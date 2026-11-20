package com.madar.rep.app.location

import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.api.AttendanceEnvelope
import com.madar.rep.app.data.api.AttendanceRecord
import com.madar.rep.app.data.db.AttendanceActionEntity
import com.madar.rep.app.data.db.AttendanceActionState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BreadcrumbDutyPolicyTest {
    private fun action(kind: String, at: Long, state: String = AttendanceActionState.QUEUED) = AttendanceActionEntity(
        actionUuid = "$kind-$at", ownerRepId = 1, action = kind, occurredAtIso = MadarTime.isoUtc(at),
        occurredAtMillis = at, locationJson = "{}", state = state, createdAt = at, updatedAt = at,
    )

    @Test
    fun authenticationOrClosedAttendanceDoesNotEnableRecording() {
        assertFalse(shouldRecordBreadcrumbs(null, null, emptyList()))
        assertFalse(shouldRecordBreadcrumbs(AttendanceEnvelope(), null, emptyList()))
        assertFalse(shouldRecordBreadcrumbs(AttendanceEnvelope(attendance = AttendanceRecord(
            clockInTime = "2026-11-19T09:00:00.000Z",
            clockOutTime = "2026-11-19T17:00:00.000Z",
        )), null, emptyList()))
    }

    @Test
    fun serverConfirmedOvernightShiftSurvivesDateChangeUntilExplicitClockOut() {
        val start = "2026-11-19T21:30:00.000Z"
        val envelope = AttendanceEnvelope(
            date = "2026-11-20",
            openAttendance = AttendanceRecord(activeClockInTime = start),
        )
        val startMs = requireNotNull(MadarTime.parseIso(start))
        assertTrue(shouldRecordBreadcrumbs(envelope, null, emptyList()))
        assertTrue(shouldRecordBreadcrumbs(envelope, null, listOf(action("out", startMs - 1))))
        assertFalse(shouldRecordBreadcrumbs(envelope, null, listOf(action("out", startMs + 1))))
    }

    @Test
    fun durableOfflineClockInEnablesRecordingButClockOutOrRejectionStopsIt() {
        val clockIn = action("in", 1_000)
        assertTrue(clockIn.isClockInAwaitingSync())
        assertTrue(shouldRecordBreadcrumbs(null, null, listOf(clockIn)))
        assertTrue(shouldRecordBreadcrumbs(null, null, listOf(clockIn.copy(state = AttendanceActionState.RETRY_WAIT))))
        assertFalse(shouldRecordBreadcrumbs(null, null, listOf(clockIn.copy(state = AttendanceActionState.NEEDS_REVIEW))))
        assertFalse(shouldRecordBreadcrumbs(null, null, listOf(clockIn.copy(biometricVerified = false))))
        assertFalse(shouldRecordBreadcrumbs(null, null, listOf(clockIn.copy(locationJson = null))))
        assertFalse(shouldRecordBreadcrumbs(null, null, listOf(clockIn, action("out", 2_000))))
    }

    @Test
    fun syncReceiptKeepsRecordingUntilARecentAuthoritativeSnapshotArrives() {
        val clockIn = action("in", 1_000, "synced").copy(updatedAt = 2_000)
        assertTrue(shouldRecordBreadcrumbs(AttendanceEnvelope(), 1_500, listOf(clockIn)))
        assertFalse(shouldRecordBreadcrumbs(AttendanceEnvelope(), 2_500, listOf(clockIn)))
    }
}
