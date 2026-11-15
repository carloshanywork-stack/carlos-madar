package com.madar.rep.app.core

data class SseEvent(
    val id: String?,
    val event: String?,
    val data: String,
    val retryMillis: Long?,
)

/**
 * Minimal, strict SSE frame parser. It keeps partial lines between reads so a
 * chunk boundary can never turn one event into two invalidation signals.
 */
class SseParser {
    private val data = StringBuilder()
    private var event: String? = null
    private var id: String? = null
    private var retry: Long? = null
    private var line = StringBuilder()

    fun feed(chunk: String): List<SseEvent> {
        val events = ArrayList<SseEvent>()
        for (character in chunk) {
            if (character == '\n') {
                val completed = line.toString().removeSuffix("\r")
                line = StringBuilder()
                processLine(completed, events)
            } else {
                line.append(character)
            }
        }
        return events
    }

    fun reset() {
        data.clear()
        event = null
        id = null
        retry = null
        line = StringBuilder()
    }

    private fun processLine(value: String, output: MutableList<SseEvent>) {
        if (value.isEmpty()) {
            if (data.isNotEmpty()) {
                output.add(SseEvent(id, event, data.toString().removeSuffix("\n"), retry))
            }
            data.clear()
            event = null
            id = null
            retry = null
            return
        }
        if (value.startsWith(":")) return
        val separator = value.indexOf(':')
        val field = if (separator < 0) value else value.substring(0, separator)
        var content = if (separator < 0) "" else value.substring(separator + 1)
        if (content.startsWith(" ")) content = content.substring(1)
        when (field) {
            "data" -> data.append(content).append('\n')
            "event" -> event = content
            "id" -> if (!content.contains('\u0000')) id = content
            "retry" -> retry = content.toLongOrNull()?.takeIf { it in 0..300_000 }
        }
    }
}
