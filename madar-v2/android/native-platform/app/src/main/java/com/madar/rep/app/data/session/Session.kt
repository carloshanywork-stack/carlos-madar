package com.madar.rep.app.data.session

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.madar.rep.app.core.Jwt
import com.madar.rep.app.core.MadarError
import java.net.URI
import java.nio.ByteBuffer
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class LocalIdentity(
    val serverUrl: String,
    val repId: Long,
    val ownerScopeId: Long,
    val username: String,
    val fullName: String? = null,
    val deviceId: String,
    val lastVerifiedAtEpochSeconds: Long = System.currentTimeMillis() / 1000,
    val lastSyncAtEpochSeconds: Long = 0,
    val offlineLeaseExpiresAtEpochSeconds: Long = (System.currentTimeMillis() / 1000) + (14 * 24 * 3600),
) {
    fun isOfflineLeaseValid(nowEpochSeconds: Long = System.currentTimeMillis() / 1000): Boolean =
        offlineLeaseExpiresAtEpochSeconds > nowEpochSeconds

    val remainingDays: Int
        get() {
            val now = System.currentTimeMillis() / 1000
            val secondsRemaining = (offlineLeaseExpiresAtEpochSeconds - now).coerceAtLeast(0)
            return (secondsRemaining / (24 * 3600)).toInt()
        }
}

@Serializable
data class OnlineCredentials(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtEpochSeconds: Long,
    val deviceSessionId: String? = null,
) {
    fun isAccessExpired(nowEpochSeconds: Long = System.currentTimeMillis() / 1000): Boolean =
        expiresAtEpochSeconds <= nowEpochSeconds + 30
}

@Serializable
data class Session(
    val serverUrl: String,
    val token: String,
    val repId: Long,
    val username: String,
    val fullName: String? = null,
    val expiresAtEpochSeconds: Long,
    val deviceId: String = "",
    val refreshToken: String? = null,
    val offlineLeaseJwt: String? = null,
    val offlineLeaseExpiresAtEpochSeconds: Long = expiresAtEpochSeconds,
    val isOfflineOnly: Boolean = false,
) {
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

    fun isOfflineLeaseValid(nowEpochSeconds: Long = System.currentTimeMillis() / 1000): Boolean =
        offlineLeaseExpiresAtEpochSeconds > nowEpochSeconds

    fun bearer(): String = "Bearer $token"
}

enum class SessionState {
    LOCKED,
    ENROLLMENT_REQUIRED,
    OFFLINE_UNLOCKED,
    ONLINE_AUTHENTICATED,
    TOKEN_REFRESHING,
    SYNCING,
    AUTH_REQUIRED,
    ACCOUNT_REVOKED,
}

object SessionCodec {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    fun encodeSession(session: Session): String = json.encodeToString(Session.serializer(), session)
    fun decodeSession(value: String): Session = json.decodeFromString(Session.serializer(), value)

    fun encodeIdentity(identity: LocalIdentity): String = json.encodeToString(LocalIdentity.serializer(), identity)
    fun decodeIdentity(value: String): LocalIdentity = json.decodeFromString(LocalIdentity.serializer(), value)

    fun encodeCredentials(creds: OnlineCredentials): String = json.encodeToString(OnlineCredentials.serializer(), creds)
    fun decodeCredentials(value: String): OnlineCredentials = json.decodeFromString(OnlineCredentials.serializer(), value)
}

class SecureSessionStore(val context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun getOrCreateDeviceId(): String {
        var id = preferences.getString(KEY_DEVICE_ID, null)
        if (id.isNullOrBlank()) {
            id = "madar-rep-" + UUID.randomUUID().toString()
            preferences.edit().putString(KEY_DEVICE_ID, id).apply()
        }
        return id
    }

    fun save(
        session: Session,
        identity: LocalIdentity,
        credentials: OnlineCredentials?,
        offlineLease: String?,
    ) {
        val editor = preferences.edit()
        editor.putString(KEY_IDENTITY, SessionCodec.encodeIdentity(identity))
        if (offlineLease != null) {
            editor.putString(KEY_OFFLINE_LEASE, offlineLease)
        }
        editor.putBoolean(KEY_LOCKED, false)

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val blobToEncrypt = if (credentials != null) {
            SessionCodec.encodeCredentials(credentials)
        } else {
            SessionCodec.encodeSession(session)
        }
        val encrypted = cipher.doFinal(blobToEncrypt.toByteArray(Charsets.UTF_8))
        val packed = cipher.iv + encrypted
        editor.putString(KEY_SESSION, Base64.encodeToString(packed, Base64.NO_WRAP))
        editor.apply()
    }

    fun saveLegacy(session: Session) {
        val identity = LocalIdentity(
            serverUrl = session.serverUrl,
            repId = session.repId,
            ownerScopeId = session.ownerScopeId,
            username = session.username,
            fullName = session.fullName,
            deviceId = getOrCreateDeviceId(),
            offlineLeaseExpiresAtEpochSeconds = session.expiresAtEpochSeconds,
        )
        val creds = if (session.token.isNotBlank()) {
            OnlineCredentials(
                accessToken = session.token,
                refreshToken = session.refreshToken ?: "",
                expiresAtEpochSeconds = session.expiresAtEpochSeconds,
            )
        } else null
        save(session, identity, creds, session.offlineLeaseJwt)
    }

    fun loadIdentity(): LocalIdentity? {
        val raw = preferences.getString(KEY_IDENTITY, null) ?: return null
        return runCatching { SessionCodec.decodeIdentity(raw) }.getOrNull()
    }

    fun loadOfflineLease(): String? = preferences.getString(KEY_OFFLINE_LEASE, null)

    fun isLocked(): Boolean = preferences.getBoolean(KEY_LOCKED, false)

    fun lock() {
        preferences.edit().putBoolean(KEY_LOCKED, true).apply()
    }

    fun unlock() {
        preferences.edit().putBoolean(KEY_LOCKED, false).apply()
    }

    fun loadCredentials(): OnlineCredentials? {
        val encoded = preferences.getString(KEY_SESSION, null) ?: return null
        return try {
            val packed = Base64.decode(encoded, Base64.NO_WRAP)
            if (packed.size <= IV_BYTES) return null
            val iv = packed.copyOfRange(0, IV_BYTES)
            val cipherText = packed.copyOfRange(IV_BYTES, packed.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
            val plain = String(cipher.doFinal(cipherText), Charsets.UTF_8)
            runCatching { SessionCodec.decodeCredentials(plain) }.getOrElse {
                val legacy = SessionCodec.decodeSession(plain)
                OnlineCredentials(legacy.token, legacy.refreshToken ?: "", legacy.expiresAtEpochSeconds)
            }
        } catch (_: Exception) {
            null
        }
    }

    fun load(): Session? {
        if (isLocked()) return null
        val identity = loadIdentity() ?: return null
        val creds = loadCredentials()
        val leaseJwt = loadOfflineLease()
        val now = System.currentTimeMillis() / 1000

        if (creds != null && !creds.isAccessExpired(now)) {
            return Session(
                serverUrl = identity.serverUrl,
                token = creds.accessToken,
                repId = identity.repId,
                username = identity.username,
                fullName = identity.fullName,
                expiresAtEpochSeconds = creds.expiresAtEpochSeconds,
                deviceId = identity.deviceId,
                refreshToken = creds.refreshToken,
                offlineLeaseJwt = leaseJwt,
                offlineLeaseExpiresAtEpochSeconds = identity.offlineLeaseExpiresAtEpochSeconds,
                isOfflineOnly = false,
            )
        }

        if (identity.isOfflineLeaseValid(now)) {
            return Session(
                serverUrl = identity.serverUrl,
                token = creds?.accessToken ?: "",
                repId = identity.repId,
                username = identity.username,
                fullName = identity.fullName,
                expiresAtEpochSeconds = creds?.expiresAtEpochSeconds ?: 0L,
                deviceId = identity.deviceId,
                refreshToken = creds?.refreshToken,
                offlineLeaseJwt = leaseJwt,
                offlineLeaseExpiresAtEpochSeconds = identity.offlineLeaseExpiresAtEpochSeconds,
                isOfflineOnly = true,
            )
        }

        return null
    }

    fun clear() {
        preferences.edit()
            .remove(KEY_SESSION)
            .remove(KEY_IDENTITY)
            .remove(KEY_OFFLINE_LEASE)
            .remove(KEY_LOCKED)
            .apply()
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
        private const val KEY_IDENTITY = "local_identity"
        private const val KEY_OFFLINE_LEASE = "offline_lease"
        private const val KEY_LOCKED = "is_locked"
        private const val KEY_DEVICE_ID = "device_id"
    }
}

class SessionGateway(
    private val store: SecureSessionStore,
    private val apiFactory: (String) -> com.madar.rep.app.data.api.MadarApi = {
        com.madar.rep.app.data.api.MadarApi(it)
    },
) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    fun current(): Session? = store.load()

    fun enrolledIdentity(): LocalIdentity? = store.loadIdentity()

    fun isLocked(): Boolean = store.isLocked()

    fun requireSession(): Session = current() ?: throw MadarError.SessionExpired()

    fun login(serverUrl: String, username: String, password: String): Session {
        if (username.isBlank()) throw MadarError.Validation("اسم المستخدم مطلوب")
        if (password.isEmpty()) throw MadarError.Validation("كلمة المرور مطلوبة")
        val normalizedUrl = com.madar.rep.app.data.api.MadarApi.normalizeServerUrl(serverUrl)
        val api = apiFactory(normalizedUrl)
        val deviceId = store.getOrCreateDeviceId()
        val deviceName = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}"
        val appVersion = "${com.madar.rep.app.BuildConfig.VERSION_NAME} (${com.madar.rep.app.BuildConfig.VERSION_CODE})"

        val result = api.login(
            username = username,
            password = password,
            deviceId = deviceId,
            deviceName = deviceName,
            appVersion = appVersion,
        )
        when {
            result.status == 401 -> throw MadarError.InvalidCredentials(error(result.body))
            result.status == 403 -> throw MadarError.AccountDisabled(error(result.body))
            result.status == 429 -> throw MadarError.Server("تم تجاوز الحد المسموح لمحاولات تسجيل الدخول")
            result.status >= 500 -> throw MadarError.Server(error(result.body))
            result.status !in 200..299 -> throw MadarError.Protocol(error(result.body))
        }

        val parsed = runCatching {
            json.decodeFromString(
                com.madar.rep.app.data.api.LoginResponse.serializer(),
                result.body
            )
        }.getOrElse { throw MadarError.Protocol("استجابة الخادم غير صالحة") }

        val token = parsed.token ?: throw MadarError.Protocol("لم يصدر الخادم رمز مرور صالح")
        val rep = parsed.rep ?: throw MadarError.Protocol("لم يُرجع الخادم بيانات المندوب")
        val expiry = Jwt.expiryEpochSeconds(token) ?: throw MadarError.Protocol("رمز المرور لا يحتوي على تاريخ انتهاء")
        val leaseExpiry = parsed.offlineLease?.let { Jwt.expiryEpochSeconds(it) }
            ?: ((System.currentTimeMillis() / 1000) + (14 * 24 * 3600))

        val session = Session(
            serverUrl = normalizedUrl,
            token = token,
            repId = rep.id,
            username = rep.username,
            fullName = rep.fullName,
            expiresAtEpochSeconds = expiry,
            deviceId = deviceId,
            refreshToken = parsed.refreshToken,
            offlineLeaseJwt = parsed.offlineLease,
            offlineLeaseExpiresAtEpochSeconds = leaseExpiry,
            isOfflineOnly = false,
        )

        val identity = LocalIdentity(
            serverUrl = normalizedUrl,
            repId = rep.id,
            ownerScopeId = session.ownerScopeId,
            username = rep.username,
            fullName = rep.fullName,
            deviceId = deviceId,
            lastVerifiedAtEpochSeconds = System.currentTimeMillis() / 1000,
            offlineLeaseExpiresAtEpochSeconds = leaseExpiry,
        )

        val creds = parsed.refreshToken?.let {
            OnlineCredentials(
                accessToken = token,
                refreshToken = it,
                expiresAtEpochSeconds = expiry,
                deviceSessionId = parsed.deviceSessionId,
            )
        }

        store.save(session, identity, creds, parsed.offlineLease)
        return session
    }

    fun unlockOffline(): Session {
        val identity = store.loadIdentity()
            ?: throw MadarError.Validation("لا يوجد حساب مسجّل على هذا الجهاز. يلزم تسجيل الدخول عبر الإنترنت أولاً.")
        if (!identity.isOfflineLeaseValid()) {
            throw MadarError.Validation("انتهت صلاحية العمل دون اتصال. يلزم الاتصال بالإنترنت وتسجيل الدخول بكلمة المرور.")
        }
        store.unlock()
        val session = store.load()
            ?: throw MadarError.Validation("تعذر استعادة جلسة العمل المحلية.")
        return session
    }

    fun refreshCredentials(session: Session = requireSession()): Session? {
        val refreshToken = session.refreshToken ?: return null
        val deviceId = session.deviceId.ifBlank { store.getOrCreateDeviceId() }
        val api = apiFactory(session.serverUrl)

        val result = try {
            api.refresh(deviceId, refreshToken)
        } catch (_: MadarError.Network) {
            return null
        } catch (_: Exception) {
            return null
        }

        if (result.status in 200..299) {
            val parsed = runCatching {
                json.decodeFromString(
                    com.madar.rep.app.data.api.RefreshResponse.serializer(),
                    result.body
                )
            }.getOrNull() ?: return null

            val newToken = parsed.token ?: return null
            val newRefreshToken = parsed.refreshToken ?: refreshToken
            val newExpiry = Jwt.expiryEpochSeconds(newToken) ?: (System.currentTimeMillis() / 1000 + 7 * 24 * 3600)
            val newLeaseExpiry = parsed.offlineLease?.let { Jwt.expiryEpochSeconds(it) }
                ?: session.offlineLeaseExpiresAtEpochSeconds

            val updatedSession = session.copy(
                token = newToken,
                refreshToken = newRefreshToken,
                expiresAtEpochSeconds = newExpiry,
                offlineLeaseJwt = parsed.offlineLease ?: session.offlineLeaseJwt,
                offlineLeaseExpiresAtEpochSeconds = newLeaseExpiry,
                isOfflineOnly = false,
            )

            val identity = store.loadIdentity()?.copy(
                lastVerifiedAtEpochSeconds = System.currentTimeMillis() / 1000,
                offlineLeaseExpiresAtEpochSeconds = newLeaseExpiry,
            ) ?: LocalIdentity(
                serverUrl = session.serverUrl,
                repId = session.repId,
                ownerScopeId = session.ownerScopeId,
                username = session.username,
                fullName = session.fullName,
                deviceId = deviceId,
                offlineLeaseExpiresAtEpochSeconds = newLeaseExpiry,
            )

            val creds = OnlineCredentials(
                accessToken = newToken,
                refreshToken = newRefreshToken,
                expiresAtEpochSeconds = newExpiry,
                deviceSessionId = parsed.deviceSessionId,
            )

            store.save(updatedSession, identity, creds, parsed.offlineLease ?: session.offlineLeaseJwt)
            return updatedSession
        }

        if (result.status == 401 || result.status == 403) {
            store.lock()
        }
        return null
    }

    fun lock() = store.lock()

    fun logout() = store.lock()

    fun removeAccount() = store.clear()

    fun verify(session: Session): com.madar.rep.app.data.api.RouteResponse {
        val api = apiFactory(session.serverUrl)
        return api.getRoute(session.token, session.username)
    }

    private fun error(body: String): String = runCatching {
        val parsed = json.decodeFromString(
            com.madar.rep.app.data.api.ApiErrorBody.serializer(),
            body
        )
        parsed.error ?: parsed.message
    }.getOrNull().orEmpty().ifBlank { "طلب غير صالح" }
}
