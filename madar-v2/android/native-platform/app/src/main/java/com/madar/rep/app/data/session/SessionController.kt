package com.madar.rep.app.data.session

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * A single observable owner of the signed-in session. Screens observe
 * [session]; [state] manages the session lifecycle state machine.
 */
class SessionController(private val gateway: SessionGateway) {
    private val _session = MutableStateFlow(gateway.current())
    val session: StateFlow<Session?> = _session.asStateFlow()

    private val _state = MutableStateFlow(resolveInitialState())
    val state: StateFlow<SessionState> = _state.asStateFlow()

    fun enrolledIdentity(): LocalIdentity? = gateway.enrolledIdentity()

    fun isLocked(): Boolean = gateway.isLocked()

    private fun resolveInitialState(): SessionState {
        val identity = gateway.enrolledIdentity() ?: return SessionState.ENROLLMENT_REQUIRED
        val current = gateway.current()
        return when {
            current == null -> SessionState.LOCKED
            current.isOfflineOnly -> SessionState.OFFLINE_UNLOCKED
            else -> SessionState.ONLINE_AUTHENTICATED
        }
    }

    @Synchronized
    fun reload(): Session? {
        val current = gateway.current()
        _session.value = current
        _state.value = resolveInitialState()
        return current
    }

    @Synchronized
    fun login(serverUrl: String, username: String, password: String): Session {
        val session = gateway.login(serverUrl, username, password)
        _session.value = session
        _state.value = SessionState.ONLINE_AUTHENTICATED
        return session
    }

    @Synchronized
    fun unlockOffline(): Session {
        val session = gateway.unlockOffline()
        _session.value = session
        _state.value = if (session.isOfflineOnly) SessionState.OFFLINE_UNLOCKED else SessionState.ONLINE_AUTHENTICATED
        return session
    }

    @Synchronized
    fun refreshCredentials(): Session? {
        val current = _session.value ?: return null
        _state.value = SessionState.TOKEN_REFRESHING
        val refreshed = gateway.refreshCredentials(current)
        if (refreshed != null) {
            _session.value = refreshed
            _state.value = SessionState.ONLINE_AUTHENTICATED
            return refreshed
        }
        _state.value = if (current.isOfflineOnly) SessionState.OFFLINE_UNLOCKED else SessionState.ONLINE_AUTHENTICATED
        return null
    }

    @Synchronized
    fun lock() {
        gateway.lock()
        _session.value = null
        _state.value = SessionState.LOCKED
    }

    @Synchronized
    fun expire() {
        // Expire safely locks without clearing identity or Room data!
        gateway.lock()
        _session.value = null
        _state.value = SessionState.AUTH_REQUIRED
    }

    @Synchronized
    fun logout() = lock()

    @Synchronized
    fun removeAccount() {
        gateway.removeAccount()
        _session.value = null
        _state.value = SessionState.ENROLLMENT_REQUIRED
    }
}
