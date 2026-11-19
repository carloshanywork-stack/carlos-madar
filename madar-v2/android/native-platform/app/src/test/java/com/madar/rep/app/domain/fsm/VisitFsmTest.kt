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
    fun enRouteWhenOutsideGeofenceAndNoPhotos() {
        val visit = testVisit()
        // Location far away (1000m away)
        val farLocation = GeoPoint(30.0544, 31.2357, 10f, now)
        val state = VisitFsm.evaluate(visit, emptyList(), farLocation, manualArrivalConfirmed = false, nowMillis = now)

        assertEquals(VisitStep.EN_ROUTE, state.currentStep)
        assertFalse(state.isArrivalConfirmed)
        assertFalse(state.isReadyToSubmit)
        assertTrue((state.distanceMeters ?: 0.0) > 500.0)
    }

    @Test
    fun transitionsToBeforePhotosWhenInsideGeofence() {
        val visit = testVisit()
        // Location exact match (0m away)
        val nearLocation = GeoPoint(30.0444, 31.2357, 10f, now)
        val state = VisitFsm.evaluate(visit, emptyList(), nearLocation, manualArrivalConfirmed = false, nowMillis = now)

        assertEquals(VisitStep.BEFORE_PHOTOS, state.currentStep)
        assertTrue(state.isArrivalConfirmed)
        assertEquals(0, state.beforePhotosCount)
        assertEquals(0, state.afterPhotosCount)
        assertFalse(state.isReadyToSubmit)
    }

    @Test
    fun transitionsToBeforePhotosWhenManualArrivalConfirmed() {
        val visit = testVisit()
        val farLocation = GeoPoint(30.0544, 31.2357, 10f, now)
        val state = VisitFsm.evaluate(visit, emptyList(), farLocation, manualArrivalConfirmed = true, nowMillis = now)

        assertEquals(VisitStep.BEFORE_PHOTOS, state.currentStep)
        assertTrue(state.isArrivalConfirmed)
    }

    @Test
    fun transitionsToMaintenanceWhenBeforePhotosExist() {
        val visit = testVisit(condition = "")
        val nearLocation = GeoPoint(30.0444, 31.2357, 10f, now)
        val photos = listOf(photo("before", "1"))
        val state = VisitFsm.evaluate(visit, photos, nearLocation, nowMillis = now)

        assertEquals(VisitStep.MAINTENANCE, state.currentStep)
        assertEquals(1, state.beforePhotosCount)
        assertEquals(0, state.afterPhotosCount)
        assertFalse(state.hasConditionSelected)
        assertFalse(state.isReadyToSubmit)
    }

    @Test
    fun transitionsToAfterPhotosWhenMaintenanceCompleted() {
        val visit = testVisit(condition = "working")
        val nearLocation = GeoPoint(30.0444, 31.2357, 10f, now)
        val photos = listOf(photo("before", "1"))
        val state = VisitFsm.evaluate(visit, photos, nearLocation, nowMillis = now)

        assertEquals(VisitStep.AFTER_PHOTOS, state.currentStep)
        assertEquals(1, state.beforePhotosCount)
        assertEquals(0, state.afterPhotosCount)
        assertTrue(state.hasConditionSelected)
        assertFalse(state.isReadyToSubmit)
    }

    @Test
    fun transitionsToSummaryWhenBothPhasesAndConditionSatisfied() {
        val visit = testVisit(condition = "working")
        val nearLocation = GeoPoint(30.0444, 31.2357, 10f, now)
        val photos = listOf(photo("before", "1"), photo("after", "2"))
        val state = VisitFsm.evaluate(visit, photos, nearLocation, nowMillis = now)

        assertEquals(VisitStep.SUMMARY, state.currentStep)
        assertEquals(1, state.beforePhotosCount)
        assertEquals(1, state.afterPhotosCount)
        assertTrue(state.hasConditionSelected)
        assertTrue(state.isReadyToSubmit)
    }

    @Test
    fun terminalVisitsEvaluateToSummary() {
        val visit = testVisit(condition = "working", state = VisitState.APPROVED)
        val state = VisitFsm.evaluate(visit, emptyList(), null, nowMillis = now)

        assertEquals(VisitStep.SUMMARY, state.currentStep)
    }

    @Test
    fun detectsMockLocation() {
        val visit = testVisit()
        val mockLocation = GeoPoint(30.0444, 31.2357, 10f, now, isMock = true)
        val state = VisitFsm.evaluate(visit, emptyList(), mockLocation, nowMillis = now)

        assertEquals(LocationDecision.Mocked, state.locationDecision)
    }
}
