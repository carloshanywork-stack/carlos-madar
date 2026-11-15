package com.madar.rep.app.data.map

import android.database.sqlite.SQLiteDatabase
import com.madar.rep.app.core.TileMath
import java.io.Closeable
import java.io.File

data class MbTileKey(val z: Int, val x: Int, val y: Int)

/**
 * Minimal MBTiles 1.3 reader/writer on top of the platform SQLite. MBTiles stores
 * rows in TMS order; every public method here takes XYZ (slippy) coordinates.
 */
class MbTilesStore(val file: File) : Closeable {
    private var database: SQLiteDatabase? = null
    private var writable = false

    fun open(readOnly: Boolean = true): MbTilesStore {
        if (database != null) return this
        database = if (readOnly) {
            SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
        } else {
            SQLiteDatabase.openOrCreateDatabase(file, null).apply {
                execSQL("PRAGMA journal_mode=WAL")
                execSQL("PRAGMA synchronous=NORMAL")
            }
        }
        writable = !readOnly
        return this
    }

    fun create(packId: String, metadata: Map<String, String>) {
        file.parentFile?.mkdirs()
        database = SQLiteDatabase.openOrCreateDatabase(file, null).apply {
            execSQL("PRAGMA journal_mode=WAL")
            execSQL("PRAGMA synchronous=NORMAL")
            execSQL("CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT)")
            execSQL("CREATE TABLE IF NOT EXISTS tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)")
            execSQL("CREATE UNIQUE INDEX IF NOT EXISTS tile_index ON tiles (zoom_level, tile_column, tile_row)")
        }
        writable = true
        metadata.forEach { (name, value) ->
            database!!.execSQL("INSERT OR REPLACE INTO metadata (name, value) VALUES (?, ?)", arrayOf(name, value))
        }
        database!!.execSQL("INSERT OR REPLACE INTO metadata (name, value) VALUES ('madar_pack_id', ?)", arrayOf(packId))
    }

    fun metadata(): Map<String, String> {
        val db = database ?: return emptyMap()
        val result = linkedMapOf<String, String>()
        db.rawQuery("SELECT name, value FROM metadata", null).use { cursor ->
            while (cursor.moveToNext()) {
                val name = cursor.getString(0) ?: continue
                result[name] = cursor.getString(1).orEmpty()
            }
        }
        return result
    }

    fun existingTiles(): HashSet<MbTileKey> {
        val result = HashSet<MbTileKey>()
        val db = database ?: return result
        db.rawQuery("SELECT zoom_level, tile_column, tile_row FROM tiles", null).use { cursor ->
            while (cursor.moveToNext()) {
                val zoom = cursor.getInt(0)
                result.add(MbTileKey(zoom, cursor.getInt(1), TileMath.xyzY(cursor.getInt(2), zoom)))
            }
        }
        return result
    }

    fun putTile(tile: MbTileKey, bytes: ByteArray) {
        check(writable) { "MBTiles store is read-only" }
        val db = database ?: error("MBTiles store is closed")
        db.execSQL(
            "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
            arrayOf(tile.z, tile.x, TileMath.tmsY(tile.y, tile.z), bytes),
        )
    }

    fun beginTransaction() {
        database?.beginTransaction()
    }

    fun setTransactionSuccessful() {
        database?.setTransactionSuccessful()
    }

    fun endTransaction() {
        database?.endTransaction()
    }

    fun tileCount(): Int {
        val db = database ?: return 0
        db.rawQuery("SELECT COUNT(*) FROM tiles", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    fun tileBytes(): Long {
        val db = database ?: return 0L
        db.rawQuery("SELECT COALESCE(SUM(length(tile_data)), 0) FROM tiles", null).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getLong(0) else 0L
        }
    }

    fun readTile(z: Int, x: Int, y: Int): ByteArray? {
        val db = database ?: return null
        db.rawQuery(
            "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ? LIMIT 1",
            arrayOf(z.toString(), x.toString(), TileMath.tmsY(y, z).toString()),
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return cursor.getBlob(0)
        }
    }

    fun closeQuietly() {
        runCatching { database?.close() }
        database = null
    }

    override fun close() = closeQuietly()

    fun compact() {
        runCatching { database?.execSQL("VACUUM") }
    }

    companion object {
        fun isValid(file: File): Boolean {
            if (!file.isFile || file.length() <= 0L) return false
            return runCatching {
                MbTilesStore(file).open(readOnly = true).use { store ->
                    store.metadata().isNotEmpty() && store.tileCount() > 0
                }
            }.getOrDefault(false)
        }
    }
}
