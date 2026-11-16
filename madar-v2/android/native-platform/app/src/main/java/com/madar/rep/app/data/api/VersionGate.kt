package com.madar.rep.app.data.api

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

object VersionGate {
    private val _required = MutableStateFlow(false)
    val required = _required.asStateFlow()

    fun requireUpdate() { _required.value = true }
    fun setRequired(required: Boolean) { _required.value = required }
}
