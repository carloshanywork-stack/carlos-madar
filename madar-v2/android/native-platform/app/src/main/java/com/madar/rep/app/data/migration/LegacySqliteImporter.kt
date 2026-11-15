package com.madar.rep.app.data.migration

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import androidx.room.withTransaction
import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.GovernorateIndex
import com.madar.rep.app.core.Hashing
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.api.MaintenanceLine
import com.madar.rep.app.data.db.AttendanceActionEntity
import com.madar.rep.app.data.db.AttendanceActionState
import com.madar.rep.app.data.db.FaultReasonSnapshotEntity
import com.madar.rep.app.data.db.LegacyImportEntity
import com.madar.rep.app.data.db.MachineActionEntity
import com.madar.rep.app.data.db.MachineActionState
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.db.MapPackState
import com.madar.rep.app.data.db.MigrationEntity
import com.madar.rep.app.data.db.PhotoEntity
import com.madar.rep.app.data.db.RouteSnapshotEntity
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

data class MigrationCounts(
    val visits: Int = 0,
    val photos: Int = 0,
    val attendance: Int = 0,
    val machineActions: Int = 0,
    val routeSnapshots: Int = 0,
    val reasons: Int = 0,
    val skipped: Int = 0,
)

/**
 * One-time import of the Capacitor-era SQLite queue. It never rewrites evidence
 * bytes: legacy watermarked JPEGs are copied unchanged into the native folder
 * layout, hashed, and linked to their original UUID, owner, attempts, status, and
 * error. Room's transaction covers the visit, its photos, and the idempotency
 * ledger so an interrupted migration can safely run again.
 */
class LegacySqliteImporter(
    private val context: Context,
    private val database: MadarDatabase,
    private val governorates: GovernorateIndex,
    private val json: Json,
) {
    private val filesRoot: File by lazy { context.filesDir.canonicalFile }
    private val uploadsRoot: File by lazy { File(File(context.filesDir, "MADAR"), "uploads").canonicalFile }

    fun legacyDatabase(): File = context.getDatabasePath("madar_rep_local.db")

    suspend fun import(onItem: (kind: String) -> Unit): MigrationCounts {
        val file = legacyDatabase()
        if (!file.isFile) return MigrationCounts()
        val source = runCatching {
            SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
        }.getOrElse { throw IllegalStateException("تعذر فتح قاعدة البيانات القديمة: ${it.message}") }
        var counts = MigrationCounts()
        try {
            if (hasTable(source, "route_snapshots")) counts = counts.copy(routeSnapshots = importRoute(source))
            if (hasTable(source, "fault_reasons")) counts = counts.copy(reasons = importReasons(source))
            if (hasTable(source, "pending_visits")) {
                val result = importVisits(source, onItem)
                counts = counts.copy(visits = counts.visits + result.first, photos = result.second, skipped = counts.skipped + result.third)
            }
            if (hasTable(source, "pending_attendance_actions")) {
                counts = counts.copy(attendance = importAttendance(source, onItem))
            }
            if (hasTable(source, "pending_machine_actions")) {
                counts = counts.copy(machineActions = importMachineActions(source, onItem))
            }
        } finally {
            source.close()
        }
        return counts
    }

    private suspend fun importRoute(source: SQLiteDatabase): Int {
        var imported = 0
        source.rawQuery("SELECT rep_id, route_json, cached_at FROM route_snapshots", null).use { cursor ->
            while (cursor.moveToNext()) {
                val repId = cursor.getLong(0)
                val routeJson = cursor.getString(1) ?: continue
                if (repId < 1 || routeJson.isBlank()) continue
                val cachedAt = MadarTime.parseIso(cursor.getString(2)) ?: System.currentTimeMillis()
                val existing = database.routes().get(repId)
                if (existing == null || existing.fetchedAt < cachedAt) {
                    database.routes().put(
                        RouteSnapshotEntity(
                            ownerRepId = repId,
                            routeJson = routeJson,
                            fetchedAt = cachedAt,
                            lastReconciledAt = cachedAt,
                        )
                    )
                    imported += 1
                }
            }
        }
        return imported
    }

    private suspend fun importReasons(source: SQLiteDatabase): Int {
        var imported = 0
        val byRep = linkedMapOf<Long, MutableList<String>>()
        source.rawQuery("SELECT rep_id, data_json FROM fault_reasons ORDER BY rep_id, reason_id", null).use { cursor ->
            while (cursor.moveToNext()) {
                val repId = cursor.getLong(0)
                val data = cursor.getString(1) ?: continue
                if (repId < 1) continue
                byRep.getOrPut(repId) { mutableListOf() }.add(data)
            }
        }
        byRep.forEach { (repId, reasons) ->
            val snapshot = FaultReasonSnapshotEntity(repId, "[${reasons.joinToString(",")}]", System.currentTimeMillis())
            database.faultReasons().put(snapshot)
            imported += reasons.size
        }
        return imported
    }

    private suspend fun importVisits(
        source: SQLiteDatabase,
        onItem: (String) -> Unit,
    ): Triple<Int, Int, Int> {
        var visits = 0
        var photos = 0
        var skipped = 0
        source.rawQuery(
            "SELECT visit_uuid, rep_id, rep_username, payload_json, status, attempts, last_error, created_at FROM pending_visits ORDER BY created_at",
            null,
        ).use { cursor ->
            while (cursor.moveToNext()) {
                onItem("visit")
                val visitUuid = cursor.getString(0)
                val repId = cursor.getLong(1)
                val payloadJson = cursor.getString(3) ?: ""
                val status = cursor.getString(4) ?: "pending"
                val attempts = cursor.getInt(5)
                val lastError = cursor.getString(6).orEmpty()
                val createdAt = MadarTime.parseIso(cursor.getString(7)) ?: System.currentTimeMillis()
                if (!isUuid(visitUuid) || repId < 1 || payloadJson.isBlank()) {
                    skipped += 1
                    continue
                }
                val existingLedger = database.legacyImports().find(SOURCE, "visit", visitUuid)
                if (existingLedger != null) {
                    skipped += 1
                    continue
                }
                if (database.visits().find(visitUuid) != null) {
                    skipped += 1
                    continue
                }
                val payload = runCatching { json.parseToJsonElement(payloadJson).jsonObject }.getOrNull()
                if (payload == null) {
                    skipped += 1
                    continue
                }
                val legacyPhotos = mutableListOf<PhotoEntity>()
                var missingEvidence = 0
                source.rawQuery(
                    "SELECT phase, photo_index, path, captured_at FROM visit_photos WHERE visit_uuid = ? ORDER BY CASE phase WHEN 'before' THEN 0 ELSE 1 END, photo_index",
                    arrayOf(visitUuid),
                ).use { photoCursor ->
                    while (photoCursor.moveToNext()) {
                        val phase = photoCursor.getString(0) ?: continue
                        val index = photoCursor.getInt(1)
                        val path = photoCursor.getString(2) ?: continue
                        val capturedAt = MadarTime.parseIso(photoCursor.getString(3))
                        val processed = payloadPhoto(visitUuid, phase, index, path, capturedAt, payload)
                        if (processed == null) {
                            missingEvidence += 1
                        } else {
                            legacyPhotos.add(processed)
                            photos += 1
                        }
                    }
                }
                val beforeCount = legacyPhotos.count { it.phase == "before" }
                val afterCount = legacyPhotos.count { it.phase == "after" }
                val declaredPolicy = payload.long("photoPolicyVersion")
                val policyVersion = when {
                    declaredPolicy == 2L -> 2
                    declaredPolicy == null && beforeCount == 3 && afterCount <= 3 -> 2
                    else -> 1
                }
                val countsValid = beforeCount in 1..20 && afterCount in 1..20
                val mappedState = when {
                    status == "synced" -> VisitState.APPROVED
                    status == "blocked" -> VisitState.NEEDS_REVIEW
                    !countsValid || missingEvidence > 0 -> VisitState.NEEDS_REVIEW
                    else -> VisitState.QUEUED
                }
                val stateError = when {
                    status == "blocked" -> lastError.ifBlank { "أُوقفت الزيارة في التطبيق القديم؛ البيانات محفوظة للمراجعة." }
                    missingEvidence > 0 -> "بعض صور الزيارة القديمة مفقودة ($missingEvidence)؛ الزيارة للمراجعة."
                    !countsValid -> "عدد صور الزيارة القديمة لا يطابق سياسة الصور؛ الزيارة للمراجعة."
                    policyVersion == 1 -> "سياسة الصور القديمة غير معروفة؛ الزيارة للمراجعة."
                    else -> lastError.takeIf { it.isNotBlank() }
                }
                val location = payload.location()
                val identityHash = Hashing.sha256Hex(
                    buildString {
                        append(SOURCE).append('\n')
                        append(visitUuid.lowercase()).append('\n')
                        append(repId).append('\n')
                        append(payloadJson).append('\n')
                        legacyPhotos.sortedWith(compareBy({ it.phase }, { it.position })).forEach {
                            append(it.phase).append(':').append(it.position).append(':').append(it.sizeBytes).append(':')
                                .append(it.sha256).append('\n')
                        }
                    }.toByteArray(Charsets.UTF_8)
                )
                val capturedAt = MadarTime.parseIso(payload.string("capturedAt")) ?: createdAt
                val entity = VisitEntity(
                    visitUuid = visitUuid,
                    ownerRepId = repId,
                    cardId = payload.long("cardId") ?: 0L,
                    machineCode = payload.string("machineCode").orEmpty(),
                    machineName = payload.string("machineName").orEmpty(),
                    regionName = payload.string("regionName").orEmpty()
                        .ifBlank { payload.string("areaName").orEmpty().ifBlank { "غير محددة" } }
                        .take(160),
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
                        kotlinx.serialization.builtins.ListSerializer(MaintenanceLine.serializer()),
                        payload.maintenanceLines(),
                    ),
                    notes = payload.string("notes").orEmpty().take(10_000),
                    capturedAt = capturedAt,
                    beforeCapturedAtCsv = legacyPhotos.filter { it.phase == "before" }.sortedBy { it.position }
                        .joinToString(",") { it.capturedAt.toString() },
                    afterCapturedAtCsv = legacyPhotos.filter { it.phase == "after" }.sortedBy { it.position }
                        .joinToString(",") { it.capturedAt.toString() },
                    latitude = location?.first?.latitude,
                    longitude = location?.first?.longitude,
                    locationAccuracy = location?.first?.accuracyMeters,
                    locationCapturedAt = location?.first?.capturedAtMillis,
                    locationProvider = location?.first?.provider ?: "legacy",
                    governorate = location?.first?.let { governorates.find(it.latitude, it.longitude)?.nameAr },
                    photoPolicyVersion = 2,
                    state = mappedState,
                    serverStatus = if (status == "synced") "legacy_synced" else null,
                    lastError = stateError,
                    attempts = attempts.coerceAtLeast(0),
                    nextAttemptAt = 0,
                    contentHash = identityHash,
                    createdAt = createdAt,
                    updatedAt = System.currentTimeMillis(),
                )
                database.withTransaction {
                    database.visits().upsert(entity)
                    if (legacyPhotos.isNotEmpty()) database.photos().upsertAll(legacyPhotos)
                    database.legacyImports().put(LegacyImportEntity(SOURCE, "visit", visitUuid, identityHash, System.currentTimeMillis()))
                }
                visits += 1
            }
        }
        return Triple(visits, photos, skipped)
    }

    private fun payloadPhoto(
        visitUuid: String,
        phase: String,
        index: Int,
        rawPath: String,
        capturedAt: Long?,
        payload: JsonObject,
    ): PhotoEntity? {
        if (phase != "before" && phase != "after") return null
        if (index < 0 || index >= 20) return null
        val source = runCatching { File(rawPath).canonicalFile }.getOrNull() ?: return null
        if (!source.isFile || source.length() <= 0L) return null
        val insideUploads = source.path.startsWith(uploadsRoot.path + File.separator)
        val insideFiles = source.path.startsWith(filesRoot.path + File.separator)
        if (!insideUploads && !insideFiles) return null
        val destination = File(
            File(File(filesRoot, "visits"), "$visitUuid/${if (phase == "before") "before" else "after"}"),
            "IMG_${"%04d".format(index + 1)}_processed.jpg",
        )
        return runCatching {
            copyDurably(source, destination)
            val hash = Hashing.sha256File(destination)
            PhotoEntity(
                id = java.util.UUID.nameUUIDFromBytes("legacy-sqlite:$visitUuid:$phase:$index".toByteArray()).toString(),
                visitUuid = visitUuid,
                phase = phase,
                position = index,
                originalPath = destination.absolutePath,
                processedPath = destination.absolutePath,
                capturedAt = capturedAt ?: (MadarTime.parseIso(payload.string("capturedAt")) ?: System.currentTimeMillis()),
                latitude = payload.location()?.first?.latitude,
                longitude = payload.location()?.first?.longitude,
                accuracy = payload.location()?.first?.accuracyMeters,
                provider = "legacy",
                governorate = payload.location()?.first?.let { governorates.find(it.latitude, it.longitude)?.nameAr },
                watermarkText = "",
                sha256 = hash,
                sizeBytes = destination.length(),
                mimeType = "image/jpeg",
                uploaded = false,
                createdAt = System.currentTimeMillis(),
            )
        }.getOrNull()
    }

    private suspend fun importAttendance(source: SQLiteDatabase, onItem: (String) -> Unit): Int {
        var imported = 0
        source.rawQuery(
            "SELECT action_uuid, rep_id, action, payload_json, occurred_at, status, attempts, last_error, created_at FROM pending_attendance_actions ORDER BY occurred_at, created_at",
            null,
        ).use { cursor ->
            while (cursor.moveToNext()) {
                onItem("attendance")
                val uuid = cursor.getString(0) ?: continue
                val repId = cursor.getLong(1)
                val action = cursor.getString(2) ?: continue
                val payloadJson = cursor.getString(3) ?: "{}"
                val occurredAt = MadarTime.parseIso(cursor.getString(4)) ?: System.currentTimeMillis()
                val status = cursor.getString(5) ?: "pending_attendance_sync"
                val attempts = cursor.getInt(6)
                val lastError = cursor.getString(7).orEmpty()
                if (!isUuid(uuid) || repId < 1 || (action != "in" && action != "out")) continue
                if (database.legacyImports().find(SOURCE, "attendance", uuid) != null) continue
                if (database.attendanceActions().find(uuid) != null) continue
                val payload = runCatching { json.parseToJsonElement(payloadJson).jsonObject }.getOrNull() ?: JsonObject(emptyMap())
                val biometric = payload.boolean("biometricVerified") ?: false
                val location = payload["location"] as? JsonObject
                val identityHash = Hashing.sha256Hex("$SOURCE\n$uuid\n$action\n$payloadJson".toByteArray())
                val entity = AttendanceActionEntity(
                    actionUuid = uuid,
                    ownerRepId = repId,
                    action = action,
                    occurredAtIso = MadarTime.isoUtc(occurredAt),
                    occurredAtMillis = occurredAt,
                    locationJson = location?.toString(),
                    biometricVerified = biometric,
                    state = when {
                        status == "pending_attendance_sync" && biometric -> AttendanceActionState.QUEUED
                        else -> AttendanceActionState.NEEDS_REVIEW
                    },
                    attempts = attempts.coerceAtLeast(0),
                    nextAttemptAt = 0,
                    lastError = when {
                        !biometric -> "تسجيل الحضور القديم بلا مصادقة حيوية؛ يحتاج مراجعة."
                        status != "pending_attendance_sync" -> lastError.ifBlank { "أُوقف تسجيل الحضور في التطبيق القديم." }
                        else -> lastError.takeIf { it.isNotBlank() }
                    },
                    createdAt = MadarTime.parseIso(cursor.getString(8)) ?: occurredAt,
                    updatedAt = System.currentTimeMillis(),
                )
                database.withTransaction {
                    database.attendanceActions().upsert(entity)
                    database.legacyImports().put(LegacyImportEntity(SOURCE, "attendance", uuid, identityHash, System.currentTimeMillis()))
                }
                imported += 1
            }
        }
        return imported
    }

    private suspend fun importMachineActions(source: SQLiteDatabase, onItem: (String) -> Unit): Int {
        var imported = 0
        source.rawQuery(
            "SELECT action_uuid, rep_id, action_type, machine_id, card_id, payload_json, evidence_path, evidence_content_type, status, attempts, last_error, correction_id, server_status, created_at FROM pending_machine_actions ORDER BY created_at",
            null,
        ).use { cursor ->
            while (cursor.moveToNext()) {
                onItem("machine")
                val uuid = cursor.getString(0) ?: continue
                val repId = cursor.getLong(1)
                val type = cursor.getString(2) ?: continue
                val machineId = cursor.getLong(3)
                val cardId = cursor.getLong(4)
                val payloadJson = cursor.getString(5) ?: "{}"
                val legacyEvidence = cursor.getString(6).orEmpty()
                val evidenceType = cursor.getString(7).orEmpty()
                val status = cursor.getString(8) ?: "queued"
                val attempts = cursor.getInt(9)
                val lastError = cursor.getString(10).orEmpty()
                val correctionId = if (cursor.isNull(11)) null else cursor.getLong(11)
                val serverStatus = cursor.getString(12).orEmpty()
                val createdAt = MadarTime.parseIso(cursor.getString(13)) ?: System.currentTimeMillis()
                if (!isUuid(uuid) || repId < 1 || machineId < 1 ||
                    (type != "confirm_location" && type != "report_correction")
                ) continue
                if (database.legacyImports().find(SOURCE, "machine", uuid) != null) continue
                if (database.machineActions().find(uuid) != null) continue
                val evidence = copyEvidence(uuid, legacyEvidence, evidenceType)
                val identityHash = Hashing.sha256Hex(
                    "$SOURCE\n$uuid\n$type\n$machineId\n$cardId\n$payloadJson\n${evidence?.length() ?: 0}".toByteArray()
                )
                val state = when (status) {
                    "queued", "syncing" -> MachineActionState.QUEUED
                    "pending_approval" -> MachineActionState.PENDING_APPROVAL
                    "approved" -> MachineActionState.APPROVED
                    "rejected" -> MachineActionState.REJECTED
                    "blocked" -> MachineActionState.NEEDS_REVIEW
                    else -> MachineActionState.NEEDS_REVIEW
                }
                val entity = MachineActionEntity(
                    actionUuid = uuid,
                    ownerRepId = repId,
                    type = type,
                    machineId = machineId,
                    cardId = cardId,
                    payloadJson = payloadJson,
                    evidencePath = evidence?.absolutePath,
                    evidenceContentType = evidenceType.ifBlank { "image/jpeg" },
                    state = state,
                    attempts = attempts.coerceAtLeast(0),
                    nextAttemptAt = 0,
                    lastError = when {
                        status == "blocked" -> lastError.ifBlank { "أُوقف إجراء الماكينة القديم للمراجعة." }
                        status.startsWith("superseded") -> "استُبدل الإجراء القديم بإجراء لاحق."
                        else -> lastError.takeIf { it.isNotBlank() }
                    },
                    correctionId = correctionId,
                    serverStatus = serverStatus.ifBlank { null },
                    createdAt = createdAt,
                    updatedAt = System.currentTimeMillis(),
                )
                database.withTransaction {
                    database.machineActions().upsert(entity)
                    database.legacyImports().put(LegacyImportEntity(SOURCE, "machine", uuid, identityHash, System.currentTimeMillis()))
                }
                imported += 1
            }
        }
        return imported
    }

    private fun copyEvidence(uuid: String, rawPath: String, contentType: String): File? {
        if (rawPath.isBlank()) return null
        val source = runCatching { File(rawPath).canonicalFile }.getOrNull() ?: return null
        if (!source.isFile || source.length() <= 0L || source.length() > 8L * 1024L * 1024L) return null
        if (!source.path.startsWith(filesRoot.path + File.separator)) return null
        val extension = when (contentType) {
            "image/png" -> "png"
            "image/webp" -> "webp"
            else -> "jpg"
        }
        val directory = File(filesRoot, "legacy-machine-evidence").apply { mkdirs() }
        val destination = File(directory, "$uuid.$extension")
        return runCatching {
            copyDurably(source, destination)
            destination
        }.getOrNull()
    }

    private fun copyDurably(source: File, destination: File) {
        destination.parentFile?.mkdirs()
        val temporary = File(destination.parentFile, destination.name + ".part")
        try {
            FileInputStream(source).use { input ->
                FileOutputStream(temporary).use { output ->
                    input.copyTo(output, 128 * 1024)
                    output.flush()
                    output.fd.sync()
                }
            }
            if (temporary.length() != source.length()) throw IllegalStateException("نسخة الصورة القديمة غير مكتملة")
            if (!temporary.renameTo(destination)) {
                temporary.copyTo(destination, overwrite = true)
                temporary.delete()
            }
        } catch (error: Exception) {
            temporary.delete()
            throw error
        }
    }

    private fun hasTable(database: SQLiteDatabase, name: String): Boolean {
        database.rawQuery("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", arrayOf(name)).use {
            return it.moveToFirst()
        }
    }

    companion object {
        const val SOURCE = "legacy-sqlite"
        private fun isUuid(value: String?): Boolean = value?.matches(
            Regex("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        ) == true
    }
}

internal fun JsonObject.string(name: String): String? =
    (this[name] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }

internal fun JsonObject.long(name: String): Long? = (this[name] as? JsonPrimitive)?.longOrNull

internal fun JsonObject.double(name: String): Double? = (this[name] as? JsonPrimitive)?.doubleOrNull

internal fun JsonObject.boolean(name: String): Boolean? = (this[name] as? JsonPrimitive)?.booleanOrNull

internal fun JsonObject.reasonIds(): List<Long> = (this["reasonIds"] as? JsonArray)
    ?.mapNotNull { (it as? JsonPrimitive)?.longOrNull }
    .orEmpty()

internal fun JsonObject.maintenanceLines(): List<MaintenanceLine> = (this["maintenanceLines"] as? JsonArray)
    ?.mapNotNull { element ->
        val line = element as? JsonObject ?: return@mapNotNull null
        val reasonId = line.long("reasonId") ?: return@mapNotNull null
        val quantity = line.long("quantity")?.toInt()?.takeIf { it > 0 } ?: 1
        MaintenanceLine(reasonId, quantity)
    }
    .orEmpty()

internal fun JsonObject.location(): Pair<GeoPoint, String?>? {
    val value = this["location"] as? JsonObject ?: return null
    val latitude = value.double("latitude") ?: return null
    val longitude = value.double("longitude") ?: return null
    val accuracy = value.double("accuracy")?.toFloat() ?: 250f
    val updatedAt = MadarTime.parseIso(value.string("updatedAt")) ?: System.currentTimeMillis()
    return Pair(
        GeoPoint(latitude, longitude, accuracy, updatedAt, provider = "legacy"),
        value.string("provider"),
    )
}
