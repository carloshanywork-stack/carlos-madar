package com.madar.rep.app.data.sync

import android.content.Context
import com.madar.rep.app.core.MadarError
import com.madar.rep.app.core.SseEvent
import com.madar.rep.app.core.SseParser
import com.madar.rep.app.data.api.MadarApi
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.db.MigrationEntity
import com.madar.rep.app.data.repo.AttendanceRepository
import com.madar.rep.app.data.repo.NotificationRepository
import com.madar.rep.app.data.repo.RouteRepository
import com.madar.rep.app.data.session.Session
import com.madar.rep.app.data.session.SessionGateway
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Interceptor
import com.madar.rep.app.BuildConfig
import com.madar.rep.app.data.api.VersionGate
import okhttp3.Request

/**
 * Keeps the operational caches honest while the app is open. The server's SSE
 * cursor is persisted in Room; a disconnect resumes with `Last-Event-ID`. If the
 * server says the cursor was reset, the stream refetches the route, reasons,
 * notifications, attendance, and syncs any local queue instead of assuming the
 * missed events were harmless.
 */
class OperationsEventStream(
    context: Context,
    private val database: MadarDatabase,
    private val sessionGateway: SessionGateway,
    private val onSessionExpired: () -> Unit,
    private val routeRepository: RouteRepository,
    private val notificationRepository: NotificationRepository,
    private val attendanceRepository: AttendanceRepository,
    private val scheduler: SyncScheduler,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val reconcileSignal = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()
    private var streamJob: Job? = null
    private var reconcileJob: Job? = null
    private val client = OkHttpClient.Builder()
        .addInterceptor(Interceptor { chain ->
            val request = chain.request().newBuilder()
                .header("X-App-Version-Code", BuildConfig.VERSION_CODE.toString())
                .build()
            chain.proceed(request).also { response ->
                if (response.code == 426) VersionGate.requireUpdate()
            }
        })
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(true)
        .build()

    fun start() {
        if (streamJob?.isActive == true) return
        streamJob = scope.launch { loop() }
        if (reconcileJob?.isActive != true) {
            reconcileJob = scope.launch {
                reconcileSignal.debounce(1_500).collect { reconcile() }
            }
        }
    }

    fun stop() {
        streamJob?.cancel()
        reconcileJob?.cancel()
        streamJob = null
        reconcileJob = null
        _connected.value = false
    }

    fun close() {
        stop()
        scope.cancel()
    }

    private suspend fun loop() {
        while (currentCoroutineContext().isActive) {
            val session = sessionGateway.current()
            if (session == null) {
                delay(5_000)
                continue
            }
            try {
                consume(session)
            } catch (error: MadarError.SessionExpired) {
                onSessionExpired()
            } catch (_: Exception) {
                // Network loss and server restarts are expected; cursor makes the retry safe.
            } finally {
                _connected.value = false
            }
            delay(3_000)
        }
    }

    private suspend fun consume(session: Session) {
        val cursor = database.migration().get(CURSOR_KEY)?.value?.toLongOrNull() ?: 0L
        val request = Request.Builder()
            .url("${session.serverUrl}/api/rep/events?lastEventId=$cursor")
            .header("Authorization", "Bearer ${session.token}")
            .header("Accept", "text/event-stream")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            if (response.code == 401) throw MadarError.SessionExpired()
            if (response.code !in 200..299) throw MadarError.Server("Event stream HTTP ${response.code}")
            _connected.value = true
            val body = response.body ?: throw MadarError.Protocol("Empty event stream")
            val parser = SseParser()
            InputStreamReader(body.byteStream(), Charsets.UTF_8).use { reader ->
                val buffer = CharArray(4096)
                while (currentCoroutineContext().isActive) {
                    val read = reader.read(buffer)
                    if (read < 0) break
                    for (event in parser.feed(String(buffer, 0, read))) {
                        handle(event)
                    }
                }
            }
        }
        throw MadarError.Network("Event stream closed")
    }

    private suspend fun handle(event: SseEvent) {
        event.id?.toLongOrNull()?.let { id ->
            database.migration().put(MigrationEntity(CURSOR_KEY, id.toString(), System.currentTimeMillis()))
        }
        if (event.event == "operations" || event.event == null) {
            reconcileSignal.tryEmit(Unit)
        }
    }

    private suspend fun reconcile() {
        val session = sessionGateway.current() ?: return
        val api = MadarApi(session.serverUrl)
        runCatching { routeRepository.refresh(session, api) }
        runCatching { notificationRepository.refresh(session, api) }
        runCatching { attendanceRepository.refresh(session, api) }
        scheduler.enqueueNow()
    }

    companion object {
        const val CURSOR_KEY = "operations.cursor"
    }
}
