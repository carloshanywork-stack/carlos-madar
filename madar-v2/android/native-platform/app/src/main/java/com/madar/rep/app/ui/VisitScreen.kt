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
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Save
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
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.core.PhotoPolicy
import com.madar.rep.app.data.api.MaintenanceLine
import com.madar.rep.app.data.db.PhotoEntity
import com.madar.rep.app.data.db.VisitEntity
import com.madar.rep.app.data.db.VisitState
import com.madar.rep.app.data.repo.VisitForm
import com.madar.rep.app.domain.fsm.VisitFsm
import com.madar.rep.app.media.CameraActivity
import com.madar.rep.app.ui.theme.MadarDanger
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
    val machineLocationApprovalProgress by vm.machineLocationApprovalProgress.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(vm) {
        vm.messages.collect { message ->
            snackbarHostState.showSnackbar(message)
        }
    }

    var initialized by remember(visitUuid) { mutableStateOf(false) }
    var condition by remember(visitUuid) { mutableStateOf("") }
    var selectedReasons by remember(visitUuid) { mutableStateOf<Set<Long>>(emptySet()) }
    var quantities by remember(visitUuid) { mutableStateOf<Map<Long, Int>>(emptyMap()) }
    var notes by remember(visitUuid) { mutableStateOf("") }
    var previewPhoto by remember(visitUuid) { mutableStateOf<PhotoEntity?>(null) }
    var showLocationChange by rememberSaveable(visitUuid) { mutableStateOf(false) }

    val visit = detail?.visit
    val editable = visit?.state == VisitState.DRAFT
    val claimBlocked = visit != null && blockedCardId == visit.cardId

    LaunchedEffect(detail?.visit?.visitUuid) {
        val loaded = detail?.visit ?: return@LaunchedEffect
        if (!initialized) {
            condition = loaded.machineCondition
            selectedReasons = vm.decodeReasonIds(loaded).toSet()
            quantities = vm.decodeLines(loaded).associate { it.reasonId to it.quantity }
            notes = loaded.notes
            initialized = true
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        vm.updateBreadcrumbStartAllowed(foreground = true)
        if (grants[Manifest.permission.ACCESS_FINE_LOCATION] == true) {
            val current = visit
            if (current?.locationLocked == false) vm.approveFirstMachineLocation(current)
            else vm.refreshLocation()
        } else vm.showMessage("يلزم منح إذن الموقع الدقيق لتأكيد الوصول.")
    }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val error = result.data?.getStringExtra("error")
        if (error != null) {
            vm.showMessage(error)
        } else if (result.resultCode == android.app.Activity.RESULT_OK) {
            vm.refreshLocation()
        }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner, visitUuid) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> vm.startVisitLocationTracking()
                Lifecycle.Event.ON_PAUSE -> vm.stopVisitLocationTracking()
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            vm.stopVisitLocationTracking()
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
        visit?.arrivalConfirmedAt,
        location.point?.capturedAtMillis,
    ) {
        val loaded = visit
        if (loaded != null && loaded.state == VisitState.DRAFT && loaded.arrivalConfirmedAt != null) {
            vm.claimWork(loaded, location.point)
        }
    }

    fun currentForm(): VisitForm {
        val lines = selectedReasons
            .mapNotNull { id ->
                val reason = reasons.firstOrNull { it.id == id }
                quantities[id]?.takeIf { it > 0 && (reason == null || reason.countable != 0) }
                    ?.let { MaintenanceLine(id, it) }
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
        if (loaded.state == VisitState.DRAFT && initialized) {
            vm.saveDraft(loaded.visitUuid, currentForm()) { saved ->
                if (saved) {
                    vm.releaseWork(loaded)
                    onClose()
                }
            }
        } else onClose()
    }

    BackHandler(enabled = true) { if (!busy) closeScreen() }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
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

        val current = requireNotNull(detail)
        val progress = VisitFsm.evaluate(current.visit, current.before + current.after)
        val maintenanceEditable = editable && initialized && progress.isArrivalConfirmed && current.before.isNotEmpty() && !claimBlocked && !busy
        val missingQuantity = reasons.any { it.id in selectedReasons && it.countable != 0 && (quantities[it.id] ?: 0) == 0 }
        val maintenanceSaved = !missingQuantity && VisitFsm.maintenanceComplete(current.visit) &&
            condition == current.visit.machineCondition && selectedReasons == vm.decodeReasonIds(current.visit).toSet() &&
            quantities == vm.decodeLines(current.visit).associate { it.reasonId to it.quantity }
        val canSaveMaintenance = maintenanceEditable && !missingQuantity &&
            (condition == "working" || condition in listOf("faulty", "preventive_maintenance") && selectedReasons.isNotEmpty())
        val beforeBlockedReason = when {
            claimBlocked -> "التصوير متوقف بسبب تعارض حجز الماكينة. صورك محفوظة."
            !progress.isArrivalConfirmed -> "أكّد وصولك عند الماكينة لفتح التصوير."
            else -> null
        }
        val afterBlockedReason = beforeBlockedReason ?: when {
            current.before.isEmpty() -> "التقط صورة قبل الصيانة أولًا."
            !maintenanceSaved -> "احفظ بيانات الصيانة أولًا."
            else -> null
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
                MachineHeader(visit = current.visit, badge = visitPill(current.visit.state))
            }

            item {
                VisitProgressStepper(currentStep = progress.currentStep.stepNumber)
            }

            if (!editable) {
                item {
                    StatusExplanation(current.visit)
                }
            }
            if (claimBlocked) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        InlineMessage(
                            "تعذّر حجز الماكينة: ${blockedMessage ?: "يوجد تعارض على الماكينة أو تغيرت حالة المسار."} الصور التي التقطتها محفوظة. حدّث المسار أو اطلب من المشرف حل التعارض قبل استكمال التصوير.",
                            MessageTone.Error,
                        )
                        TextButton(onClick = { vm.retryMachineClaim(current.visit) }) {
                            Text("تحديث المسار وإعادة التحقق")
                        }
                    }
                }
            }

            if (editable) item {
                val currentVisit = current.visit
                GeofencedArrivalCard(
                    location = location,
                    visit = currentVisit,
                    isArrived = progress.isArrivalConfirmed,
                    approvingMachineLocation = machineLocationApprovalBusyId == currentVisit.cardId,
                    approvalProgressMessage = machineLocationApprovalProgress,
                    onConfirmArrival = { point -> vm.confirmArrival(currentVisit, point) },
                    onApproveMachine = {
                        if (vm.hasLocationPermission()) vm.approveFirstMachineLocation(currentVisit)
                        else permissionLauncher.launch(
                            arrayOf(
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                            )
                        )
                    },
                    onRefreshLocation = { vm.refreshLocation() },
                    onRequestLocationChange = { showLocationChange = true },
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
                PhotoSection(
                    title = "صور قبل الصيانة",
                    phase = "before",
                    photos = current.before,
                    editable = editable && !busy,
                    blockedReason = beforeBlockedReason,
                    onAdd = {
                        cameraLauncher.launch(
                            cameraIntent(
                                context = context,
                                visit = current.visit,
                                phase = "before",
                                existingCount = current.before.size,
                            )
                        )
                    },
                    onPreview = { previewPhoto = it },
                    onDelete = { vm.deletePhoto(it.id) },
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
                                    if (maintenanceEditable) {
                                        condition = value
                                        if (value == "working") {
                                            selectedReasons = emptySet()
                                            quantities = emptyMap()
                                        }
                                    }
                                },
                                enabled = maintenanceEditable,
                                label = { Text(label) },
                            )
                        }
                    }

                    if (condition in listOf("faulty", "preventive_maintenance")) {
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
                                            enabled = maintenanceEditable,
                                            onCheckedChange = { checked ->
                                                if (maintenanceEditable && (!checked || selectedReasons.size < 50)) {
                                                    selectedReasons = if (checked) {
                                                        selectedReasons + reason.id
                                                    } else {
                                                        selectedReasons - reason.id
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
                                                value = quantities[reason.id] ?: 0,
                                                enabled = maintenanceEditable,
                                                onChange = { quantities = quantities + (reason.id to it) },
                                            )
                                        }
                                    }
                                }
                            }
                        }
                        if (missingQuantity) {
                            InlineMessage("أدخل كمية صحيحة لكل سبب قابل للعدّ.", MessageTone.Error)
                        }
                    }

                    OutlinedTextField(
                        value = notes,
                        onValueChange = { if (maintenanceEditable) notes = it.take(10_000) },
                        label = { Text("ملاحظات المندوب") },
                        minLines = 3,
                        enabled = maintenanceEditable,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (editable && !maintenanceEditable) {
                        Text("أكّد الوصول والتقط صورة قبل الصيانة لفتح بيانات الصيانة.", style = MaterialTheme.typography.bodySmall)
                    }
                    if (maintenanceEditable && !maintenanceSaved) {
                        OutlinedButton(
                            onClick = { vm.saveDraft(visitUuid, currentForm()) },
                            enabled = canSaveMaintenance,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("حفظ بيانات الصيانة") }
                    }
                }
            }

            item {
                PhotoSection(
                    title = "صور بعد الصيانة",
                    phase = "after",
                    photos = current.after,
                    editable = editable && !busy,
                    blockedReason = afterBlockedReason,
                    onAdd = {
                        cameraLauncher.launch(
                            cameraIntent(
                                context = context,
                                visit = current.visit,
                                phase = "after",
                                existingCount = current.after.size,
                            )
                        )
                    },
                    onPreview = { previewPhoto = it },
                    onDelete = { vm.deletePhoto(it.id) },
                )
            }

            item {
                val beforeCount = current.before.size
                val afterCount = current.after.size
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
                            enabled = !busy && !claimBlocked && progress.isReadyToSubmit && maintenanceSaved,
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
                            onClick = {
                                vm.saveDraft(visitUuid, currentForm()) { ok ->
                                    if (ok) {
                                        vm.showMessage("تم حفظ مسودة الزيارة والصور بنجاح. يمكنك العودة إليها في أي وقت.")
                                    }
                                }
                            },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Icon(Icons.Default.Save, contentDescription = null, tint = MadarTeal)
                            Spacer(Modifier.width(8.dp))
                            Text("حفظ كمسودة", fontWeight = FontWeight.SemiBold)
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
    if (showLocationChange && visit != null) {
        LocationChangeDialog(vm = vm, visit = visit, onDismiss = { showLocationChange = false })
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
private fun QuantityStepper(value: Int, enabled: Boolean, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { onChange(value - 1) }, enabled = enabled && value > 1) {
            Icon(Icons.Default.Remove, contentDescription = "تقليل")
        }
        Text(if (value > 0) value.toString() else "—", fontWeight = FontWeight.Bold, modifier = Modifier.width(28.dp), textAlign = TextAlign.Center)
        IconButton(onClick = { onChange(value + 1) }, enabled = enabled && value < 9999) {
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
    blockedReason: String?,
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
                            PhotoThumbnail(photo.previewPath, modifier = Modifier.clickable { onPreview(photo) })
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
                                        tint = Color.White,
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
                            .clickable(enabled = blockedReason == null, onClick = onAdd),
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
                enabled = blockedReason == null,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
            ) {
                Icon(Icons.Default.CameraAlt, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(if (phase == "before") "تصوير قبل الصيانة" else "تصوير بعد الصيانة")
            }
        }
        if (editable && blockedReason != null) {
            Text(blockedReason, color = MadarMuted, style = MaterialTheme.typography.bodySmall)
        }
        if (photos.any { it.accuracy == null }) {
            InlineMessage("بعض الصور بلا موقع GPS؛ سيظل الاعتماد بحاجة إلى موقع زيارة صالح.", MessageTone.Warning)
        }
    }
}

private val PhotoEntity.previewPath: String
    get() = if (sha256.isBlank()) originalPath else processedPath

@Composable
private fun PhotoPreviewDialog(photo: PhotoEntity, onDismiss: () -> Unit) {
    val bitmap = remember(photo.previewPath) {
        runCatching {
            val options = BitmapFactory.Options().apply { inSampleSize = if (photo.sha256.isBlank()) 4 else 1 }
            BitmapFactory.decodeFile(photo.previewPath, options)?.asImageBitmap()
        }.getOrNull()
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
