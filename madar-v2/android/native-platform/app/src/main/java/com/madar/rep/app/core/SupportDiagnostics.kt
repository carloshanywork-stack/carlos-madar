package com.madar.rep.app.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.ArrayDeque

/** A bounded in-app event buffer. Only controlled event codes are accepted, never raw logcat or business text. */
object SupportDiagnostics {
    private const val MAX_LINES = 60
    private val events = ArrayDeque<String>()
    private val eventCode = Regex("^[a-z][a-z0-9_.-]{0,48}$")
    private val dateFormat = ThreadLocal.withInitial { SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT) }

    @Synchronized
    fun record(area: String, code: String) {
        if (!eventCode.matches(area) || !eventCode.matches(code)) return
        val timestamp = dateFormat.get().format(Date())
        events.addLast(redact("$timestamp $area:$code"))
        while (events.size > MAX_LINES) events.removeFirst()
    }

    @Synchronized
    fun recentLines(limit: Int = 40): String = events.takeLast(limit.coerceIn(0, MAX_LINES)).joinToString("\n")

    fun redact(value: String): String = value
        .replace(Regex("(?i)\\bBearer\\s+[A-Za-z0-9._~+/-]+=*"), "Bearer [REDACTED]")
        .replace(Regex("(?i)(authorization|cookie|token|secret|password|session[_-]?id)\\s*[:=]\\s*[^\\s,;]+")) {
            "${it.groupValues[1]}=[REDACTED]"
        }
        .replace(Regex("\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b", RegexOption.IGNORE_CASE), "[EMAIL]")
        .replace(Regex("(?<!\\d)(?:\\+?\\d[\\s().-]?){8,15}(?!\\d)"), "[PHONE]")
        .replace(Regex("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]"), "")
}
