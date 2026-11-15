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
    const val SYNC = "sync"
    const val SUPPORT = "support"
}

/**
 * The signed-in shell. It keeps one ViewModel for the whole session, one snackbar
 * host for repository/service messages, and three top-level work areas. Visit,
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
    var showAttendance by rememberSaveable { mutableStateOf(false) }
    var showNotifications by rememberSaveable { mutableStateOf(false) }

    visitUuid?.let { uuid ->
        VisitScreen(
            vm = vm,
            visitUuid = uuid,
            onClose = { visitUuid = null },
        )
        return
    }

    if (showAttendance) {
        AttendanceHost(
            vm = vm,
            onClose = { showAttendance = false },
        )
        return
    }

    if (showNotifications) {
        BackHandler { showNotifications = false }
        LaunchedEffect(Unit) { vm.refreshNotifications() }
        NotificationsScreen(
            notifications = notifications,
            unreadCount = unread,
            loading = false,
            onBack = { showNotifications = false },
            onRefresh = { vm.refreshNotifications() },
            onMarkRead = vm::markNotificationRead,
            onMarkAllRead = vm::markAllNotificationsRead,
            onDismiss = vm::dismissNotification,
        )
        return
    }

    val title = when (tab) {
        Tabs.MAP -> "الخريطة"
        Tabs.SYNC -> "المزامنة"
        Tabs.SUPPORT -> "الدعم"
        else -> "مدار"
    }
    val subtitle = when (tab) {
        Tabs.MAP -> "بلاطات مرخصة بدون خدمات جوجل"
        Tabs.SYNC -> "قائمة الرفع وحالة الاتصال"
        Tabs.SUPPORT -> "إرسال بلاغ محفوظ محلياً على الخادم"
        else -> "${session.fullName?.takeIf { it.isNotBlank() } ?: session.username} · مسار اليوم"
    }

    Scaffold(
        topBar = {
            MadarTopBar(
                title = title,
                subtitle = subtitle,
                actions = {
                    when (tab) {
                        Tabs.ROUTE -> {
                            IconButton(onClick = { showNotifications = true }) {
                                BadgedBox(
                                    badge = {
                                        if (unread > 0) {
                                            Badge { Text(if (unread > 99) "99+" else unread.toString()) }
                                        }
                                    }
                                ) {
                                    Icon(Icons.Default.Notifications, contentDescription = "الإشعارات")
                                }
                            }
                            IconButton(onClick = { showAttendance = true }) {
                                Icon(Icons.Default.Fingerprint, contentDescription = "الحضور والانصراف")
                            }
                        }
                        Tabs.MAP -> {
                            IconButton(onClick = { vm.refreshMapCatalog() }) {
                                Icon(Icons.Default.Refresh, contentDescription = "تحديث حزم الخرائط")
                            }
                        }
                        Tabs.SYNC -> {
                            IconButton(onClick = { vm.syncNow() }) {
                                Icon(Icons.Default.Sync, contentDescription = "مزامنة الآن")
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
                NavigationBarItem(
                    selected = tab == Tabs.SYNC,
                    onClick = { tab = Tabs.SYNC },
                    icon = { Icon(Icons.Default.Sync, contentDescription = null) },
                    label = { Text("المزامنة") },
                )
                NavigationBarItem(
                    selected = tab == Tabs.SUPPORT,
                    onClick = { tab = Tabs.SUPPORT },
                    icon = { Text("؟") },
                    label = { Text("الدعم") },
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (tab) {
                Tabs.SUPPORT -> SupportScreen(vm)
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
                Tabs.SYNC -> SyncScreen(
                    vm = vm,
                    openVisits = openVisits,
                    onOpenVisit = { visit -> visitUuid = visit.visitUuid },
                    onOpenAttendance = { showAttendance = true },
                    onOpenMigration = {
                        context.startActivity(Intent(context, LegacyMigrationActivity::class.java))
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
private fun SupportScreen(vm: MadarViewModel) {
    var description by rememberSaveable { mutableStateOf("") }
    val busy = vm.supportBusy.collectAsStateWithLifecycle().value
    val message = vm.supportMessage.collectAsStateWithLifecycle().value
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
    ) {
        Text("إرسال بلاغ للدعم")
        Spacer(Modifier.height(8.dp))
        Text("سيُحفظ البلاغ على خادم MADAR المحلي. إنشاء تذكرة خارجية يتطلب إجراءً صريحاً من المدير.")
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = description,
            onValueChange = { description = it.take(8000) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("وصف المشكلة") },
            minLines = 5,
            maxLines = 10,
        )
        Spacer(Modifier.height(12.dp))
        Button(
            onClick = { vm.submitSupportReport(description) },
            enabled = !busy && description.trim().length >= 5,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (busy) CircularProgressIndicator()
            else Text("حفظ وإرسال البلاغ")
        }
        if (!message.isNullOrBlank()) {
            Spacer(Modifier.height(12.dp))
            Text(message)
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
