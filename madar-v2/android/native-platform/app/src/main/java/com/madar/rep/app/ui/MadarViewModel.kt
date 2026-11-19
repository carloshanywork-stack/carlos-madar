package com.madar.rep.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.madar.rep.app.AppContainer
import com.madar.rep.app.BuildConfig
import com.madar.rep.app.core.SupportDiagnostics
import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.GeoPolicy
import com.madar.rep.app.core.Hashing
import com.madar.rep.app.core.LocationDecision
import com.madar.rep.app.core.MadarError
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.api.ApiLocation
import com.madar.rep.app.data.api.ApkUpdateException
import com.madar.rep.app.data.api.ApkUpdateFailure
import com.madar.rep.app.data.api.ApkUpdateManager
import com.madar.rep.app.data.api.DownloadedApk
import com.madar.rep.app.data.api.FaultReason
import com.madar.rep.app.data.api.LocationChangeRequestView
import com.madar.rep.app.data.api.MadarApi
import com.madar.rep.app.data.api.ServerMapPoint
import com.madar.rep.app.data.api.VersionGate
import com.madar.rep.app.data.api.MaintenanceLine
import com.madar.rep.app.data.api.RouteMachine
import com.madar.rep.app.data.db.AttendanceActionEntity
import com.madar.rep.app.data.db.GpsPointEntity
import com.madar.rep.app.data.db.GpsPointState
import com.madar.rep.app.data.db.MachineActionEntity
import com.madar.rep.app.data.db.MachineActionState
import com.madar.rep.app.data.db.MapPackEntity
import com.madar.rep.app.data.db.NotificationEntity
import com.madar.rep.app.data.db.PhotoEntity
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import com.madar.rep.app.data.db.SupportReportEntity
import com.madar.rep.app.data.db.SupportReportState
import com.madar.rep.app.data.repo.AttendanceView
import com.madar.rep.app.data.repo.RouteView
import com.madar.rep.app.data.repo.VisitForm
import com.madar.rep.app.data.repo.VisitRepository
import com.madar.rep.app.data.session.Session
import com.madar.rep.app.data.sync.SyncRunResult
import com.madar.rep.app.location.LocationResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import java.io.File
import android.net.Uri
import org.json.JSONObject
import android.os.Build

data class LoginUiState(
    val busy: Boolean = false,
    val error: String? = null,
)

data class SyncUiState(
    val running: Boolean = false,
    val last: SyncRunResult? = null,
    val finishedAt: Long? = null,
    val note: String? = null,
)

data class LocationUiState(
    val point: GeoPoint? = null,
    val busy: Boolean = false,
    val message: String? = null,
    val permissionDenied: Boolean = false,
    val providersDisabled: Boolean = false,
)

data class MapDownloadState(
    val activeId: String? = null,
    val downloaded: Int = 0,
    val total: Int = 0,
    val error: String? = null,
    val message: String? = null,
)

data class VisitDetail(
    val visit: VisitEntity,
    val before: List<PhotoEntity>,
    val after: List<PhotoEntity>,
)

data class ApkUpdateUiState(
    val currentVersion: String = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
    val availableVersion: String? = null,
    val updateAvailable: Boolean = false,
    val busy: Boolean = false,
    val message: String? = null,
    val downloadedApk: File? = null,
    val bytesReceived: Long = 0L,
    val totalBytes: Long = 0L,
    val progress: Float? = null,
)

data class LocationChangeUiState(
    val requests: List<LocationChangeRequestView> = emptyList(),
    val busy: Boolean = false,
    val loading: Boolean = false,
    val message: String? = null,
)

private data class PendingLocationChange(
    val machineId: Long,
    val actionUuid: String,
    val payloadJson: String,
    val evidence: File?,
)

@OptIn(ExperimentalCoroutinesApi::class)
class MadarViewModel(private val container: AppContainer) : ViewModel() {
    val session: StateFlow<Session?> = container.sessions.session

    private val _login = MutableStateFlow(LoginUiState())
    val login: StateFlow<LoginUiState> = _login.asStateFlow()

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 16)
    val messages: MutableSharedFlow<String> = _messages

    private val _routeLoading = MutableStateFlow(false)
    val routeLoading: StateFlow<Boolean> = _routeLoading.asStateFlow()

    private val _routeError = MutableStateFlow<String?>(null)
    val routeError: StateFlow<String?> = _routeError.asStateFlow()

    private val _reasons = MutableStateFlow<List<FaultReason>>(emptyList())
    val reasons: StateFlow<List<FaultReason>> = _reasons.asStateFlow()

    private val _location = MutableStateFlow(LocationUiState())
    val location: StateFlow<LocationUiState> = _location.asStateFlow()

    private val _sync = MutableStateFlow(SyncUiState())
    val sync: StateFlow<SyncUiState> = _sync.asStateFlow()

    private val _mapDownload = MutableStateFlow(MapDownloadState())
    val mapDownload: StateFlow<MapDownloadState> = _mapDownload.asStateFlow()

    private val _claimBlockedCardId = MutableStateFlow<Long?>(null)
    val claimBlockedCardId: StateFlow<Long?> = _claimBlockedCardId.asStateFlow()
    private val _claimBlockedMessage = MutableStateFlow<String?>(null)
    val claimBlockedMessage: StateFlow<String?> = _claimBlockedMessage.asStateFlow()

    private val _visitBusy = MutableStateFlow(false)
    val visitBusy: StateFlow<Boolean> = _visitBusy.asStateFlow()

    private val _machineLocationApprovalBusy = MutableStateFlow<Long?>(null)
    val machineLocationApprovalBusy: StateFlow<Long?> = _machineLocationApprovalBusy.asStateFlow()

    private val _supportBusy = MutableStateFlow(false)
    val supportBusy: StateFlow<Boolean> = _supportBusy.asStateFlow()

    private val _supportMessage = MutableStateFlow<String?>(null)
    val supportMessage: StateFlow<String?> = _supportMessage.asStateFlow()

    private val _apkUpdate = MutableStateFlow(ApkUpdateUiState())
    val apkUpdate: StateFlow<ApkUpdateUiState> = _apkUpdate.asStateFlow()
    private val apkUpdateManager = ApkUpdateManager(container.appContext)

    private val _locationChange = MutableStateFlow(LocationChangeUiState())
    val locationChange: StateFlow<LocationChangeUiState> = _locationChange.asStateFlow()
    private var pendingLocationChange: PendingLocationChange? = null

    val supportReports: StateFlow<List<SupportReportEntity>> = session.flatMapLatest { current ->
        if (current == null) flowOf(emptyList()) else container.database.supportReports().observeForOwner(current.ownerScopeId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val eventConnected: StateFlow<Boolean> = container.eventStream.connected

    val route: StateFlow<RouteView?> = session.flatMapLatest { current ->
        if (current == null) flowOf(null) else container.routeRepository.observe(current.ownerScopeId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val openVisits: StateFlow<List<VisitEntity>> = session.flatMapLatest { current ->
        if (current == null) flowOf(emptyList()) else container.visitRepository.observeOpen(current.ownerScopeId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val notifications: StateFlow<List<NotificationEntity>> = session.flatMapLatest { current ->
        if (current == null) flowOf(emptyList()) else container.notificationRepository.observe(current.ownerScopeId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val unreadNotifications: StateFlow<Int> = session.flatMapLatest { current ->
        if (current == null) flowOf(0) else container.notificationRepository.observeUnread(current.ownerScopeId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    val attendance: StateFlow<AttendanceView?> = session.flatMapLatest { current ->
        if (current == null) flowOf(null) else container.attendanceRepository.observe(current.ownerScopeId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val attendanceActions: StateFlow<List<AttendanceActionEntity>> = session.flatMapLatest { current ->
        if (current == null) flowOf(emptyList()) else container.attendanceRepository.observeActions(current.ownerScopeId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val machineActions: StateFlow<List<MachineActionEntity>> = session.flatMapLatest { current ->
        if (current == null) flowOf(emptyList()) else container.database.machineActions().observeForOwner(current.ownerScopeId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val gpsPoints = session.flatMapLatest { current ->
        if (current == null) flowOf(emptyList()) else container.database.gpsPoints().observeForOwner(current.repId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val mapPacks: StateFlow<List<MapPackEntity>> = container.mapRepository.observePacks()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _mapPoints = MutableStateFlow<List<ServerMapPoint>>(emptyList())
    val mapPoints: StateFlow<List<ServerMapPoint>> = _mapPoints.asStateFlow()
    val mandatoryUpdate = VersionGate.required

    val migration = container.migrationManager.state

    fun refreshMigrationMarkers() {
        viewModelScope.launch { container.migrationManager.refreshMarkers() }
    }

    init {
        viewModelScope.launch {
            session.collect { current ->
                if (current == null) {
                    _reasons.value = emptyList()
                    _routeError.value = null
                    _claimBlockedCardId.value = null
                    _claimBlockedMessage.value = null
                    com.madar.rep.app.location.GpsBreadcrumbService.stop(container.appContext)
                } else {
                    refreshAll(current)
                    if (container.locationProvider.hasPermission()) {
                        com.madar.rep.app.location.GpsBreadcrumbService.start(container.appContext, current.repId)
                    }
                    pingLocationOnForeground()
                }
            }
        }
        viewModelScope.launch {
            attendance.collect { record ->
                val current = session.value ?: return@collect
                if (record?.envelope?.attendance?.hasOpenAttendance == true) {
                    com.madar.rep.app.location.GpsBreadcrumbService.start(container.appContext, current.repId)
                }
            }
        }
        viewModelScope.launch {
            machineActions.collect { actions ->
                val current = session.value ?: return@collect
                var routeNeedsRefresh = false
                for (action in actions) {
                    if (action.ownerRepId != current.ownerScopeId || action.type != "confirm_location" ||
                        action.state != MachineActionState.APPROVED
                    ) continue
                    val point = runCatching {
                        JSONObject(action.payloadJson).getJSONObject("location")
                    }.getOrNull() ?: continue
                    val draft = container.database.visits().findDraft(action.ownerRepId, action.cardId) ?: continue
                    if (draft.locationLocked) continue
                    container.visitRepository.confirmDraftMachineLocation(
                        draft.visitUuid,
                        point.getDouble("latitude"),
                        point.getDouble("longitude"),
                    )
                    routeNeedsRefresh = true
                }
                if (routeNeedsRefresh) refreshRoute(current)
            }
        }
    }

    fun login(serverUrl: String, username: String, password: String) {
        if (_login.value.busy) return
        _login.value = LoginUiState(busy = true)
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    container.sessions.login(serverUrl, username, password)
                }
                _login.value = LoginUiState()
            } catch (error: Exception) {
                _login.value = LoginUiState(error = human(error))
            }
        }
    }

    fun clearLoginError() {
        if (_login.value.error != null) _login.value = _login.value.copy(error = null)
    }

    fun showMessage(text: String) {
        _messages.tryEmit(text)
    }

    fun checkForApkUpdate() {
        val current = session.value ?: return
        if (_apkUpdate.value.busy) return
        _apkUpdate.value = _apkUpdate.value.copy(busy = true, message = null, downloadedApk = null)
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val status = container.apiFactory(current.serverUrl).getApkStatus(current.token)
                val metadata = status.releaseMetadata
                if (!status.available || status.artifactType != "release" || metadata == null || metadata.buildType != "release") {
                    _apkUpdate.value = _apkUpdate.value.copy(busy = false, availableVersion = null, updateAvailable = false, message = ApkUpdateFailure.NOT_CONFIGURED.userMessage)
                } else {
                    val newer = metadata.versionCode > BuildConfig.VERSION_CODE
                    _apkUpdate.value = _apkUpdate.value.copy(
                        busy = false,
                        availableVersion = "${metadata.versionName} (${metadata.versionCode})",
                        updateAvailable = newer,
                        message = if (newer) "يتوفر تحديث جديد." else ApkUpdateFailure.NOT_NEWER.userMessage,
                    )
                }
            } catch (error: Exception) {
                _apkUpdate.value = _apkUpdate.value.copy(busy = false, message = human(error))
            }
        }
    }

    fun checkMandatoryUpdate() {
        val serverUrl = session.value?.serverUrl ?: container.defaultServerUrl()
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { container.apiFactory(serverUrl).getAppVersion() }
                .onSuccess { version ->
                    val required = version.minSupportedVersionCode > 0 && BuildConfig.VERSION_CODE < version.minSupportedVersionCode
                    VersionGate.setRequired(required)
                    if (required && version.versionName != null) {
                        _apkUpdate.value = _apkUpdate.value.copy(
                            availableVersion = "${version.versionName} (${version.latestVersionCode})",
                            updateAvailable = true
                        )
                    }
                }
        }
    }

    fun refreshMapPoints() {
        val current = session.value ?: return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { container.apiFactory(current.serverUrl).getMapPoints(current.token) }
                .onSuccess { _mapPoints.value = it }
        }
    }

    fun downloadApkUpdate() {
        val serverUrl = session.value?.serverUrl ?: container.defaultServerUrl()
        val token = session.value?.token
        if (_apkUpdate.value.busy) return
        _apkUpdate.value = _apkUpdate.value.copy(
            busy = true,
            message = "جارٍ تنزيل APK والتحقق منه…",
            downloadedApk = null,
            bytesReceived = 0L,
            totalBytes = 0L,
            progress = null
        )
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val downloaded = apkUpdateManager.download(
                    api = container.apiFactory(serverUrl),
                    token = token,
                    onProgress = { bytesRead, total ->
                        val prog = if (total > 0) bytesRead.toFloat() / total.toFloat() else null
                        _apkUpdate.value = _apkUpdate.value.copy(
                            bytesReceived = bytesRead,
                            totalBytes = total,
                            progress = prog,
                            message = if (total > 0) {
                                val mbRead = "%.1f".format(bytesRead / 1_048_576.0)
                                val mbTotal = "%.1f".format(total / 1_048_576.0)
                                "جارٍ التنزيل: $mbRead / $mbTotal ميجابايت…"
                            } else {
                                "جارٍ التنزيل…"
                            }
                        )
                    }
                )
                _apkUpdate.value = _apkUpdate.value.copy(
                    busy = false,
                    availableVersion = "${downloaded.metadata.versionName} (${downloaded.metadata.versionCode})",
                    updateAvailable = true,
                    message = "اكتمل التنزيل والتحقق بنجاح. اضغط تثبيت التحديث للمتابعة.",
                    downloadedApk = downloaded.file,
                    progress = 1.0f
                )
            } catch (error: ApkUpdateException) {
                _apkUpdate.value = _apkUpdate.value.copy(busy = false, message = error.failure.userMessage, downloadedApk = null)
            } catch (error: Exception) {
                _apkUpdate.value = _apkUpdate.value.copy(busy = false, message = human(error), downloadedApk = null)
            }
        }
    }

    fun clearDownloadedApk() { _apkUpdate.value = _apkUpdate.value.copy(downloadedApk = null) }

    fun refreshLocationChangeRequests() {
        val current = session.value ?: return
        if (_locationChange.value.loading) return
        _locationChange.value = _locationChange.value.copy(loading = true, message = null)
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val requests = container.apiFactory(current.serverUrl).getLocationChangeRequests(current.token)
                _locationChange.value = _locationChange.value.copy(requests = requests, loading = false)
            } catch (error: Exception) {
                _locationChange.value = _locationChange.value.copy(loading = false, message = human(error))
            }
        }
    }

    fun submitLocationChangeRequest(cardId: Long, note: String, evidenceUri: Uri?) {
        val current = session.value ?: return
        if (_locationChange.value.busy) return
        _locationChange.value = _locationChange.value.copy(busy = true, message = null)
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val machine = route.value?.route?.regions?.asSequence()?.flatMap { it.machines.asSequence() }
                    ?.firstOrNull { it.cardId == cardId }
                    ?: throw MadarError.Validation("تعذر تحديد الماكينة من المسار؛ حدّث المسار وحاول مجددًا.")
                if (!machine.isLocationLocked || machine.latitude == null || machine.longitude == null) {
                    throw MadarError.Conflict("لا يمكن طلب تغيير الموقع قبل تثبيت موقع الماكينة من الإدارة.")
                }
                var pending = pendingLocationChange?.takeIf { it.machineId == machine.machineId }
                if (pending == null) {
                    val result = container.locationProvider.currentFix(10_000)
                    val point = (result as? LocationResult.Success)?.point
                        ?: throw MadarError.Validation("تعذر الحصول على موقع GPS حديث؛ شغّل الموقع وحاول مجددًا.")
                    val age = System.currentTimeMillis() - point.capturedAtMillis
                    if (point.isMock || point.accuracyMeters !in 0f..100f || age !in 0..300_000L) {
                        throw MadarError.Validation("يلزم موقع GPS غير محاكى بدقة 100 متر أو أفضل وحديث خلال خمس دقائق.")
                    }
                    val uuid = UUID.randomUUID().toString()
                    val evidence = evidenceUri?.let { copySupportAttachment(it, "location-$uuid") }
                    val payload = JSONObject()
                        .put("actionUuid", uuid)
                        .put("cardId", cardId)
                        .put("location", JSONObject()
                            .put("latitude", point.latitude)
                            .put("longitude", point.longitude)
                            .put("accuracy", point.accuracyMeters)
                            .put("updatedAt", MadarTime.isoUtc(point.capturedAtMillis))
                            .put("isMock", false))
                        .put("note", note.trim().take(2000))
                        .toString()
                    pending = PendingLocationChange(machine.machineId, uuid, payload, evidence)
                    pendingLocationChange = pending
                }
                val submission = pending
                    ?: throw MadarError.Protocol("تعذر تجهيز طلب تغيير الموقع.")
                val result = container.apiFactory(current.serverUrl).submitLocationChangeRequest(
                    current.token, submission.machineId, submission.payloadJson, submission.evidence,
                )
                pendingLocationChange?.evidence?.delete()
                pendingLocationChange = null
                _locationChange.value = _locationChange.value.copy(
                    busy = false,
                    message = if (result.idempotent) "طلب تغيير الموقع محفوظ مسبقًا: ${result.status}." else "تم إرسال طلب تغيير الموقع: ${result.status}.",
                )
                refreshLocationChangeRequests()
            } catch (error: Exception) {
                val keepIdempotentRetry = error is MadarError.Network || error is MadarError.Server
                if (!keepIdempotentRetry) {
                    pendingLocationChange?.evidence?.delete()
                    pendingLocationChange = null
                }
                _locationChange.value = _locationChange.value.copy(busy = false, message = human(error))
            }
        }
    }

    fun governorateFor(point: GeoPoint?): String? =
        point?.let { container.governorates.find(it.latitude, it.longitude)?.nameAr }

    fun hasLocationPermission(): Boolean = container.locationProvider.hasPermission()

    fun pingLocationOnForeground() {
        viewModelScope.launch(Dispatchers.IO) {
            val current = session.value ?: return@launch
            if (!container.locationProvider.hasPermission()) return@launch
            val fix = container.locationProvider.lastKnown()
                ?: (container.locationProvider.currentFix(4000L) as? LocationResult.Success)?.point
            if (fix != null && !fix.isMock) {
                val nowMs = System.currentTimeMillis()
                val id = "native-${current.repId}-${UUID.randomUUID()}"
                val updatedAt = MadarTime.isoUtc(fix.capturedAtMillis)
                val payload = JSONObject().put("clientPointId", id)
                    .put("latitude", fix.latitude).put("longitude", fix.longitude)
                    .put("accuracy", fix.accuracyMeters.toDouble())
                    .put("speed", 0.0).put("updatedAt", updatedAt)
                val entity = GpsPointEntity(
                    clientPointId = id,
                    repId = current.repId,
                    latitude = fix.latitude,
                    longitude = fix.longitude,
                    accuracy = fix.accuracyMeters.toDouble(),
                    speed = 0.0,
                    updatedAt = updatedAt,
                    state = GpsPointState.QUEUED,
                    contentHash = Hashing.sha256Hex(payload.toString().toByteArray()),
                    createdAt = nowMs,
                )
                runCatching { container.database.gpsPoints().insert(entity) }
                container.scheduler.enqueueNow()
            }
        }
    }

    fun confirmArrival(visit: VisitEntity, point: GeoPoint) {
        val current = session.value ?: return
        if (visit.state != VisitState.DRAFT) return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                if (point.isMock) {
                    _messages.tryEmit("تم رفض تسجيل الوصول: تم اكتشاف أداة تزييف موقع (Mock GPS).")
                    return@launch
                }
                container.visitRepository.saveForm(
                    visit.visitUuid,
                    VisitForm(
                        condition = visit.machineCondition,
                        reasons = decodeReasonIds(visit),
                        lines = decodeLines(visit),
                        notes = visit.notes,
                    ),
                    point
                )
                pingLocationOnForeground()
                _messages.tryEmit("📍 تم تأكيد الوصول والتواجد عند الماكينة بنجاح.")
            } catch (error: Exception) {
                _messages.tryEmit(human(error))
            }
        }
    }

    fun reportUnableToService(
        visit: VisitEntity,
        reasonCode: String,
        reasonLabel: String,
        notes: String,
        onComplete: (Boolean) -> Unit = {},
    ) {
        val current = session.value ?: return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val now = System.currentTimeMillis()
                val actionUuid = UUID.randomUUID().toString()
                val fix = container.locationProvider.lastKnown()
                val payload = JSONObject()
                    .put("actionUuid", actionUuid)
                    .put("cardId", visit.cardId)
                    .put("machineCode", visit.machineCode)
                    .put("reasonCode", reasonCode)
                    .put("reasonLabel", reasonLabel)
                    .put("notes", notes)
                    .put("reportedAt", MadarTime.isoUtc(now))
                if (fix != null) {
                    payload.put("location", JSONObject()
                        .put("latitude", fix.latitude)
                        .put("longitude", fix.longitude)
                        .put("accuracy", fix.accuracyMeters.toDouble())
                        .put("updatedAt", MadarTime.isoUtc(fix.capturedAtMillis)))
                }
                val entity = MachineActionEntity(
                    actionUuid = actionUuid,
                    ownerRepId = current.ownerScopeId,
                    type = "unable_to_service",
                    machineId = visit.machineLatitude?.toLong() ?: visit.cardId,
                    cardId = visit.cardId,
                    payloadJson = payload.toString(),
                    createdAt = now,
                    updatedAt = now,
                )
                container.database.machineActions().upsert(entity)
                container.scheduler.enqueueNow()
                _messages.tryEmit("تم تسجيل تقرير تعذر الزيارة ($reasonLabel) وحفظه بنجاح للمشرف.")
                withContext(Dispatchers.Main) { onComplete(true) }
            } catch (error: Exception) {
                _messages.tryEmit(human(error))
                withContext(Dispatchers.Main) { onComplete(false) }
            }
        }
    }

    fun approveFirstMachineLocation(visit: VisitEntity) {
        val current = session.value ?: return
        if (visit.state != VisitState.DRAFT || visit.locationLocked || _machineLocationApprovalBusy.value != null) return
        _machineLocationApprovalBusy.value = visit.cardId
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val machine = route.value?.route?.regions?.asSequence()?.flatMap { it.machines.asSequence() }
                    ?.firstOrNull { it.cardId == visit.cardId }
                    ?: throw MadarError.Validation("تعذر تحديد الماكينة من المسار الحالي؛ حدّث المسار وحاول مجددًا.")
                if (machine.isLocationLocked) {
                    container.routeRepository.refresh(current, container.apiFactory(current.serverUrl))
                    throw MadarError.Conflict("موقع الماكينة تم اعتماده بالفعل. حدّث المسار للمتابعة.")
                }

                val activeAction = container.database.machineActions().listForOwner(current.ownerScopeId)
                    .firstOrNull {
                        it.machineId == machine.machineId && it.type == "confirm_location" &&
                            it.state in setOf("queued", "syncing", "retry_wait", "needs_login")
                    }
                val action = if (activeAction != null) activeAction else {
                    val result = container.locationProvider.currentFix(7_000)
                    val point = (result as? LocationResult.Success)?.point ?: container.locationProvider.lastKnown()
                        ?: throw MadarError.Validation("لم يصل الموقع بعد. تأكد من تشغيل GPS وحاول اعتماد الماكينة مرة أخرى.")
                    val now = System.currentTimeMillis()
                    val age = now - point.capturedAtMillis
                    if (point.isMock || age !in 0..300_000L || point.accuracyMeters > 100f) {
                        throw MadarError.Validation("يلزم موقع GPS حديث ودقيق (حتى 100 متر) لاعتماد الماكينة.")
                    }
                    val actionUuid = UUID.randomUUID().toString()
                    val payload = JSONObject()
                        .put("actionUuid", actionUuid)
                        .put("cardId", machine.cardId)
                        .put("location", JSONObject()
                            .put("latitude", point.latitude)
                            .put("longitude", point.longitude)
                            .put("accuracy", point.accuracyMeters)
                            .put("updatedAt", MadarTime.isoUtc(point.capturedAtMillis)))
                        .toString()
                    MachineActionEntity(
                        actionUuid = actionUuid,
                        ownerRepId = current.ownerScopeId,
                        type = "confirm_location",
                        machineId = machine.machineId,
                        cardId = machine.cardId,
                        payloadJson = payload,
                        createdAt = now,
                        updatedAt = now,
                    ).also { container.database.machineActions().upsert(it) }
                }

                container.syncEngine.run()
                val saved = container.database.machineActions().find(action.actionUuid)
                when (saved?.state) {
                    MachineActionState.APPROVED -> {
                        val location = JSONObject(action.payloadJson).getJSONObject("location")
                        val latitude = location.getDouble("latitude")
                        val longitude = location.getDouble("longitude")
                        container.visitRepository.confirmDraftMachineLocation(visit.visitUuid, latitude, longitude)
                        applyLocationPoint(GeoPoint(
                            latitude = latitude,
                            longitude = longitude,
                            accuracyMeters = location.getDouble("accuracy").toFloat(),
                            capturedAtMillis = MadarTime.parseIso(location.getString("updatedAt")) ?: System.currentTimeMillis(),
                            provider = "GPS",
                            isMock = false,
                        ), "تم اعتماد موقع الماكينة. يمكنك الآن استكمال الزيارة.")
                        container.routeRepository.refresh(current, container.apiFactory(current.serverUrl))
                        _messages.tryEmit("تم اعتماد موقع الماكينة بنجاح.")
                    }
                    MachineActionState.QUEUED, MachineActionState.RETRY_WAIT, MachineActionState.SYNCING -> {
                        container.scheduler.enqueueNow()
                        _messages.tryEmit("تم حفظ طلب اعتماد الماكينة على الهاتف؛ سيُرسل تلقائيًا عند توفر الاتصال.")
                    }
                    else -> _messages.tryEmit(saved?.lastError ?: "تعذر اعتماد موقع الماكينة. راجع حالة الإجراء في شاشة المزامنة.")
                }
            } catch (error: Exception) {
                _messages.tryEmit(human(error))
            } finally {
                _machineLocationApprovalBusy.value = null
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            try {
                com.madar.rep.app.location.GpsBreadcrumbService.stop(container.appContext)
                withContext(Dispatchers.IO) {
                    container.sessions.logout()
                    container.database.routes().clear()
                    container.photoStore.clearOrphans()
                    container.photoStore.pruneOldPhotos(7)
                }
                _sync.value = SyncUiState()
                _login.value = LoginUiState()
                _location.value = LocationUiState()
            } catch (error: Exception) { _messages.emit(human(error)) }
        }
    }

    fun dismissMessageHint() {
        // Kept for symmetry with screens that clear a stale inline warning.
        _routeError.value = null
    }

    fun refreshAll(current: Session? = session.value) {
        val active = current ?: return
        viewModelScope.launch { refreshRoute(active) }
        viewModelScope.launch { refreshReasons(active) }
        viewModelScope.launch { refreshNotifications(active) }
        viewModelScope.launch { refreshAttendance(active) }
        viewModelScope.launch { refreshMapCatalogInternal(active) }
        container.scheduler.ensureScheduled()
        container.scheduler.enqueueNow()
        loadCachedPreview(active)
    }

    fun submitSupportReport(
        description: String,
        category: String = "bug",
        severity: String = "normal",
        screenName: String = "profile/support",
        includeDiagnostics: Boolean = false,
        screenshotUri: Uri? = null,
    ) {
        val current = session.value ?: return
        val text = description.trim()
        if (text.length < 5 || text.length > 8000) {
            _supportMessage.value = "اكتب وصفاً من 5 إلى 8000 حرف."
            return
        }
        if (_supportBusy.value) return
        _supportBusy.value = true
        _supportMessage.value = null
        viewModelScope.launch(Dispatchers.IO) {
            var attachment: File? = null
            var persisted = false
            try {
                val uuid = UUID.randomUUID().toString()
                if (screenshotUri != null) attachment = copySupportAttachment(screenshotUri, uuid)
                val report = JSONObject()
                    .put("reportUuid", uuid)
                    .put("category", category)
                    .put("severity", severity)
                    .put("description", text)
                    .put("screenName", screenName.take(120))
                    .put("appVersion", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                    .put("deviceModel", Build.MANUFACTURER + " " + Build.MODEL)
                    .put("androidVersion", Build.VERSION.RELEASE ?: "unknown")
                    .put("logs", if (includeDiagnostics) SupportDiagnostics.recentLines() else "")
                container.database.supportReports().insert(SupportReportEntity(
                    reportUuid = uuid,
                    ownerRepId = current.ownerScopeId,
                    payloadJson = report.toString(),
                    attachmentPath = attachment?.absolutePath,
                    state = SupportReportState.QUEUED,
                    createdAt = System.currentTimeMillis(),
                    updatedAt = System.currentTimeMillis(),
                ))
                persisted = true
                SupportDiagnostics.record("support", "queued")
                _supportMessage.value = "تم حفظ البلاغ محليًا في قائمة المزامنة؛ سيُرسل عند توفر الاتصال."
                container.scheduler.enqueueNow()
            } catch (error: Throwable) {
                if (error is CancellationException) throw error
                if (!persisted) attachment?.delete()
                _supportMessage.value = human(error)
            } finally { _supportBusy.value = false }
        }
    }

    private fun copySupportAttachment(uri: Uri, uuid: String): File {
        val resolver = container.appContext.contentResolver
        if (resolver.getType(uri)?.startsWith("image/") != true) throw MadarError.Validation("اختر صورة صالحة للبلاغ.")
        val directory = File(container.appContext.filesDir, "support-outbox").apply {
            if (!exists() && !mkdirs()) throw MadarError.Validation("تعذر حفظ صورة البلاغ محليًا.")
        }
        val temporary = File(directory, "$uuid.jpg.part")
        val destination = File(directory, "$uuid.jpg")
        val input = resolver.openInputStream(uri) ?: throw MadarError.Validation("تعذر قراءة الصورة المختارة.")
        input.use { source -> temporary.outputStream().use { output ->
            val buffer = ByteArray(16 * 1024)
            var total = 0L
            while (true) {
                val count = source.read(buffer)
                if (count < 0) break
                total += count
                if (total > 4L * 1024 * 1024) throw MadarError.Validation("يجب ألا يتجاوز مرفق البلاغ 4 ميجابايت.")
                output.write(buffer, 0, count)
            }
        } }
        if (temporary.length() <= 0L || !temporary.renameTo(destination)) {
            temporary.delete()
            throw MadarError.Validation("تعذر تجهيز مرفق البلاغ.")
        }
        return destination
    }

    fun clearSupportMessage() { _supportMessage.value = null }

    private fun loadCachedPreview(current: Session) {
        viewModelScope.launch {
            if (_reasons.value.isEmpty()) {
                _reasons.value = container.routeRepository.cachedFaultReasons(current.ownerScopeId)
            }
        }
    }

    fun refreshRoute(current: Session? = session.value) {
        val active = current ?: return
        viewModelScope.launch { refreshRouteInternal(active) }
    }

    private suspend fun refreshRouteInternal(current: Session) {
        _routeLoading.value = true
        try {
            withContext(Dispatchers.IO) {
                container.routeRepository.refresh(current, container.apiFactory(current.serverUrl))
            }
            _routeError.value = null
        } catch (error: Exception) {
            if (error is MadarError.SessionExpired || error is MadarError.AccountDisabled) {
                _login.value = LoginUiState(error = human(error))
                container.sessions.expire()
            }
            _routeError.value = human(error)
        } finally {
            _routeLoading.value = false
        }
    }

    fun refreshReasons(current: Session? = session.value) {
        val active = current ?: return
        viewModelScope.launch { refreshReasonsInternal(active) }
    }

    private suspend fun refreshReasonsInternal(current: Session) {
        try {
            val reasons = withContext(Dispatchers.IO) {
                container.routeRepository.refreshFaultReasons(current, container.apiFactory(current.serverUrl))
            }
            _reasons.value = reasons
        } catch (error: Exception) {
            if (_reasons.value.isEmpty()) {
                _reasons.value = container.routeRepository.cachedFaultReasons(current.ownerScopeId)
            }
            if (error is MadarError.SessionExpired) container.sessions.expire()
        }
    }

    fun refreshNotifications(current: Session? = session.value) {
        val active = current ?: return
        viewModelScope.launch { refreshNotificationsInternal(active) }
    }

    private suspend fun refreshNotificationsInternal(current: Session) {
        runCatching {
            withContext(Dispatchers.IO) {
                container.notificationRepository.refresh(current, container.apiFactory(current.serverUrl))
            }
        }.onFailure { if (it is MadarError.SessionExpired) container.sessions.expire() }
    }

    fun markNotificationRead(id: Long) {
        val current = session.value ?: return
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    container.notificationRepository.markRead(
                        current,
                        container.apiFactory(current.serverUrl),
                        id,
                    )
                }
            } catch (error: Exception) {
                _messages.tryEmit(human(error))
            }
        }
    }

    fun markAllNotificationsRead() {
        val current = session.value ?: return
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    container.notificationRepository.markAllRead(
                        current,
                        container.apiFactory(current.serverUrl),
                    )
                }
            } catch (error: Exception) {
                _messages.tryEmit(human(error))
            }
        }
    }

    fun dismissNotification(id: Long) {
        val current = session.value ?: return
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    container.notificationRepository.dismiss(
                        current,
                        container.apiFactory(current.serverUrl),
                        id,
                    )
                }
            } catch (error: Exception) {
                _messages.tryEmit(human(error))
            }
        }
    }

    fun refreshAttendance(current: Session? = session.value) {
        val active = current ?: return
        viewModelScope.launch { refreshAttendanceInternal(active) }
    }

    private suspend fun refreshAttendanceInternal(current: Session) {
        runCatching {
            withContext(Dispatchers.IO) {
                container.attendanceRepository.refresh(current, container.apiFactory(current.serverUrl))
            }
        }.onFailure { if (it is MadarError.SessionExpired) container.sessions.expire() }
    }

    fun refreshMapCatalog(current: Session? = session.value) {
        val active = current ?: return
        viewModelScope.launch { refreshMapCatalogInternal(active) }
    }

    private suspend fun refreshMapCatalogInternal(current: Session) {
        runCatching {
            withContext(Dispatchers.IO) {
                container.mapRepository.refreshCatalog(current, container.apiFactory(current.serverUrl))
            }
        }.onFailure { if (it is MadarError.SessionExpired) container.sessions.expire() }
    }

    fun downloadMapPack(packId: String) {
        val current = session.value ?: return
        if (_mapDownload.value.activeId != null) return
        _mapDownload.value = MapDownloadState(activeId = packId, message = "جارٍ تجهيز التنزيل…")
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val entity = container.mapRepository.download(
                    current,
                    container.apiFactory(current.serverUrl),
                    packId,
                ) { downloaded, total ->
                    _mapDownload.value = MapDownloadState(
                        activeId = packId,
                        downloaded = downloaded,
                        total = total,
                        message = "تنزيل البلاطات $downloaded / $total",
                    )
                }
                _mapDownload.value = MapDownloadState(
                    activeId = null,
                    downloaded = entity.downloadedTiles,
                    total = entity.tileCount,
                    message = "تم التحقق من الحزمة وتفعيلها (${entity.tileCount} بلاطة).",
                )
            } catch (error: Exception) {
                _mapDownload.value = MapDownloadState(activeId = null, error = human(error))
            }
        }
    }

    fun deleteMapPack(packId: String) {
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { container.mapRepository.delete(packId) }
                .onFailure { _messages.tryEmit(human(it)) }
        }
    }

    fun openMachine(machine: RouteMachine, onReady: (VisitEntity) -> Unit) {
        val current = session.value ?: return
        viewModelScope.launch {
            try {
                val name = machine.arabicName?.takeIf { it.isNotBlank() } ?: machine.machineCode
                val visit = withContext(Dispatchers.IO) {
                    container.visitRepository.draftFor(current.ownerScopeId, machine, name)
                }
                _claimBlockedCardId.value = null
                onReady(visit)
            } catch (error: Exception) {
                _messages.tryEmit(human(error))
            }
        }
    }

    fun visitDetail(uuid: String): Flow<VisitDetail?> = combine(
        container.visitRepository.observeVisit(uuid),
        container.visitRepository.observePhotos(uuid, "before"),
        container.visitRepository.observePhotos(uuid, "after"),
    ) { visit, before, after ->
        visit?.let { VisitDetail(it, before, after) }
    }

    fun saveDraft(visitUuid: String, form: VisitForm, onSaved: ((Boolean) -> Unit)? = null) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    container.visitRepository.saveForm(visitUuid, form, container.locationProvider.lastKnown())
                }
                withContext(Dispatchers.Main) { onSaved?.invoke(true) }
            } catch (error: Exception) {
                _messages.tryEmit(human(error))
                withContext(Dispatchers.Main) { onSaved?.invoke(false) }
            }
        }
    }

    fun decodeLines(visit: VisitEntity): List<MaintenanceLine> =
        container.visitRepository.decodeLines(visit.maintenanceLinesJson)

    fun decodeReasonIds(visit: VisitEntity): List<Long> =
        container.visitRepository.decodeReasonIds(visit.reasonIdsCsv)

    fun submitVisit(visitUuid: String, form: VisitForm, onComplete: (Boolean) -> Unit) {
        if (_visitBusy.value) return
        _visitBusy.value = true
        viewModelScope.launch {
            try {
                _messages.tryEmit("جارٍ التحقق من موقع GPS…")
                val fix = withContext(Dispatchers.IO) {
                    when (val result = container.locationProvider.currentFix(7_000)) {
                        is LocationResult.Success -> result.point
                        else -> container.locationProvider.lastKnown()
                    }
                }
                if (fix != null) applyLocationPoint(fix, "تم تحديث الموقع قبل الإرسال.")
                val result = withContext(Dispatchers.IO) {
                    container.visitRepository.saveForm(visitUuid, form, fix)
                    container.visitRepository.queue(visitUuid, fix)
                }
                when (result) {
                    is com.madar.rep.app.data.repo.QueueResult.Queued -> {
                        _messages.tryEmit("حُفظت الزيارة في قائمة المزامنة. ستبقى الصور حتى تأكيد الخادم.")
                        container.scheduler.enqueueNow()
                        withContext(Dispatchers.Main) { onComplete(true) }
                    }
                    is com.madar.rep.app.data.repo.QueueResult.Blocked -> {
                        _messages.tryEmit(result.message)
                        withContext(Dispatchers.Main) { onComplete(false) }
                    }
                }
            } catch (error: Exception) {
                _messages.tryEmit(human(error))
                withContext(Dispatchers.Main) { onComplete(false) }
            } finally {
                _visitBusy.value = false
            }
        }
    }

    fun deletePhoto(photoId: String) {
        viewModelScope.launch {
            try {
                val photo = container.visitRepository.photo(photoId) ?: return@launch
                withContext(Dispatchers.IO) {
                    val visit = container.visitRepository.find(photo.visitUuid)
                    if (visit?.state != VisitState.DRAFT) {
                        throw MadarError.Validation("لا يمكن حذف صورة بعد إرسال الزيارة")
                    }
                    container.photoStore.delete(photo)
                    container.visitRepository.removePhoto(photoId)
                }
            } catch (error: Exception) {
                _messages.tryEmit(human(error))
            }
        }
    }

    fun refreshLocation() {
        if (_location.value.busy) return
        _location.value = _location.value.copy(busy = true, message = null, permissionDenied = false, providersDisabled = false)
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { container.locationProvider.currentFix(7_000) }
            when (result) {
                is LocationResult.Success -> applyLocationPoint(result.point)
                LocationResult.PermissionDenied -> {
                    _location.value = _location.value.copy(
                        busy = false,
                        permissionDenied = true,
                        message = "يلزم إذن الموقع لاعتماد الزيارة وتسجيل الحضور.",
                    )
                }
                LocationResult.ProvidersDisabled -> {
                    _location.value = _location.value.copy(
                        busy = false,
                        providersDisabled = true,
                        message = "خدمة الموقع مغلقة. شغّل GPS أو الشبكة ثم أعد المحاولة.",
                    )
                }
                LocationResult.Timeout -> {
                    val fallback = container.locationProvider.lastKnown()
                    if (fallback != null) {
                        applyLocationPoint(fallback, "آخر إشارة متاحة؛ انتظر تحديثًا إن كانت قديمة.")
                    } else {
                        _location.value = _location.value.copy(
                            busy = false,
                            message = "تعذر الحصول على إشارة GPS حديثة. الصور محفوظة والزيارة تبقى مسودة.",
                        )
                    }
                }
                is LocationResult.Failure -> {
                    _location.value = _location.value.copy(busy = false, message = result.message)
                }
            }
        }
    }

    private fun applyLocationPoint(point: GeoPoint, override: String? = null) {
        val now = System.currentTimeMillis()
        val ageSeconds = ((now - point.capturedAtMillis).coerceAtLeast(0)) / 1000
        val message = override ?: when {
            point.isMock -> "الموقع مُبلّغ كمزيف من النظام؛ لا يمكن اعتماده."
            point.accuracyMeters > GeoPolicy.MAX_ACCURACY_METERS ->
                "الموقع تقريبي (±${point.accuracyMeters.toInt()} م) ويُعرض للاسترشاد فقط. يلزم موقع أدق من ${GeoPolicy.MAX_ACCURACY_METERS.toInt()} م."
            !point.isFresh(now) -> "إشارة الموقع قديمة ($ageSeconds ثانية). انتظر تحديثًا."
            else -> "موقع حديث بدقة ±${point.accuracyMeters.toInt()} م."
        }
        _location.value = LocationUiState(point = point, busy = false, message = message)
    }

    fun clearClaimBlock() {
        _claimBlockedCardId.value = null
        _claimBlockedMessage.value = null
    }

    /**
     * Announces the machine claim to other representatives. Failures are split:
     * a real conflict blocks capture, while a network loss simply continues as an
     * offline draft because the server validates the visit again on sync.
     */
    fun claimWork(
        visit: VisitEntity,
        location: GeoPoint? = _location.value.point,
        forceRetry: Boolean = false,
    ) {
        val current = session.value ?: return
        if (visit.state != VisitState.DRAFT || !visit.locationLocked) return
        if (location == null) return
        val now = System.currentTimeMillis()
        val age = now - location.capturedAtMillis
        if (location.isMock || age !in 0..300_000L || location.accuracyMeters > 120f) return
        if (!forceRetry && _claimBlockedCardId.value == visit.cardId) return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                container.apiFactory(current.serverUrl).startWork(
                    current.token,
                    visit.cardId,
                    visit.visitUuid,
                    ApiLocation(
                        latitude = location.latitude,
                        longitude = location.longitude,
                        accuracy = location.accuracyMeters,
                        updatedAt = MadarTime.isoUtc(location.capturedAtMillis),
                        isMock = location.isMock,
                    ),
                )
                _claimBlockedCardId.value = null
                _claimBlockedMessage.value = null
            } catch (error: MadarError.Conflict) {
                _claimBlockedCardId.value = visit.cardId
                _claimBlockedMessage.value = error.message ?: "يوجد تعارض يمنع حجز هذه الماكينة."
                _messages.tryEmit(_claimBlockedMessage.value!!)
            } catch (_: MadarError.Network) {
                // Offline is allowed: the visit is still a local draft.
            } catch (error: MadarError.SessionExpired) {
                container.sessions.expire()
            } catch (error: MadarError) {
                _messages.tryEmit(error.message ?: "لم يُسجّل بدء العمل على الخادم.")
            }
        }
    }

    fun retryMachineClaim(visit: VisitEntity) {
        val current = session.value ?: return
        if (visit.state != VisitState.DRAFT || !visit.locationLocked) return
        viewModelScope.launch {
            refreshRoute(current)
            val point = withContext(Dispatchers.IO) {
                when (val result = container.locationProvider.currentFix(5_000)) {
                    is LocationResult.Success -> result.point
                    else -> container.locationProvider.lastKnown()
                }
            }
            if (point == null) {
                _messages.tryEmit("تعذر إعادة التحقق: لا يوجد موقع متاح. شغّل GPS وحاول مجددًا.")
                return@launch
            }
            claimWork(visit, point, forceRetry = true)
        }
    }

    fun releaseWork(visit: VisitEntity) {
        val current = session.value ?: return
        if (visit.state != VisitState.DRAFT) return
        viewModelScope.launch(Dispatchers.IO) {
            runCatching {
                container.apiFactory(current.serverUrl).stopWork(current.token, visit.cardId, visit.visitUuid)
            }
        }
    }

    fun enqueueAttendance(action: String, location: GeoPoint?, onDone: (Boolean) -> Unit) {
        val current = session.value ?: return
        viewModelScope.launch {
            try {
                if (action == "in") {
                    val decision = GeoPolicy.evaluate(location, null, null, nowMillis = System.currentTimeMillis())
                    if (decision !is LocationDecision.Valid) {
                        val message = when (decision) {
                            LocationDecision.Missing -> "تسجيل الحضور يحتاج موقع GPS حديثًا."
                            is LocationDecision.Stale -> "إشارة الموقع قديمة؛ انتظر تحديث GPS."
                            is LocationDecision.Inaccurate -> "دقة الموقع غير كافية لتسجيل الحضور."
                            is LocationDecision.Mocked -> "الموقع مزيف؛ لا يمكن تسجيل الحضور."
                            is LocationDecision.Invalid -> decision.reason
                            else -> "تعذر اعتماد الموقع."
                        }
                        _messages.tryEmit(message)
                        withContext(Dispatchers.Main) { onDone(false) }
                        return@launch
                    }
                }
                withContext(Dispatchers.IO) {
                    container.attendanceRepository.enqueue(
                        repId = current.ownerScopeId,
                        action = action,
                        location = location,
                        biometricVerified = true,
                    )
                }
                if (action == "in") com.madar.rep.app.location.GpsBreadcrumbService.start(container.appContext, current.repId)
                else com.madar.rep.app.location.GpsBreadcrumbService.stop(container.appContext)
                _messages.tryEmit(
                    if (action == "in") "سُجّل الحضور محليًا بالوقت الأصلي؛ ستُزامن مع الخادم."
                    else "سُجّل الانصراف محليًا بالوقت الأصلي؛ ستُزامن مع الخادم."
                )
                syncNow(showSummary = false)
                withContext(Dispatchers.Main) { onDone(true) }
            } catch (error: Exception) {
                _messages.tryEmit(human(error))
                withContext(Dispatchers.Main) { onDone(false) }
            }
        }
    }

    fun syncNow(showSummary: Boolean = true) {
        if (_sync.value.running) return
        _sync.value = _sync.value.copy(running = true, note = null)
        viewModelScope.launch {
            try {
                val result = container.syncEngine.run()
                _sync.value = SyncUiState(
                    running = false,
                    last = result,
                    finishedAt = System.currentTimeMillis(),
                    note = when {
                        result.needsLogin -> "انتهت الجلسة؛ سجّل الدخول من جديد."
                        result.remaining > 0 -> "بقي ${result.remaining} عنصرًا في قائمة المزامنة."
                        else -> "لا توجد عناصر معلّقة."
                    },
                )
                if (result.needsLogin) {
                    container.sessions.expire()
                } else if (result.shouldRetry) {
                    container.scheduler.enqueueNow()
                }
                if (showSummary) {
                    _messages.tryEmit(
                        "المزامنة: ${result.acknowledged} مؤكد، ${result.processing} قيد المعالجة، ${result.needsReview} للمراجعة."
                    )
                }
            } catch (error: Exception) {
                _sync.value = _sync.value.copy(running = false, note = human(error))
                _messages.tryEmit(human(error))
            }
        }
    }

    fun retryVisit(visitUuid: String) {
        viewModelScope.launch {
            container.database.visits().retryNow(visitUuid, System.currentTimeMillis())
            syncNow()
        }
    }

    fun retryAttendance(actionUuid: String) {
        viewModelScope.launch {
            container.database.attendanceActions().retryNow(actionUuid, System.currentTimeMillis())
            syncNow()
        }
    }

    fun retryMachineAction(actionUuid: String) {
        viewModelScope.launch {
            container.database.machineActions().retryNow(actionUuid, System.currentTimeMillis())
            syncNow()
        }
    }

    fun retryGpsPoint(clientPointId: String) {
        val owner = session.value?.repId ?: return
        viewModelScope.launch {
            container.database.gpsPoints().retryNow(clientPointId, owner)
            syncNow()
        }
    }

    private fun human(error: Throwable): String = when (error) {
        is MadarError.InvalidCredentials -> "اسم المستخدم أو كلمة المرور غير صحيحة."
        is MadarError.AccountDisabled -> "الحساب معطّل. تواصل مع الإدارة."
        is MadarError.SessionExpired -> "انتهت الجلسة. سجّل الدخول من جديد."
        is MadarError.Network -> "تعذر الاتصال بالخادم. تحقق من الشبكة."
        is MadarError.Server -> "الخادم غير متاح مؤقتًا."
        is MadarError.Protocol -> "رد غير متوقع من الخادم."
        is MadarError.Conflict -> error.message ?: "تعارض في البيانات."
        is MadarError.Validation -> error.message ?: "بيانات غير صالحة."
        is MadarError.Permission -> error.message ?: "صلاحية مطلوبة."
        else -> error.message ?: "حدث خطأ غير متوقع."
    }

    companion object {
        fun factory(container: AppContainer): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = MadarViewModel(container) as T
        }
    }
}
