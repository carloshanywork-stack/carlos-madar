package com.madar.rep.app.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * MADAR operations are reported in Africa/Cairo. The original capture instant is
 * always stored as epoch milliseconds and sent to the server as an ISO-8601 UTC
 * string; only the human watermark is localized.
 */
object MadarTime {
    val cairo: TimeZone = TimeZone.getTimeZone("Africa/Cairo")
    val utc: TimeZone = TimeZone.getTimeZone("UTC")

    @Volatile
    var serverClockOffsetMs: Long = 0L

    fun nowCalibrated(): Long = System.currentTimeMillis() + serverClockOffsetMs

    fun isoUtc(epochMillis: Long): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = utc
        return format.format(Date(epochMillis))
    }

    fun parseIso(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        val patterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
        )
        for (pattern in patterns) {
            val parsed = runCatching {
                SimpleDateFormat(pattern, Locale.US).apply {
                    timeZone = if (pattern.endsWith("'Z'")) utc else cairo
                    isLenient = false
                }.parse(value)
            }.getOrNull()
            if (parsed != null) return parsed.time
        }
        return null
    }

    fun watermark(epochMillis: Long): WatermarkTime {
        val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = cairo }.format(Date(epochMillis))
        val weekday = SimpleDateFormat("EEEE", Locale("ar", "EG")).apply { timeZone = cairo }.format(Date(epochMillis))
        val time = SimpleDateFormat("hh:mm:ss a", Locale.US).apply { timeZone = cairo }.format(Date(epochMillis))
        return WatermarkTime(date, weekday, time)
    }

    fun displayDateTime(epochMillis: Long): String {
        val format = SimpleDateFormat("yyyy-MM-dd hh:mm a", Locale.US)
        format.timeZone = cairo
        return format.format(Date(epochMillis))
    }

    fun displayTime(epochMillis: Long): String {
        val format = SimpleDateFormat("hh:mm:ss a", Locale.US)
        format.timeZone = cairo
        return format.format(Date(epochMillis))
    }
}

data class WatermarkTime(val date: String, val weekday: String, val time: String)
