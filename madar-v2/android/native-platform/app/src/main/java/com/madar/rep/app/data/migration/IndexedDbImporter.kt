package com.madar.rep.app.data.migration

import android.content.Context
import android.util.Base64
import androidx.room.withTransaction
import com.madar.rep.app.core.GovernorateIndex
import com.madar.rep.app.core.Hashing
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.api.AttendanceEnvelope
import com.madar.rep.app.data.api.MaintenanceLine
import com.madar.rep.app.data.db.AttendanceActionEntity
import com.madar.rep.app.data.db.AttendanceActionState
import com.madar.rep.app.data.db.AttendanceSnapshotEntity
import com.madar.rep.app.data.db.FaultReasonSnapshotEntity
import com.madar.rep.app.data.db.LegacyImportEntity
import com.madar.rep.app.data.db.MachineActionEntity
import com.madar.rep.app.data.db.MachineActionState
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.db.PhotoEntity
import com.madar.rep.app.data.db.RouteSnapshotEntity
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Imports the temporary WebView bridge export of `madar-rep-offline` (IndexedDB)
 * after the SQLite queue has been imported. Every item is verified against the
 * same owner/UUID ledger, so the bridge can be retried or interrupted without
 * duplicating a visit or overwriting evidence.
 */
class IndexedDbImporter(
    private val context: Context,
    private val database: MadarDatabase,
    private val governorates: GovernorateIndex,
    private val json: Json,
) {
    private val filesRoot: File by lazy { context.filesDir.canonicalFile }

    suspend fun import(raw: String, onItem: (String) -> Unit): MigrationCounts {
        val root = runCatching { json.parseToJsonElement(raw).jsonObject }
            .getOrElse { throw IllegalStateException("استجابة استعادة المتصفح غير صالحة") }
        if (root["ok"]?.jsonPrimitive?.booleanOrNull == false) {
            throw IllegalStateException(root.string("error") ?: "تعذر قراءة تخزين المتصفح القديم")
        }
        var counts = MigrationCounts()
        val visits = root["visits"] as? JsonArray
        visits?.forEach { element ->
            val item = element as? JsonObject ?: return@forEach
            onItem("browser-visit")
            when (importVisit(item)) {
                true -> counts = counts.copy(visits = counts.visits + 1)
                false -> counts = counts.copy(skipped = counts.skipped + 1)
                null -> Unit
            }
        }
        val actions = root["machineActions"] as? JsonArray
        actions?.forEach { element ->
            val item = element as? JsonObject ?: return@forEach
            onItem("browser-machine")
            if (importMachineAction(item)) counts = counts.copy(machineActions = counts.machineActions + 1)
        }
        val routes = root["routeSnapshots"] as? JsonArray
        routes?.forEach { element ->
            val item = element as? JsonObject ?: return@forEach
            if (importRouteSnapshot(item)) counts = counts.copy(routeSnapshots = counts.routeSnapshots + 1)
        }
        val reasons = root["reasonSnapshots"] as? JsonArray
        reasons?.forEach { element ->
            val item = element as? JsonObject ?: return@forEach
            if (importReasonSnapshot(item)) counts = counts.copy(reasons = counts.reasons + 1)
        }
        val attendance = root["attendanceSnapshots"] as? JsonArray
        attendance?.forEach { element ->
            val item = element as? JsonObject ?: return@forEach
            if (importAttendanceSnapshot(item)) counts = counts.copy(attendance = counts.attendance + 1)
        }
        return counts
    }

    private suspend fun importVisit(item: JsonObject): Boolean? {
        val uuid = item.string("visitUuid") ?: return null
        val repId = item.long("repId") ?: return null
        if (repId < 1 || database.legacyImports().find(SOURCE, "visit", uuid) != null) return false
        if (database.visits().find(uuid) != null) return false
        val payload = item["payload"] as? JsonObject ?: return null
        val nativeStoragePath = item.string("nativeStoragePath")
        val photos = ArrayList<PhotoEntity>()
        var missing = 0
        for (phase in listOf("before", "after")) {
            val entries = (when (phase) {
                "before" -> item["beforePhotos"]
                else -> item["afterPhotos"]
            }) as? JsonArray ?: emptyList()
            entries.forEachIndexed { index, element ->
                val photo = element as? JsonObject ?: return@forEachIndexed
                val entity = writePhoto(uuid, phase, index, photo)
                if (entity == null) missing += 1 else photos.add(entity)
            }
        }
        val beforeCount = photos.count { it.phase == "before" }
        val afterCount = photos.count { it.phase == "after" }
        val countsValid = beforeCount in 1..20 && afterCount in 1..20
        val payloadText = payload.toString()
        val identity = Hashing.sha256Hex(
            buildString {
                append(SOURCE).append('\n').append(uuid.lowercase()).append('\n').append(repId).append('\n')
                append(payloadText).append('\n')
                photos.sortedWith(compareBy({ it.phase }, { it.position })).forEach {
                    append(it.phase).append(':').append(it.position).append(':').append(it.sha256).append('\n')
                }
            }.toByteArray()
        )
        val created = MadarTime.parseIso(item.string("createdAt")) ?: System.currentTimeMillis()
        val captured = MadarTime.parseIso(payload.string("capturedAt")) ?: created
        val status = item.string("status") ?: "queued"
        val state = when {
            status == "synced" -> VisitState.APPROVED
            !countsValid || missing > 0 -> VisitState.NEEDS_REVIEW
            status == "blocked" -> VisitState.NEEDS_REVIEW
            else -> VisitState.QUEUED
        }
        val location = payload.location()
        val entity = VisitEntity(
            visitUuid = uuid,
            ownerRepId = repId,
            cardId = payload.long("cardId") ?: 0L,
            machineCode = payload.string("machineCode").orEmpty(),
            machineName = payload.string("machineName").orEmpty(),
            regionName = payload.string("regionName").orEmpty().ifBlank { "غير محددة" }.take(160),
            areaName = payload.string("areaName").orEmpty(),
            clientName = payload.string("clientName").orEmpty(),
            address = payload.string("address").orEmpty(),
            machineLatitude = payload.double("machineLatitude"),
            machineLongitude = payload.double("machineLongitude"),
            geofenceRadiusMeters = payload.double("geofenceRadiusMeters") ?: 50.0,
            locationLocked = payload.boolean("locationLocked") ?: false,
            machineCondition = payload.string("machineCondition")
                ?.takeIf { it in setOf("working", "faulty", "preventive_maintenance") } ?: "working",
            reasonIdsCsv = payload.reasonIds().distinct().sorted().joinToString(","),
            maintenanceLinesJson = json.encodeToString(
                ListSerializer(MaintenanceLine.serializer()),
                payload.maintenanceLines(),
            ),
            notes = payload.string("notes").orEmpty().take(10_000),
            capturedAt = captured,
            beforeCapturedAtCsv = photos.filter { it.phase == "before" }.sortedBy { it.position }
                .joinToString(",") { it.capturedAt.toString() },
            afterCapturedAtCsv = photos.filter { it.phase == "after" }.sortedBy { it.position }
                .joinToString(",") { it.capturedAt.toString() },
            latitude = location?.first?.latitude,
            longitude = location?.first?.longitude,
            locationAccuracy = location?.first?.accuracyMeters,
            locationCapturedAt = location?.first?.capturedAtMillis,
            locationProvider = "legacy-browser",
            governorate = location?.first?.let { governorates.find(it.latitude, it.longitude)?.nameAr },
            photoPolicyVersion = 2,
            state = state,
            serverStatus = if (status == "synced") "legacy_synced" else null,
            lastError = when {
                missing > 0 -> "صور من متصفح التطبيق القديم مفقودة ($missing)؛ الزيارة للمراجعة."
                !countsValid -> "صور الزيارة القديمة غير مكتملة؛ الزيارة للمراجعة."
                state == VisitState.NEEDS_REVIEW -> item.string("lastError")
                    ?: "الزيارة القديمة موقوفة للمراجعة."
                else -> null
            },
            attempts = item.long("attempts")?.toInt()?.coerceAtLeast(0) ?: 0,
            nextAttemptAt = 0,
            contentHash = identity,
            createdAt = created,
            updatedAt = System.currentTimeMillis(),
        )
        if (nativeStoragePath != null && photos.isEmpty()) return false
        database.withTransaction {
            database.visits().upsert(entity)
            if (photos.isNotEmpty()) database.photos().upsertAll(photos)
            database.legacyImports().put(LegacyImportEntity(SOURCE, "visit", uuid, identity, System.currentTimeMillis()))
        }
        return true
    }

    private fun writePhoto(visitUuid: String, phase: String, index: Int, item: JsonObject): PhotoEntity? {
        val captured = MadarTime.parseIso(item.string("capturedAt")) ?: System.currentTimeMillis()
        val destination = File(
            File(File(filesRoot, "visits"), "$visitUuid/${if (phase == "before") "before" else "after"}"),
            "IMG_${"%04d".format(index + 1)}_processed.jpg",
        )
        val written = runCatching {
            destination.parentFile?.mkdirs()
            val base64 = item.string("base64")
            if (base64 != null) {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                if (bytes.isEmpty() || bytes.size > 8 * 1024 * 1024) return null
                val temporary = File(destination.parentFile, destination.name + ".part")
                try {
                    FileOutputStream(temporary).use { output ->
                        output.write(bytes)
                        output.flush()
                        output.fd.sync()
                    }
                    if (!temporary.renameTo(destination)) {
                        temporary.copyTo(destination, overwrite = true)
                        temporary.delete()
                    }
                } catch (error: Exception) {
                    temporary.delete()
                    throw error
                }
                destination
            } else {
                val path = item.string("path") ?: return null
                val source = File(path).canonicalFile
                if (!source.isFile || source.length() <= 0L) return null
                if (!source.path.startsWith(filesRoot.path + File.separator)) return null
                copyDurably(source, destination)
                destination
            }
        }.getOrNull() ?: return null
        val hash = Hashing.sha256File(written)
        return PhotoEntity(
            id = UUID.nameUUIDFromBytes("legacy-indexeddb:$visitUuid:$phase:$index".toByteArray()).toString(),
            visitUuid = visitUuid,
            phase = phase,
            position = index,
            originalPath = written.absolutePath,
            processedPath = written.absolutePath,
            capturedAt = captured,
            provider = "legacy-browser",
            watermarkText = "",
            sha256 = hash,
            sizeBytes = written.length(),
            mimeType = "image/jpeg",
            uploaded = false,
            createdAt = System.currentTimeMillis(),
        )
    }

    private suspend fun importMachineAction(item: JsonObject): Boolean {
        val uuid = item.string("actionUuid") ?: return false
        val repId = item.long("repId") ?: return false
        val machineId = item.long("machineId") ?: return false
        val cardId = item.long("cardId") ?: return false
        val type = item.string("type") ?: return false
        if (repId < 1 || machineId < 1 || cardId < 1) return false
        if (type != "confirm_location" && type != "report_correction") return false
        if (database.legacyImports().find(SOURCE, "machine", uuid) != null) return false
        if (database.machineActions().find(uuid) != null) return false
        val payload = item["payload"] as? JsonObject ?: JsonObject(emptyMap())
        val evidenceBase64 = item.string("evidenceBase64")
        val evidenceType = item.string("evidenceMimeType") ?: "image/jpeg"
        var evidence: File? = null
        if (evidenceBase64 != null) {
            val bytes = runCatching { Base64.decode(evidenceBase64, Base64.DEFAULT) }.getOrNull()
            if (bytes != null && bytes.isNotEmpty() && bytes.size <= 8 * 1024 * 1024) {
                val extension = when (evidenceType) {
                    "image/png" -> "png"
                    "image/webp" -> "webp"
                    else -> "jpg"
                }
                val directory = File(filesRoot, "legacy-machine-evidence").apply { mkdirs() }
                val destination = File(directory, "$uuid.$extension")
                runCatching {
                    destination.outputStream().use { it.write(bytes) }
                    evidence = destination
                }
            }
        }
        val identity = Hashing.sha256Hex(
            "$SOURCE\n$uuid\n$type\n$machineId\n$cardId\n$payload\n${evidence?.length() ?: 0}".toByteArray()
        )
        val status = item.string("status") ?: "queued"
        val state = when (status) {
            "queued", "syncing" -> MachineActionState.QUEUED
            "pending_approval" -> MachineActionState.PENDING_APPROVAL
            "approved" -> MachineActionState.APPROVED
            "rejected" -> MachineActionState.REJECTED
            else -> MachineActionState.NEEDS_REVIEW
        }
        val entity = MachineActionEntity(
            actionUuid = uuid,
            ownerRepId = repId,
            type = type,
            machineId = machineId,
            cardId = cardId,
            payloadJson = payload.toString(),
            evidencePath = evidence?.absolutePath,
            evidenceContentType = evidenceType,
            state = state,
            attempts = item.long("attempts")?.toInt()?.coerceAtLeast(0) ?: 0,
            nextAttemptAt = 0,
            lastError = item.string("lastError"),
            correctionId = item.long("correctionId"),
            serverStatus = item.string("serverStatus"),
            createdAt = MadarTime.parseIso(item.string("createdAt")) ?: System.currentTimeMillis(),
            updatedAt = System.currentTimeMillis(),
        )
        database.withTransaction {
            database.machineActions().upsert(entity)
            database.legacyImports().put(LegacyImportEntity(SOURCE, "machine", uuid, identity, System.currentTimeMillis()))
        }
        return true
    }

    private suspend fun importRouteSnapshot(item: JsonObject): Boolean {
        val repId = item.long("repId") ?: return false
        val route = item["route"] as? JsonObject ?: return false
        if (repId < 1 || database.routes().get(repId) != null) return false
        val cachedAt = MadarTime.parseIso(item.string("cachedAt")) ?: System.currentTimeMillis()
        database.routes().put(RouteSnapshotEntity(repId, route.toString(), cachedAt, cachedAt))
        return true
    }

    private suspend fun importReasonSnapshot(item: JsonObject): Boolean {
        val repId = item.long("repId") ?: return false
        val reasons = item["reasons"] as? JsonArray ?: return false
        if (repId < 1 || database.faultReasons().get(repId) != null) return false
        database.faultReasons().put(FaultReasonSnapshotEntity(repId, reasons.toString(), System.currentTimeMillis()))
        return true
    }

    private suspend fun importAttendanceSnapshot(item: JsonObject): Boolean {
        val repId = item.long("repId") ?: return false
        if (repId < 1 || database.attendanceSnapshots().get(repId) != null) return false
        val envelope = json.encodeToString(
            AttendanceEnvelope.serializer(),
            AttendanceEnvelope(
                success = true,
                date = item.string("date").orEmpty(),
                attendance = item["attendance"]?.let {
                    runCatching {
                        json.decodeFromJsonElement(
                            com.madar.rep.app.data.api.AttendanceRecord.serializer(),
                            it,
                        )
                    }.getOrNull()
                },
                overtimeRequest = item["overtimeRequest"]?.let {
                    runCatching {
                        json.decodeFromJsonElement(
                            com.madar.rep.app.data.api.OvertimeRequest.serializer(),
                            it,
                        )
                    }.getOrNull()
                },
            )
        )
        val fetchedAt = MadarTime.parseIso(item.string("cachedAt")) ?: System.currentTimeMillis()
        database.attendanceSnapshots().put(AttendanceSnapshotEntity(repId, envelope, fetchedAt))
        return true
    }

    private fun copyDurably(source: File, destination: File) {
        destination.parentFile?.mkdirs()
        val temporary = File(destination.parentFile, destination.name + ".part")
        try {
            source.inputStream().use { input ->
                FileOutputStream(temporary).use { output ->
                    input.copyTo(output, 128 * 1024)
                    output.flush()
                    output.fd.sync()
                }
            }
            if (temporary.length() != source.length()) throw IllegalStateException("نسخة الصورة غير مكتملة")
            if (!temporary.renameTo(destination)) {
                temporary.copyTo(destination, overwrite = true)
                temporary.delete()
            }
        } catch (error: Exception) {
            temporary.delete()
            throw error
        }
    }

    companion object {
        const val SOURCE = "legacy-indexeddb"
    }
}
