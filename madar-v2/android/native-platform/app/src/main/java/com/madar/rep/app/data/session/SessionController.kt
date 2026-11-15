package com.madar.rep.app.data.session

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A single observable owner of the signed-in session. Screens observe
 * [session]; an expiry discovered by a background worker clears it so the UI
 * returns to login instead of silently retrying with a dead token.
 */
class SessionController(private val gateway: SessionGateway) {
    private val _session = MutableStateFlow(gateway.current())
    val session: StateFlow<Session?> = _session.asStateFlow()

    @Synchronized
    fun reload(): Session? {
        val current = gateway.current()
        _session.value = current
        return current
    }

    @Synchronized
    fun login(serverUrl: String, username: String, password: String): Session {
        val session = gateway.login(serverUrl, username, password)
        _session.value = session
        return session
    }

    @Synchronized
    fun expire() {
        gateway.logout()
        _session.value = null
    }

    @Synchronized
    fun logout() = expire()
}
