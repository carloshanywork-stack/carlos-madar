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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.madar.rep.app.data.db.AttendanceActionState
import com.madar.rep.app.data.db.MachineActionState
import com.madar.rep.app.data.db.MapPackState
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
