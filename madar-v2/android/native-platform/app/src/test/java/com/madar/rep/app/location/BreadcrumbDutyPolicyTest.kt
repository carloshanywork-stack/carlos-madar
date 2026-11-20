package com.madar.rep.app.location

import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.api.AttendanceEnvelope
import com.madar.rep.app.data.api.AttendanceRecord
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BreadcrumbDutyPolicyTest {
    @Test
    fun authenticationOrClosedAttendanceDoesNotEnableRecording() {
        assertFalse(shouldRecordBreadcrumbs(null, null))
        assertFalse(shouldRecordBreadcrumbs(AttendanceEnvelope(), null))
        assertFalse(shouldRecordBreadcrumbs(AttendanceEnvelope(attendance = AttendanceRecord(
            clockInTime = "2026-11-19T09:00:00.000Z",
            clockOutTime = "2026-11-19T17:00:00.000Z",
        )), null))
    }

    @Test
    fun serverConfirmedOvernightShiftSurvivesDateChangeUntilExplicitClockOut() {
        val start = "2026-11-19T21:30:00.000Z"
        val envelope = AttendanceEnvelope(
            date = "2026-11-20",
            openAttendance = AttendanceRecord(activeClockInTime = start),
        )
        val startMs = requireNotNull(MadarTime.parseIso(start))
        assertTrue(shouldRecordBreadcrumbs(envelope, null))
        assertTrue(shouldRecordBreadcrumbs(envelope, startMs - 1))
        assertFalse(shouldRecordBreadcrumbs(envelope, startMs + 1))
    }
}
