package com.madar.rep.app.location

import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.api.AttendanceEnvelope
import com.madar.rep.app.data.db.AttendanceActionEntity
import com.madar.rep.app.data.db.AttendanceActionState

internal fun AttendanceActionEntity.isClockInAwaitingSync(): Boolean =
    action == "in" && hasClockInEvidence() && state in setOf(
        AttendanceActionState.QUEUED, AttendanceActionState.SYNCING,
        AttendanceActionState.RETRY_WAIT, AttendanceActionState.NEEDS_LOGIN,
    )

private fun AttendanceActionEntity.hasClockInEvidence() = biometricVerified && !locationJson.isNullOrBlank()

/** Begin recording for explicit offline attendance or a confirmed server shift. */
internal fun shouldRecordBreadcrumbs(
    envelope: AttendanceEnvelope?,
    snapshotFetchedAt: Long?,
    actions: List<AttendanceActionEntity>,
): Boolean {
    val attendance = envelope?.openAttendance ?: envelope?.attendance
    val confirmedStartedAt = if (attendance == null) null else MadarTime.parseIso(when {
        envelope?.openAttendance != null && attendance.activeClockInTime != null -> attendance.activeClockInTime
        attendance.overtimeIsOpen -> attendance.overtimeClockInTime
        attendance.hasOpenAttendance -> attendance.clockInTime
        else -> null
    })
    val latestAction = actions.maxWithOrNull(compareBy<AttendanceActionEntity> { it.occurredAtMillis }.thenBy { it.action == "out" })
    if (latestAction != null && (confirmedStartedAt == null || latestAction.occurredAtMillis >= confirmedStartedAt)) {
        if (latestAction.action == "out") return false
        if (latestAction.isClockInAwaitingSync()) return true
        if (latestAction.action == "in" && latestAction.hasClockInEvidence() && latestAction.state == "synced"
            && latestAction.updatedAt > (snapshotFetchedAt ?: 0L)) return true
    }
    return confirmedStartedAt != null
}
