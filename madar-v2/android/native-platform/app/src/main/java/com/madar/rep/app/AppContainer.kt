package com.madar.rep.app

import android.content.Context
import com.madar.rep.app.core.DeviceDiagnostics
import com.madar.rep.app.core.GovernorateCatalog
import com.madar.rep.app.core.GovernorateIndex
import com.madar.rep.app.core.InstallationManager
import com.madar.rep.app.data.api.MadarApi
import com.madar.rep.app.data.db.MadarDatabase
import com.madar.rep.app.data.map.MapRepository
import com.madar.rep.app.data.migration.MigrationManager
import com.madar.rep.app.data.repo.AttendanceRepository
import com.madar.rep.app.data.repo.NotificationRepository
import com.madar.rep.app.data.repo.RouteRepository
import com.madar.rep.app.data.repo.VisitRepository
import com.madar.rep.app.data.session.SecureSessionStore
import com.madar.rep.app.data.session.SessionController
import com.madar.rep.app.data.session.SessionGateway
import com.madar.rep.app.data.sync.AutomaticCrashHandoff
import com.madar.rep.app.data.sync.AutomaticDiagnostics
import com.madar.rep.app.data.sync.OperationsEventStream
import com.madar.rep.app.data.sync.SyncEngine
import com.madar.rep.app.data.sync.SyncScheduler
import com.madar.rep.app.location.LocationProvider
import com.madar.rep.app.media.PhotoStore
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * One process-wide graph. Every repository, worker, and screen shares the same
 * Room database, session, and sync engine so a login switch or a background
 * retry cannot create a second queue owner.
 */
class AppContainer(context: Context) {
    val appContext: Context = context.applicationContext
    val database: MadarDatabase = MadarDatabase.get(appContext)
    val governorates: GovernorateIndex = GovernorateCatalog.load(appContext)

    val sessionStore = SecureSessionStore(appContext)
    val sessionGateway = SessionGateway(sessionStore)
    val sessions = SessionController(sessionGateway)

    val apiFactory: (String) -> MadarApi = { MadarApi(it) }

    val routeRepository = RouteRepository(database)
    val notificationRepository = NotificationRepository(database)
    val attendanceRepository = AttendanceRepository(database)
    val visitRepository = VisitRepository(database, governorates, routeRepository)
    val visitRepo get() = visitRepository
    val mapRepository = MapRepository(appContext, database)
    val migrationManager = MigrationManager(appContext, database, governorates)
    val photoStore = PhotoStore(appContext, governorates)
    val locationProvider = LocationProvider(appContext)
    val installationManager = InstallationManager(appContext)
    val deviceDiagnostics = DeviceDiagnostics(appContext, locationProvider, installationManager)
    val scheduler = SyncScheduler(appContext)
    val automaticDiagnostics = AutomaticDiagnostics(database, scheduler)

    val syncEngine = SyncEngine(
        context = appContext,
        database = database,
        sessionGateway = sessionGateway,
        apiFactory = apiFactory,
        onSessionExpired = { sessions.expire() },
        photoStore = photoStore,
        diagnostics = automaticDiagnostics,
    )

    val eventStream = OperationsEventStream(
        context = appContext,
        database = database,
        sessionGateway = sessionGateway,
        onSessionExpired = { sessions.expire() },
        routeRepository = routeRepository,
        notificationRepository = notificationRepository,
        attendanceRepository = attendanceRepository,
        scheduler = scheduler,
    )

    /** The migration screen is offered once per process, not on every rotation. */
    val migrationPrompted = AtomicBoolean(false)

    fun defaultServerUrl(): String = BuildConfig.REP_SERVER_URL
}

class MadarApplication : android.app.Application() {
    lateinit var container: AppContainer
        private set

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        val crashHandoff = AutomaticCrashHandoff(noBackupFilesDir)
        crashHandoff.install { container.sessions.session.value?.ownerScopeId }
        appScope.launch {
            container.sessions.session.collect { session ->
                if (session != null) {
                    kotlinx.coroutines.withContext(Dispatchers.IO) {
                        crashHandoff.restore(session.ownerScopeId, container.automaticDiagnostics)
                        container.photoStore.recoverPending().forEach { photo ->
                            runCatching {
                                val visit = container.visitRepository.find(photo.visitUuid)
                                if (visit?.ownerRepId == session.ownerScopeId && visit.state == "draft") {
                                    val saved = container.visitRepository.photo(photo.id)
                                    if (saved == null) {
                                        container.visitRepository.addPhoto(photo.visitUuid, photo, recovered = true)
                                    } else if (saved.sha256.isBlank()) {
                                        container.database.photos().updateProcessed(
                                            photo.id, photo.processedPath, photo.watermarkText, photo.sha256, photo.sizeBytes,
                                        )
                                    }
                                }
                            }
                        }
                    }
                    container.scheduler.ensureScheduled()
                    container.eventStream.start()
                } else {
                    container.eventStream.stop()
                }
            }
        }
    }
}
