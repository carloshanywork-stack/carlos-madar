package com.madar.rep.app.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Tracks the estimated wall-clock skew between this Android device and the MADAR production server.
 * Skew is defined as: (Server Wall Clock Time) - (Device Wall Clock Time).
 *
 * If skew is positive, device clock is behind server (e.g. +300s = phone is 5 minutes slow).
 * If skew is negative, device clock is ahead of server (e.g. -65s = phone is 65 seconds fast).
 *
 * MADAR V2 Server enforces:
 * -60_000 ms <= (ServerTime - GPS/FixTime) <= 300_000 ms (5 minutes past, 1 minute future).
 */
object ServerClockTracker {
    @Volatile
    var estimatedSkewMs: Long? = null
        private set

    @Volatile
    var lastSyncTimestamp: Long = 0L
        private set

    private val httpDateFormat: ThreadLocal<SimpleDateFormat> = ThreadLocal.withInitial {
        SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss z", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("GMT")
        }
    }

    fun parseHttpDate(headerValue: String?): Long? {
        if (headerValue.isNullOrBlank()) return null
        return runCatching {
            httpDateFormat.get()?.parse(headerValue.trim())?.time
        }.getOrNull()
    }

    @Synchronized
    fun update(serverTimeEpochMs: Long, requestDurationMs: Long = 0L) {
        val now = System.currentTimeMillis()
        val estimatedServerNow = serverTimeEpochMs + (requestDurationMs / 2).coerceAtLeast(0L)
        val calculatedSkew = estimatedServerNow - now
        estimatedSkewMs = calculatedSkew
        lastSyncTimestamp = now
    }

    /**
     * Checks if the phone clock is dangerously out of sync with server time.
     * Dangerous threshold: Device is > 45 seconds ahead of server (limit is 60s),
     * or > 240 seconds behind server (limit is 300s).
     */
    fun isSkewSuspicious(): Boolean {
        val skew = estimatedSkewMs ?: return false
        return skew < -45_000L || skew > 240_000L
    }

    fun isSkewCritical(): Boolean {
        val skew = estimatedSkewMs ?: return false
        return skew < -60_000L || skew > 300_000L
    }

    fun skewDescriptionArabic(): String {
        val skew = estimatedSkewMs ?: return "غير محدد (لم يتم الاتصال بالخادم بعد)"
        val absSeconds = kotlin.math.abs(skew) / 1000
        val minutes = absSeconds / 60
        val remainingSeconds = absSeconds % 60

        val formattedDuration = if (minutes > 0) {
            "$minutes دقيقة و $remainingSeconds ثانية"
        } else {
            "$absSeconds ثانية"
        }

        return when {
            kotlin.math.abs(skew) < 5_000L -> "متطابق تماماً (فارق أقل من 5 ثوانٍ)"
            skew < 0 -> "ساعة الهاتف متقدمة على الخادم بمقدار $formattedDuration"
            else -> "ساعة الهاتف متأخرة عن الخادم بمقدار $formattedDuration"
        }
    }
}
