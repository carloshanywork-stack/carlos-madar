package com.madar.rep.app.ui

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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.madar.rep.app.AppContainer
import com.madar.rep.app.data.session.Session
import com.madar.rep.app.migration.LegacyMigrationActivity
import kotlinx.coroutines.delay

private object Tabs {
    const val ROUTE = "route"
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
    val session by vm.session.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(vm) {
        vm.messages.collect { message -> snackbarHostState.showSnackbar(message) }
    }

    val current = session
    if (current == null) {
        val login by vm.login.collectAsStateWithLifecycle()
        LoginScreen(
            state = login,
            defaultServerUrl = container.defaultServerUrl(),
            onLogin = vm::login,
            onClearError = vm::clearLoginError,
        )
        return
    }

    SignedInShell(
        vm = vm,
        container = container,
        session = current,
        snackbarHostState = snackbarHostState,
    )
}

@Composable
private fun SignedInShell(
    vm: MadarViewModel,
    container: AppContainer,
    session: Session,
    snackbarHostState: SnackbarHostState,
) {
    val route by vm.route.collectAsStateWithLifecycle()
    val openVisits by vm.openVisits.collectAsStateWithLifecycle()
    val notifications by vm.notifications.collectAsStateWithLifecycle()
    val unread by vm.unreadNotifications.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var tab by rememberSaveable { mutableStateOf(Tabs.ROUTE) }
    var visitUuid by rememberSaveable { mutableStateOf<String?>(null) }
    var profilePage by rememberSaveable { mutableStateOf<String?>(null) }

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
                onMigration = { context.startActivity(Intent(context, LegacyMigrationActivity::class.java)) },
                onLogout = { vm.logout(); profilePage = null },
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
                    )
                }
            }
            "support" -> Scaffold(topBar = {
                MadarTopBar(title = "الدعم", subtitle = "بلاغات التطبيق", onBack = { profilePage = "profile" })
            }) { padding -> Box(Modifier.fillMaxSize().padding(padding)) { SupportScreen(vm) } }
        }
        return
    }

    val title = when (tab) {
        Tabs.MAP -> "الخريطة"
        else -> "مدار"
    }
    val subtitle = when (tab) {
        Tabs.MAP -> "بلاطات مرخصة بدون خدمات جوجل"
        else -> "${session.fullName?.takeIf { it.isNotBlank() } ?: session.username} · مسار اليوم"
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
                    when (tab) {
                        Tabs.ROUTE -> Unit
                        Tabs.MAP -> {
                            IconButton(onClick = { vm.refreshMapCatalog() }) {
                                Icon(Icons.Default.Refresh, contentDescription = "تحديث حزم الخرائط")
                            }
                        }
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
                    label = { Text("العمل") },
                )
                NavigationBarItem(
                    selected = tab == Tabs.MAP,
                    onClick = { tab = Tabs.MAP },
                    icon = { Icon(Icons.Default.Map, contentDescription = null) },
                    label = { Text("الخريطة") },
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (tab) {
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
                )
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
