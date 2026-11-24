package com.madar.rep.app.data.sync

import com.madar.rep.app.core.MadarError
import com.madar.rep.app.data.api.AutomaticDiagnostic
import com.madar.rep.app.data.api.DiagnosticFailure
import com.madar.rep.app.data.api.DiagnosticOperation
import com.madar.rep.app.data.api.MadarApi
import com.madar.rep.app.data.db.AutomaticReportSample
import kotlinx.coroutines.CancellationException
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AutomaticDiagnosticsTest {
    private val diagnostic = AutomaticDiagnostic(
        reportUuid = "4498bfb0-e35f-4003-b77f-295b00c89322",
        operation = DiagnosticOperation.VISIT_SYNC,
        failureCode = DiagnosticFailure.SERVER,
        httpStatus = 503,
        occurredAt = "2026-11-24T13:00:00.000Z",
        appVersion = "2.5.11",
        versionCode = 43,
        androidVersion = 34,
    )

    @Test
    fun automaticDataHasItsOwnEndpointAndContainsOnlyAllowlistedFields() {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            assertEquals("/api/rep/support/diagnostics", request.url.encodedPath)
            assertEquals("POST", request.method)
            val sink = Buffer()
            requireNotNull(request.body).writeTo(sink)
            val payload = JSONObject(sink.readUtf8())
            assertEquals(
                setOf("reportUuid", "operation", "failureCode", "httpStatus", "occurredAt", "appVersion", "versionCode", "androidVersion"),
                payload.keys().asSequence().toSet(),
            )
            assertEquals("visit_sync", payload.getString("operation"))
            assertEquals("server", payload.getString("failureCode"))
            assertEquals(503, payload.getInt("httpStatus"))
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(201).message("OK")
                .body("""{"success":true,"report":{"id":1,"reportUuid":"${diagnostic.reportUuid}","status":"received","idempotent":false}}""".toResponseBody())
                .build()
        }.build()
        assertEquals(diagnostic.reportUuid, MadarApi("https://example.ts.net", client).submitAutomaticDiagnostic("test", diagnostic))
    }

    @Test
    fun transientAndRejectedTransportStatusesStaySanitized() {
        fun send(status: Int): Throwable? {
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(status).message("failure")
                    .body("""{"error":"private example from remote"}""".toResponseBody())
                    .build()
            }.build()
            return runCatching {
                MadarApi("https://example.ts.net", client).submitAutomaticDiagnostic("test", diagnostic)
            }.exceptionOrNull()
        }
        assertTrue(send(401) is MadarError.SessionExpired)
        assertTrue(send(429) is MadarError.Server)
        assertTrue(send(503) is MadarError.Server)
        for (code in listOf(400, 409)) {
            val error = send(code)
            assertTrue(error is MadarError.Validation)
            assertFalse(error?.message.orEmpty().contains("private example"))
        }
        assertTrue(send(201) is MadarError.Network)
    }

    @Test
    fun onlyNewCategoriesCanBeQueuedAndRepeatedFailuresAreBounded() {
        val now = 1_800_000_000_000L
        val payload = AutomaticDiagnosticPayload.encode(diagnostic)
        assertTrue(payload.startsWith(AutomaticDiagnosticPayload.PREFIX))
        assertEquals(diagnostic, AutomaticDiagnosticPayload.decode(payload))
        assertTrue(canQueueAutomaticDiagnostic(diagnostic, emptyList(), 0, now))
        assertFalse(canQueueAutomaticDiagnostic(diagnostic, listOf(AutomaticReportSample(payload, now - 1000)), 1, now))
        assertTrue(canQueueAutomaticDiagnostic(diagnostic, listOf(AutomaticReportSample(payload, now - 7 * 60 * 60 * 1000)), 1, now))
        assertFalse(canQueueAutomaticDiagnostic(diagnostic, emptyList(), 24, now))
        assertFalse(canQueueAutomaticDiagnostic(diagnostic, List(12) { AutomaticReportSample(payload, now) }, 0, now))
        assertTrue(AutomaticDiagnosticPayload.isLegacyCameraReport("""{"category":"camera","screenName":"camera/capture","description":"private"}"""))
        assertFalse(AutomaticDiagnosticPayload.isLegacyCameraReport("""{"category":"camera","screenName":"profile/support"}"""))
        assertNull(AutomaticDiagnosticPayload.decode("""{"category":"bug","description":"manual"}"""))
    }

    @Test
    fun ordinaryUserErrorsAndCancellationsAreNotDiagnoses() {
        assertNull(diagnosticFailureFor(CancellationException()))
        assertNull(diagnosticFailureFor(MadarError.Validation("user error")))
        assertNull(diagnosticFailureFor(MadarError.Permission("denied")))
        assertNull(diagnosticFailureFor(MadarError.SessionExpired()))
        assertNull(diagnosticFailureFor(MadarError.Network()))
        assertEquals(DiagnosticFailure.NETWORK, diagnosticFailureFor(MadarError.Network(), includeNetwork = true))
        assertEquals(DiagnosticFailure.SERVER, diagnosticFailureFor(MadarError.Server("server message")))
        assertEquals(DiagnosticFailure.PROTOCOL, diagnosticFailureFor(MadarError.Protocol("server message")))
    }
}
