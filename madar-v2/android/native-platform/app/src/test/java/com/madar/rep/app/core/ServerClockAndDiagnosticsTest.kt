package com.madar.rep.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerClockAndDiagnosticsTest {

    @Test
    fun parseHttpDateParsesStandardRfc1123Header() {
        val dateHeader = "Tue, 24 Nov 2026 11:00:00 GMT"
        val epochMs = ServerClockTracker.parseHttpDate(dateHeader)
        assertNotNull(epochMs)
        // 2026-11-24T11:00:00Z = 1795518000000L
        assertTrue(epochMs!! > 1700000000000L)
    }

    @Test
    fun skewCalculationAndSuspiciousThresholds() {
        val now = System.currentTimeMillis()
        // Server is 2 minutes ahead (phone is slow)
        ServerClockTracker.update(now + 120_000L, 200L)
        val skew = ServerClockTracker.estimatedSkewMs
        assertNotNull(skew)
        assertTrue(skew!! in 119_000L..121_000L)
        assertFalse(ServerClockTracker.isSkewSuspicious()) // 2 min is < 4 min

        // Server is 5 minutes ahead (phone is 5 minutes slow -> triggers server 300s limit)
        ServerClockTracker.update(now + 310_000L, 200L)
        assertTrue(ServerClockTracker.isSkewSuspicious())
        assertTrue(ServerClockTracker.isSkewCritical())

        // Phone is 70 seconds fast (ahead of server -> triggers server -60s limit)
        ServerClockTracker.update(now - 70_000L, 200L)
        assertTrue(ServerClockTracker.isSkewSuspicious())
        assertTrue(ServerClockTracker.isSkewCritical())

        // Phone and server are in sync
        ServerClockTracker.update(now, 50L)
        assertFalse(ServerClockTracker.isSkewSuspicious())
    }

    @Test
    fun arabicDescriptionReflectsClockDirection() {
        val now = System.currentTimeMillis()
        // Phone ahead
        ServerClockTracker.update(now - 125_000L, 100L)
        val descFast = ServerClockTracker.skewDescriptionArabic()
        assertTrue(descFast.contains("متقدمة"))
        assertTrue(descFast.contains("دقيقة"))

        // Phone behind
        ServerClockTracker.update(now + 180_000L, 100L)
        val descSlow = ServerClockTracker.skewDescriptionArabic()
        assertTrue(descSlow.contains("متأخرة"))
        assertTrue(descSlow.contains("3 دقيقة"))

        // Synced
        ServerClockTracker.update(now + 1_000L, 50L)
        val descSynced = ServerClockTracker.skewDescriptionArabic()
        assertTrue(descSynced.contains("متطابق تماماً"))
    }

    @Test
    fun geoPointFreshnessWithElapsedRealtimeNanos() {
        val point = GeoPoint(
            latitude = 30.0444,
            longitude = 31.2357,
            accuracyMeters = 10f,
            capturedAtMillis = System.currentTimeMillis(),
            provider = "fused",
            isMock = false,
            elapsedRealtimeNanos = 0L,
        )
        // With elapsedRealtimeNanos = 0, falls back to capturedAtMillis
        assertTrue(point.isFresh(System.currentTimeMillis(), 30_000L))
        assertFalse(point.isFresh(System.currentTimeMillis() + 40_000L, 30_000L))
    }
}
