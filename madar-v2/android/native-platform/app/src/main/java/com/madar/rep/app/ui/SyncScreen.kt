package com.madar.rep.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.madar.rep.app.BuildConfig
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.db.AttendanceActionEntity
import com.madar.rep.app.data.db.AttendanceActionState
import com.madar.rep.app.data.db.MachineActionEntity
import com.madar.rep.app.data.db.MachineActionState
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import com.madar.rep.app.data.db.GpsPointEntity
import com.madar.rep.app.data.db.GpsPointState
import com.madar.rep.app.data.repo.AttendanceView
import com.madar.rep.app.ui.theme.MadarDanger
import com.madar.rep.app.ui.theme.MadarGold
import com.madar.rep.app.ui.theme.MadarMuted
import com.madar.rep.app.ui.theme.MadarTeal
import com.madar.rep.app.ui.theme.MadarWarning

/**
 * The queue is the source of truth for unsent field work. This screen never
 * removes local evidence: retrying only resets the next-attempt time, and a
 * server "processing" answer remains visibly pending until a final acknowledgement.
 */
@Composable
fun SyncScreen(
    vm: MadarViewModel,
    openVisits: List<VisitEntity>,
    onOpenVisit: (VisitEntity) -> Unit,
    onOpenAttendance: () -> Unit,
    onOpenMigration: () -> Unit,
) {
    val sync by vm.sync.collectAsStateWithLifecycle()
    val connected by vm.eventConnected.collectAsStateWithLifecycle()
    val migration by vm.migration.collectAsStateWithLifecycle()
    val machineActions by vm.machineActions.collectAsStateWithLifecycle()
    val attendanceActions by vm.attendanceActions.collectAsStateWithLifecycle()
    val gpsPoints by vm.gpsPoints.collectAsStateWithLifecycle()
    val attendance by vm.attendance.collectAsStateWithLifecycle()
    var confirmLogout by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.refreshMigrationMarkers() }

    LazyColumn(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SyncHeader(
                running = sync.running,
                note = sync.note,
                last = sync.last,
                lastFinishedAt = sync.finishedAt,
                connected = connected,
                onSync = { vm.syncNow() },
            )
        }

        if (sync.last != null) {
            item {
                SectionCard(title = "نتيجة آخر مزامنة") {
                    val result = sync.last!!
                    InfoRow("تمت محاولة", result.attempted.toString())
                    InfoRow("مؤكدة نهائيًا", result.acknowledged.toString(), emphasize = result.acknowledged > 0)
                    InfoRow("قيد معالجة الخادم", result.processing.toString(), emphasize = result.processing > 0)
                    InfoRow("تحتاج مراجعة", result.needsReview.toString(), emphasize = result.needsReview > 0)
                    InfoRow("فشل مؤقت", result.transientFailures.toString(), emphasize = result.transientFailures > 0)
                    InfoRow("المتبقي في القائمة", result.remaining.toString(), emphasize = result.remaining > 0)
                    if (result.processing > 0) {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                        Text(
                            "الخادم يعالج الزيارة. لا تُعتبر مكتملة حتى يصل التأكيد النهائي.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MadarMuted,
                        )
                    }
                }
            }
        }

        if (!migration.finished) {
            item {
                SectionCard(
                    title = "استعادة بيانات التطبيق القديم",
                    subtitle = "تُنسخ الزيارات والصور والUUID والحالات دون حذف ملفات النسخة القديمة.",
                ) {
                    InfoRow("قاعدة البيانات القديمة", if (migration.sqliteDone) "تمت" else "لم تتم")
                    InfoRow("تخزين المتصفح القديم", if (migration.browserDone) "تمت" else "لم تتم")
                    if (migration.counts.visits > 0 || migration.counts.photos > 0) {
                        InfoRow("زيارات مستعادة", migration.counts.visits.toString(), emphasize = true)
                        InfoRow("صور مستعادة", migration.counts.photos.toString(), emphasize = true)
                    }
                    if (migration.errors.isNotEmpty()) {
                        Text(migration.errors.last(), style = MaterialTheme.typography.bodySmall, color = MadarDanger)
                    }
                    if (migration.warnings.isNotEmpty()) {
                        Text(migration.warnings.last(), style = MaterialTheme.typography.bodySmall, color = MadarWarning)
                    }
                    OutlinedButton(onClick = onOpenMigration, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Default.Storage, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("فتح شاشة الاستعادة")
                    }
                }
            }
        }

        item {
            SyncSectionTitle("الزيارات المحلية", "${openVisits.size} عنصرًا في سجل الجهاز")
        }
        if (openVisits.isEmpty()) {
            item { InlineMessage("لا توجد زيارات محلية معلّقة.", MessageTone.Success) }
        } else {
            items(openVisits, key = { it.visitUuid }) { visit ->
                VisitQueueCard(
                    visit = visit,
                    onOpen = { onOpenVisit(visit) },
                    onRetry = { vm.retryVisit(visit.visitUuid) },
                )
            }
        }

        item {
            SyncSectionTitle(
                "إجراءات الماكينات",
                if (machineActions.isEmpty()) "لا توجد إجراءات محفوظة" else "${machineActions.size} إجراءً",
            )
        }
        if (machineActions.isNotEmpty()) {
            items(machineActions, key = { it.actionUuid }) { action ->
                MachineActionCard(
                    action = action,
                    onRetry = { vm.retryMachineAction(action.actionUuid) },
                )
            }
        }

        item { SyncSectionTitle("نقاط الموقع المحفوظة", "تُرسل بعد الحضور وبمعرّف ثابت؛ لا تفتح الوردية") }
        if (gpsPoints.isEmpty()) item { InlineMessage("لا توجد نقاط موقع معلّقة.", MessageTone.Info) }
        else items(gpsPoints, key = { it.clientPointId }) { point ->
            GpsPointCard(point) { vm.retryGpsPoint(point.clientPointId) }
        }

        item {
            AttendanceQueueCard(
                attendance = attendance,
                actions = attendanceActions,
                onOpen = onOpenAttendance,
                onRetry = vm::retryAttendance,
            )
        }

        item {
            OutlinedButton(
                onClick = { confirmLogout = true },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
            ) {
                Icon(Icons.Default.Logout, contentDescription = null, tint = MadarDanger)
                Spacer(Modifier.size(8.dp))
                Text("تسجيل الخروج", color = MadarDanger)
            }
        }

        item {
            Text(
                "الإصدار ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE}) · ${BuildConfig.APPLICATION_ID}",
                style = MaterialTheme.typography.bodySmall,
                color = MadarMuted,
            )
        }
        item { Spacer(Modifier.height(16.dp)) }
    }

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("تسجيل الخروج؟") },
            text = {
                Text(
                    "ستحتاج إلى إدخال بيانات الدخول من جديد. الزيارات والصور والإجراءات المحلية تبقى محفوظة على الجهاز."
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirmLogout = false
                        vm.logout()
                    }
                ) { Text("خروج", color = MadarDanger) }
            },
            dismissButton = {
                TextButton(onClick = { confirmLogout = false }) { Text("إلغاء") }
            },
        )
    }
}

@Composable
private fun GpsPointCard(point: GpsPointEntity, onRetry: () -> Unit) {
    val retryable = point.state in setOf(GpsPointState.NEEDS_LOGIN, GpsPointState.NEEDS_REVIEW, GpsPointState.RETRY_WAIT)
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("${point.updatedAt} · دقة ${point.accuracy.toInt()}م", fontWeight = FontWeight.SemiBold)
            Text("${point.latitude}, ${point.longitude}", style = MaterialTheme.typography.bodySmall, color = MadarMuted)
            Text(point.lastError ?: when (point.state) {
                GpsPointState.QUEUED, GpsPointState.SYNCING, GpsPointState.RETRY_WAIT -> "النقطة محفوظة محليًا بانتظار الإقرار النهائي."
                GpsPointState.NEEDS_LOGIN -> "يلزم تسجيل الدخول لإعادة المحاولة."
                else -> "رفض الخادم النقطة؛ بقيت محفوظة للمراجعة."
            }, style = MaterialTheme.typography.bodySmall, color = if (point.state == GpsPointState.NEEDS_REVIEW) MadarWarning else MadarMuted)
            if (retryable) OutlinedButton(onClick = onRetry) { Icon(Icons.Default.Refresh, contentDescription = null); Spacer(Modifier.size(6.dp)); Text("إعادة المحاولة") }
        }
    }
}

@Composable
private fun SyncHeader(
    running: Boolean,
    note: String?,
    last: com.madar.rep.app.data.sync.SyncRunResult?,
    lastFinishedAt: Long?,
    connected: Boolean,
    onSync: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (connected) Icons.Default.CloudDone else Icons.Default.CloudOff,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimary,
                )
                Spacer(Modifier.size(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        "قائمة المزامنة",
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Text(
                        when {
                            connected -> "متصل بأحداث الخادم"
                            running -> "جارٍ الرفع…"
                            else -> "غير متصل حاليًا؛ العمل يُحفظ محليًا"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                    )
                }
                if (lastFinishedAt != null) {
                    Text(
                        MadarTime.displayTime(lastFinishedAt),
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                        fontSize = 12.sp,
                    )
                }
            }

            if (note != null) {
                Text(
                    note,
                    color = MadarGold,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                )
            } else if (last == null) {
                Text(
                    "لن تُحذف الصور أو السجلات قبل تأكيد الخادم النهائي.",
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                    style = MaterialTheme.typography.bodySmall,
                )
            }

            Button(
                onClick = onSync,
                enabled = !running,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(14.dp),
            ) {
                if (running) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Spacer(Modifier.size(8.dp))
                    Text("جارٍ المزامنة…")
                } else {
                    Icon(Icons.Default.Sync, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("مزامنة الآن", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun SyncSectionTitle(title: String, subtitle: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (subtitle != null) {
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MadarMuted)
        }
    }
}

@Composable
private fun VisitQueueCard(visit: VisitEntity, onOpen: () -> Unit, onRetry: () -> Unit) {
    val retryable = visit.state in setOf(
        VisitState.NEEDS_LOGIN,
        VisitState.NEEDS_REVIEW,
        VisitState.RETRY_WAIT,
    )
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "${visit.machineCode} · ${visit.machineName.ifBlank { visit.regionName }}",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                StatusPill(visitPill(visit.state))
            }
            Text(
                "${MadarTime.displayDateTime(visit.updatedAt)} · محاولات ${visit.attempts}",
                style = MaterialTheme.typography.bodySmall,
                color = MadarMuted,
            )
            if (!visit.lastError.isNullOrBlank()) {
                Text(
                    visit.lastError,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (retryable) MadarDanger else MadarMuted,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when (visit.state) {
                        VisitState.DRAFT -> "مسودة لم تُرسل"
                        VisitState.QUEUED, VisitState.SYNCING -> "في قائمة الرفع"
                        VisitState.PROCESSING -> "قيد معالجة الخادم"
                        VisitState.NEEDS_LOGIN -> "يلزم تسجيل الدخول"
                        VisitState.NEEDS_REVIEW -> "تحتاج مراجعة قبل الإرسال"
                        VisitState.RETRY_WAIT -> "بانتظار إعادة المحاولة"
                        else -> visit.state
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                )
                Spacer(Modifier.weight(1f))
                if (retryable) {
                    TextButton(onClick = onRetry) {
                        Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.size(4.dp))
                        Text("إعادة المحاولة")
                    }
                }
            }
        }
    }
}

@Composable
private fun MachineActionCard(action: MachineActionEntity, onRetry: () -> Unit) {
    val retryable = action.state in setOf(
        MachineActionState.NEEDS_LOGIN,
        MachineActionState.NEEDS_REVIEW,
        MachineActionState.RETRY_WAIT,
        MachineActionState.FAILED,
    )
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    if (action.type == "confirm_location") "تثبيت موقع ماكينة" else "بلاغ تصحيح موقع",
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "${MadarTime.displayDateTime(action.createdAt)} · محاولات ${action.attempts}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                )
                if (!action.lastError.isNullOrBlank()) {
                    Text(action.lastError, style = MaterialTheme.typography.bodySmall, color = MadarDanger)
                }
            }
            StatusPill(machinePill(action.state))
            if (retryable) {
                TextButton(onClick = onRetry) { Text("إعادة") }
            }
        }
    }
}

@Composable
private fun AttendanceQueueCard(
    attendance: AttendanceView?,
    actions: List<AttendanceActionEntity>,
    onOpen: () -> Unit,
    onRetry: (String) -> Unit,
) {
    val record = attendance?.envelope?.attendance
    val open = record?.hasOpenAttendance == true
    SectionCard(
        title = "الحضور والانصراف",
        subtitle = "إجراءات صريحة بمصادقة حيوية؛ الوقت الأصلي محفوظ حتى لو تجاوزت الوردية منتصف الليل.",
    ) {
        InfoRow(
            "الوردية",
            when {
                open -> "مفتوحة منذ ${record?.clockInTime ?: "—"}"
                record?.clockInTime != null -> "مغلقة · ${record.clockInTime} — ${record.clockOutTime ?: "—"}"
                actions.any { it.state != "synced" } -> "بانتظار تأكيد الخادم"
                else -> "لم تُسجّل اليوم"
            },
            emphasize = open,
        )
        if (record != null && record.overtimeHours > 0) {
            InfoRow("ساعات إضافية", "%.2f ساعة".format(record.overtimeHours), emphasize = true)
        }
        if (actions.isNotEmpty()) {
            actions.forEach { action ->
                val retryable = action.state in setOf(
                    AttendanceActionState.NEEDS_LOGIN,
                    AttendanceActionState.NEEDS_REVIEW,
                    AttendanceActionState.RETRY_WAIT,
                    AttendanceActionState.FAILED,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "${if (action.action == "in") "حضور" else "انصراف"} · ${action.occurredAtIso}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MadarMuted,
                        modifier = Modifier.weight(1f),
                    )
                    StatusPill(attendancePill(action.state))
                    if (retryable) {
                        TextButton(onClick = { onRetry(action.actionUuid) }) { Text("إعادة") }
                    }
                }
            }
        }
        OutlinedButton(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Default.Fingerprint, contentDescription = null)
            Spacer(Modifier.size(8.dp))
            Text("فتح شاشة الحضور")
        }
    }
}
