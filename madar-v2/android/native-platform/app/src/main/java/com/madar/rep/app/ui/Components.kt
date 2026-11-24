package com.madar.rep.app.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.GeoPolicy
import com.madar.rep.app.core.LocationDecision
import com.madar.rep.app.data.db.AttendanceActionState
import com.madar.rep.app.data.db.MachineActionState
import com.madar.rep.app.data.db.MapPackState
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.domain.fsm.VisitFsm
import com.madar.rep.app.data.db.VisitState
import com.madar.rep.app.ui.theme.MadarDanger
import com.madar.rep.app.ui.theme.MadarGold
import com.madar.rep.app.ui.theme.MadarInk
import com.madar.rep.app.ui.theme.MadarMuted
import com.madar.rep.app.ui.theme.MadarTeal
import com.madar.rep.app.ui.theme.MadarWarning
import java.io.File
import java.text.DecimalFormat

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MadarTopBar(
    title: String,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
    actions: @Composable () -> Unit = {},
) {
    TopAppBar(
        title = {
            Column {
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                if (!subtitle.isNullOrBlank()) {
                    Text(subtitle, fontSize = 12.sp, color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f))
                }
            }
        },
        navigationIcon = {
            if (onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                }
            }
        },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.primary,
            titleContentColor = MaterialTheme.colorScheme.onPrimary,
            navigationIconContentColor = MaterialTheme.colorScheme.onPrimary,
            actionIconContentColor = MaterialTheme.colorScheme.onPrimary,
        ),
    )
}

@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    subtitle: String? = null,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (title != null) {
                Text(title, style = MaterialTheme.typography.titleMedium)
            }
            if (subtitle != null) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MadarMuted)
            }
            content()
        }
    }
}

data class PillStyle(val background: androidx.compose.ui.graphics.Color, val foreground: androidx.compose.ui.graphics.Color, val label: String)

@Composable
fun visitPill(state: String): PillStyle = when (state) {
    VisitState.DRAFT -> PillStyle(MadarGold.copy(alpha = 0.18f), MadarWarning, "مسودة")
    VisitState.QUEUED, VisitState.SYNCING -> PillStyle(MadarTeal.copy(alpha = 0.16f), MadarTeal, "بالانتظار")
    VisitState.PROCESSING -> PillStyle(MadarTeal.copy(alpha = 0.16f), MadarTeal, "قيد المعالجة")
    VisitState.PENDING_REVIEW -> PillStyle(MadarGold.copy(alpha = 0.2f), MadarWarning, "مراجعة المشرف")
    VisitState.APPROVED -> PillStyle(MadarTeal.copy(alpha = 0.18f), MadarTeal, "معتمدة")
    VisitState.RESHOOT -> PillStyle(MadarDanger.copy(alpha = 0.14f), MadarDanger, "إعادة تصوير")
    VisitState.NEEDS_LOGIN -> PillStyle(MadarDanger.copy(alpha = 0.14f), MadarDanger, "يلزم تسجيل الدخول")
    VisitState.NEEDS_REVIEW -> PillStyle(MadarDanger.copy(alpha = 0.14f), MadarDanger, "تحتاج مراجعة")
    VisitState.RETRY_WAIT -> PillStyle(MadarGold.copy(alpha = 0.2f), MadarWarning, "إعادة محاولة")
    VisitState.FAILED -> PillStyle(MadarDanger.copy(alpha = 0.14f), MadarDanger, "فشلت")
    else -> PillStyle(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant, state)
}

@Composable
fun machinePill(state: String): PillStyle = when (state) {
    MachineActionState.QUEUED, MachineActionState.SYNCING, MachineActionState.RETRY_WAIT ->
        PillStyle(MadarGold.copy(alpha = 0.2f), MadarWarning, "بالانتظار")
    MachineActionState.PENDING_APPROVAL -> PillStyle(MadarTeal.copy(alpha = 0.14f), MadarTeal, "بانتظار المشرف")
    MachineActionState.APPROVED -> PillStyle(MadarTeal.copy(alpha = 0.18f), MadarTeal, "معتمدة")
    MachineActionState.REJECTED -> PillStyle(MadarDanger.copy(alpha = 0.14f), MadarDanger, "مرفوضة")
    MachineActionState.NEEDS_LOGIN -> PillStyle(MadarDanger.copy(alpha = 0.14f), MadarDanger, "يلزم تسجيل الدخول")
    else -> PillStyle(MadarDanger.copy(alpha = 0.14f), MadarDanger, state)
}

@Composable
fun attendancePill(state: String): PillStyle = when (state) {
    AttendanceActionState.QUEUED, AttendanceActionState.SYNCING, AttendanceActionState.RETRY_WAIT, "synced" ->
        PillStyle(MadarTeal.copy(alpha = 0.14f), MadarTeal, "بالانتظار")
    AttendanceActionState.NEEDS_LOGIN, AttendanceActionState.NEEDS_REVIEW, AttendanceActionState.FAILED ->
        PillStyle(MadarDanger.copy(alpha = 0.14f), MadarDanger, "تحتاج مراجعة")
    else -> PillStyle(MadarGold.copy(alpha = 0.2f), MadarWarning, state)
}

@Composable
fun mapPackPill(state: String): PillStyle = when (state) {
    MapPackState.VERIFIED -> PillStyle(MadarTeal.copy(alpha = 0.16f), MadarTeal, "مفعّلة")
    MapPackState.DOWNLOADING -> PillStyle(MadarGold.copy(alpha = 0.2f), MadarWarning, "جارٍ التنزيل")
    MapPackState.FAILED -> PillStyle(MadarDanger.copy(alpha = 0.14f), MadarDanger, "فشلت")
    else -> PillStyle(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant, "غير منزّلة")
}

@Composable
fun StatusPill(style: PillStyle, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = style.background,
    ) {
        Text(
            style.label,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            color = style.foreground,
            fontSize = 12.sp,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
fun InlineMessage(
    text: String,
    tone: MessageTone = MessageTone.Info,
    modifier: Modifier = Modifier,
) {
    val background = when (tone) {
        MessageTone.Info -> MaterialTheme.colorScheme.primaryContainer
        MessageTone.Warning -> MadarGold.copy(alpha = 0.18f)
        MessageTone.Error -> MadarDanger.copy(alpha = 0.12f)
        MessageTone.Success -> MadarTeal.copy(alpha = 0.14f)
    }
    val foreground = when (tone) {
        MessageTone.Info -> MaterialTheme.colorScheme.onPrimaryContainer
        MessageTone.Warning -> MadarWarning
        MessageTone.Error -> MadarDanger
        MessageTone.Success -> MadarTeal
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            when (tone) {
                MessageTone.Success -> Icons.Default.CheckCircle
                MessageTone.Error -> Icons.Default.ErrorOutline
                MessageTone.Warning -> Icons.Default.Schedule
                MessageTone.Info -> Icons.Default.Refresh
            },
            contentDescription = null,
            tint = foreground,
            modifier = Modifier.size(18.dp),
        )
        Text(text, color = foreground, style = MaterialTheme.typography.bodySmall)
    }
}

enum class MessageTone { Info, Warning, Error, Success }

@Composable
fun EmptyState(title: String, body: String? = null, action: (@Composable () -> Unit)? = null) {
    Column(
        Modifier.fillMaxWidth().padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Default.CloudOff, contentDescription = null, tint = MadarMuted, modifier = Modifier.size(34.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
        if (body != null) Text(body, style = MaterialTheme.typography.bodySmall, color = MadarMuted)
        action?.invoke()
    }
}

@Composable
fun PhotoThumbnail(path: String, modifier: Modifier = Modifier, selected: Boolean = false) {
    val bitmap = remember(path, File(path).lastModified()) {
        runCatching {
            val options = BitmapFactory.Options().apply { inSampleSize = 4 }
            BitmapFactory.decodeFile(path, options)?.asImageBitmap()
        }.getOrNull()
    }
    Box(
        modifier
            .size(86.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(bitmap, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().height(86.dp))
        } else {
            Icon(Icons.Default.ErrorOutline, contentDescription = "صورة غير متاحة", tint = MadarDanger)
        }
    }
}

fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0"
    val units = arrayOf("B", "KB", "MB", "GB")
    var value = bytes.toDouble()
    var index = 0
    while (value >= 1024 && index < units.lastIndex) {
        value /= 1024
        index += 1
    }
    return "${DecimalFormat("0.#").format(value)} ${units[index]}"
}

@Composable
fun ErrorBanner(text: String, onRetry: (() -> Unit)? = null) {
    InlineMessage(text, MessageTone.Error)
    if (onRetry != null) {
        TextButton(onClick = onRetry) { Text("إعادة المحاولة") }
    }
}

@Composable
fun InfoRow(label: String, value: String, emphasize: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MadarMuted, style = MaterialTheme.typography.bodySmall)
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (emphasize) FontWeight.Bold else FontWeight.Normal,
            color = if (emphasize) MadarInk else MaterialTheme.colorScheme.onSurface,
        )
    }
    Spacer(Modifier.height(0.dp))
}

@Composable
fun VisitProgressStepper(
    currentStep: Int,
    modifier: Modifier = Modifier,
) {
    val steps = listOf("الوصول", "صور قبل", "الصيانة", "صور بعد", "الاعتماد")
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 10.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            steps.forEachIndexed { index, title ->
                val stepNum = index + 1
                val isDone = stepNum < currentStep
                val isActive = stepNum == currentStep
                val badgeColor = when {
                    isDone -> MadarTeal
                    isActive -> MaterialTheme.colorScheme.primary
                    else -> MaterialTheme.colorScheme.surfaceVariant
                }
                val textColor = when {
                    isDone -> MadarTeal
                    isActive -> MaterialTheme.colorScheme.primary
                    else -> MadarMuted
                }

                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(badgeColor),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isDone) {
                            Icon(
                                Icons.Default.CheckCircle,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(15.dp),
                            )
                        } else {
                            Text(
                                "$stepNum",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (isActive) MaterialTheme.colorScheme.onPrimary else MadarMuted,
                            )
                        }
                    }
                    Text(
                        title,
                        fontSize = 10.sp,
                        fontWeight = if (isActive) FontWeight.Bold else FontWeight.Normal,
                        color = textColor,
                        maxLines = 1,
                    )
                }

                if (index < steps.lastIndex) {
                    Box(
                        Modifier
                            .width(12.dp)
                            .height(2.dp)
                            .background(if (index < currentStep - 1) MadarTeal else MaterialTheme.colorScheme.surfaceVariant)
                    )
                }
            }
        }
    }
}

@Composable
fun GeofencedArrivalCard(
    location: LocationUiState,
    visit: VisitEntity,
    isArrived: Boolean,
    approvingMachineLocation: Boolean,
    approvalProgressMessage: String? = null,
    onConfirmArrival: (GeoPoint) -> Unit,
    onApproveMachine: () -> Unit,
    onRefreshLocation: () -> Unit,
    onRequestLocationChange: () -> Unit,
    onRequestPermission: () -> Unit,
    onConfirmDifferentLocation: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    SectionCard(
        modifier = modifier,
        title = "تأكيد الوصول",
    ) {
        if (!visit.locationLocked) {
            InlineMessage(
                "موقع الماكينة غير مثبت بعد؛ يلزم التواجد أمام الماكينة واعتماد موقعها لبدء الزيارة.",
                MessageTone.Warning,
            )
            Button(
                onClick = onApproveMachine,
                enabled = !approvingMachineLocation,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                if (approvingMachineLocation) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                    Spacer(Modifier.width(8.dp))
                    Text(approvalProgressMessage ?: "جارٍ اعتماد موقع الماكينة…")
                } else {
                    Icon(Icons.Default.LocationOn, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("اعتماد موقع الماكينة في النظام")
                }
            }
        } else {
            val point = location.point
            val decision = VisitFsm.arrivalDecision(visit, point)
            val canConfirm = decision == LocationDecision.Valid && !location.busy &&
                !location.permissionDenied && !location.approximateOnly && !location.providersDisabled
            if (isArrived) {
                InlineMessage("تم حفظ تأكيد الوصول عند الماكينة.", MessageTone.Success)
            } else {
                val (message, tone) = when (decision) {
                    LocationDecision.Valid -> "أنت داخل نطاق الماكينة. أكّد وصولك لبدء الزيارة." to MessageTone.Success
                    LocationDecision.Missing -> "بانتظار قراءة GPS." to MessageTone.Warning
                    LocationDecision.Mocked -> "تم اكتشاف موقع مزيّف." to MessageTone.Error
                    LocationDecision.InvalidCoordinates -> "إحداثيات الموقع غير صالحة." to MessageTone.Error
                    is LocationDecision.Invalid -> decision.reason to MessageTone.Error
                    is LocationDecision.Stale -> "قراءة الموقع قديمة. حدّث GPS." to MessageTone.Warning
                    is LocationDecision.Inaccurate -> "دقة الموقع غير كافية. حاول في مكان مكشوف." to MessageTone.Warning
                    is LocationDecision.Outside -> "أنت خارج نطاق الماكينة، على بُعد ${decision.distanceMeters.toInt()} م." to MessageTone.Warning
                }
                InlineMessage(message, tone)
                Button(
                    onClick = { point?.let(onConfirmArrival) },
                    enabled = canConfirm,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Icon(Icons.Default.LocationOn, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("تأكيد الوصول عند الماكينة", fontWeight = FontWeight.Bold)
                }
                if (decision is LocationDecision.Outside) {
                    if (point != null && point.accuracyMeters <= GeoPolicy.MAX_FIELD_CONFIRMATION_ACCURACY_METERS && onConfirmDifferentLocation != null) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = MadarGold.copy(alpha = 0.15f),
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        ) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Icon(Icons.Default.Warning, contentDescription = null, tint = MadarGold)
                                    Text(
                                        text = "أنت في موقع مختلف عن الموقع المسجل للماكينة",
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 14.sp,
                                        color = MadarInk,
                                    )
                                }
                                Text(
                                    text = "المسافة الحالية عن الموقع المسجل: ${decision.distanceMeters.toInt()}م. إذا كانت الماكينة نُقلت أو كان الموقع المسجل غير صحيح، يمكنك اعتماد موقعك الحالي للزيارة والمتابعة فوراً.",
                                    fontSize = 12.sp,
                                    color = MadarMuted,
                                )
                                Button(
                                    onClick = onConfirmDifferentLocation,
                                    colors = ButtonDefaults.buttonColors(containerColor = MadarTeal, contentColor = Color.White),
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.fillMaxWidth().height(46.dp),
                                ) {
                                    Icon(Icons.Default.LocationOn, contentDescription = null, Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("اعتماد الموقع الحالي للزيارة", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                }
                            }
                        }
                    }

                    OutlinedButton(onClick = onRequestLocationChange, modifier = Modifier.fillMaxWidth()) {
                        Text("طلب تصحيح موقع الماكينة")
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (point != null) {
                    Text(
                        "دقة الإشارة: ±${point.accuracyMeters.toInt()}م · ${point.provider ?: "GPS"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MadarMuted,
                    )
                }
                TextButton(onClick = onRefreshLocation, enabled = !location.busy) {
                    if (location.busy) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                    else {
                        Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("تحديث GPS", fontSize = 12.sp)
                    }
                }
            }
            if (location.providersDisabled) {
                InlineMessage("فعّل خدمة الموقع من إعدادات الهاتف.", MessageTone.Warning)
            }
            if (location.permissionDenied || location.approximateOnly) {
                Button(onClick = onRequestPermission, modifier = Modifier.fillMaxWidth()) {
                    Text("منح إذن الموقع الجغرافي")
                }
            }
        }
    }
}

