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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AssignmentTurnedIn
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.LocationOff
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.graphics.Color
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
import com.madar.rep.app.ui.theme.FlexAmazonOrange
import com.madar.rep.app.ui.theme.FlexDarkHeader
import com.madar.rep.app.ui.theme.FlexGreenArrival
import com.madar.rep.app.ui.theme.FlexStopBadge
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
    onOpenMap: (() -> Unit)? = null,
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
            RouteSummaryCard(route, routeView?.fetchedAt, openVisits.size, loading, onRefresh, onOpenMap)
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

        var globalStopIndex = 0
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
                    val currentStop = globalStopIndex++
                    MachineCard(
                        stopIndex = currentStop,
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
    onOpenMap: (() -> Unit)? = null,
) {
    val summary = route?.summary
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = FlexDarkHeader,
        tonalElevation = 4.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("خط السير الميداني · اليوم", color = Color.White, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(
                        if (fetchedAt != null) "آخر مزامنة ${MadarTime.displayTime(fetchedAt)}" else "جاري تحميل بيانات خط السير...",
                        color = Color.White.copy(alpha = 0.7f),
                        fontSize = 12.sp,
                    )
                }
                if (loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(22.dp),
                        strokeWidth = 2.dp,
                        color = FlexAmazonOrange,
                    )
                } else {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "تحديث", tint = Color.White)
                    }
                }
            }

            if (summary != null) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "${summary.completed}",
                        color = FlexAmazonOrange,
                        fontSize = 36.sp,
                        fontWeight = FontWeight.ExtraBold,
                    )
                    Text(
                        "من ${summary.totalMachines} محطة مكتملة",
                        color = Color.White.copy(alpha = 0.85f),
                        modifier = Modifier.padding(bottom = 6.dp),
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        "${summary.progress}%",
                        color = FlexGreenArrival,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        modifier = Modifier.padding(bottom = 6.dp),
                    )
                }
                LinearProgressIndicator(
                    progress = { (summary.progress.coerceIn(0, 100) / 100f) },
                    modifier = Modifier.fillMaxWidth().height(8.dp),
                    color = FlexAmazonOrange,
                    trackColor = Color.White.copy(alpha = 0.15f),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    SummaryChip("بانتظار التنفيذ", summary.pending.toString())
                    SummaryChip("مراجعة المشرف", summary.pendingReview.toString())
                    if (localOpen > 0) SummaryChip("مسودة محلية", localOpen.toString())
                }

                // Amazon Flex View Switcher Toggle (List / Map)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color.White.copy(alpha = 0.10f), RoundedCornerShape(12.dp))
                        .padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = FlexAmazonOrange,
                        modifier = Modifier.weight(1f).height(38.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Icon(Icons.Default.AssignmentTurnedIn, contentDescription = null, tint = Color.Black, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("قائمة المحطات", color = Color.Black, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        }
                    }
                    if (onOpenMap != null) {
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = Color.Transparent,
                            modifier = Modifier
                                .weight(1f)
                                .height(38.dp)
                                .clickable { onOpenMap() }
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.Center
                            ) {
                                Icon(Icons.Default.Map, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.width(6.dp))
                                Text("عرض الخريطة", color = Color.White, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                            }
                        }
                    }
                }
            } else {
                Text(
                    "حدّث المسار بعد تسجيل الدخول لعرض مهام اليوم.",
                    color = Color.White.copy(alpha = 0.8f),
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
private fun MachineCard(stopIndex: Int, machine: RouteMachine, localVisit: VisitEntity?, onClick: () -> Unit) {
    val isDraft = localVisit != null && localVisit.state == VisitState.DRAFT
    val (status, tone) = when {
        isDraft -> "draft" to PillStyle(
            Color(0xFFFEF3C7),
            Color(0xFFD97706),
            "مسودة مفتوحة · صور قبل جاهزة"
        )
        localVisit != null -> localVisit.state to visitPill(localVisit.state)
        machine.reviewStatus == "reshoot" -> "reshoot" to PillStyle(MadarDanger.copy(alpha = 0.12f), MadarDanger, "إعادة تصوير")
        machine.isCompleted -> "done" to PillStyle(Color(0xFFD1FAE5), FlexGreenArrival, "مكتملة")
        machine.isSubmitted -> "review" to PillStyle(MadarGold.copy(alpha = 0.2f), MadarWarning, "بانتظار المشرف")
        machine.correctionPending -> "correction" to PillStyle(MadarGold.copy(alpha = 0.2f), MadarWarning, "تصحيح معلّق")
        machine.canVisit -> "open" to PillStyle(MadarTeal.copy(alpha = 0.1f), MadarTeal, "متاحة للزيارة")
        else -> "blocked" to PillStyle(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant, "غير متاحة")
    }
    val enabled = localVisit != null || machine.canVisit
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 2.dp,
        border = androidx.compose.foundation.BorderStroke(1.dp, if (isDraft) Color(0xFFF59E0B) else if (machine.isCompleted) FlexGreenArrival.copy(alpha = 0.3f) else Color(0xFFE2E8F0)),
        modifier = Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Amazon Flex Stop Badge
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .background(
                            if (machine.isCompleted) FlexGreenArrival else if (isDraft) Color(0xFFD97706) else FlexStopBadge,
                            CircleShape
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    if (machine.isCompleted) {
                        Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
                    } else {
                        Text(
                            "${stopIndex + 1}",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 15.sp,
                        )
                    }
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        machine.machineCode,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.ExtraBold,
                    )
                    Text(
                        machine.arabicName ?: machine.machineCode,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                StatusPill(tone)
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Place, contentDescription = null, tint = MadarMuted, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(4.dp))
                Text(
                    listOf(machine.clientName, machine.areaName).filterNotNull().filter { it.isNotBlank() }
                        .joinToString(" · ").ifBlank { machine.address.ifBlank { "بدون عنوان محدد" } },
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

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

            // High-Contrast Action CTA Button (Amazon Flex Style)
            if (isDraft) {
                Button(
                    onClick = onClick,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().height(42.dp)
                ) {
                    Text("استكمال المسودة (محفوظة محلياً)", fontWeight = FontWeight.Bold, color = Color.White)
                }
            } else if (machine.canVisit) {
                Button(
                    onClick = onClick,
                    colors = ButtonDefaults.buttonColors(containerColor = FlexGreenArrival),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth().height(42.dp)
                ) {
                    Text("بدء الزيارة الميدانية", fontWeight = FontWeight.Bold, color = Color.White)
                }
            } else if (machine.isCompleted) {
                Text("تمت زيارة الماكينة واعتمادها بنجاح ✅", color = FlexGreenArrival, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
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
