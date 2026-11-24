package com.madar.rep.app.ui

import android.app.Activity
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AssignmentTurnedIn
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.Surface
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import com.madar.rep.app.AppContainer
import com.madar.rep.app.data.session.Session
import com.madar.rep.app.data.api.ApkUpdateManager
import com.madar.rep.app.migration.LegacyMigrationActivity
import kotlinx.coroutines.delay

private object Tabs {
    const val ATTENDANCE = "attendance"
    const val ROUTE = "route"
    const val SUPPORT = "support"
    const val SYNC = "sync"
    const val MAP = "map"
}

/**
 * The signed-in shell. It keeps one ViewModel for the whole session, one snackbar
 * host for repository/service messages, and two top-level work areas. Visit,
 * attendance, and notification screens are layered above the tabs so a capture in
 * progress cannot be lost by an accidental tab switch.
 */
@Composable
fun MadarRoot(container: AppContainer) {
    val vm: MadarViewModel = viewModel(factory = MadarViewModel.factory(container))
    FirstLaunchPermissions { vm.updateBreadcrumbStartAllowed(foreground = true) }
    LifecycleResumeEffect(vm) {
        vm.updateBreadcrumbStartAllowed(foreground = true)
        onPauseOrDispose { vm.updateBreadcrumbStartAllowed(foreground = false) }
    }
    val session by vm.session.collectAsStateWithLifecycle()
    val mandatoryUpdate by vm.mandatoryUpdate.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(vm) {
        vm.messages.collect { message -> snackbarHostState.showSnackbar(message) }
    }

    LaunchedEffect(Unit) {
        vm.checkMandatoryUpdate()
    }
    if (mandatoryUpdate) {
        ForcedUpdateScreen(vm)
        return
    }

    val current = session
    if (current == null) {
        val login by vm.login.collectAsStateWithLifecycle()
        LoginScreen(
            state = login,
            onLogin = { username, password ->
                vm.login(container.defaultServerUrl(), username, password)
            },
            onUnlockOffline = vm::unlockOffline,
            onClearError = vm::clearLoginError,
            onRemoveAccount = vm::removeAccount,
        )
        return
    }

    SignedInShell(
        vm = vm,
        container = container,
        session = current,
        mandatoryUpdate = mandatoryUpdate,
        snackbarHostState = snackbarHostState,
    )
}

@Composable
private fun SignedInShell(
    vm: MadarViewModel,
    container: AppContainer,
    session: Session,
    mandatoryUpdate: Boolean,
    snackbarHostState: SnackbarHostState,
) {
    val route by vm.route.collectAsStateWithLifecycle()
    val openVisits by vm.openVisits.collectAsStateWithLifecycle()
    val notifications by vm.notifications.collectAsStateWithLifecycle()
    val unread by vm.unreadNotifications.collectAsStateWithLifecycle()
    val attendanceView by vm.attendance.collectAsStateWithLifecycle()
    val attendanceActions by vm.attendanceActions.collectAsStateWithLifecycle()
    val location by vm.location.collectAsStateWithLifecycle()
    val context = LocalContext.current

    if (mandatoryUpdate) {
        ForcedUpdateScreen(vm)
        return
    }

    var tab by rememberSaveable { mutableStateOf(Tabs.ROUTE) }
    var visitUuid by rememberSaveable { mutableStateOf<String?>(null) }
    var profilePage by rememberSaveable { mutableStateOf<String?>(null) }
    var autoClockInTriggered by rememberSaveable { mutableStateOf(false) }

    val record = attendanceView?.envelope?.let { it.openAttendance ?: it.attendance }
    val hasOpenAttendance = record?.hasOpenAttendance == true
    val hasClockIn = record?.clockInTime != null
    val pendingIn = attendanceActions.any {
        it.action == "in" && it.state != "synced" && it.state != com.madar.rep.app.data.db.AttendanceActionState.FAILED
    }

    val autoBiometricGate = rememberBiometricGate { success, error ->
        if (success) {
            vm.enqueueAttendance("in", location.point) { ok ->
                if (ok) vm.showMessage("تم بدء وردية اليوم بنجاح تلقائياً ✅")
            }
        } else if (error != null) {
            vm.showMessage(error)
        }
    }

    LaunchedEffect(attendanceView, autoClockInTriggered) {
        if (!autoClockInTriggered && attendanceView != null) {
            autoClockInTriggered = true
            if (!hasOpenAttendance && !hasClockIn && !pendingIn) {
                vm.refreshLocation()
                autoBiometricGate(
                    "تسجيل الحضور التلقائي",
                    "أكد هويتك بالبصمة أو رمز الهاتف لبدء وردية اليوم وتفعيل التتبع.",
                )
            }
        }
    }

    visitUuid?.let { uuid ->
        VisitScreen(
            vm = vm,
            visitUuid = uuid,
            onClose = { visitUuid = null },
        )
        return
    }

    if (profilePage != null) {
        if (profilePage != "attendance") {
            BackHandler { profilePage = if (profilePage == "profile") null else "profile" }
        }
        when (profilePage) {
            "profile" -> ProfileScreen(
                vm = vm,
                session = session,
                onAttendance = { profilePage = "attendance" },
                onNotifications = { profilePage = "notifications" },
                onSync = { profilePage = "sync" },
                onSupport = { profilePage = "support" },
                onDiagnostics = { profilePage = "diagnostics" },
                onMigration = { context.startActivity(Intent(context, LegacyMigrationActivity::class.java)) },
                onLogout = { vm.lock(); profilePage = null },
            )
            "attendance" -> AttendanceHost(vm = vm, onClose = { profilePage = "profile" })
            "notifications" -> {
                LaunchedEffect(Unit) { vm.refreshNotifications() }
                NotificationsScreen(
                    notifications = notifications,
                    unreadCount = unread,
                    loading = false,
                    onBack = { profilePage = "profile" },
                    onRefresh = { vm.refreshNotifications() },
                    onMarkRead = vm::markNotificationRead,
                    onMarkAllRead = vm::markAllNotificationsRead,
                    onDismiss = vm::dismissNotification,
                )
            }
            "sync" -> Scaffold(topBar = {
                MadarTopBar(title = "المزامنة", subtitle = "قائمة الرفع وحالة الاتصال", onBack = { profilePage = "profile" }, actions = {
                    IconButton(onClick = { vm.syncNow() }) { Icon(Icons.Default.Sync, contentDescription = "مزامنة الآن") }
                })
            }) { padding ->
                Box(Modifier.fillMaxSize().padding(padding)) {
                    SyncScreen(
                        vm = vm,
                        openVisits = openVisits,
                        onOpenVisit = { visit -> visitUuid = visit.visitUuid },
                        onOpenAttendance = { profilePage = "attendance" },
                        onOpenMigration = { context.startActivity(Intent(context, LegacyMigrationActivity::class.java)) },
                        onOpenDiagnostics = { profilePage = "diagnostics" },
                    )
                }
            }
            "support" -> Scaffold(topBar = {
                MadarTopBar(title = "الدعم", subtitle = "بلاغات التطبيق", onBack = { profilePage = "profile" })
            }) { padding -> Box(Modifier.fillMaxSize().padding(padding)) { SupportScreen(vm) } }
            "diagnostics" -> DiagnosticScreen(vm = vm, onBack = { profilePage = "profile" })
        }
        return
    }

    val title = when (tab) {
        Tabs.SUPPORT -> "البلاغات الميدانية"
        Tabs.SYNC -> "المزامنة والرتل"
        Tabs.MAP -> "الخريطة المباشرة"
        else -> "خط السير الميداني"
    }
    val subtitle = when (tab) {
        Tabs.SUPPORT -> "إرسال بلاغ فوري للإدارة"
        Tabs.SYNC -> "طابور العمليات غير المرفوعة"
        Tabs.MAP -> "مواقع الماكينات ومسار المندوب"
        else -> "${session.fullName?.takeIf { it.isNotBlank() } ?: session.username} · المسار اليومي النشط"
    }

    Scaffold(
        topBar = {
            MadarTopBar(
                title = title,
                subtitle = subtitle,
                actions = {
                    IconButton(onClick = { profilePage = "profile" }) {
                        Icon(Icons.Default.AccountCircle, contentDescription = "حسابي والإعدادات")
                    }
                    IconButton(onClick = { profilePage = "attendance" }) {
                        Icon(Icons.Default.Fingerprint, contentDescription = "تسجيل الحضور والانصراف")
                    }
                    when (tab) {
                        Tabs.MAP -> {
                            IconButton(onClick = { vm.refreshMapCatalog(); vm.refreshMapPoints() }) {
                                Icon(Icons.Default.Refresh, contentDescription = "تحديث حزم الخرائط")
                            }
                        }
                        else -> Unit
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == Tabs.ROUTE,
                    onClick = { tab = Tabs.ROUTE },
                    icon = { Icon(Icons.Default.AssignmentTurnedIn, contentDescription = null) },
                    label = { Text("خط السير") },
                )
                NavigationBarItem(
                    selected = tab == Tabs.MAP,
                    onClick = { tab = Tabs.MAP },
                    icon = { Icon(Icons.Default.Map, contentDescription = null) },
                    label = { Text("الخريطة") },
                )
                NavigationBarItem(
                    selected = tab == Tabs.SYNC,
                    onClick = { tab = Tabs.SYNC },
                    icon = {
                        if (openVisits.isNotEmpty()) {
                            BadgedBox(badge = { Badge { Text("${openVisits.size}") } }) {
                                Icon(Icons.Default.Sync, contentDescription = null)
                            }
                        } else {
                            Icon(Icons.Default.Sync, contentDescription = null)
                        }
                    },
                    label = { Text("المزامنة") },
                )
                NavigationBarItem(
                    selected = tab == Tabs.SUPPORT,
                    onClick = { tab = Tabs.SUPPORT },
                    icon = {
                        if (unread > 0) {
                            BadgedBox(badge = { Badge { Text("$unread") } }) {
                                Icon(Icons.Default.Notifications, contentDescription = null)
                            }
                        } else {
                            Icon(Icons.Default.Notifications, contentDescription = null)
                        }
                    },
                    label = { Text("البلاغات") },
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (tab) {
                Tabs.SUPPORT -> SupportScreen(vm = vm, screenName = "tabs/support")
                Tabs.SYNC -> SyncScreen(
                    vm = vm,
                    openVisits = openVisits,
                    onOpenVisit = { visit -> visitUuid = visit.visitUuid },
                    onOpenAttendance = { profilePage = "attendance" },
                    onOpenMigration = { context.startActivity(Intent(context, LegacyMigrationActivity::class.java)) },
                )
                Tabs.MAP -> MapScreen(
                    vm = vm,
                    mapRepository = container.mapRepository,
                    governorates = container.governorates,
                    routeView = route,
                    openVisits = openVisits,
                    onOpenMachine = { machine ->
                        val local = openVisits.firstOrNull { it.cardId == machine.cardId }
                        if (local != null) {
                            visitUuid = local.visitUuid
                        } else {
                            vm.openMachine(machine) { visit -> visitUuid = visit.visitUuid }
                        }
                    },
                )
                else -> RouteScreen(
                    routeView = route,
                    loading = vm.routeLoading.collectAsStateWithLifecycle().value,
                    error = vm.routeError.collectAsStateWithLifecycle().value,
                    openVisits = openVisits,
                    onRefresh = { vm.refreshRoute() },
                    onOpenMachine = { machine ->
                        val local = openVisits.firstOrNull { it.cardId == machine.cardId }
                        if (local != null) {
                            visitUuid = local.visitUuid
                        } else {
                            vm.openMachine(machine) { visit -> visitUuid = visit.visitUuid }
                        }
                    },
                    onOpenVisit = { visit -> visitUuid = visit.visitUuid },
                    onOpenMap = { tab = Tabs.MAP },
                )
            }
        }
    }
}

@Composable
private fun ForcedUpdateScreen(vm: MadarViewModel) {
    val context = LocalContext.current
    val update by vm.apkUpdate.collectAsStateWithLifecycle()
    BackHandler(enabled = true) { }
    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.fillMaxSize().padding(28.dp),
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("يلزم تحديث التطبيق", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(12.dp))
            Text("هذا الإصدار لم يعد مدعومًا. حدّث التطبيق للعودة إلى العمل. لن تُرسل البيانات من هذا الإصدار.")
            Spacer(Modifier.height(12.dp))
            update.availableVersion?.let { Text("الإصدار المطلوب: $it") }
            update.message?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, style = MaterialTheme.typography.bodyMedium)
            }
            if (update.busy) {
                Spacer(Modifier.height(16.dp))
                if (update.progress != null) {
                    androidx.compose.material3.LinearProgressIndicator(
                        progress = { update.progress ?: 0f },
                        modifier = Modifier.fillMaxWidth(0.85f)
                    )
                } else {
                    CircularProgressIndicator()
                }
            }
            Spacer(Modifier.height(20.dp))
            when {
                update.downloadedApk != null -> Button(onClick = {
                    val activity = context as? Activity
                    if (activity == null) vm.showMessage("تعذر فتح مثبت Android.")
                    else runCatching { ApkUpdateManager(context).install(activity, update.downloadedApk!!) }
                        .onSuccess { opened ->
                            if (!opened) vm.showMessage("اسمح بتثبيت تطبيقات غير معروفة لهذا التطبيق، ثم ارجع واضغط التثبيت مرة أخرى.")
                        }
                        .onFailure { vm.showMessage("تعذر فتح مثبت Android: ${it.message ?: "خطأ غير معروف"}") }
                }, enabled = !update.busy) { Text("تثبيت التحديث") }
                else -> Button(onClick = vm::downloadApkUpdate, enabled = !update.busy) {
                    Text("تنزيل التحديث والتحقق منه")
                }
            }
        }
    }
}

@Composable
private fun AttendanceHost(vm: MadarViewModel, onClose: () -> Unit) {
    val view by vm.attendance.collectAsStateWithLifecycle()
    val actions by vm.attendanceActions.collectAsStateWithLifecycle()
    var loading by remember { mutableStateOf(view == null) }

    LaunchedEffect(Unit) {
        vm.refreshAttendance()
        delay(1_000)
        loading = false
    }

    BackHandler { onClose() }

    Scaffold(
        topBar = {
            MadarTopBar(
                title = "الحضور والانصراف",
                subtitle = "مصادقة حيوية ووقت أصلي محفوظ",
                onBack = onClose,
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            AttendanceScreen(
                vm = vm,
                view = view,
                actions = actions,
                loading = loading,
                onRefresh = { vm.refreshAttendance() },
            )
        }
    }
}
