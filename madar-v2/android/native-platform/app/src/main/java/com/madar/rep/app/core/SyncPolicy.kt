package com.madar.rep.app.core

enum class SyncSignal {
    ACK,
    PROCESSING,
    NEEDS_LOGIN,
    NEEDS_REVIEW,
    RETRY,
}

object SyncPolicy {
    const val MAX_ATTEMPTS = 20

    fun classify(
        httpStatus: Int,
        success: Boolean? = null,
        status: String? = null,
        message: String? = null,
    ): SyncSignal {
        if (httpStatus == 401) return SyncSignal.NEEDS_LOGIN
        if (httpStatus == 403) {
            val disabled = message?.contains("معطل") == true || message?.contains("disabled", true) == true
            return if (disabled) SyncSignal.NEEDS_LOGIN else SyncSignal.NEEDS_REVIEW
        }
        if (httpStatus == 202 || status.equals("processing", true)) return SyncSignal.PROCESSING
        if (httpStatus in 200..299) {
            return if (success == false) SyncSignal.NEEDS_REVIEW else SyncSignal.ACK
        }
        if (httpStatus == 409) {
            val isTransientConflict = message?.contains("wait", ignoreCase = true) == true ||
                message?.contains("انتظار", ignoreCase = true) == true ||
                message?.contains("another representative", ignoreCase = true) == true ||
                message?.contains("active visit", ignoreCase = true) == true
            return if (isTransientConflict) SyncSignal.RETRY else SyncSignal.NEEDS_REVIEW
        }
        if (httpStatus in setOf(400, 410, 422)) return SyncSignal.NEEDS_REVIEW
        if (httpStatus == 429 || httpStatus >= 500) return SyncSignal.RETRY
        return SyncSignal.RETRY
    }

    fun retryDelayMillis(attempt: Int): Long {
        val bounded = attempt.coerceIn(1, 10)
        return (15_000L shl (bounded - 1)).coerceAtMost(30 * 60 * 1000L)
    }
}
