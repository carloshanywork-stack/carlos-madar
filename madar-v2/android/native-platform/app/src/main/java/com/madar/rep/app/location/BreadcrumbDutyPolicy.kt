package com.madar.rep.app.location

import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.api.AttendanceEnvelope

/**
 * A confirmed open shift is the prerequisite for background recording. A local
 * logout or clock-out stops newly acquired points even before server sync.
 */
internal fun shouldRecordBreadcrumbs(envelope: AttendanceEnvelope?, latestClockOut: Long?): Boolean {
    if (envelope == null) return false
    val attendance = envelope.openAttendance ?: envelope.attendance ?: return false
    val startedAt = MadarTime.parseIso(when {
        envelope.openAttendance != null && attendance.activeClockInTime != null -> attendance.activeClockInTime
        attendance.overtimeIsOpen -> attendance.overtimeClockInTime
        attendance.hasOpenAttendance -> attendance.clockInTime
        else -> null
    }) ?: return false
    return latestClockOut == null || latestClockOut < startedAt
}
