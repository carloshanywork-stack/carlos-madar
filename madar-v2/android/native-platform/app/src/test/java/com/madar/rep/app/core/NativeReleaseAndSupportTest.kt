package com.madar.rep.app.core

import com.madar.rep.app.data.api.ApkUpdateChecks
import com.madar.rep.app.data.sync.SupportReportQueueItem
import com.madar.rep.app.data.sync.flushSupportReportOutbox
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeReleaseAndSupportTest {
    @Test
    fun updatePolicyRequiresStrictlyHigherVersionCode() {
        assertTrue(ApkUpdateChecks.isNewer(16, 15))
        assertFalse(ApkUpdateChecks.isNewer(15, 15))
        assertFalse(ApkUpdateChecks.isNewer(14, 15))
    }

    @Test
    fun updatePolicyChecksApkHashAndTrustedSigner() {
        val hash = "a".repeat(64)
        val signer = ApkUpdateChecks.TRUSTED_SIGNER_SHA256
        assertTrue(ApkUpdateChecks.hashMatches(hash, hash.uppercase()))
        assertFalse(ApkUpdateChecks.hashMatches(hash, "b".repeat(64)))
        assertFalse(ApkUpdateChecks.hashMatches("short", hash))
        assertTrue(ApkUpdateChecks.signerMatches(signer.uppercase()))
        assertFalse(ApkUpdateChecks.signerMatches("0".repeat(64)))
        assertFalse(ApkUpdateChecks.signerMatches("bad"))
    }

    @Test
    fun reportDiagnosticsRedactCredentialsEmailsAndPhoneNumbers() {
        val safe = SupportDiagnostics.redact(
            "Bearer abc.def token=secret cookie=session authorization:Basic abc user@example.com +966 50 123 4567",
        )
        assertFalse(safe.contains("abc.def"))
        assertFalse(safe.contains("secret"))
        assertFalse(safe.contains("session"))
        assertFalse(safe.contains("user@example.com"))
        assertFalse(safe.contains("123 4567"))
        assertTrue(safe.contains("[REDACTED]"))
        assertTrue(safe.contains("[EMAIL]"))
        assertTrue(safe.contains("[PHONE]"))
    }

    @Test
    fun offlineReportRetryUsesSameUuidAndServerDuplicateAckClearsItOnce() = runBlocking {
        val uuid = "0bdff93f-3112-4d39-910c-3d6910bb7a82"
        val queued = mutableListOf(SupportReportQueueItem(uuid, "{}", null, 0))
        val serverReports = mutableMapOf<String, String>()
        var calls = 0
        var acknowledgements = 0

        val first = flushSupportReportOutbox(
            queued.toList(),
            send = { report ->
                calls += 1
                serverReports.putIfAbsent(report.reportUuid, report.payloadJson)
                throw MadarError.Network("response lost after server commit")
            },
            markSent = { acknowledgements += 1; queued.removeAll { it.reportUuid == uuid } },
            markRetry = { _, _ -> },
            markNeedsReview = { _, message -> throw AssertionError(message) },
            markNeedsLogin = { throw AssertionError("Unexpected login expiry") },
        )
        assertEquals(1, first.retried)
        assertEquals(1, queued.size)

        val second = flushSupportReportOutbox(
            queued.toList(),
            send = { report ->
                calls += 1
                serverReports.putIfAbsent(report.reportUuid, report.payloadJson)
                report.reportUuid // Server's idempotent 200 response returns the original UUID.
            },
            markSent = { acknowledgements += 1; queued.removeAll { it.reportUuid == uuid } },
            markRetry = { _, message -> throw AssertionError(message) },
            markNeedsReview = { _, message -> throw AssertionError(message) },
            markNeedsLogin = { throw AssertionError("Unexpected login expiry") },
        )
        assertEquals(1, second.sent)
        assertEquals(2, calls)
        assertEquals(1, serverReports.size)
        assertEquals(1, acknowledgements)
        assertTrue(queued.isEmpty())
    }
}
