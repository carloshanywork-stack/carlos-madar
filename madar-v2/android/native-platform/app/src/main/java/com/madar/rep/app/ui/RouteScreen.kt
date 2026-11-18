package com.madar.rep.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.AssignmentTurnedIn
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.LocationOff
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.api.RouteMachine
import com.madar.rep.app.data.api.RouteResponse
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import com.madar.rep.app.data.repo.RouteView
import com.madar.rep.app.ui.theme.MadarDanger
import com.madar.rep.app.ui.theme.MadarGold
import com.madar.rep.app.ui.theme.MadarInk
import com.madar.rep.app.ui.theme.MadarMuted
import com.madar.rep.app.ui.theme.MadarTeal
import com.madar.rep.app.ui.theme.MadarWarning

@Composable
fun RouteScreen(
    routeView: RouteView?,
    loading: Boolean,
    error: String?,
    openVisits: List<VisitEntity>,
    onRefresh: () -> Unit,
    onOpenMachine: (RouteMachine) -> Unit,
    onOpenVisit: (VisitEntity) -> Unit,
) {
    var query by rememberSaveable { mutableStateOf("") }
    var expanded by rememberSaveable { mutableStateOf<Set<String>>(emptySet()) }
    val route = routeView?.route
    val regions = route?.regions.orEmpty()

    LaunchedEffect(regions.map { it.regionName }) {
        if (expanded.isEmpty()) expanded = regions.map { it.regionName }.toSet()
    }

    LazyColumn(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            RouteSummaryCard(route, routeView?.fetchedAt, openVisits.size, loading, onRefresh)
        }

        if (routeView == null && loading) {
            item {
                Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
        }
        if (error != null) {
            item {
                InlineMessage(
                    "تعذر تحديث المسار: $error — تُعرض آخر نسخة محفوظة إن وُجدت.",
                    MessageTone.Warning,
                )
            }
        }

        if (openVisits.isNotEmpty()) {
            item {
                SectionTitle("متابعة العمل المحلي", "${openVisits.size} زيارة لم تُغلق بعد")
            }
            items(openVisits, key = { it.visitUuid }) { visit ->
                OpenVisitCard(visit, onClick = { onOpenVisit(visit) })
            }
        }

        if (route != null) {
            val completed = route.summary.completed
            val total = route.summary.totalMachines
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("مهام اليوم", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "$completed مكتملة من $total · ${route.summary.pendingReview} بانتظار المراجعة",
                        style = MaterialTheme.typography.bodySmall,
                        color = MadarMuted,
                    )
                }
            }
            item {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("ابحث بكود أو اسم الماكينة أو العميل") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                )
            }
        }

        if (route != null && regions.isEmpty()) {
            item {
                EmptyState(
                    "لا توجد ماكينات في مسار اليوم",
                    "سيظهر المسار هنا بعد أن تعتمده إدارة الصيانة.",
                )
            }
        }

        regions.forEach { region ->
            val filtered = region.machines.filter { machine ->
                query.isBlank() || listOf(
                    machine.machineCode,
                    machine.arabicName.orEmpty(),
                    machine.clientName.orEmpty(),
                    machine.areaName,
                    machine.address,
                ).any { it.contains(query, ignoreCase = true) }
            }
            if (filtered.isEmpty()) return@forEach
            val isExpanded = query.isNotBlank() || region.regionName in expanded
            item(key = "region-${region.regionName}") {
                RegionHeader(
                    name = region.regionName,
                    count = filtered.size,
                    expanded = isExpanded,
                    onToggle = {
                        expanded = if (region.regionName in expanded) expanded - region.regionName
                        else expanded + region.regionName
                    },
                )
            }
            if (isExpanded) {
                items(filtered, key = { "machine-${it.cardId}" }) { machine ->
                    val localVisit = openVisits.firstOrNull { it.cardId == machine.cardId }
                    MachineCard(
                        machine = machine,
                        localVisit = localVisit,
                        onClick = {
                            val waiting = localVisit
                            if (waiting != null) onOpenVisit(waiting) else onOpenMachine(machine)
                        },
                    )
                }
            }
        }

        item { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun RouteSummaryCard(
    route: RouteResponse?,
    fetchedAt: Long?,
    localOpen: Int,
    loading: Boolean,
    onRefresh: () -> Unit,
) {
    val summary = route?.summary
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("مسار اليوم", color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.titleLarge)
                    Text(
                        if (fetchedAt != null) "آخر تحديث ${MadarTime.displayTime(fetchedAt)}" else "لم يُحمّل المسار بعد",
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.75f),
                        fontSize = 12.sp,
                    )
                }
                if (loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(22.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                } else {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "تحديث", tint = MaterialTheme.colorScheme.onPrimary)
                    }
                }
            }
            if (summary != null) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "${summary.completed}",
                        color = MadarGold,
                        fontSize = 34.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        "من ${summary.totalMachines} ماكينة",
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.85f),
                        modifier = Modifier.padding(bottom = 6.dp),
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${summary.progress}%",
                        color = MaterialTheme.colorScheme.onPrimary,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(bottom = 6.dp),
                    )
                }
                LinearProgressIndicator(
                    progress = { (summary.progress.coerceIn(0, 100) / 100f) },
                    modifier = Modifier.fillMaxWidth().height(8.dp),
                    color = MadarGold,
                    trackColor = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.2f),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    SummaryChip("بانتظار التنفيذ", summary.pending.toString())
                    SummaryChip("مراجعة", summary.pendingReview.toString())
                    if (localOpen > 0) SummaryChip("محلي", localOpen.toString())
                }
            } else {
                Text(
                    "حدّث المسار بعد تسجيل الدخول لعرض مهام اليوم.",
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun SummaryChip(label: String, value: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(value, color = MaterialTheme.colorScheme.onPrimary, fontWeight = FontWeight.Bold)
        Text(label, color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f), fontSize = 11.sp)
    }
}

@Composable
private fun SectionTitle(title: String, subtitle: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MadarMuted)
    }
}

@Composable
private fun RegionHeader(name: String, count: Int, expanded: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
            contentDescription = null,
            tint = MadarTeal,
        )
        Spacer(Modifier.size(6.dp))
        Text(name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        Text("$count ماكينة", style = MaterialTheme.typography.bodySmall, color = MadarMuted)
    }
}

@Composable
private fun MachineCard(machine: RouteMachine, localVisit: VisitEntity?, onClick: () -> Unit) {
    val isDraft = localVisit != null && localVisit.state == VisitState.DRAFT
    val (status, tone) = when {
        isDraft -> "draft" to PillStyle(
            MadarTeal.copy(alpha = 0.2f),
            MadarTeal,
            "مسودة مفتوحة - صور قبل الصيانة جاهزة"
        )
        localVisit != null -> localVisit.state to visitPill(localVisit.state)
        machine.reviewStatus == "reshoot" -> "reshoot" to PillStyle(MadarDanger.copy(alpha = 0.12f), MadarDanger, "إعادة تصوير")
        machine.isCompleted -> "done" to PillStyle(MadarTeal.copy(alpha = 0.14f), MadarTeal, "مكتملة")
        machine.isSubmitted -> "review" to PillStyle(MadarGold.copy(alpha = 0.2f), MadarWarning, "بانتظار المشرف")
        machine.correctionPending -> "correction" to PillStyle(MadarGold.copy(alpha = 0.2f), MadarWarning, "تصحيح معلّق")
        machine.canVisit -> "open" to PillStyle(MadarTeal.copy(alpha = 0.1f), MadarTeal, "متاحة")
        else -> "blocked" to PillStyle(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant, "غير متاحة")
    }
    val enabled = localVisit != null || machine.canVisit
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    machine.machineCode,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                StatusPill(tone)
            }
            Text(
                machine.arabicName ?: machine.machineCode,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOf(machine.clientName, machine.areaName).filterNotNull().filter { it.isNotBlank() }
                    .joinToString(" · ").ifBlank { machine.address.ifBlank { "بدون عنوان" } },
                style = MaterialTheme.typography.bodySmall,
                color = MadarMuted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (machine.reviewNote != null && machine.reviewStatus == "reshoot") {
                InlineMessage("ملاحظة المشرف: ${machine.reviewNote}", MessageTone.Warning)
            }
            if (!machine.isLocationLocked) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.LocationOff, contentDescription = null, tint = MadarWarning, modifier = Modifier.size(15.dp))
                    Text(
                        "موقع الماكينة غير مثبت من الإدارة؛ لا يمكن اعتماد الزيارة.",
                        color = MadarWarning,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
            if (!machine.canVisit && localVisit == null) {
                Text(
                    when {
                        machine.isCompleted -> "تم اعتماد الزيارة بالفعل."
                        machine.isSubmitted -> "الزيارة بانتظار مراجعة المشرف."
                        machine.correctionPending -> "يوجد بلاغ تصحيح موقع معلّق."
                        else -> "الماكينة قيد تنفيذ مندوب آخر أو خارج مسارك."
                    },
                    color = MadarMuted,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (machine.workStatus == "in_progress" && machine.workOwnerId != null && localVisit == null) {
                Text("قيد التنفيذ من مندوب آخر", color = MadarWarning, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun OpenVisitCard(visit: VisitEntity, onClick: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                if (visit.state == com.madar.rep.app.data.db.VisitState.APPROVED) Icons.Default.CheckCircle else Icons.Default.AssignmentTurnedIn,
                contentDescription = null,
                tint = MadarTeal,
            )
            Spacer(Modifier.size(10.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("${visit.machineCode} · ${visit.machineName.ifBlank { visit.regionName }}", fontWeight = FontWeight.SemiBold)
                Text(
                    MadarTime.displayDateTime(visit.updatedAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                )
                if (visit.lastError != null) {
                    Text(visit.lastError, style = MaterialTheme.typography.bodySmall, color = MadarDanger, maxLines = 2)
                }
            }
            StatusPill(visitPill(visit.state))
        }
    }
}
