package com.madar.rep.app.data.sync

import com.madar.rep.app.core.MadarError
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.core.SyncPolicy
import com.madar.rep.app.core.SyncSignal
import com.madar.rep.app.core.SupportDiagnostics
import com.madar.rep.app.data.api.ApiLocation
import com.madar.rep.app.data.api.AttendanceActionRequest
import com.madar.rep.app.data.api.MadarApi
import com.madar.rep.app.data.api.MaintenanceLine
import com.madar.rep.app.data.api.VisitPhotoFile
import com.madar.rep.app.data.api.VisitUpload
import com.madar.rep.app.data.db.AttendanceActionEntity
import com.madar.rep.app.data.db.AttendanceActionState
import com.madar.rep.app.data.db.GpsPointState
import com.madar.rep.app.data.db.MachineActionEntity
import com.madar.rep.app.data.db.MachineActionState
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.db.SupportReportState
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import com.madar.rep.app.data.session.Session
import com.madar.rep.app.data.session.SessionGateway
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

data class SyncRunResult(
    val attempted: Int,
    val acknowledged: Int,
    val processing: Int,
    val needsReview: Int,
    val transientFailures: Int,
    val needsLogin: Boolean,
    val remaining: Int,
) {
    val shouldRetry: Boolean get() = transientFailures > 0 || processing > 0 || remaining > 0
}

class SyncEngine(
    private val context: android.content.Context,
    private val database: MadarDatabase,
    private val sessionGateway: SessionGateway,
    private val apiFactory: (String) -> MadarApi = { MadarApi(it) },
    private val onSessionExpired: () -> Unit = {},
) {
    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }

    /**
     * The WorkManager worker and an explicit "sync now" tap can overlap. One
     * mutex keeps a single drain at a time, so the same UUID is never uploaded
     * twice concurrently.
     */
    private val runMutex = Mutex()

    suspend fun run(): SyncRunResult = runMutex.withLock {
        withContext(Dispatchers.IO) { runOnce() }
    }

    private suspend fun runOnce(): SyncRunResult {
        val session = sessionGateway.current() ?: return SyncRunResult(
            attempted = 0, acknowledged = 0, processing = 0, needsReview = 0,
            transientFailures = 0, needsLogin = true, remaining = 0
        )
        val api = apiFactory(session.serverUrl)
        var attempted = 0
        var acknowledged = 0
        var processing = 0
        var needsReview = 0
        var transient = 0
        var needsLogin = false

        runCatching { syncAttendance(session, api) }
            .onFailure { if (it is MadarError.SessionExpired) needsLogin = true }
        runCatching { syncMachineActions(session, api) }
            .onFailure { if (it is MadarError.SessionExpired) needsLogin = true }
        if (!needsLogin) {
            runCatching { syncGpsPoints(session, api) }
                .onFailure { if (it is MadarError.SessionExpired) needsLogin = true }
        }

        if (!needsLogin) {
            val now = System.currentTimeMillis()
            val pendingReports = database.supportReports().dueForSync(session.ownerScopeId, now)
            pendingReports.forEach { report ->
                database.supportReports().updateState(
                    report.reportUuid, SupportReportState.SYNCING, null, report.attempts,
                    report.nextAttemptAt, now,
                )
            }
            val summary = flushSupportReportOutbox(
                pendingReports.map { SupportReportQueueItem(it.reportUuid, it.payloadJson, it.attachmentPath, it.attempts) },
                send = { item ->
                    val attachment = item.attachmentPath?.let { path ->
                        File(path).takeIf(File::isFile)
                            ?: throw MadarError.Validation("صورة البلاغ المحلية مفقودة؛ احتُفظ بالبلاغ للمراجعة.")
                    }
                    api.submitSupportReport(session.token, item.payloadJson, attachment).reportUuid
                },
                markSent = { item ->
                    val attempts = pendingReports.first { it.reportUuid == item.reportUuid }.attempts + 1
                    database.supportReports().updateState(
                        item.reportUuid, SupportReportState.SENT, null, attempts, 0, System.currentTimeMillis(),
                    )
                    item.attachmentPath?.let { File(it).delete() }
                    SupportDiagnostics.record("support", "sent")
                },
                markRetry = { item, message ->
                    val attempts = pendingReports.first { it.reportUuid == item.reportUuid }.attempts + 1
                    val retryAt = System.currentTimeMillis() + SyncPolicy.retryDelayMillis(attempts)
                    database.supportReports().updateState(
                        item.reportUuid, SupportReportState.RETRY_WAIT, message.take(500), attempts, retryAt, System.currentTimeMillis(),
                    )
                    SupportDiagnostics.record("support", "retry_wait")
                },
                markNeedsReview = { item, message ->
                    val attempts = pendingReports.first { it.reportUuid == item.reportUuid }.attempts + 1
                    database.supportReports().updateState(
                        item.reportUuid, SupportReportState.NEEDS_REVIEW, message.take(500), attempts, 0, System.currentTimeMillis(),
                    )
                    SupportDiagnostics.record("support", "needs_review")
                },
                markNeedsLogin = { item ->
                    val attempts = pendingReports.first { it.reportUuid == item.reportUuid }.attempts + 1
                    database.supportReports().updateState(
                        item.reportUuid, SupportReportState.NEEDS_LOGIN,
                        "انتهت الجلسة؛ سجّل الدخول لاستكمال إرسال البلاغ.", attempts, 0, System.currentTimeMillis(),
                    )
                    onSessionExpired()
                },
            )
            attempted += pendingReports.size
            acknowledged += summary.sent
            transient += summary.retried
            needsReview += summary.needsReview
            if (summary.needsLogin) needsLogin = true
        }

        if (!needsLogin) {
            val visits = database.visits().dueForSync(session.ownerScopeId, System.currentTimeMillis())
            for (visit in visits) {
                attempted += 1
                when (val outcome = syncVisit(session, api, visit)) {
                    SyncSignal.ACK -> acknowledged += 1
                    SyncSignal.PROCESSING -> processing += 1
                    SyncSignal.NEEDS_REVIEW -> needsReview += 1
                    SyncSignal.NEEDS_LOGIN -> {
                        needsLogin = true
                        break
                    }
                    SyncSignal.RETRY -> transient += 1
                }
            }
        }

        val remaining = database.visits().countPending(session.ownerScopeId) +
            database.machineActions().countPending(session.ownerScopeId) +
            database.attendanceActions().dueForSync(session.ownerScopeId, Long.MAX_VALUE).size +
            database.gpsPoints().countPending(session.repId) +
            database.supportReports().countPending(session.ownerScopeId)
        return SyncRunResult(
            attempted = attempted,
            acknowledged = acknowledged,
            processing = processing,
            needsReview = needsReview,
            transientFailures = transient,
            needsLogin = needsLogin,
            remaining = remaining,
        )
    }

    private suspend fun syncVisit(session: Session, api: MadarApi, visit: VisitEntity): SyncSignal {
        val now = System.currentTimeMillis()
        database.visits().updateSyncState(
            visit.visitUuid,
            VisitState.SYNCING,
            null,
            visit.attempts,
            0,
            visit.serverStatus,
            now,
        )
        val photos = database.photos().forVisit(visit.visitUuid)
        val before = photos.filter { it.phase == "before" }.sortedBy { it.position }
        val after = photos.filter { it.phase == "after" }.sortedBy { it.position }
        if (before.isEmpty() || after.isEmpty() || before.size > 20 || after.size > 20) {
            val message = "عدد الصور لا يطابق سياسة الزيارة؛ لم تُحذف البيانات المحلية."
            database.visits().updateSyncState(
                visit.visitUuid, VisitState.NEEDS_REVIEW, message, visit.attempts + 1,
                0, visit.serverStatus, now
            )
            return SyncSignal.NEEDS_REVIEW
        }
        val files = ArrayList<VisitPhotoFile>(photos.size)
        for (photo in before + after) {
            val file = File(photo.processedPath)
            if (!file.isFile || file.length() <= 0L || file.length() != photo.sizeBytes) {
                val message = "صورة محلية مفقودة أو تغيّر حجمها؛ الزيارة محفوظة للمراجعة."
                database.visits().updateSyncState(
                    visit.visitUuid, VisitState.NEEDS_REVIEW, message, visit.attempts + 1,
                    0, visit.serverStatus, now
                )
                return SyncSignal.NEEDS_REVIEW
            }
            files.add(VisitPhotoFile(photo.phase, file))
        }
        val payload = visit.toUpload(before, after)
        val result = try {
            api.syncVisit(session.token, payload, files)
        } catch (error: MadarError.SessionExpired) {
            database.visits().updateSyncState(
                visit.visitUuid, VisitState.NEEDS_LOGIN, "انتهت الجلسة؛ سجّل الدخول لاستكمال المزامنة.",
                visit.attempts + 1, 0, visit.serverStatus, now
            )
            onSessionExpired()
            return SyncSignal.NEEDS_LOGIN
        } catch (error: MadarError.Network) {
            scheduleRetry(visit, error.message ?: "تعذر الاتصال", visit.attempts + 1, now)
            return SyncSignal.RETRY
        } catch (error: MadarError.Server) {
            scheduleRetry(visit, error.message ?: "السيرفر غير متاح", visit.attempts + 1, now)
            return SyncSignal.RETRY
        } catch (error: MadarError) {
            database.visits().updateSyncState(
                visit.visitUuid, VisitState.NEEDS_REVIEW, error.message, visit.attempts + 1,
                0, visit.serverStatus, now
            )
            return SyncSignal.NEEDS_REVIEW
        }
        return when (SyncPolicy.classify(result.httpStatus, result.success, result.status, result.message)) {
            SyncSignal.ACK -> {
                val serverStatus = result.status ?: "pending_review"
                val state = when (serverStatus) {
                    "approved" -> VisitState.APPROVED
                    "reshoot_requested" -> VisitState.RESHOOT
                    else -> VisitState.PENDING_REVIEW
                }
                val reviewMessage = if (state == VisitState.PENDING_REVIEW) {
                    result.reasonCodes.mapNotNull(::reviewReasonLabel).distinct().joinToString(" ")
                        .ifBlank { null }
                } else null
                database.visits().updateSyncState(
                    visit.visitUuid, state, reviewMessage, visit.attempts + 1, 0, serverStatus, now
                )
                database.photos().markUploaded(visit.visitUuid)
                SyncSignal.ACK
            }
            SyncSignal.PROCESSING -> {
                val delay = (result.retryAfterMs ?: 1_500L).coerceIn(1_000L, 60_000L)
                database.visits().updateSyncState(
                    visit.visitUuid, VisitState.PROCESSING,
                    "السيرفر ما زال يعالج الزيارة؛ ستُعاد بنفس المعرّف.",
                    visit.attempts + 1, now + delay, "processing", now
                )
                SyncSignal.PROCESSING
            }
            SyncSignal.NEEDS_LOGIN -> {
                database.visits().updateSyncState(
                    visit.visitUuid, VisitState.NEEDS_LOGIN,
                    result.message ?: "الجلسة غير صالحة؛ سجّل الدخول من جديد.",
                    visit.attempts + 1, 0, result.status, now
                )
                onSessionExpired()
                SyncSignal.NEEDS_LOGIN
            }
            SyncSignal.NEEDS_REVIEW -> {
                database.visits().updateSyncState(
                    visit.visitUuid, VisitState.NEEDS_REVIEW,
                    result.message ?: "الخادم رفض الزيارة؛ بياناتها وصورها محفوظة.",
                    visit.attempts + 1, 0, result.status, now
                )
                SyncSignal.NEEDS_REVIEW
            }
            SyncSignal.RETRY -> {
                scheduleRetry(visit, result.message ?: "لم يؤكد الخادم الزيارة", visit.attempts + 1, now)
                SyncSignal.RETRY
            }
        }
    }

    private suspend fun scheduleRetry(visit: VisitEntity, message: String, attempts: Int, now: Long) {
        database.visits().updateSyncState(
            visit.visitUuid,
            VisitState.RETRY_WAIT,
            message,
            attempts,
            now + SyncPolicy.retryDelayMillis(attempts),
            visit.serverStatus,
            now,
        )
    }

    private suspend fun syncAttendance(session: Session, api: MadarApi) {
        val actions = database.attendanceActions().dueForSync(session.ownerScopeId, System.currentTimeMillis())
        for (action in actions) {
            val now = System.currentTimeMillis()
            database.attendanceActions().updateState(
                action.actionUuid, AttendanceActionState.SYNCING, null, action.attempts, 0, now
            )
            val request = AttendanceActionRequest(
                actionUuid = action.actionUuid,
                action = action.action,
                occurredAt = action.occurredAtIso,
                location = action.locationJson?.let { runCatching { json.decodeFromString(ApiLocation.serializer(), it) }.getOrNull() },
                biometricVerified = action.biometricVerified,
            )
            try {
                val response = api.syncAttendance(session.token, request)
                if (response.success && response.actionUuid.equals(action.actionUuid, ignoreCase = true)) {
                    database.attendanceActions().updateState(
                        action.actionUuid, "synced", null, action.attempts + 1, 0, now
                    )
                } else {
                    database.attendanceActions().updateState(
                        action.actionUuid, AttendanceActionState.RETRY_WAIT,
                        response.message ?: response.error ?: "لم يؤكد الخادم تسجيل الحضور",
                        action.attempts + 1,
                        now + SyncPolicy.retryDelayMillis(action.attempts + 1),
                        now,
                    )
                }
            } catch (error: MadarError.SessionExpired) {
                database.attendanceActions().updateState(
                    action.actionUuid, AttendanceActionState.NEEDS_LOGIN,
                    "انتهت الجلسة؛ سجّل الدخول من جديد", action.attempts + 1, 0, now
                )
                throw error
            } catch (error: MadarError.Network) {
                database.attendanceActions().updateState(
                    action.actionUuid, AttendanceActionState.RETRY_WAIT,
                    error.message, action.attempts + 1,
                    now + SyncPolicy.retryDelayMillis(action.attempts + 1), now
                )
            } catch (error: MadarError) {
                database.attendanceActions().updateState(
                    action.actionUuid, AttendanceActionState.NEEDS_REVIEW,
                    error.message, action.attempts + 1, 0, now
                )
            }
        }
    }

    private suspend fun syncMachineActions(session: Session, api: MadarApi) {
        val actions = database.machineActions().dueForSync(session.ownerScopeId, System.currentTimeMillis())
        for (action in actions) {
            val now = System.currentTimeMillis()
            database.machineActions().updateState(
                action.actionUuid, MachineActionState.SYNCING, null, action.attempts, 0,
                action.correctionId, action.serverStatus, now
            )
            try {
                val response = if (action.type == "confirm_location") {
                    api.confirmMachineLocation(session.token, action.machineId, action.payloadJson)
                } else {
                    val evidence = action.evidencePath?.let { File(it) }?.takeIf { it.isFile }
                    api.submitMachineCorrection(
                        session.token, action.machineId, action.payloadJson,
                        evidence, action.evidenceContentType
                    )
                }
                if (response.success) {
                    val state = when {
                        action.type == "confirm_location" && response.status == "approved" -> MachineActionState.APPROVED
                        action.type == "confirm_location" && response.status == "rejected" -> MachineActionState.REJECTED
                        action.type == "confirm_location" -> MachineActionState.PENDING_APPROVAL
                        else -> "synced"
                    }
                    database.machineActions().updateState(
                        action.actionUuid, state, null, action.attempts + 1, 0,
                        response.correctionId ?: response.id ?: action.correctionId,
                        response.status ?: action.serverStatus, now
                    )
                } else {
                    database.machineActions().updateState(
                        action.actionUuid, MachineActionState.RETRY_WAIT,
                        response.message ?: response.error ?: "لم يؤكد الخادم العملية",
                        action.attempts + 1,
                        now + SyncPolicy.retryDelayMillis(action.attempts + 1),
                        action.correctionId, action.serverStatus, now,
                    )
                }
            } catch (error: MadarError.SessionExpired) {
                database.machineActions().updateState(
                    action.actionUuid, MachineActionState.NEEDS_LOGIN,
                    "انتهت الجلسة؛ سجّل الدخول من جديد", action.attempts + 1, 0,
                    action.correctionId, action.serverStatus, now
                )
                throw error
            } catch (error: MadarError.Network) {
                database.machineActions().updateState(
                    action.actionUuid, MachineActionState.RETRY_WAIT, error.message,
                    action.attempts + 1, now + SyncPolicy.retryDelayMillis(action.attempts + 1),
                    action.correctionId, action.serverStatus, now
                )
            } catch (error: MadarError) {
                database.machineActions().updateState(
                    action.actionUuid, MachineActionState.NEEDS_REVIEW, error.message,
                    action.attempts + 1, 0, action.correctionId, action.serverStatus, now
                )
            }
        }
    }

    private fun reviewReasonLabel(code: String): String? = when (code) {
        "PERMISSION_DISABLED" -> "بانتظار المشرف: الاعتماد الذاتي غير مفعّل لهذا الحساب."
        "STALE_FIX" -> "بانتظار المشرف: إشارة GPS أقدم من خمس دقائق."
        "GPS_INACCURATE" -> "بانتظار المشرف: دقة GPS تتجاوز 100 متر."
        "MOCK_LOCATION" -> "بانتظار المشرف: الجهاز أبلغ عن موقع محاكى."
        "OUTSIDE_GEOFENCE" -> "بانتظار المشرف: الموقع خارج نطاق الماكينة."
        "MACHINE_LOCATION_NOT_CONFIRMED" -> "بانتظار المشرف: موقع الماكينة غير مثبت على الخادم."
        "GPS_UNAVAILABLE" -> "بانتظار المشرف: لا توجد قراءة GPS للزيارة."
        "REQUIRED_PHOTOS_MISSING" -> "بانتظار المشرف: صور الزيارة المطلوبة غير مكتملة."
        else -> null
    }

    private suspend fun syncGpsPoints(session: Session, api: MadarApi) {
        val now = System.currentTimeMillis()
        val points = database.gpsPoints().pending(session.repId, now)
        for (point in points) {
            if (sessionGateway.current()?.repId != session.repId) return
            val capturedAt = MadarTime.parseIso(point.updatedAt)
            if (capturedAt == null || now - capturedAt > GPS_RETENTION_MS) {
                database.gpsPoints().update(point.copy(
                    state = GpsPointState.NEEDS_REVIEW,
                    attempts = point.attempts + 1,
                    lastError = "نقطة الموقع قديمة أو وقتها غير صالح؛ احتُفظ بها للمراجعة.",
                    nextAttemptAt = 0,
                ))
                continue
            }
            val sending = point.copy(
                state = GpsPointState.SYNCING,
                attempts = point.attempts + 1,
                lastError = null,
            )
            database.gpsPoints().update(sending)
            val result = try {
                val ack = api.sendLocationPing(
                    session.token,
                    com.madar.rep.app.data.api.TrackingPoint(
                        clientPointId = point.clientPointId,
                        latitude = point.latitude,
                        longitude = point.longitude,
                        accuracy = point.accuracy,
                        speed = point.speed,
                        updatedAt = point.updatedAt,
                    ),
                )
                val receipt = ack.points.firstOrNull { it.clientPointId == point.clientPointId }
                when (receipt?.status) {
                    "accepted", "duplicate" -> GpsPointState.ACKNOWLEDGED to null
                    "rejected" -> GpsPointState.NEEDS_REVIEW to (receipt.reason ?: "رفض الخادم نقطة الموقع.")
                    else -> GpsPointState.NEEDS_REVIEW to "لم يصل إقرار مطابق من الخادم؛ احتُفظ بالنقطة للمراجعة."
                }
            } catch (error: MadarError.SessionExpired) {
                database.gpsPoints().update(sending.copy(
                    state = GpsPointState.NEEDS_LOGIN,
                    lastError = "انتهت الجلسة؛ سجّل الدخول لاستكمال مزامنة الموقع.",
                    nextAttemptAt = 0,
                ))
                onSessionExpired()
                throw error
            } catch (error: MadarError) {
                when (error) {
                    is MadarError.Network, is MadarError.Server -> {
                        val attempt = sending.attempts
                        val terminal = attempt >= SyncPolicy.MAX_ATTEMPTS
                        (if (terminal) GpsPointState.NEEDS_REVIEW else GpsPointState.RETRY_WAIT) to
                            (error.message ?: "تعذرت مزامنة نقطة الموقع.")
                    }
                    else -> GpsPointState.NEEDS_REVIEW to (error.message ?: "تعذر قبول نقطة الموقع.")
                }
            }
            val state = result.first
            val attempt = sending.attempts
            database.gpsPoints().update(sending.copy(
                state = state,
                lastError = result.second,
                nextAttemptAt = if (state == GpsPointState.RETRY_WAIT) {
                    System.currentTimeMillis() + SyncPolicy.retryDelayMillis(attempt)
                } else 0,
            ))
        }
    }

    private fun VisitEntity.toUpload(
        before: List<com.madar.rep.app.data.db.PhotoEntity>,
        after: List<com.madar.rep.app.data.db.PhotoEntity>,
    ): VisitUpload {
        val lines = runCatching {
            json.decodeFromString(
                kotlinx.serialization.builtins.ListSerializer(MaintenanceLine.serializer()),
                maintenanceLinesJson
            )
        }.getOrDefault(emptyList())
        return VisitUpload(
            visitUuid = visitUuid,
            cardId = cardId,
            machineCode = machineCode,
            regionName = regionName.ifBlank { areaName.ifBlank { clientName.ifBlank { "غير محددة" } } }.take(160),
            machineCondition = machineCondition,
            reasonIds = reasonIdsCsv.split(',').mapNotNull { it.trim().toLongOrNull() }.distinct(),
            maintenanceLines = lines,
            notes = notes,
            capturedAt = MadarTime.isoUtc(capturedAt),
            beforeCapturedAt = before.map { MadarTime.isoUtc(it.capturedAt) },
            afterCapturedAt = after.map { MadarTime.isoUtc(it.capturedAt) },
            location = locationCapturedAt?.let { captured ->
                ApiLocation(
                    latitude = latitude ?: 0.0,
                    longitude = longitude ?: 0.0,
                    accuracy = locationAccuracy ?: 0f,
                    updatedAt = MadarTime.isoUtc(captured),
                    isMock = (locationProvider == "mock").takeIf { it },
                )
            },
            photoPolicyVersion = photoPolicyVersion,
        )
    }

    companion object {
        private const val GPS_RETENTION_MS = 90L * 24 * 60 * 60 * 1000
    }
}
