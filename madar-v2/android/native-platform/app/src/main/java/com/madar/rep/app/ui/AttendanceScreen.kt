package com.madar.rep.app.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Login
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.madar.rep.app.core.GeoPolicy
import com.madar.rep.app.core.LocationDecision
import com.madar.rep.app.data.db.AttendanceActionEntity
import com.madar.rep.app.data.db.AttendanceActionState
import com.madar.rep.app.data.repo.AttendanceView
import com.madar.rep.app.ui.theme.MadarDanger
import com.madar.rep.app.ui.theme.MadarMuted
import com.madar.rep.app.ui.theme.MadarTeal
import com.madar.rep.app.ui.theme.MadarWarning

@Composable
fun AttendanceScreen(
    vm: MadarViewModel,
    view: AttendanceView?,
    actions: List<AttendanceActionEntity>,
    loading: Boolean,
    onRefresh: () -> Unit,
) {
    val location by vm.location.collectAsStateWithLifecycle()
    val pendingIn = actions.firstOrNull {
        it.action == "in" && it.state != "synced" && it.state != AttendanceActionState.FAILED
    }
    val pendingOut = actions.firstOrNull {
        it.action == "out" && it.state != "synced" && it.state != AttendanceActionState.FAILED
    }
    val record = view?.envelope?.attendance
    val open = record?.hasOpenAttendance == true
    val loginState by vm.login.collectAsStateWithLifecycle()

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        if (grants[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            grants[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        ) {
            vm.refreshLocation()
        } else {
            vm.showMessage("يلزم إذن الموقع لتسجيل الحضور.")
        }
    }

    val biometricGate = rememberBiometricGate { success, error ->
        if (!success) {
            if (error != null) vm.showMessage(error)
        } else if (open) {
            vm.enqueueAttendance("out", location.point) { }
        } else {
            vm.enqueueAttendance("in", location.point) { }
        }
    }

    fun requestAction(action: String) {
        val decision = GeoPolicy.evaluate(location.point, null, null)
        if (action == "in" && decision !is LocationDecision.Valid) {
            vm.showMessage(
                when (decision) {
                    LocationDecision.Missing -> "شغّل الموقع وحدّثه قبل تسجيل الحضور."
                    is LocationDecision.Stale -> "إشارة الموقع قديمة. حدّث الموقع أولًا."
                    is LocationDecision.Inaccurate -> "دقة الموقع غير كافية. انتظر إشارة أدق."
                    is LocationDecision.Mocked -> "الموقع مزيف ولا يمكن اعتماده."
                    else -> "الموقع غير صالح لتسجيل الحضور."
                }
            )
            vm.refreshLocation()
            return
        }
        biometricGate(
            if (action == "in") "تسجيل الحضور" else "تسجيل الانصراف",
            "أكد بصمتك لتسجيل ${if (action == "in") "الحضور" else "الانصراف"} بالوقت الحالي.",
        )
    }

    LazyColumn(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = if (open) MadarTeal else MaterialTheme.colorScheme.primary,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (open) Icons.Default.Login else Icons.Default.Logout,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onPrimary,
                        )
                        Spacer(Modifier.size(8.dp))
                        Text(
                            when {
                                open -> "وردية مفتوحة"
                                pendingIn != null -> "الحضور بانتظار المزامنة"
                                else -> "لم يُسجّل الحضور بعد"
                            },
                            color = MaterialTheme.colorScheme.onPrimary,
                            style = MaterialTheme.typography.titleLarge,
                        )
                        Spacer(Modifier.weight(1f))
                        IconButtonRefresh(loading, onRefresh)
                    }
                    Text(
                        view?.envelope?.date?.ifBlank { "اليوم" } ?: "اليوم",
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(
                        "الحضور والانصراف إجراءان صريحان: مصادقة حيوية + وقت أصلي محفوظ حتى لو تجاوزت الوردية منتصف الليل.",
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }

        if (record != null) {
            item {
                SectionCard(title = "وردية اليوم") {
                    InfoRow("وقت الحضور", record.clockInTime ?: "—", emphasize = true)
                    InfoRow("وقت الانصراف", record.clockOutTime ?: if (open) "لم يُسجّل" else "—")
                    InfoRow("الساعات الكلية", "%.2f ساعة".format(record.totalHours))
                    InfoRow("الساعات النظامية", "%.2f ساعة".format(record.regularHours))
                    InfoRow("الساعات الإضافية", "%.2f ساعة".format(record.overtimeHours), emphasize = record.overtimeHours > 0)
                    if (record.overtimeSessionStatus != null) {
                        InfoRow("جلسة الأوفرتايم", record.overtimeSessionStatus)
                    }
                    if (!record.overtimeRequestStatus.isNullOrBlank()) {
                        InfoRow("حالة طلب الأوفرتايم", record.overtimeRequestStatus)
                    }
                    HorizontalDivider()
                    Text(
                        "يُحفظ وقت البداية الأصلي كما هو. لا يوجد إغلاق تلقائي عند منتصف الليل، وأي وردية تمتد بعد منتصف الليل تبقى مرتبطة بيوم بدايتها.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MadarMuted,
                    )
                }
            }
        } else {
            item {
                InlineMessage(
                    if (loading) "جارٍ تحميل حالة الحضور…" else "لم تُحمّل حالة الحضور من الخادم. يمكنك تسجيل الحضور محليًا وسيُزامن لاحقًا.",
                    if (loading) MessageTone.Info else MessageTone.Warning,
                )
            }
        }

        item {
            SectionCard(title = "موقع تسجيل الحضور", subtitle = "الحضور يحتاج موقعًا حديثًا بدقة 50 مترًا أو أفضل. الانصراف يقبل الموقع عند توفره.") {
                val point = location.point
                if (point != null) {
                    Text(
                        "%.5f, %.5f · ±%d م · ${location.point?.provider ?: ""}".format(
                            point.latitude, point.longitude, point.accuracyMeters.toInt()
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        "وقت الإشارة: ${com.madar.rep.app.core.MadarTime.displayTime(point.capturedAtMillis)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MadarMuted,
                    )
                } else {
                    Text("لا توجد إشارة موقع.", style = MaterialTheme.typography.bodySmall, color = MadarMuted)
                }
                if (location.message != null) {
                    InlineMessage(location.message, if (location.permissionDenied) MessageTone.Error else MessageTone.Info)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { vm.refreshLocation() }, enabled = !location.busy) {
                        if (location.busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        else Text("تحديث الموقع")
                    }
                    if (location.permissionDenied) {
                        Button(onClick = {
                            permissionLauncher.launch(
                                arrayOf(
                                    Manifest.permission.ACCESS_FINE_LOCATION,
                                    Manifest.permission.ACCESS_COARSE_LOCATION,
                                )
                            )
                        }) { Text("منح الإذن") }
                    }
                }
            }
        }

        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (pendingIn != null) {
                    InlineMessage(
                        "سُجّل الحضور محليًا في ${pendingIn.occurredAtIso} وهو بانتظار تأكيد الخادم. لا يمكن تكرار الحضور.",
                        MessageTone.Info,
                    )
                }
                if (!open && pendingIn == null) {
                    Button(
                        onClick = { requestAction("in") },
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Icon(Icons.Default.Fingerprint, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("تسجيل الحضور بالبصمة", fontWeight = FontWeight.Bold)
                    }
                }
                if (open && pendingOut == null) {
                    Button(
                        onClick = { requestAction("out") },
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = MadarWarning),
                    ) {
                        Icon(Icons.Default.Logout, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("تسجيل الانصراف بالبصمة", fontWeight = FontWeight.Bold)
                    }
                }
                if (pendingOut != null) {
                    InlineMessage("الانصراف مسجل محليًا وبانتظار تأكيد الخادم.", MessageTone.Info)
                }
                Text(
                    "لن يُسجّل أي إجراء دون مصادقة حيوية ناجحة. عند تعذر الشبكة يحتفظ الجهاز بالوقت الأصلي ويعيد المحاولة.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                    textAlign = TextAlign.Center,
                )
            }
        }

        if (actions.isNotEmpty()) {
            item {
                Text("إجراءات الحضور المحلية", style = MaterialTheme.typography.titleMedium)
            }
            items(actions, key = { it.actionUuid }) { action ->
                AttendanceActionCard(action) { vm.retryAttendance(action.actionUuid) }
            }
        }

        if (view == null && !loading) {
            item {
                EmptyState(
                    "تعذر تحميل حالة الحضور",
                    "يمكنك إعادة المحاولة الآن؛ الإجراءات المسجلة محليًا لن تُفقد.",
                    action = { TextButton(onClick = onRefresh) { Text("إعادة المحاولة") } },
                )
            }
        }
        item { Spacer(Modifier.height(20.dp)) }
    }
}

@Composable
private fun IconButtonRefresh(loading: Boolean, onRefresh: () -> Unit) {
    androidx.compose.material3.IconButton(onClick = onRefresh) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        } else {
            Icon(Icons.Default.Refresh, contentDescription = "تحديث", tint = MaterialTheme.colorScheme.onPrimary)
        }
    }
}

@Composable
private fun AttendanceActionCard(action: AttendanceActionEntity, onRetry: () -> Unit) {
    val retryable = action.state in setOf(
        AttendanceActionState.NEEDS_LOGIN,
        AttendanceActionState.NEEDS_REVIEW,
        AttendanceActionState.RETRY_WAIT,
        AttendanceActionState.FAILED,
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
                    if (action.action == "in") "حضور" else "انصراف",
                    fontWeight = FontWeight.SemiBold,
                )
                Text(action.occurredAtIso, style = MaterialTheme.typography.bodySmall, color = MadarMuted)
                if (!action.lastError.isNullOrBlank()) {
                    Text(action.lastError, style = MaterialTheme.typography.bodySmall, color = MadarDanger)
                }
            }
            StatusPill(attendancePill(action.state))
            if (retryable) {
                TextButton(onClick = onRetry) { Text("إعادة") }
            }
        }
    }
}
