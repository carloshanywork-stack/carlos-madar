package com.madar.rep.app.data.repo

import androidx.room.withTransaction
import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.Hashing
import com.madar.rep.app.core.LocationDecision
import com.madar.rep.app.core.MadarError
import com.madar.rep.app.core.PhotoFingerprint
import com.madar.rep.app.core.PhotoPolicy
import com.madar.rep.app.data.api.MaintenanceLine
import com.madar.rep.app.data.api.RouteMachine
import com.madar.rep.app.data.db.ActionQueueEntity
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.db.PhotoEntity
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import com.madar.rep.app.domain.fsm.VisitFsm
import com.madar.rep.app.domain.fsm.VisitStep
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
    private val routes: RouteRepository,
) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    private val lineSerializer = ListSerializer(MaintenanceLine.serializer())

    fun observeVisits(repId: Long): Flow<List<VisitEntity>> = database.visits().observeForOwner(repId)

    fun observeOpen(repId: Long): Flow<List<VisitEntity>> = database.visits().observeOpen(repId)

    fun observePhotos(visitUuid: String, phase: String): Flow<List<PhotoEntity>> =
        database.photos().observePhase(visitUuid, phase)

    suspend fun find(uuid: String): VisitEntity? = database.visits().find(uuid)

    suspend fun confirmDraftMachineLocation(visitUuid: String, latitude: Double, longitude: Double) = database.withTransaction {
        val visit = database.visits().find(visitUuid) ?: return@withTransaction
        if (visit.state != VisitState.DRAFT || visit.locationLocked) return@withTransaction
        database.visits().upsert(visit.copy(
            machineLatitude = latitude,
            machineLongitude = longitude,
            locationLocked = true,
            geofenceRadiusMeters = 50.0,
            updatedAt = System.currentTimeMillis(),
        ))
    }

    suspend fun confirmArrival(visitUuid: String, point: GeoPoint, now: Long = System.currentTimeMillis()) =
        database.withTransaction {
            val visit = database.visits().find(visitUuid) ?: throw MadarError.Validation("الزيارة غير موجودة")
            if (visit.state != VisitState.DRAFT) throw MadarError.Validation("الزيارة غير قابلة للتعديل")
            val decision = VisitFsm.arrivalDecision(visit, point, now)
            if (decision != LocationDecision.Valid) {
                throw MadarError.Validation("تعذّر تأكيد الوصول. حدّث الموقع وتأكد من وجودك عند الماكينة.")
            }
            database.visits().upsert(visit.copy(
                arrivalConfirmedAt = now,
                latitude = point.latitude,
                longitude = point.longitude,
                locationAccuracy = point.accuracyMeters,
                locationCapturedAt = point.capturedAtMillis,
                locationProvider = point.provider,
                governorate = governorates.find(point.latitude, point.longitude)?.nameAr,
                updatedAt = now,
            ))
        }

    fun observeVisit(uuid: String): Flow<VisitEntity?> = database.visits().observe(uuid)

    suspend fun photos(uuid: String): List<PhotoEntity> = database.photos().forVisit(uuid)

    suspend fun photo(id: String): PhotoEntity? = database.photos().find(id)

    suspend fun draftFor(repId: Long, machine: RouteMachine, machineName: String): VisitEntity = database.withTransaction {
        val machineLatitude = machine.approvedLocation?.latitude ?: machine.latitude
        val machineLongitude = machine.approvedLocation?.longitude ?: machine.longitude
        val existing = database.visits().findDraft(repId, machine.cardId)
        if (existing != null) {
            val sameGeofence = machine.isLocationLocked && existing.machineLatitude == machineLatitude &&
                existing.machineLongitude == machineLongitude && existing.geofenceRadiusMeters == machine.geofenceRadiusMeters
            val updated = existing.copy(
                machineCode = machine.machineCode,
                machineName = machineName,
                areaName = machine.areaName,
                clientName = machine.clientName.orEmpty(),
                address = machine.address,
                machineLatitude = machineLatitude,
                machineLongitude = machineLongitude,
                geofenceRadiusMeters = machine.geofenceRadiusMeters,
                locationLocked = machine.isLocationLocked,
                arrivalConfirmedAt = existing.arrivalConfirmedAt.takeIf { sameGeofence },
                updatedAt = System.currentTimeMillis(),
            )
            database.visits().upsert(updated)
            return@withTransaction updated
        }
        val now = System.currentTimeMillis()
        val entity = VisitEntity(
            visitUuid = UUID.randomUUID().toString(),
            ownerRepId = repId,
            cardId = machine.cardId,
            machineCode = machine.machineCode,
            machineName = machineName,
            regionName = machine.visitRegionName ?: machine.areaName.ifBlank { machine.clientName.orEmpty() },
            areaName = machine.areaName,
            clientName = machine.clientName.orEmpty(),
            address = machine.address,
            machineLatitude = machineLatitude,
            machineLongitude = machineLongitude,
            geofenceRadiusMeters = machine.geofenceRadiusMeters,
            locationLocked = machine.isLocationLocked,
            machineCondition = "",
            capturedAt = now,
            state = VisitState.DRAFT,
            createdAt = now,
            updatedAt = now,
        )
        database.visits().upsert(entity)
        entity
    }

    suspend fun saveForm(visitUuid: String, form: VisitForm): VisitEntity = database.withTransaction {
        val current = database.visits().find(visitUuid) ?: throw MadarError.Validation("الزيارة غير موجودة")
        if (current.state != VisitState.DRAFT) throw MadarError.Validation("لا يمكن تعديل زيارة أُرسلت بالفعل")
        val updated = current.copy(
            machineCondition = form.condition,
            reasonIdsCsv = form.reasons.distinct().sorted().joinToString(","),
            maintenanceLinesJson = json.encodeToString(lineSerializer, form.lines.sortedBy { it.reasonId }),
            notes = form.notes.take(10_000),
            updatedAt = System.currentTimeMillis(),
        )
        database.visits().upsert(updated)
        updated
    }

    suspend fun addPhoto(visitUuid: String, photo: PhotoEntity, recovered: Boolean = false) = database.withTransaction {
        val visit = database.visits().find(visitUuid) ?: throw MadarError.Validation("الزيارة غير موجودة")
        if (visit.state != VisitState.DRAFT) throw MadarError.Validation("الصور لا تُضاف بعد إرسال الزيارة")
        if (!recovered) {
            val state = VisitFsm.evaluate(visit, database.photos().forVisit(visitUuid))
            if (!state.isArrivalConfirmed || (photo.phase == "after" &&
                    (state.currentStep < VisitStep.AFTER_PHOTOS || !hasRequiredQuantities(visit)))) {
                throw MadarError.Validation("استكمل خطوات الزيارة قبل التصوير.")
            }
        }
        val count = database.photos().forPhase(visitUuid, photo.phase).size
        if (!PhotoPolicy.validCount(count + 1)) {
            throw MadarError.Validation("لا يمكن إضافة أكثر من ${PhotoPolicy.MAX_PER_PHASE} صورة للمرحلة")
        }
        if (database.photos().insertNew(photo) == -1L && !recovered) {
            throw MadarError.Validation("تعذّر إضافة الصورة لهذه الخانة. صورك الحالية محفوظة.")
        }
    }

    suspend fun removePhoto(photoId: String, retainOriginal: (PhotoEntity) -> Unit) = database.withTransaction {
        val photo = database.photos().find(photoId) ?: return@withTransaction
        if (database.visits().find(photo.visitUuid)?.state != VisitState.DRAFT) {
            throw MadarError.Validation("لا يمكن حذف صورة بعد إرسال الزيارة")
        }
        retainOriginal(photo)
        database.photos().delete(photo.id)
    }

    /**
     * Queueing is the only place where a visit becomes eligible for upload. Safety
     * failures are preserved and sent for server-side supervisor review rather
     * than silently blocking evidence upload.
     */
    suspend fun queue(visitUuid: String, location: GeoPoint?, now: Long = System.currentTimeMillis()): QueueResult =
        database.withTransaction {
            val visit = database.visits().find(visitUuid) ?: return@withTransaction QueueResult.Blocked("الزيارة غير موجودة", null)
            if (visit.state != VisitState.DRAFT) {
                return@withTransaction QueueResult.Blocked("الزيارة ليست مسودة قابلة للإرسال", null)
            }
            val photos = database.photos().forVisit(visitUuid)
            val progress = VisitFsm.evaluate(visit, photos)
            if (!progress.isArrivalConfirmed) {
                return@withTransaction QueueResult.Blocked("أكّد وصولك عند الماكينة قبل إرسال الزيارة.", null)
            }
            if (!progress.hasConditionSelected || !hasRequiredQuantities(visit)) {
                return@withTransaction QueueResult.Blocked("احفظ حالة الماكينة وبيانات الصيانة قبل إرسال الزيارة.", null)
            }
            val before = photos.filter { it.phase == "before" }
            val after = photos.filter { it.phase == "after" }
            val countsValid = runCatching { PhotoPolicy.validateVisit(before.size, after.size) }.isSuccess
            if (!countsValid) {
                return@withTransaction QueueResult.Blocked(
                    "كل مرحلة تحتاج صورة واحدة على الأقل وبحد أقصى ${PhotoPolicy.MAX_PER_PHASE} صورة.",
                    null
                )
            }
            if (photos.any { it.sha256.isBlank() || it.sizeBytes <= 0L }) {
                return@withTransaction QueueResult.Blocked("جارٍ تجهيز الصور الأصلية للإرسال. حاول مرة أخرى بعد اكتمال التجهيز.", null)
            }
            val arrivalLocation = if (visit.latitude != null && visit.longitude != null &&
                visit.locationAccuracy != null && visit.locationCapturedAt != null) {
                GeoPoint(visit.latitude, visit.longitude, visit.locationAccuracy, visit.locationCapturedAt, visit.locationProvider)
            } else null
            val submissionLocation = location?.takeIf { VisitFsm.arrivalDecision(visit, it, now) == LocationDecision.Valid }
                ?: arrivalLocation
            val queued = visit.copy(
                latitude = submissionLocation?.latitude,
                longitude = submissionLocation?.longitude,
                locationAccuracy = submissionLocation?.accuracyMeters,
                locationCapturedAt = submissionLocation?.capturedAtMillis,
                locationProvider = submissionLocation?.provider,
                governorate = submissionLocation?.let { governorates.find(it.latitude, it.longitude)?.nameAr },
                capturedAt = now,
                beforeCapturedAtCsv = before.joinToString(",") { it.capturedAt.toString() },
                afterCapturedAtCsv = after.joinToString(",") { it.capturedAt.toString() },
                state = VisitState.QUEUED,
                lastError = null,
                nextAttemptAt = now,
                updatedAt = now,
            ).let { it.copy(contentHash = fingerprint(it, photos, submissionLocation)) }
            database.actionQueue().append(ActionQueueEntity(visitUuid, queued.ownerRepId, "visit", queued.contentHash, now))
            database.visits().upsert(queued)
            QueueResult.Queued(queued)
        }

    private suspend fun hasRequiredQuantities(visit: VisitEntity): Boolean {
        val quantities = decodeLines(visit.maintenanceLinesJson).associate { it.reasonId to it.quantity }
        val selected = decodeReasonIds(visit.reasonIdsCsv).toSet()
        return routes.cachedFaultReasons(visit.ownerRepId).none {
            it.id in selected && it.countable != 0 && (quantities[it.id] ?: 0) <= 0
        }
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
