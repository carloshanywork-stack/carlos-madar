package com.madar.rep.app.data.repo

import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.Hashing
import com.madar.rep.app.core.LocationDecision
import com.madar.rep.app.core.MadarError
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.core.PhotoFingerprint
import com.madar.rep.app.core.PhotoPolicy
import com.madar.rep.app.data.api.MaintenanceLine
import com.madar.rep.app.data.api.RouteMachine
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.db.PhotoEntity
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

data class VisitForm(
    val condition: String = "working",
    val reasons: List<Long> = emptyList(),
    val lines: List<MaintenanceLine> = emptyList(),
    val notes: String = "",
)

sealed interface QueueResult {
    data class Queued(val visit: VisitEntity) : QueueResult
    data class Blocked(val message: String, val decision: LocationDecision?) : QueueResult
}

class VisitRepository(
    private val database: MadarDatabase,
    private val governorates: com.madar.rep.app.core.GovernorateIndex,
) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    private val lineSerializer = ListSerializer(MaintenanceLine.serializer())

    fun observeVisits(repId: Long): Flow<List<VisitEntity>> = database.visits().observeForOwner(repId)

    fun observeOpen(repId: Long): Flow<List<VisitEntity>> = database.visits().observeOpen(repId)

    fun observePhotos(visitUuid: String, phase: String): Flow<List<PhotoEntity>> =
        database.photos().observePhase(visitUuid, phase)

    suspend fun find(uuid: String): VisitEntity? = database.visits().find(uuid)

    suspend fun confirmDraftMachineLocation(visitUuid: String, latitude: Double, longitude: Double) {
        val visit = database.visits().find(visitUuid) ?: return
        if (visit.state != VisitState.DRAFT || visit.locationLocked) return
        database.visits().upsert(visit.copy(
            machineLatitude = latitude,
            machineLongitude = longitude,
            locationLocked = true,
            geofenceRadiusMeters = 50.0,
            updatedAt = System.currentTimeMillis(),
        ))
    }

    fun observeVisit(uuid: String): Flow<VisitEntity?> = database.visits().observe(uuid)

    suspend fun photos(uuid: String): List<PhotoEntity> = database.photos().forVisit(uuid)

    suspend fun photo(id: String): PhotoEntity? = database.photos().find(id)

    suspend fun draftFor(repId: Long, machine: RouteMachine, machineName: String): VisitEntity {
        val existing = database.visits().findDraft(repId, machine.cardId)
        if (existing != null) {
            val updated = existing.copy(
                machineCode = machine.machineCode,
                machineName = machineName,
                regionName = machine.areaName.ifBlank { machine.clientName.orEmpty() },
                areaName = machine.areaName,
                clientName = machine.clientName.orEmpty(),
                address = machine.address,
                machineLatitude = machine.approvedLocation?.latitude ?: machine.latitude,
                machineLongitude = machine.approvedLocation?.longitude ?: machine.longitude,
                geofenceRadiusMeters = machine.geofenceRadiusMeters,
                locationLocked = machine.isLocationLocked,
                updatedAt = System.currentTimeMillis(),
            )
            database.visits().upsert(updated)
            return updated
        }
        val now = System.currentTimeMillis()
        val entity = VisitEntity(
            visitUuid = UUID.randomUUID().toString(),
            ownerRepId = repId,
            cardId = machine.cardId,
            machineCode = machine.machineCode,
            machineName = machineName,
            regionName = machine.areaName.ifBlank { machine.clientName.orEmpty() },
            areaName = machine.areaName,
            clientName = machine.clientName.orEmpty(),
            address = machine.address,
            machineLatitude = machine.approvedLocation?.latitude ?: machine.latitude,
            machineLongitude = machine.approvedLocation?.longitude ?: machine.longitude,
            geofenceRadiusMeters = machine.geofenceRadiusMeters,
            locationLocked = machine.isLocationLocked,
            capturedAt = now,
            state = VisitState.DRAFT,
            createdAt = now,
            updatedAt = now,
        )
        database.visits().upsert(entity)
        return entity
    }

    suspend fun saveForm(visitUuid: String, form: VisitForm, location: GeoPoint?): VisitEntity {
        val current = database.visits().find(visitUuid) ?: throw MadarError.Validation("الزيارة غير موجودة")
        if (current.state != VisitState.DRAFT) throw MadarError.Validation("لا يمكن تعديل زيارة أُرسلت بالفعل")
        val updated = current.copy(
            machineCondition = form.condition,
            reasonIdsCsv = form.reasons.distinct().sorted().joinToString(","),
            maintenanceLinesJson = json.encodeToString(lineSerializer, form.lines.sortedBy { it.reasonId }),
            notes = form.notes.take(10_000),
            latitude = location?.latitude ?: current.latitude,
            longitude = location?.longitude ?: current.longitude,
            locationAccuracy = location?.accuracyMeters ?: current.locationAccuracy,
            locationCapturedAt = location?.capturedAtMillis ?: current.locationCapturedAt,
            locationProvider = location?.provider ?: current.locationProvider,
            governorate = location?.let {
                governorates.find(it.latitude, it.longitude)?.nameAr
            } ?: current.governorate,
            updatedAt = System.currentTimeMillis(),
        )
        database.visits().upsert(updated)
        return updated
    }

    suspend fun addPhoto(visitUuid: String, photo: PhotoEntity) {
        val visit = database.visits().find(visitUuid) ?: throw MadarError.Validation("الزيارة غير موجودة")
        if (visit.state != VisitState.DRAFT) throw MadarError.Validation("الصور لا تُضاف بعد إرسال الزيارة")
        val count = database.photos().forPhase(visitUuid, photo.phase).size
        if (!PhotoPolicy.validCount(count + 1)) {
            throw MadarError.Validation("لا يمكن إضافة أكثر من ${PhotoPolicy.MAX_PER_PHASE} صورة للمرحلة")
        }
        database.photos().upsert(photo)
    }

    suspend fun removePhoto(photoId: String) {
        database.photos().delete(photoId)
    }

    /**
     * Queueing is the only place where a visit becomes eligible for upload. Safety
     * failures are preserved and sent for server-side supervisor review rather
     * than silently blocking evidence upload.
     */
    suspend fun queue(visitUuid: String, location: GeoPoint?, now: Long = System.currentTimeMillis()): QueueResult {
        val visit = database.visits().find(visitUuid) ?: return QueueResult.Blocked("الزيارة غير موجودة", null)
        if (visit.state != VisitState.DRAFT && visit.state != VisitState.NEEDS_REVIEW) {
            return QueueResult.Blocked("الزيارة ليست مسودة قابلة للإرسال", null)
        }
        val photos = database.photos().forVisit(visitUuid)
        val before = photos.filter { it.phase == "before" }
        val after = photos.filter { it.phase == "after" }
        val countsValid = runCatching { PhotoPolicy.validateVisit(before.size, after.size) }.isSuccess
        if (!countsValid) {
            return QueueResult.Blocked(
                "كل مرحلة تحتاج صورة واحدة على الأقل وبحد أقصى ${PhotoPolicy.MAX_PER_PHASE} صورة.",
                null
            )
        }
        if (!visit.locationLocked) {
            return QueueResult.Blocked("موقع الماكينة غير مثبت من الإدارة؛ لا يمكن اعتماد الزيارة.", null)
        }
        val fingerprint = fingerprint(visit, photos, location)
        val queued = visit.copy(
            latitude = location?.latitude,
            longitude = location?.longitude,
            locationAccuracy = location?.accuracyMeters,
            locationCapturedAt = location?.capturedAtMillis,
            locationProvider = if (location?.isMock == true) "mock" else location?.provider,
            governorate = location?.let { governorates.find(it.latitude, it.longitude)?.nameAr },
            capturedAt = now,
            beforeCapturedAtCsv = before.joinToString(",") { it.capturedAt.toString() },
            afterCapturedAtCsv = after.joinToString(",") { it.capturedAt.toString() },
            contentHash = fingerprint,
            state = VisitState.QUEUED,
            lastError = null,
            nextAttemptAt = now,
            updatedAt = now,
        )
        database.visits().upsert(queued)
        return QueueResult.Queued(queued)
    }

    fun fingerprint(visit: VisitEntity, photos: List<PhotoEntity>, location: GeoPoint?): String {
        fun entries(phase: String): List<PhotoFingerprint> = photos
            .filter { it.phase == phase }
            .sortedBy { it.position }
            .map { PhotoFingerprint(it.position, it.sizeBytes, it.sha256) }
        val base = Hashing.visitFingerprint(
            ownerRepId = visit.ownerRepId,
            visitUuid = visit.visitUuid,
            cardId = visit.cardId,
            machineCode = visit.machineCode,
            regionName = visit.regionName,
            condition = visit.machineCondition,
            reasonIds = visit.reasonIdsCsv.split(',').mapNotNull { it.toLongOrNull() },
            lines = decodeLines(visit.maintenanceLinesJson).map { it.reasonId to it.quantity },
            notes = visit.notes,
            capturedAtMillis = visit.capturedAt,
            before = entries("before"),
            after = entries("after"),
        )
        val locationPart = location?.let {
            "|${it.latitude}|${it.longitude}|${it.accuracyMeters}|${it.capturedAtMillis}|mock=${it.isMock}"
        }.orEmpty()
        return Hashing.sha256Hex((base + locationPart).toByteArray(Charsets.UTF_8))
    }

    fun decodeLines(value: String): List<MaintenanceLine> = runCatching {
        json.decodeFromString(lineSerializer, value)
    }.getOrDefault(emptyList())

    fun decodeReasonIds(value: String): List<Long> =
        value.split(',').mapNotNull { it.trim().toLongOrNull() }

    suspend fun pendingForOtherOwners(repId: Long): List<VisitEntity> =
        database.visits().pendingForOtherOwners(repId)
}
