package com.madar.rep.app.core

object PhotoPolicy {
    const val VERSION = 2
    const val MIN_PER_PHASE = 1
    const val MAX_PER_PHASE = 20

    fun validCount(count: Int): Boolean = count in MIN_PER_PHASE..MAX_PER_PHASE

    fun validVisit(before: Int, after: Int): Boolean =
        validCount(before) && validCount(after)

    fun validateVisit(before: Int, after: Int) {
        if (!validVisit(before, after)) {
            throw MadarError.Validation(
                "كل مرحلة تحتاج صورة واحدة على الأقل وبحد أقصى $MAX_PER_PHASE صورة (قبل: $before، بعد: $after)."
            )
        }
    }
}
