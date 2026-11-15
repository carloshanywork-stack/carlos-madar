package com.madar.rep.app.ui

import android.Manifest
import android.content.Intent
import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.GeoPolicy
import com.madar.rep.app.core.LocationDecision
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.core.PhotoPolicy
import com.madar.rep.app.data.api.MaintenanceLine
import com.madar.rep.app.data.db.PhotoEntity
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import com.madar.rep.app.data.repo.VisitForm
import com.madar.rep.app.media.CameraActivity
import com.madar.rep.app.ui.theme.MadarDanger
import com.madar.rep.app.ui.theme.MadarGold
import com.madar.rep.app.ui.theme.MadarInk
import com.madar.rep.app.ui.theme.MadarMuted
import com.madar.rep.app.ui.theme.MadarTeal
import com.madar.rep.app.ui.theme.MadarWarning
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VisitScreen(
    vm: MadarViewModel,
    visitUuid: String,
    onClose: () -> Unit,
) {
    val detail by remember(visitUuid) { vm.visitDetail(visitUuid) }
        .collectAsStateWithLifecycle(initialValue = null)
    val reasons by vm.reasons.collectAsStateWithLifecycle()
    val location by vm.location.collectAsStateWithLifecycle()
    val busy by vm.visitBusy.collectAsStateWithLifecycle()
    val blockedCardId by vm.claimBlockedCardId.collectAsStateWithLifecycle()
    val blockedMessage by vm.claimBlockedMessage.collectAsStateWithLifecycle()
    val machineLocationApprovalBusyId by vm.machineLocationApprovalBusy.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var initialized by remember(visitUuid) { mutableStateOf(false) }
    var condition by remember(visitUuid) { mutableStateOf("working") }
    var selectedReasons by remember(visitUuid) { mutableStateOf<Set<Long>>(emptySet()) }
    var quantities by remember(visitUuid) { mutableStateOf<Map<Long, Int>>(emptyMap()) }
    var notes by remember(visitUuid) { mutableStateOf("") }
    var previewPhoto by remember(visitUuid) { mutableStateOf<PhotoEntity?>(null) }

    val visit = detail?.visit
    val editable = visit?.state == VisitState.DRAFT
    val claimBlocked = visit != null && blockedCardId == visit.cardId

    LaunchedEffect(detail?.visit?.visitUuid) {
        val loaded = detail?.visit ?: return@LaunchedEffect
        if (!initialized) {
            condition = loaded.machineCondition.ifBlank { "working" }
            selectedReasons = vm.decodeReasonIds(loaded).toSet()
            quantities = vm.decodeLines(loaded).associate { it.reasonId to it.quantity }
            notes = loaded.notes
            initialized = true
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val granted = grants[Manifest.permission.ACCESS_FINE_LOCATION] == true ||
            grants[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (granted) visit?.let(vm::approveFirstMachineLocation)
        else vm.showMessage("يلزم إذن الموقع لاعتماد الماكينة.")
    }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val error = result.data?.getStringExtra("error")
        if (error != null) {
            vm.showMessage(error)
        } else if (result.resultCode == android.app.Activity.RESULT_OK) {
            vm.refreshLocation()
        }
    }

    LaunchedEffect(visitUuid) {
        vm.refreshLocation()
    }

    val currentState by rememberUpdatedState(visit?.state)
    LaunchedEffect(visitUuid) {
        while (true) {
            delay(30_000)
            if (currentState == VisitState.DRAFT) vm.refreshLocation()
        }
    }

    LaunchedEffect(
        visit?.state,
        visit?.locationLocked,
        location.point?.capturedAtMillis,
    ) {
        val loaded = visit
        if (loaded != null && loaded.state == VisitState.DRAFT && loaded.locationLocked) {
            vm.claimWork(loaded, location.point)
        }
    }

    fun currentForm(): VisitForm {
        val lines = selectedReasons
            .mapNotNull { id ->
                val reason = reasons.firstOrNull { it.id == id } ?: return@mapNotNull null
                if (reason.countable != 0) MaintenanceLine(id, (quantities[id] ?: 1).coerceIn(1, 9999)) else null
            }
            .sortedBy { it.reasonId }
        return VisitForm(
            condition = condition,
            reasons = selectedReasons.toList().sorted(),
            lines = lines,
            notes = notes.take(10_000),
        )
    }

    fun closeScreen() {
        val loaded = visit
        if (loaded == null) {
            onClose()
            return
        }
        if (loaded.state == VisitState.DRAFT) {
            vm.saveDraft(loaded.visitUuid, currentForm()) { _ ->
                vm.releaseWork(loaded)
                onClose()
            }
        } else {
            onClose()
        }
    }

    BackHandler(enabled = true) { if (!busy) closeScreen() }

    Scaffold(
        topBar = {
            MadarTopBar(
                title = visit?.machineCode ?: "الزيارة",
                subtitle = when (visit?.state) {
                    VisitState.DRAFT -> "مسودة زيارة"
                    VisitState.QUEUED, VisitState.SYNCING -> "بانتظار المزامنة"
                    VisitState.PROCESSING -> "قيد معالجة الخادم"
                    VisitState.PENDING_REVIEW -> "بانتظار مراجعة المشرف"
                    VisitState.APPROVED -> "زيارة معتمدة"
                    VisitState.RESHOOT -> "مطلوب إعادة تصوير"
                    VisitState.NEEDS_REVIEW -> "تحتاج مراجعة"
                    VisitState.NEEDS_LOGIN -> "يلزم تسجيل الدخول"
                    else -> visit?.state.orEmpty()
                },
                onBack = { if (!busy) closeScreen() },
            )
        },
    ) { padding ->
        if (detail == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        LazyColumn(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
                .background(MaterialTheme.colorScheme.background),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                MachineHeader(visit = detail!!.visit, badge = visitPill(detail!!.visit.state))
            }

            if (!editable) {
                item {
                    StatusExplanation(detail!!.visit)
                }
            }
            if (claimBlocked) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        InlineMessage(
                            "تعذّر حجز الماكينة: ${blockedMessage ?: "يوجد تعارض على الماكينة أو تغيرت حالة المسار."} الصور التي التقطتها محفوظة. حدّث المسار أو اطلب من المشرف حل التعارض قبل استكمال التصوير.",
                            MessageTone.Error,
                        )
                        TextButton(onClick = { vm.retryMachineClaim(detail!!.visit) }) {
                            Text("تحديث المسار وإعادة التحقق")
                        }
                    }
                }
            }

            item {
                LocationCard(
                    location = location,
                    visit = detail!!.visit,
                    approvingMachineLocation = machineLocationApprovalBusyId == detail!!.visit.cardId,
                    onRefresh = { vm.refreshLocation() },
                    onApproveMachine = {
                        if (vm.hasLocationPermission()) vm.approveFirstMachineLocation(detail!!.visit)
                        else permissionLauncher.launch(arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                        ))
                    },
                    onRequestPermission = {
                        permissionLauncher.launch(
                            arrayOf(
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                            )
                        )
                    },
                )
            }

            item {
                SectionCard(title = "حالة الماكينة") {
                    Row(
                        Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        listOf(
                            "working" to "تعمل",
                            "faulty" to "عطل",
                            "preventive_maintenance" to "صيانة وقائية",
                        ).forEach { (value, label) ->
                            FilterChip(
                                selected = condition == value,
                                onClick = {
                                    if (editable) {
                                        condition = value
                                        if (value == "working") {
                                            selectedReasons = emptySet()
                                            quantities = emptyMap()
                                        }
                                    }
                                },
                                enabled = editable,
                                label = { Text(label) },
                            )
                        }
                    }

                    if (condition != "working") {
                        Text(
                            "اختر أسباب الصيانة المنفذة. الأسباب القابلة للعدّ تحتاج كمية صريحة.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MadarMuted,
                        )
                        if (reasons.isEmpty()) {
                            InlineMessage(
                                "لم تُحمّل أسباب الصيانة بعد. حدّث المسار عند توفر الشبكة.",
                                MessageTone.Warning,
                            )
                        }
                        reasons.forEach { reason ->
                            val selected = reason.id in selectedReasons
                            val countable = reason.countable != 0
                            Surface(
                                shape = RoundedCornerShape(14.dp),
                                color = if (selected) MadarTeal.copy(alpha = 0.09f) else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        androidx.compose.material3.Checkbox(
                                            checked = selected,
                                            enabled = editable,
                                            onCheckedChange = { checked ->
                                                if (editable) {
                                                    selectedReasons = if (checked) {
                                                        selectedReasons + reason.id
                                                    } else {
                                                        selectedReasons - reason.id
                                                    }
                                                    if (checked && countable) {
                                                        quantities = quantities + (reason.id to (quantities[reason.id] ?: 1))
                                                    }
                                                    if (!checked) quantities = quantities - reason.id
                                                }
                                            },
                                        )
                                        Column(Modifier.weight(1f)) {
                                            Text(reason.name, style = MaterialTheme.typography.bodyMedium)
                                            val meta = listOfNotNull(
                                                reason.category?.takeIf { it.isNotBlank() },
                                                if (countable) "قابل للعدّ${reason.unit?.let { " · $it" } ?: ""}" else null,
                                            ).joinToString(" · ")
                                            if (meta.isNotBlank()) {
                                                Text(meta, style = MaterialTheme.typography.bodySmall, color = MadarMuted)
                                            }
                                        }
                                        if (selected && countable) {
                                            QuantityStepper(
                                                value = quantities[reason.id] ?: 1,
                                                enabled = editable,
                                                onChange = { quantities = quantities + (reason.id to it) },
                                            )
                                        }
                                    }
                                }
                            }
                        }
                        if (selectedReasons.any { id ->
                                reasons.firstOrNull { it.id == id }?.countable != 0 &&
                                    (quantities[id] ?: 0) <= 0
                            }
                        ) {
                            InlineMessage("أدخل كمية صحيحة لكل سبب قابل للعدّ.", MessageTone.Error)
                        }
                    }

                    OutlinedTextField(
                        value = notes,
                        onValueChange = { if (editable) notes = it.take(10_000) },
                        label = { Text("ملاحظات المندوب") },
                        minLines = 3,
                        enabled = editable,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            item {
                PhotoSection(
                    title = "صور قبل الصيانة",
                    phase = "before",
                    photos = detail!!.before,
                    editable = editable,
                    blocked = claimBlocked,
                    onAdd = {
                        cameraLauncher.launch(
                            cameraIntent(
                                context = context,
                                visit = detail!!.visit,
                                phase = "before",
                                existingCount = detail!!.before.size,
                            )
                        )
                    },
                    onPreview = { previewPhoto = it },
                    onDelete = { vm.deletePhoto(it.id) },
                )
            }
            item {
                PhotoSection(
                    title = "صور بعد الصيانة",
                    phase = "after",
                    photos = detail!!.after,
                    editable = editable,
                    blocked = claimBlocked,
                    onAdd = {
                        cameraLauncher.launch(
                            cameraIntent(
                                context = context,
                                visit = detail!!.visit,
                                phase = "after",
                                existingCount = detail!!.after.size,
                            )
                        )
                    },
                    onPreview = { previewPhoto = it },
                    onDelete = { vm.deletePhoto(it.id) },
                )
            }

            item {
                val beforeCount = detail!!.before.size
                val afterCount = detail!!.after.size
                val countsReady = PhotoPolicy.validVisit(beforeCount, afterCount)
                InlineMessage(
                    when {
                        countsReady -> "الصور جاهزة: $beforeCount قبل و$afterCount بعد. الحد الأقصى ${PhotoPolicy.MAX_PER_PHASE} لكل مرحلة."
                        beforeCount == 0 || afterCount == 0 -> "كل مرحلة تحتاج صورة واحدة على الأقل. أضف الصور الناقصة."
                        else -> "عدد الصور يتجاوز الحد المسموح."
                    },
                    if (countsReady) MessageTone.Success else MessageTone.Warning,
                )
            }

            if (editable) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = {
                                vm.submitVisit(visitUuid, currentForm()) { success ->
                                    if (success) onClose()
                                }
                            },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().height(52.dp),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            if (busy) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary,
                                )
                                Spacer(Modifier.width(10.dp))
                                Text("جارٍ التحقق والإرسال…")
                            } else {
                                Icon(Icons.Default.CameraAlt, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text("اعتماد الزيارة وإرسالها للمزامنة", fontWeight = FontWeight.Bold)
                            }
                        }
                        OutlinedButton(
                            onClick = { vm.saveDraft(visitUuid, currentForm()) },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("حفظ المسودة دون إرسال")
                        }
                        Text(
                            "لن تُحذف الصور أو المسودة عند تعذر الموقع أو الشبكة. تبقى الزيارة في قائمة المزامنة حتى تأكيد الخادم.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MadarMuted,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            } else {
                item {
                    val retryable = visit?.state in setOf(
                        VisitState.NEEDS_REVIEW,
                        VisitState.NEEDS_LOGIN,
                        VisitState.RETRY_WAIT,
                        VisitState.FAILED,
                    )
                    if (retryable) {
                        OutlinedButton(
                            onClick = {
                                vm.retryVisit(visitUuid)
                                onClose()
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text("إعادة المحاولة الآن")
                        }
                    }
                }
            }

            item { Spacer(Modifier.height(24.dp)) }
        }
    }

    previewPhoto?.let { photo ->
        PhotoPreviewDialog(photo = photo, onDismiss = { previewPhoto = null })
    }
}

private fun cameraIntent(
    context: android.content.Context,
    visit: VisitEntity,
    phase: String,
    existingCount: Int,
): Intent = Intent(context, CameraActivity::class.java).apply {
    putExtra(CameraActivity.EXTRA_VISIT_UUID, visit.visitUuid)
    putExtra(CameraActivity.EXTRA_PHASE, phase)
    putExtra(CameraActivity.EXTRA_MACHINE_CODE, visit.machineCode)
    putExtra(CameraActivity.EXTRA_MACHINE_NAME, visit.machineName)
    putExtra(CameraActivity.EXTRA_EXISTING_COUNT, existingCount)
}

@Composable
private fun MachineHeader(visit: VisitEntity, badge: PillStyle) {
    Surface(
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    visit.machineCode,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                )
                StatusPill(badge)
            }
            Text(
                visit.machineName.ifBlank { "ماكينة ${visit.machineCode}" },
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                listOf(visit.clientName, visit.areaName, visit.regionName)
                    .filter { it.isNotBlank() }
                    .distinct()
                    .joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MadarMuted,
            )
            if (visit.address.isNotBlank()) {
                Text(visit.address, style = MaterialTheme.typography.bodySmall, color = MadarMuted)
            }
            if (!visit.contentHash.isNullOrBlank()) {
                Text(
                    "بصمة المحتوى: ${visit.contentHash.orEmpty().take(16)}…",
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                )
            }
        }
    }
}

@Composable
private fun StatusExplanation(visit: VisitEntity) {
    val tone = when (visit.state) {
        VisitState.APPROVED -> MessageTone.Success
        VisitState.PENDING_REVIEW, VisitState.PROCESSING, VisitState.QUEUED, VisitState.SYNCING -> MessageTone.Info
        else -> MessageTone.Warning
    }
    val text = when (visit.state) {
        VisitState.QUEUED, VisitState.SYNCING -> "الزيارة في قائمة المزامنة. الصور محفوظة ولن تُحذف قبل تأكيد الخادم."
        VisitState.PROCESSING -> "الخادم ما زال يعالج الزيارة. ستُعاد بنفس المعرّف حتى يصل التأكيد النهائي."
        VisitState.PENDING_REVIEW -> "أُرسلت الزيارة وتنتظر مراجعة المشرف."
        VisitState.APPROVED -> "تم اعتماد الزيارة من المشرف."
        VisitState.RESHOOT -> "طلب المشرف إعادة التصوير. راجع ملاحظة المشرف في المسار."
        VisitState.NEEDS_REVIEW -> "تحتاج الزيارة إلى مراجعة قبل إعادة الإرسال. البيانات والصور محفوظة."
        VisitState.NEEDS_LOGIN -> "انتهت الجلسة. سجّل الدخول ثم أعد المحاولة؛ البيانات محفوظة."
        else -> "الزيارة غير قابلة للتعديل في حالتها الحالية."
    }
    InlineMessage(text, tone)
    if (!visit.lastError.isNullOrBlank()) {
        Text(visit.lastError, style = MaterialTheme.typography.bodySmall, color = MadarDanger)
    }
}

@Composable
private fun LocationCard(
    location: LocationUiState,
    visit: VisitEntity,
    approvingMachineLocation: Boolean,
    onRefresh: () -> Unit,
    onApproveMachine: () -> Unit,
    onRequestPermission: () -> Unit,
) {
    SectionCard(
        title = if (visit.locationLocked) "موقع الاعتماد" else null,
        subtitle = if (visit.locationLocked) "يلزم موقع حديث بدقة 50 مترًا أو أفضل، مع احتساب هامش الدقة داخل نطاق الماكينة." else null,
    ) {
        if (!visit.locationLocked) {
            Button(
                onClick = onApproveMachine,
                enabled = !approvingMachineLocation,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (approvingMachineLocation) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("جارٍ اعتماد الماكينة…")
                } else {
                    Text("اعتماد الماكينة")
                }
            }
        } else {
            val point = location.point
            if (point == null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.LocationOn, contentDescription = null, tint = MadarMuted)
                    Text("لا توجد إشارة موقع محفوظة.", style = MaterialTheme.typography.bodySmall, color = MadarMuted)
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.LocationOn, contentDescription = null, tint = MadarTeal)
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "%.5f, %.5f · ±%d م".format(point.latitude, point.longitude, point.accuracyMeters.toInt()),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                Text(
                    "وقت الإشارة: ${MadarTime.displayTime(point.capturedAtMillis)} · المزود: ${point.provider ?: "غير معروف"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                )
                val decision = GeoPolicy.evaluate(
                    point,
                    visit.machineLatitude,
                    visit.machineLongitude,
                    visit.geofenceRadiusMeters,
                )
                val (decisionText, tone) = when (decision) {
                    LocationDecision.Valid -> "الموقع صالح للاعتماد داخل نطاق الماكينة." to MessageTone.Success
                    LocationDecision.InvalidCoordinates -> "إحداثيات الموقع غير صالحة؛ حدّث GPS ولا تعتمد القراءة الحالية." to MessageTone.Error
                    LocationDecision.Missing -> "لا يوجد موقع." to MessageTone.Error
                    LocationDecision.Mocked -> "الموقع مزيف من النظام ولا يمكن اعتماده." to MessageTone.Error
                    is LocationDecision.Invalid -> decision.reason to MessageTone.Error
                    is LocationDecision.Stale -> "الإشارة قديمة (${decision.ageMillis / 1000} ثانية)." to MessageTone.Warning
                    is LocationDecision.Inaccurate -> "الدقة ${decision.accuracyMeters.toInt()} مترًا ولا تكفي." to MessageTone.Warning
                    is LocationDecision.Outside -> "خارج النطاق: المسافة الفعالة ${decision.effectiveDistanceMeters.toInt()} مترًا والمسموح ${decision.allowedRadiusMeters.toInt()}." to MessageTone.Error
                }
                InlineMessage(decisionText, tone)
                if (point.accuracyMeters > GeoPolicy.MAX_ACCURACY_METERS) {
                    InlineMessage("الموقع تقريبي ويُعرض للاسترشاد فقط؛ لن يُستخدم لاعتماد الزيارة.", MessageTone.Warning)
                }
            }
            if (location.message != null) {
                InlineMessage(location.message, if (location.permissionDenied || location.providersDisabled) MessageTone.Error else MessageTone.Info)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onRefresh, enabled = !location.busy) {
                    if (location.busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    else Text("تحديث الموقع")
                }
                if (location.permissionDenied) Button(onClick = onRequestPermission) { Text("منح إذن الموقع") }
            }
            if (location.providersDisabled) InlineMessage("افتح إعدادات الجهاز وشغّل خدمة الموقع ثم أعد المحاولة.", MessageTone.Warning)
        }
    }
}

@Composable
private fun QuantityStepper(value: Int, enabled: Boolean, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { onChange((value - 1).coerceAtLeast(1)) }, enabled = enabled) {
            Icon(Icons.Default.Remove, contentDescription = "تقليل")
        }
        Text("$value", fontWeight = FontWeight.Bold, modifier = Modifier.width(28.dp), textAlign = TextAlign.Center)
        IconButton(onClick = { onChange((value + 1).coerceAtMost(9999)) }, enabled = enabled) {
            Icon(Icons.Default.Add, contentDescription = "زيادة")
        }
    }
}

@Composable
private fun PhotoSection(
    title: String,
    phase: String,
    photos: List<PhotoEntity>,
    editable: Boolean,
    blocked: Boolean,
    onAdd: () -> Unit,
    onPreview: (PhotoEntity) -> Unit,
    onDelete: (PhotoEntity) -> Unit,
) {
    SectionCard(
        title = title,
        subtitle = "الحد الأدنى صورة واحدة والحد الأقصى ${PhotoPolicy.MAX_PER_PHASE} صور.",
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${photos.size} / ${PhotoPolicy.MAX_PER_PHASE}",
                style = MaterialTheme.typography.titleMedium,
                color = if (photos.isEmpty()) MadarWarning else MadarTeal,
            )
            Spacer(Modifier.weight(1f))
            if (photos.isEmpty()) {
                Text("مطلوبة", color = MadarWarning, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (photos.isEmpty()) {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(
                    Modifier.padding(18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(Icons.Default.CameraAlt, contentDescription = null, tint = MadarMuted)
                    Text(
                        if (phase == "before") "لم تُلتقط صور قبل الصيانة بعد." else "لم تُلتقط صور بعد الصيانة بعد.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MadarMuted,
                    )
                }
            }
        } else {
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                photos.sortedBy { it.position }.forEach { photo ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Box {
                            PhotoThumbnail(photo.processedPath, modifier = Modifier.clickable { onPreview(photo) })
                            if (editable) {
                                IconButton(
                                    onClick = { onDelete(photo) },
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .size(28.dp)
                                        .background(MadarDanger, CircleShape),
                                ) {
                                    Icon(
                                        Icons.Default.DeleteOutline,
                                        contentDescription = "حذف",
                                        tint = androidx.compose.ui.graphics.Color.White,
                                        modifier = Modifier.size(17.dp),
                                    )
                                }
                            }
                        }
                        Text(
                            MadarTime.displayTime(photo.capturedAt),
                            style = MaterialTheme.typography.bodySmall,
                            color = MadarMuted,
                        )
                    }
                }
                if (editable && photos.size < PhotoPolicy.MAX_PER_PHASE) {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.primaryContainer,
                        modifier = Modifier
                            .size(86.dp)
                            .clickable(enabled = !blocked, onClick = onAdd),
                    ) {
                        Column(
                            Modifier.fillMaxSize(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Icon(Icons.Default.Add, contentDescription = null, tint = MadarTeal)
                            Text("إضافة", fontSize = 12.sp, color = MadarTeal)
                        }
                    }
                }
            }
        }
        if (editable && (photos.isEmpty() || photos.size < PhotoPolicy.MAX_PER_PHASE)) {
            Button(
                onClick = onAdd,
                enabled = !blocked,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
            ) {
                Icon(Icons.Default.CameraAlt, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(if (phase == "before") "تصوير قبل الصيانة" else "تصوير بعد الصيانة")
            }
        }
        if (blocked) {
            Text("التصوير متوقف مؤقتًا بسبب تعارض حجز الماكينة. صورك الحالية لم تُحذف.", color = MadarDanger, style = MaterialTheme.typography.bodySmall)
        }
        if (photos.any { it.accuracy == null }) {
            InlineMessage("بعض الصور بلا موقع GPS؛ سيظل الاعتماد بحاجة إلى موقع زيارة صالح.", MessageTone.Warning)
        }
    }
}

@Composable
private fun PhotoPreviewDialog(photo: PhotoEntity, onDismiss: () -> Unit) {
    val bitmap = remember(photo.processedPath) {
        runCatching { BitmapFactory.decodeFile(photo.processedPath)?.asImageBitmap() }.getOrNull()
    }
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.surface) {
            Column(
                Modifier
                    .padding(16.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (bitmap != null) {
                    Image(
                        bitmap,
                        contentDescription = "معاينة الصورة",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxWidth().height(360.dp).clip(RoundedCornerShape(12.dp)),
                    )
                }
                Text(
                    if (photo.phase == "before") "معاينة صورة قبل الصيانة" else "معاينة صورة بعد الصيانة",
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    photo.watermarkText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                )
                Text(
                    "الالتقاط: ${MadarTime.displayDateTime(photo.capturedAt)} · الحجم: ${formatBytes(photo.sizeBytes)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                )
                if (photo.sha256.isNotBlank()) {
                    Text("SHA-256: ${photo.sha256}", style = MaterialTheme.typography.bodySmall, color = MadarMuted)
                }
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.End)) { Text("إغلاق") }
            }
        }
    }
}
