package com.madar.rep.app.data.sync

import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.db.MachineActionEntity
import com.madar.rep.app.data.db.MachineActionState
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DelayedLocationSyncPolicyTest {

    @Test
    fun freshConfirmLocationKeepsAllowPendingReviewUnset() {
        val now = 1_800_000_000_000L
        val capturedAtIso = MadarTime.isoUtc(now - 60_000L)
        val payload = JSONObject()
            .put("actionUuid", "act-fresh")
            .put("cardId", 2164L)
            .put(
                "location",
                JSONObject()
                    .put("latitude", 30.0444)
                    .put("longitude", 31.2357)
                    .put("accuracy", 9.0)
                    .put("updatedAt", capturedAtIso),
            )
            .toString()

        val prepared = DelayedLocationSyncPolicy.preparePayloadIfDelayed(payload, nowMillis = now)
        assertFalse(prepared.usedPendingReviewFlag)
        val parsed = JSONObject(prepared.json)
        assertFalse(parsed.has("allowPendingReview"))
        assertEquals(capturedAtIso, parsed.getJSONObject("location").getString("updatedAt"))
    }

    @Test
    fun delayedOfflineLocationSetsAllowPendingReviewWithoutMutatingCaptureTimestamp() {
        val now = 1_800_000_000_000L
        val originalCapturedAtIso = MadarTime.isoUtc(now - 2 * 60 * 60 * 1000L)
        val payload = JSONObject()
            .put("actionUuid", "act-delayed")
            .put("cardId", 2165L)
            .put(
                "location",
                JSONObject()
                    .put("latitude", 31.2565)
                    .put("longitude", 32.2841)
                    .put("accuracy", 11.5)
                    .put("updatedAt", originalCapturedAtIso),
            )
            .toString()

        val prepared = DelayedLocationSyncPolicy.preparePayloadIfDelayed(payload, nowMillis = now)
        assertTrue(prepared.usedPendingReviewFlag)
        val parsed = JSONObject(prepared.json)
        assertTrue(parsed.getBoolean("allowPendingReview"))
        assertEquals(originalCapturedAtIso, parsed.getJSONObject("location").getString("updatedAt"))
    }

    @Test
    fun recoverableMachineActionAndLockedVisitErrorsMatchAccurately() {
        assertTrue(
            DelayedLocationSyncPolicy.isRecoverableMachineActionError(
                "confirm_location",
                "A current GPS reading is required for first location confirmation.",
            ),
        )
        assertTrue(
            DelayedLocationSyncPolicy.isRecoverableMachineActionError(
                "location_change",
                "Unsupported field: visitUuid.",
            ),
        )
        assertFalse(
            DelayedLocationSyncPolicy.isRecoverableMachineActionError(
                "wrong_machine",
                "Unsupported field: visitUuid.",
            ),
        )

        val queuedAction = MachineActionEntity(
            actionUuid = "act-1",
            ownerRepId = 12L,
            type = "confirm_location",
            machineId = 88L,
            cardId = 2164L,
            payloadJson = "{}",
            state = MachineActionState.PENDING_APPROVAL,
            createdAt = 1000L,
            updatedAt = 1000L,
        )
        assertTrue(
            DelayedLocationSyncPolicy.shouldRetryVisitWaitingOnLocation(
                visitError = "يلزم تثبيت موقع الماكينة قبل رفع صور الزيارة.",
                actionsForOwner = listOf(queuedAction),
                cardId = 2164L,
            ),
        )
        assertFalse(
            DelayedLocationSyncPolicy.shouldRetryVisitWaitingOnLocation(
                visitError = "يلزم تثبيت موقع الماكينة قبل رفع صور الزيارة.",
                actionsForOwner = listOf(queuedAction.copy(state = MachineActionState.NEEDS_REVIEW)),
                cardId = 2164L,
            ),
        )
    }
}
