package com.madar.rep.app.data.sync

import android.os.Build
import android.util.AtomicFile
import androidx.room.withTransaction
import com.madar.rep.app.BuildConfig
import com.madar.rep.app.core.MadarError
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.api.AutomaticDiagnostic
import com.madar.rep.app.data.api.DiagnosticFailure
import com.madar.rep.app.data.api.DiagnosticOperation
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.db.AutomaticReportSample
import com.madar.rep.app.data.db.SupportReportEntity
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private const val HOURS_MS = 60L * 60L * 1000L
private const val DAILY_LIMIT = 12
private const val PENDING_LIMIT = 24
private const val DEDUP_WINDOW_MS = 6 * HOURS_MS
private const val DAY_MS = 24 * HOURS_MS

internal fun diagnosticFailureFor(error: Exception, includeNetwork: Boolean = false): DiagnosticFailure? = when (error) {
    is CancellationException, is MadarError.InvalidCredentials, is MadarError.AccountDisabled,
    is MadarError.SessionExpired, is MadarError.Conflict, is MadarError.Validation, is MadarError.Permission -> null
    is MadarError.Network -> DiagnosticFailure.NETWORK.takeIf { includeNetwork }
    is MadarError.Server -> DiagnosticFailure.SERVER
    is MadarError.Protocol -> DiagnosticFailure.PROTOCOL
    else -> DiagnosticFailure.UNEXPECTED
}

@Serializable
private data class QueuedDiagnostic(
    val category: String = "diagnostics",
    val diagnostic: AutomaticDiagnostic,
)

internal object AutomaticDiagnosticPayload {
    const val PREFIX = "{\"category\":\"diagnostics\","
    private val json = Json { encodeDefaults = true; explicitNulls = false }

    fun encode(diagnostic: AutomaticDiagnostic): String =
        json.encodeToString(QueuedDiagnostic.serializer(), QueuedDiagnostic(diagnostic = diagnostic))

    fun decode(payload: String): AutomaticDiagnostic? = if (payload.startsWith(PREFIX)) {
        runCatching { json.decodeFromString(QueuedDiagnostic.serializer(), payload).diagnostic }.getOrNull()
    } else null

    fun isLegacyCameraReport(payload: String): Boolean {
        val body = runCatching { json.parseToJsonElement(payload) as? JsonObject }.getOrNull() ?: return false
        return (body["category"] as? JsonPrimitive)?.content == "camera" &&
            (body["screenName"] as? JsonPrimitive)?.content == "camera/capture"
    }
}

internal fun canQueueAutomaticDiagnostic(
    diagnostic: AutomaticDiagnostic,
    recent: List<AutomaticReportSample>,
    pending: Int,
    now: Long,
): Boolean = pending < PENDING_LIMIT && recent.size < DAILY_LIMIT && recent.none { report ->
    report.createdAt >= now - DEDUP_WINDOW_MS && AutomaticDiagnosticPayload.decode(report.payloadJson)?.let {
        it.operation == diagnostic.operation && it.failureCode == diagnostic.failureCode
    } == true
}

class AutomaticDiagnostics(
    private val database: MadarDatabase,
    private val scheduler: SyncScheduler,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun recordAsync(ownerRepId: Long?, operation: DiagnosticOperation, failure: DiagnosticFailure) {
        if (ownerRepId == null) return
        scope.launch { record(ownerRepId, operation, failure, schedule = true) }
    }

    suspend fun record(
        ownerRepId: Long,
        operation: DiagnosticOperation,
        failure: DiagnosticFailure,
        httpStatus: Int? = null,
        schedule: Boolean = false,
    ) {
        enqueueSafely(ownerRepId, newDiagnostic(operation, failure, httpStatus), schedule)
    }

    internal suspend fun enqueueSafely(ownerRepId: Long, diagnostic: AutomaticDiagnostic, schedule: Boolean): Boolean {
        if (ownerRepId <= 0) return true
        val now = System.currentTimeMillis()
        return try {
            val inserted = database.withTransaction {
                val reports = database.supportReports()
                val pending = reports.countPendingAutomatic(ownerRepId, AutomaticDiagnosticPayload.PREFIX)
                val recent = reports.recentAutomaticPayloads(ownerRepId, now - DAY_MS, DAILY_LIMIT, AutomaticDiagnosticPayload.PREFIX)
                if (!canQueueAutomaticDiagnostic(diagnostic, recent, pending, now)) return@withTransaction false
                reports.insertAutomatic(SupportReportEntity(
                    reportUuid = diagnostic.reportUuid,
                    ownerRepId = ownerRepId,
                    payloadJson = AutomaticDiagnosticPayload.encode(diagnostic),
                    createdAt = now,
                    updatedAt = now,
                )) != -1L
            }
            if (inserted && schedule) scheduler.enqueueNow()
            true
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            false
        }
    }
}

private fun newDiagnostic(operation: DiagnosticOperation, failure: DiagnosticFailure, status: Int? = null) =
    AutomaticDiagnostic(
        reportUuid = UUID.randomUUID().toString(),
        operation = operation,
        failureCode = failure,
        httpStatus = status?.takeIf { it in 400..599 },
        occurredAt = MadarTime.isoUtc(System.currentTimeMillis()),
        appVersion = BuildConfig.VERSION_NAME,
        versionCode = BuildConfig.VERSION_CODE,
        androidVersion = Build.VERSION.SDK_INT,
    )

@Serializable
private data class PendingCrash(val ownerRepId: Long, val diagnostic: AutomaticDiagnostic)

/** Saves one small owner-scoped crash marker, then delegates to Android's original handler. */
class AutomaticCrashHandoff private constructor(private val marker: AtomicFile) {
    constructor(directory: File) : this(AtomicFile(File(directory, "madar-diagnostic-crash.json")))

    private val lock = Any()
    private val json = Json { explicitNulls = false }

    fun install(owner: () -> Long?) {
        val previous = Thread.getDefaultUncaughtExceptionHandler() ?: return
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                if (error !is CancellationException) {
                    owner()?.takeIf { it > 0 }?.let { ownerRepId ->
                        val crash = PendingCrash(ownerRepId, newDiagnostic(
                            DiagnosticOperation.APP_CRASH, DiagnosticFailure.UNCAUGHT_EXCEPTION,
                        ))
                        synchronized(lock) {
                            val output = marker.startWrite()
                            try {
                                output.write(json.encodeToString(PendingCrash.serializer(), crash).toByteArray(Charsets.UTF_8))
                                marker.finishWrite(output)
                            } catch (_: Exception) {
                                marker.failWrite(output)
                            }
                        }
                    }
                }
            } catch (_: Throwable) {
                // The normal Android crash path remains responsible for terminating the process.
            } finally {
                previous.uncaughtException(thread, error)
            }
        }
    }

    suspend fun restore(ownerRepId: Long, diagnostics: AutomaticDiagnostics) {
        val crash = synchronized(lock) { readMarker() } ?: return
        if (crash.ownerRepId != ownerRepId) return
        if (diagnostics.enqueueSafely(ownerRepId, crash.diagnostic, schedule = true)) {
            synchronized(lock) {
                if (readMarker()?.diagnostic?.reportUuid == crash.diagnostic.reportUuid) marker.delete()
            }
        }
    }

    private fun readMarker(): PendingCrash? = runCatching {
        if (marker.baseFile.length() > 1024L) {
            marker.delete()
            return null
        }
        json.decodeFromString(PendingCrash.serializer(), marker.readFully().toString(Charsets.UTF_8))
    }.getOrNull()
}
