package com.madar.rep.app.data.session

import com.madar.rep.app.core.Jwt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineSessionTest {

    @Test
    fun localIdentitySerializationAndLeaseValidity() {
        val now = 1700000000L
        val identity = LocalIdentity(
            serverUrl = "https://madar.example.com",
            repId = 42L,
            ownerScopeId = 123456789L,
            username = "rep_ahmed",
            fullName = "أحمد محمد",
            deviceId = "madar-rep-device-test-uuid",
            lastVerifiedAtEpochSeconds = now,
            lastSyncAtEpochSeconds = now - 3600,
            offlineLeaseExpiresAtEpochSeconds = now + (14 * 24 * 3600),
        )

        val encoded = SessionCodec.encodeIdentity(identity)
        val decoded = SessionCodec.decodeIdentity(encoded)

        assertEquals(identity.serverUrl, decoded.serverUrl)
        assertEquals(identity.repId, decoded.repId)
        assertEquals(identity.ownerScopeId, decoded.ownerScopeId)
        assertEquals(identity.username, decoded.username)
        assertEquals(identity.fullName, decoded.fullName)
        assertEquals(identity.deviceId, decoded.deviceId)
        assertEquals(identity.offlineLeaseExpiresAtEpochSeconds, decoded.offlineLeaseExpiresAtEpochSeconds)

        // Lease is valid before expiration
        assertTrue(decoded.isOfflineLeaseValid(now))
        assertTrue(decoded.isOfflineLeaseValid(now + (10 * 24 * 3600)))
        // Lease is expired after deadline
        assertFalse(decoded.isOfflineLeaseValid(now + (15 * 24 * 3600)))
    }

    @Test
    fun onlineCredentialsSerializationAndExpiry() {
        val now = 1700000000L
        val creds = OnlineCredentials(
            accessToken = "jwt.access.token",
            refreshToken = "opaque-rotating-refresh-token",
            expiresAtEpochSeconds = now + 3600,
            deviceSessionId = "session-uuid-1",
        )

        val encoded = SessionCodec.encodeCredentials(creds)
        val decoded = SessionCodec.decodeCredentials(encoded)

        assertEquals(creds.accessToken, decoded.accessToken)
        assertEquals(creds.refreshToken, decoded.refreshToken)
        assertEquals(creds.expiresAtEpochSeconds, decoded.expiresAtEpochSeconds)
        assertEquals(creds.deviceSessionId, decoded.deviceSessionId)

        assertFalse(decoded.isAccessExpired(now))
        assertTrue(decoded.isAccessExpired(now + 3600))
    }

    @Test
    fun ownerScopeIdIsDeterministicAndIsolatesAcrossServers() {
        val sessionServerA = Session(
            serverUrl = "https://cairo.madar.com",
            token = "token1",
            repId = 5L,
            username = "rep_5",
            expiresAtEpochSeconds = 1800000000L,
        )
        val sessionServerB = Session(
            serverUrl = "https://alex.madar.com",
            token = "token2",
            repId = 5L,
            username = "rep_5",
            expiresAtEpochSeconds = 1800000000L,
        )
        val sessionServerASameRep = Session(
            serverUrl = "https://cairo.madar.com",
            token = "token3",
            repId = 5L,
            username = "rep_5",
            expiresAtEpochSeconds = 1800000000L,
        )

        // Same server + same rep produces exact same ownerScopeId
        assertEquals(sessionServerA.ownerScopeId, sessionServerASameRep.ownerScopeId)

        // Different server + same rep ID produces DIFFERENT ownerScopeId (no collisions)
        assertNotEquals(sessionServerA.ownerScopeId, sessionServerB.ownerScopeId)
    }

    @Test
    fun jwtHelperMethods() {
        // Sample standard JWT header.payload.signature
        // Payload: {"sub":"42","exp":1800000000,"type":"offline_lease","role":"rep"}
        // base64url: eyJzdWIiOiI0MiIsImV4cCI6MTgwMDAwMDAwMCwidHlwZSI6Im9mZmxpbmVfbGVhc2UiLCJyb2xlIjoicmVwIn0
        val token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiIsImV4cCI6MTgwMDAwMDAwMCwidHlwZSI6Im9mZmxpbmVfbGVhc2UiLCJyb2xlIjoicmVwIn0.dummy-sig"

        val exp = Jwt.expiryEpochSeconds(token)
        assertEquals(1800000000L, exp)

        val role = Jwt.claim(token, "role")
        assertEquals("rep", role)

        val type = Jwt.claim(token, "type")
        assertEquals("offline_lease", type)

        val payload = Jwt.payloadJson(token)
        assertNotNull(payload)
        assertTrue(payload!!.contains("\"role\":\"rep\""))
    }
}
