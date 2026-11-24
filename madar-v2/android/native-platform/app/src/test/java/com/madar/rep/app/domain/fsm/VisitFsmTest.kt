package com.madar.rep.app.domain.fsm

import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.LocationDecision
import com.madar.rep.app.data.db.PhotoEntity
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VisitFsmTest {

    private val now = 1_700_000_000_000L

    private fun testVisit(
        latitude: Double? = 30.0444,
        longitude: Double? = 31.2357,
        locationLocked: Boolean = true,
        condition: String = "",
        state: String = VisitState.DRAFT,
    ) = VisitEntity(
        visitUuid = "test-uuid-1",
        ownerRepId = 1L,
        cardId = 100L,
        machineCode = "M-101",
        machineName = "Test Vending Machine",
        regionName = "Cairo",
        machineLatitude = latitude,
        machineLongitude = longitude,
        geofenceRadiusMeters = 50.0,
        locationLocked = locationLocked,
        machineCondition = condition,
        capturedAt = now,
        state = state,
        createdAt = now,
        updatedAt = now,
    )

    private fun photo(phase: String, id: String = "photo-1") = PhotoEntity(
        id = id,
        visitUuid = "test-uuid-1",
        phase = phase,
        position = 1,
        originalPath = "/mock/path/$id.jpg",
        processedPath = "/mock/path/${id}_proc.jpg",
        capturedAt = now,
        createdAt = now,
    )

    @Test
    fun nearbyFixAndLegacyPhotosDoNotConfirmArrival() {
        val visit = testVisit().copy(latitude = 30.0444, longitude = 31.2357, locationCapturedAt = now)
        val near = GeoPoint(30.0444, 31.2357, 10f, now)
        assertEquals(LocationDecision.Valid, VisitFsm.arrivalDecision(visit, near, now))
        val state = VisitFsm.evaluate(visit, listOf(photo("before"), photo("after", "2")))
        assertEquals(VisitStep.EN_ROUTE, state.currentStep)
        assertFalse(state.isArrivalConfirmed)
        assertFalse(state.isReadyToSubmit)
    }

    @Test
    fun lockedLocationAndFreshAccurateNonMockFixAreRequired() {
        val visit = testVisit()
        val near = GeoPoint(30.0444, 31.2357, 10f, now)
        assertTrue(VisitFsm.arrivalDecision(visit.copy(locationLocked = false), near, now) is LocationDecision.Invalid)
        assertTrue(VisitFsm.arrivalDecision(visit.copy(machineLatitude = null), near, now) is LocationDecision.Invalid)
        assertTrue(VisitFsm.arrivalDecision(visit, near.copy(latitude = 30.0544), now) is LocationDecision.Outside)
        assertTrue(VisitFsm.arrivalDecision(visit, near.copy(accuracyMeters = 51f), now) is LocationDecision.Inaccurate)
        assertTrue(VisitFsm.arrivalDecision(visit, near.copy(capturedAtMillis = now - 30_001), now) is LocationDecision.Stale)
        assertEquals(LocationDecision.Mocked, VisitFsm.arrivalDecision(visit, near.copy(isMock = true), now))
    }

    @Test
    fun savedArrivalResumesWithoutLiveGpsAndPhotosDoNotSkipMaintenance() {
        val visit = testVisit().copy(arrivalConfirmedAt = now)
        val arrival = VisitFsm.evaluate(visit, emptyList())
        assertEquals(VisitStep.BEFORE_PHOTOS, arrival.currentStep)
        assertTrue(arrival.isArrivalConfirmed)
        assertFalse(arrival.isReadyToSubmit)

        val photos = listOf(photo("before"))
        val state = VisitFsm.evaluate(visit.copy(machineCondition = "faulty"), photos)
        assertEquals(VisitStep.MAINTENANCE, state.currentStep)
        assertFalse(state.hasConditionSelected)
        assertFalse(state.isReadyToSubmit)

        val savedMaintenance = visit.copy(machineCondition = "faulty", reasonIdsCsv = "7")
        assertEquals(VisitStep.AFTER_PHOTOS, VisitFsm.evaluate(savedMaintenance, photos).currentStep)
    }

    @Test
    fun bothPhotoPhasesAreNeededAfterConfirmedArrivalAndMaintenance() {
        val visit = testVisit(condition = "working").copy(arrivalConfirmedAt = now)
        val photos = listOf(photo("before"), photo("after", "2"))
        val state = VisitFsm.evaluate(visit, photos)
        assertEquals(VisitStep.SUMMARY, state.currentStep)
        assertEquals(1, state.beforePhotosCount)
        assertEquals(1, state.afterPhotosCount)
        assertTrue(state.hasConditionSelected)
        assertTrue(state.isReadyToSubmit)
    }

    @Test
    fun submittedVisitsStillDisplayTheSummary() {
        val visit = testVisit(condition = "working", state = VisitState.APPROVED)
        assertEquals(VisitStep.SUMMARY, VisitFsm.evaluate(visit, emptyList()).currentStep)
    }
}
