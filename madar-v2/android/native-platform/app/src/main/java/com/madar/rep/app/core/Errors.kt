package com.madar.rep.app.core

/**
 * Errors are deliberately split by recovery action. A network failure must never
 * be shown as a bad password, and an expired session must reopen login instead of
 * silently retrying forever.
 */
sealed class MadarError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class InvalidCredentials(message: String = "Invalid credentials") : MadarError(message)
    class AccountDisabled(message: String = "Account disabled") : MadarError(message)
    class SessionExpired(message: String = "Session expired") : MadarError(message)
    class Network(message: String = "Network unavailable", cause: Throwable? = null) : MadarError(message, cause)
    class Server(message: String = "Server unavailable") : MadarError(message)
    class Protocol(message: String = "Unexpected server response") : MadarError(message)
    class Conflict(message: String = "Content conflict") : MadarError(message)
    class Validation(message: String = "Validation failed") : MadarError(message)
    class Permission(message: String = "Permission required") : MadarError(message)
}
