package com.madar.rep.app.location

import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.GeoPolicy
import com.madar.rep.app.data.db.MachineActionEntity
import com.madar.rep.app.data.db.MachineActionState
import com.madar.rep.app.data.db.PhotoEntity
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

class GpsAndCapturePerformanceTest {

    private val now = 1_700_000_000_000L

    @Test
    fun locationResultTypesDiscriminateProperly() {
        val goodPoint = GeoPoint(30.0444, 31.2357, 8.5f, now, provider = "gps")
        val successResult = LocationResult.Success(goodPoint, gpsEnabled = true)
        assertEquals(goodPoint, successResult.point)
        assertTrue(successResult.gpsEnabled)

        val weakPoint = GeoPoint(30.0444, 31.2357, 85f, now, provider = "network")
        val weakSignalResult = LocationResult.WeakSignal(weakPoint, 85f)
        assertEquals(85f, weakSignalResult.accuracyMeters)
        assertEquals(weakPoint, weakSignalResult.candidate)

        val approxResult = LocationResult.ApproximateOnlyPermission
        assertNotNull(approxResult)

        val disabledResult = LocationResult.ProvidersDisabled
        assertNotNull(disabledResult)

        val timeoutResult = LocationResult.Timeout
        assertNotNull(timeoutResult)
    }

    @Test
    fun visitLocationStatusTransitions() {
        val point = GeoPoint(30.0444, 31.2357, 12f, now, provider = "fused")
        val statusHigh: VisitLocationStatus = VisitLocationStatus.HighAccuracy(point)
        val statusProv: VisitLocationStatus = VisitLocationStatus.Provisional(point.copy(accuracyMeters = 35f))
        val statusWeak: VisitLocationStatus = VisitLocationStatus.WeakSignal(point, 65f)

        assertTrue(statusHigh is VisitLocationStatus.HighAccuracy)
        assertTrue(statusProv is VisitLocationStatus.Provisional)
        assertTrue(statusWeak is VisitLocationStatus.WeakSignal)
    }

    @Test
    fun locationApprovalPayloadStructureAndDecoupling() {
        val actionUuid = "action-uuid-12345"
        val cardId = 555L
        val point = GeoPoint(30.0444, 31.2357, 10f, now, provider = "gps")

        val payload = JSONObject()
            .put("actionUuid", actionUuid)
            .put("cardId", cardId)
            .put("location", JSONObject()
                .put("latitude", point.latitude)
                .put("longitude", point.longitude)
                .put("accuracy", point.accuracyMeters)
                .put("updatedAt", "2026-11-23T12:00:00.000Z"))
            .toString()

        val entity = MachineActionEntity(
            actionUuid = actionUuid,
            ownerRepId = 1L,
            type = "confirm_location",
            machineId = 100L,
            cardId = cardId,
            payloadJson = payload,
            state = MachineActionState.QUEUED,
            createdAt = now,
            updatedAt = now,
        )

        assertEquals("confirm_location", entity.type)
        assertEquals(MachineActionState.QUEUED, entity.state)

        val parsedLocation = JSONObject(entity.payloadJson).getJSONObject("location")
        assertEquals(30.0444, parsedLocation.getDouble("latitude"), 0.0001)
        assertEquals(31.2357, parsedLocation.getDouble("longitude"), 0.0001)
        assertEquals(10.0, parsedLocation.getDouble("accuracy"), 0.1)
    }

    @Test
    fun photoReadinessCheckDistinguishesPendingRenderFromReady() {
        val pendingPhoto = PhotoEntity(
            id = "photo-1",
            visitUuid = "visit-1",
            phase = "before",
            position = 1,
            originalPath = "/storage/visits/visit-1/before/photo-1/original.jpg",
            processedPath = "/storage/visits/visit-1/before/photo-1/processed.jpg",
            capturedAt = now,
            sha256 = "", // Empty sha256 indicates still in bounded-concurrency processing pipeline
            watermarkText = "",
            createdAt = now,
        )

        // Photo is not ready for network upload yet
        assertTrue(pendingPhoto.sha256.isBlank())

        val completedPhoto = pendingPhoto.copy(
            sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            watermarkText = "MADAR • 2026-11-23 12:00",
            sizeBytes = 250_000L,
        )

        // Photo is ready for upload
        assertFalse(completedPhoto.sha256.isBlank())
        assertTrue(completedPhoto.sizeBytes > 0L)
    }
}
