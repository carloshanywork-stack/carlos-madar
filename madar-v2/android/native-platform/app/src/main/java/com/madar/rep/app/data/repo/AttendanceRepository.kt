package com.madar.rep.app.data.repo

import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.MadarError
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.api.AttendanceActionRequest
import com.madar.rep.app.data.api.AttendanceEnvelope
import com.madar.rep.app.data.api.MadarApi
import com.madar.rep.app.data.db.AttendanceActionEntity
import com.madar.rep.app.data.db.AttendanceActionState
import com.madar.rep.app.data.db.AttendanceSnapshotEntity
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.session.Session
import java.util.UUID
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json

data class AttendanceView(
    val envelope: AttendanceEnvelope,
    val fetchedAt: Long,
)

/**
 * Attendance is always an explicit, user-confirmed action. Clock-in requires a
 * GPS fix and a real biometric prompt; this repository refuses to queue an
 * action without both. Offline actions keep their original timestamp so a shift
 * that crosses midnight keeps its true start.
 */
class AttendanceRepository(private val database: MadarDatabase) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    fun observe(repId: Long): Flow<AttendanceView?> = database.attendanceSnapshots().observe(repId).map { row ->
        row?.let { decode(it) }
    }

    fun observeActions(repId: Long): Flow<List<AttendanceActionEntity>> =
        database.attendanceActions().observeForOwner(repId)

    suspend fun cached(repId: Long): AttendanceView? =
        database.attendanceSnapshots().get(repId)?.let { decode(it) }

    suspend fun refresh(session: Session, api: MadarApi): AttendanceEnvelope {
        val envelope = api.getTodayAttendance(session.token)
        if (envelope.success) {
            database.attendanceSnapshots().put(
                AttendanceSnapshotEntity(
                    ownerRepId = session.ownerScopeId,
                    envelopeJson = json.encodeToString(AttendanceEnvelope.serializer(), envelope),
                    fetchedAt = System.currentTimeMillis(),
                )
            )
        }
        return envelope
    }

    suspend fun enqueue(
        repId: Long,
        action: String,
        occurredAtMillis: Long = System.currentTimeMillis(),
        location: GeoPoint?,
        biometricVerified: Boolean,
    ): AttendanceActionEntity {
        if (action != "in" && action != "out") throw MadarError.Validation("نوع تسجيل الحضور غير صالح")
        if (!biometricVerified) throw MadarError.Validation("يلزم تأكيد المصادقة الحيوية")
        if (action == "in" && location == null) throw MadarError.Validation("تسجيل الحضور يحتاج موقع GPS")
        val now = System.currentTimeMillis()
        val entity = AttendanceActionEntity(
            actionUuid = UUID.randomUUID().toString(),
            ownerRepId = repId,
            action = action,
            occurredAtIso = MadarTime.isoUtc(occurredAtMillis),
            occurredAtMillis = occurredAtMillis,
            locationJson = location?.let {
                json.encodeToString(
                    com.madar.rep.app.data.api.ApiLocation.serializer(),
                    com.madar.rep.app.data.api.ApiLocation(
                        it.latitude, it.longitude, it.accuracyMeters, MadarTime.isoUtc(it.capturedAtMillis)
                    )
                )
            },
            biometricVerified = true,
            state = AttendanceActionState.QUEUED,
            attempts = 0,
            nextAttemptAt = 0,
            createdAt = now,
            updatedAt = now,
        )
        database.attendanceActions().upsert(entity)
        return entity
    }

    suspend fun request(action: AttendanceActionEntity): AttendanceActionRequest = AttendanceActionRequest(
        actionUuid = action.actionUuid,
        action = action.action,
        occurredAt = action.occurredAtIso,
        location = action.locationJson?.let {
            runCatching { json.decodeFromString(com.madar.rep.app.data.api.ApiLocation.serializer(), it) }.getOrNull()
        },
        biometricVerified = action.biometricVerified,
    )

    private fun decode(row: AttendanceSnapshotEntity): AttendanceView? = runCatching {
        AttendanceView(json.decodeFromString(AttendanceEnvelope.serializer(), row.envelopeJson), row.fetchedAt)
    }.getOrNull()
}
