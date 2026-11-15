package com.madar.rep.app.data.session

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.madar.rep.app.core.MadarError
import java.security.KeyStore
import java.net.URI
import java.nio.ByteBuffer
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class Session(
    val serverUrl: String,
    val token: String,
    val repId: Long,
    val username: String,
    val fullName: String? = null,
    val expiresAtEpochSeconds: Long,
) {
    /**
     * Local database namespace is bound to both the server origin and server-side
     * representative ID. A matching numeric ID on another server cannot reveal
     * or upload this server's private queue.
     */
    val ownerScopeId: Long
        get() {
            val origin = runCatching {
                val uri = URI(serverUrl)
                val scheme = uri.scheme.lowercase()
                val host = uri.host.lowercase()
                val port = when {
                    uri.port == -1 -> ""
                    scheme == "https" && uri.port == 443 -> ""
                    scheme == "http" && uri.port == 80 -> ""
                    else -> ":${uri.port}"
                }
                "$scheme://$host$port"
            }.getOrElse { serverUrl.trimEnd('/').lowercase() }
            val digest = java.security.MessageDigest.getInstance("SHA-256")
                .digest("madar-owner-v1\n$origin\n$repId".toByteArray(Charsets.UTF_8))
            return (ByteBuffer.wrap(digest, 0, Long.SIZE_BYTES).long and Long.MAX_VALUE).coerceAtLeast(1L)
        }

    fun isExpired(nowEpochSeconds: Long = System.currentTimeMillis() / 1000): Boolean =
        expiresAtEpochSeconds <= nowEpochSeconds + 30

    fun bearer(): String = "Bearer $token"
}

object SessionCodec {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    fun encode(session: Session): String = json.encodeToString(Session.serializer(), session)
    fun decode(value: String): Session = json.decodeFromString(Session.serializer(), value)
}

/**
 * Encrypts the whole session blob with an Android Keystore AES/GCM key. The
 * token never appears in plain SharedPreferences, and a key invalidation is
 * treated as a signed-out state rather than a crash.
 */
class SecureSessionStore(private val context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun save(session: Session) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(SessionCodec.encode(session).toByteArray(Charsets.UTF_8))
        val packed = cipher.iv + encrypted
        preferences.edit().putString(KEY_SESSION, Base64.encodeToString(packed, Base64.NO_WRAP)).apply()
    }

    fun load(): Session? {
        val encoded = preferences.getString(KEY_SESSION, null) ?: return null
        return try {
            val packed = Base64.decode(encoded, Base64.NO_WRAP)
            if (packed.size <= IV_BYTES) return null
            val iv = packed.copyOfRange(0, IV_BYTES)
            val cipherText = packed.copyOfRange(IV_BYTES, packed.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
            val plain = cipher.doFinal(cipherText)
            SessionCodec.decode(String(plain, Charsets.UTF_8))
        } catch (_: Exception) {
            clear()
            null
        }
    }

    fun clear() {
        preferences.edit().remove(KEY_SESSION).apply()
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "madar.native.session.v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_BYTES = 12
        private const val PREFERENCES = "madar.native.session"
        private const val KEY_SESSION = "encrypted_session"
    }
}

class SessionGateway(
    private val store: SecureSessionStore,
    private val apiFactory: (String) -> com.madar.rep.app.data.api.MadarApi = {
        com.madar.rep.app.data.api.MadarApi(it)
    },
) {
    fun current(): Session? = store.load()?.takeUnless { it.isExpired() }

    fun requireSession(): Session = current() ?: throw MadarError.SessionExpired()

    fun login(serverUrl: String, username: String, password: String): Session {
        if (username.isBlank()) throw MadarError.Validation("Username is required")
        if (password.isEmpty()) throw MadarError.Validation("Password is required")
        val api = apiFactory(serverUrl)
        val result = api.login(username, password)
        when {
            result.status == 401 -> throw MadarError.InvalidCredentials(error(result.body))
            result.status == 403 -> throw MadarError.AccountDisabled(error(result.body))
            result.status == 429 -> throw MadarError.Server("Too many login attempts")
            result.status >= 500 -> throw MadarError.Server(error(result.body))
            result.status !in 200..299 -> throw MadarError.Protocol(error(result.body))
        }
        val parsed = runCatching {
            Json { ignoreUnknownKeys = true }.decodeFromString(
                com.madar.rep.app.data.api.LoginResponse.serializer(),
                result.body
            )
        }.getOrElse { throw MadarError.Protocol("Invalid login response") }
        val token = parsed.token ?: throw MadarError.Protocol("Server did not issue a native token")
        val rep = parsed.rep ?: throw MadarError.Protocol("Server did not return the representative")
        val expiry = com.madar.rep.app.core.Jwt.expiryEpochSeconds(token)
            ?: throw MadarError.Protocol("Token has no expiry")
        val session = Session(
            serverUrl = com.madar.rep.app.data.api.MadarApi.normalizeServerUrl(serverUrl),
            token = token,
            repId = rep.id,
            username = rep.username,
            fullName = rep.fullName,
            expiresAtEpochSeconds = expiry,
        )
        store.save(session)
        return session
    }

    /**
     * Confirms the session with the server. A network failure is not an expiry:
     * the caller keeps the session and works offline.
     */
    fun verify(session: Session): com.madar.rep.app.data.api.RouteResponse {
        val api = apiFactory(session.serverUrl)
        return api.getRoute(session.token, session.username)
    }

    fun logout() = store.clear()

    private fun error(body: String): String = runCatching {
        val parsed = Json { ignoreUnknownKeys = true }.decodeFromString(
            com.madar.rep.app.data.api.ApiErrorBody.serializer(),
            body
        )
        parsed.error ?: parsed.message
    }.getOrNull().orEmpty().ifBlank { "Request rejected" }
}
