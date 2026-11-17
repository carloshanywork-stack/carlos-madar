package com.madar.rep.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreSafetyTest {
    @Test
    fun rejectsNonFiniteAndOutOfRangeCoordinates() {
        val nan = GeoPoint(Double.NaN, 31.2, 4f, NOW)
        val infinity = GeoPoint(30.0, Double.POSITIVE_INFINITY, 4f, NOW)
        val outOfRange = GeoPoint(91.0, 31.2, 4f, NOW)

        assertTrue(GeoPolicy.evaluate(nan, null, null, nowMillis = NOW) is LocationDecision.InvalidCoordinates)
        assertTrue(GeoPolicy.evaluate(infinity, null, null, nowMillis = NOW) is LocationDecision.InvalidCoordinates)
        assertTrue(GeoPolicy.evaluate(outOfRange, null, null, nowMillis = NOW) is LocationDecision.InvalidCoordinates)
    }

    @Test
    fun validatesMachinePinAndPolicyParameters() {
        val point = point()
        assertTrue(GeoPolicy.evaluate(point, 30.0, null, nowMillis = NOW) is LocationDecision.InvalidCoordinates)
        assertTrue(GeoPolicy.evaluate(point, 91.0, 31.2, nowMillis = NOW) is LocationDecision.InvalidCoordinates)
        assertTrue(GeoPolicy.evaluate(point, null, null, radiusMeters = Double.NaN, nowMillis = NOW) is LocationDecision.InvalidCoordinates)
        assertTrue(GeoPolicy.evaluate(point, null, null, maxAccuracyMeters = Float.NaN, nowMillis = NOW) is LocationDecision.InvalidCoordinates)
    }

    @Test
    fun enforcesFreshnessAccuracyMockAndDocumentedClockTolerance() {
        assertEquals(LocationDecision.Valid, GeoPolicy.evaluate(point(at = NOW), null, null, nowMillis = NOW))
        assertTrue(GeoPolicy.evaluate(point(at = NOW - 300_001), null, null, nowMillis = NOW) is LocationDecision.Stale)
        assertTrue(GeoPolicy.evaluate(point(at = NOW + 60_001), null, null, nowMillis = NOW) is LocationDecision.Stale)
        assertEquals(LocationDecision.Valid, GeoPolicy.evaluate(point(at = NOW + 60_000), null, null, nowMillis = NOW))
        assertTrue(GeoPolicy.evaluate(point(accuracy = Float.NaN), null, null, nowMillis = NOW) is LocationDecision.Inaccurate)
        assertEquals(LocationDecision.Mocked, GeoPolicy.evaluate(point(mock = true), null, null, nowMillis = NOW))
    }

    @Test
    fun geofenceUsesDistanceMinusAccuracy() {
        val target = point(latitude = 30.0, longitude = 31.0, accuracy = 25f)
        assertEquals(LocationDecision.Valid, GeoPolicy.evaluate(target, 30.0, 31.0006, 50.0, NOW))
        assertTrue(GeoPolicy.evaluate(target, 30.0, 31.0012, 50.0, NOW) is LocationDecision.Outside)
    }

    @Test
    fun photoPolicyRequiresBeforeAndAfterAndCapsEachPhaseAtTwenty() {
        assertFalse(PhotoPolicy.validVisit(0, 1))
        assertFalse(PhotoPolicy.validVisit(1, 0))
        assertTrue(PhotoPolicy.validVisit(1, 1))
        assertTrue(PhotoPolicy.validVisit(20, 20))
        assertFalse(PhotoPolicy.validVisit(21, 1))
    }

    @Test
    fun processingAndLostResponsesAreNeverFinalAcknowledgements() {
        assertEquals(SyncSignal.PROCESSING, SyncPolicy.classify(202, true, "processing"))
        assertEquals(SyncSignal.PROCESSING, SyncPolicy.classify(200, true, "processing"))
        assertEquals(SyncSignal.RETRY, SyncPolicy.classify(503))
        assertEquals(SyncSignal.NEEDS_LOGIN, SyncPolicy.classify(401))
        assertEquals(SyncSignal.NEEDS_REVIEW, SyncPolicy.classify(422, false))
        assertEquals(SyncSignal.ACK, SyncPolicy.classify(200, true, "pending_review"))
    }

    @Test
    fun sseParserRetainsPartialFramesAndMultilineData() {
        val parser = SseParser()
        assertTrue(parser.feed("id: 7\nevent: operations\ndata: {\"ok\":\n").isEmpty())
        val events = parser.feed("data: true}\n\n")
        assertEquals(1, events.size)
        assertEquals("7", events.single().id)
        assertEquals("operations", events.single().event)
        assertEquals("{\"ok\":\ntrue}", events.single().data)
    }

    @Test
    fun tileMathRoundTripsCairoAndUsesTmsRows() {
        val z = 12
        val x = TileMath.lonToTileX(31.2357, z)
        val y = TileMath.latToTileY(30.0444, z)
        assertEquals(y, TileMath.xyzY(TileMath.tmsY(y, z), z))
        val viewport = TileViewport(30.0444, 31.2357, z.toDouble(), 1080, 1920)
        val screen = TileMath.worldToScreen(30.0444, 31.2357, viewport)
        assertEquals(540.0, screen.first, 0.001)
        assertEquals(960.0, screen.second, 0.001)
        assertTrue(x in 0 until (1 shl z))
    }

    private fun point(
        latitude: Double = 30.0,
        longitude: Double = 31.0,
        accuracy: Float = 5f,
        at: Long = NOW,
        mock: Boolean = false,
    ) = GeoPoint(latitude, longitude, accuracy, at, "gps", mock)

    private companion object {
        const val NOW = 1_800_000_000_000L
    }
}
