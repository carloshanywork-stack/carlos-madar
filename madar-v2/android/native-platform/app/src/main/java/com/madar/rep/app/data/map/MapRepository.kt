package com.madar.rep.app.data.map

import android.content.Context
import com.madar.rep.app.core.Hashing
import com.madar.rep.app.core.MadarError
import com.madar.rep.app.data.api.MadarApi
import com.madar.rep.app.data.api.MapManifest
import com.madar.rep.app.data.db.MapPackEntity
import com.madar.rep.app.data.db.MapPackState
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.session.Session
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

/**
 * Downloads a licensed raster pack tile by tile into a real MBTiles file. Partial
 * downloads are resumable: existing tile rows are skipped, and the file is only
 * renamed into place after coverage, byte count, license, and tile count pass
 * activation checks. No Google Maps or network tile fallback is used.
 */
class MapRepository(
    private val context: Context,
    private val database: MadarDatabase,
) {
    private val directory = File(context.filesDir, "maps")

    fun observePacks(): Flow<List<MapPackEntity>> = database.mapPacks().observeAll()

    fun fileFor(packId: String): File {
        val safe = packId.replace(Regex("[^A-Za-z0-9._-]"), "_")
        return File(directory, "$safe.mbtiles")
    }

    fun partFileFor(packId: String): File = File(fileFor(packId).parentFile, fileFor(packId).name + ".part")

    suspend fun activeVerified(): MapPackEntity? = withContext(Dispatchers.IO) {
        val pack = database.mapPacks().active() ?: return@withContext null
        if (isUsable(pack)) pack else null
    }

    suspend fun openActive(): MbTilesStore? = withContext(Dispatchers.IO) {
        val pack = activeVerified() ?: return@withContext null
        runCatching { MbTilesStore(File(pack.path)).open(readOnly = true) }.getOrNull()
    }

    suspend fun refreshCatalog(session: Session, api: MadarApi): List<MapPackEntity> = withContext(Dispatchers.IO) {
        val packs = api.getMapPacks(session.token)
        val now = System.currentTimeMillis()
        packs.map { remote ->
            val existing = database.mapPacks().find(remote.id)
            val file = File(existing?.path?.takeIf { it.isNotBlank() } ?: fileFor(remote.id).absolutePath)
            val verifiedOnDisk = existing?.state == MapPackState.VERIFIED && file.isFile && file.length() > 0
            val b = remote.effectiveBounds
            val entity = MapPackEntity(
                id = remote.id,
                name = remote.name,
                minZoom = remote.minZoom,
                maxZoom = remote.maxZoom,
                boundsWest = b?.west,
                boundsSouth = b?.south,
                boundsEast = b?.east,
                boundsNorth = b?.north,
                attribution = remote.attribution,
                sourceName = remote.sourceName,
                license = remote.license.ifBlank { existing?.license.orEmpty() },
                format = remote.format ?: existing?.format.orEmpty(),
                path = if (verifiedOnDisk) file.absolutePath else fileFor(remote.id).absolutePath,
                sizeBytes = if (verifiedOnDisk) existing?.sizeBytes ?: remote.sizeBytes else remote.sizeBytes,
                sha256 = existing?.sha256.orEmpty(),
                tileCount = remote.tileCount,
                downloadedTiles = if (verifiedOnDisk) existing?.downloadedTiles ?: remote.tileCount else 0,
                state = if (verifiedOnDisk) MapPackState.VERIFIED else MapPackState.NOT_DOWNLOADED,
                lastError = if (remote.available) existing?.lastError.takeIf { !verifiedOnDisk } else remote.reason,
                updatedAt = now,
            )
            database.mapPacks().upsert(entity)
            entity
        }
    }

    suspend fun download(
        session: Session,
        api: MadarApi,
        packId: String,
        onProgress: (downloaded: Int, total: Int) -> Unit = { _, _ -> },
    ): MapPackEntity = withContext(Dispatchers.IO) {
        val catalog = database.mapPacks().find(packId)
            ?: throw MadarError.Validation("حزمة الخريطة غير معروفة")
        val manifest = api.getMapManifest(session.token, packId)
            ?: throw MadarError.Validation("الخادم لا يعرف حزمة الخريطة")
        if (!manifest.available || !manifest.renderable) {
            throw MadarError.Validation("الحزمة غير متاحة للنظام النقطي على الخادم")
        }
        if (manifest.license.isBlank()) {
            throw MadarError.Validation("الحزمة لا تحمل بيانات ترخيص؛ لا يمكن تفعيلها دون ترخيص موثق")
        }
        if (manifest.tiles.isEmpty() || manifest.tileCount <= 0) {
            throw MadarError.Validation("قائمة بلاطات الحزمة فارغة")
        }
        val finalFile = fileFor(packId)
        val part = partFileFor(packId)
        val existingVerified = finalFile.isFile && catalog.state == MapPackState.VERIFIED && isUsable(catalog)
        if (existingVerified) return@withContext catalog

        val previous = database.mapPacks().find(packId)
        database.mapPacks().upsert(
            (previous ?: catalog).copy(
                state = MapPackState.DOWNLOADING,
                lastError = null,
                updatedAt = System.currentTimeMillis(),
            )
        )

        var store: MbTilesStore? = null
        try {
            directory.mkdirs()
            store = MbTilesStore(part).apply {
                create(
                    packId = manifest.id,
                    metadata = buildMap {
                        put("name", manifest.name)
                        put("format", manifest.format ?: "png")
                        put("minzoom", manifest.minZoom.toString())
                        put("maxzoom", manifest.maxZoom.toString())
                        put("attribution", manifest.attribution)
                        put("license", manifest.license)
                        put("source_name", manifest.sourceName.orEmpty())
                        manifest.effectiveBounds?.let {
                            put("bounds", "${it.west},${it.south},${it.east},${it.north}")
                        }
                    },
                )
            }
            val present = store.existingTiles()
            val total = manifest.tiles.size
            var downloaded = present.size
            onProgress(downloaded, total)
            var batch = 0
            var inTransaction = false
            var missing = 0
            var lastProgressTime = 0L
            for (tile in manifest.tiles) {
                val key = MbTileKey(tile.z, tile.x, tile.y)
                if (key in present) continue
                val bytes = api.downloadTileBytes(session.token, packId, tile.z, tile.x, tile.y)
                if (bytes == null) {
                    missing += 1
                    continue
                }
                if (!inTransaction) {
                    store.beginTransaction()
                    inTransaction = true
                }
                store.putTile(key, bytes)
                downloaded += 1
                batch += 1
                val now = System.currentTimeMillis()
                if (batch >= 100 || (batch >= 20 && now - lastProgressTime >= 300L)) {
                    store.setTransactionSuccessful()
                    store.endTransaction()
                    inTransaction = false
                    batch = 0
                    lastProgressTime = now
                    onProgress(downloaded, total)
                }
            }
            if (inTransaction) {
                store.setTransactionSuccessful()
                store.endTransaction()
            }
            if (missing > 0) throw MadarError.Validation("ينقص الحزمة $missing بلاطة داخل نطاق التغطية")
            val actualTiles = store.tileCount()
            val actualBytes = store.tileBytes()
            if (actualTiles != manifest.tileCount) {
                throw MadarError.Validation("عدد البلاطات المنزّلة $actualTiles لا يطابق بيانات الحزمة ${manifest.tileCount}")
            }
            if (manifest.sizeBytes > 0 && actualBytes != manifest.sizeBytes) {
                throw MadarError.Validation("حجم البلاطات المنزّلة لا يطابق بيانات الحزمة")
            }
            store.closeQuietly()
            store = null
            if (!part.renameTo(finalFile)) {
                part.copyTo(finalFile, overwrite = true)
                part.delete()
            }
            val hash = Hashing.sha256File(finalFile)
            val entity = (database.mapPacks().find(packId) ?: catalog).copy(
                path = finalFile.absolutePath,
                sizeBytes = finalFile.length(),
                sha256 = hash,
                tileCount = actualTiles,
                downloadedTiles = actualTiles,
                state = MapPackState.VERIFIED,
                lastError = null,
                updatedAt = System.currentTimeMillis(),
            )
            database.mapPacks().upsert(entity)
            onProgress(actualTiles, actualTiles)
            entity
        } catch (error: Exception) {
            runCatching { store?.closeQuietly() }
            val message = error.message ?: "تعذر تنزيل حزمة الخريطة"
            database.mapPacks().upsert(
                (database.mapPacks().find(packId) ?: catalog).copy(
                    state = MapPackState.FAILED,
                    lastError = message,
                    updatedAt = System.currentTimeMillis(),
                )
            )
            throw error
        }
    }

    suspend fun delete(packId: String) = withContext(Dispatchers.IO) {
        fileFor(packId).delete()
        partFileFor(packId).delete()
        val pack = database.mapPacks().find(packId) ?: return@withContext
        database.mapPacks().upsert(
            pack.copy(
                state = MapPackState.NOT_DOWNLOADED,
                downloadedTiles = 0,
                sha256 = "",
                path = fileFor(packId).absolutePath,
                lastError = null,
                updatedAt = System.currentTimeMillis(),
            )
        )
    }

    suspend fun isUsable(pack: MapPackEntity): Boolean = withContext(Dispatchers.IO) {
        if (pack.state != MapPackState.VERIFIED) return@withContext false
        val file = File(pack.path)
        if (!file.isFile || file.length() <= 0L) return@withContext false
        runCatching {
            MbTilesStore(file).open(readOnly = true).use { store ->
                val metadata = store.metadata()
                metadata["madar_pack_id"] == pack.id &&
                    metadata["license"].orEmpty().isNotBlank() &&
                    store.tileCount() > 0 &&
                    (pack.tileCount <= 0 || store.tileCount() == pack.tileCount)
            }
        }.getOrDefault(false)
    }

    fun boundsOf(pack: MapPackEntity): com.madar.rep.app.core.GeoBounds? {
        val west = pack.boundsWest ?: return null
        val south = pack.boundsSouth ?: return null
        val east = pack.boundsEast ?: return null
        val north = pack.boundsNorth ?: return null
        return com.madar.rep.app.core.GeoBounds(west, south, east, north)
    }
}
