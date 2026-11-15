package com.madar.rep.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.madar.rep.app.core.GeoPolicy
import com.madar.rep.app.data.db.VisitEntity

@Composable
fun LocationChangeDialog(vm: MadarViewModel, visit: VisitEntity, onDismiss: () -> Unit) {
    val location by vm.location.collectAsStateWithLifecycle()
    val state by vm.locationChange.collectAsStateWithLifecycle()
    var note by rememberSaveable(visit.cardId) { mutableStateOf("") }
    var evidenceUri by rememberSaveable(visit.cardId) { mutableStateOf<android.net.Uri?>(null) }
    val evidencePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { evidenceUri = it }

    LaunchedEffect(visit.cardId) {
        vm.refreshLocation()
        vm.refreshLocationChangeRequests()
    }

    val point = location.point
    val coordinatesValid = point != null && !point.isMock && point.accuracyMeters in 0f..100f &&
        System.currentTimeMillis() - point.capturedAtMillis in 0..300_000L
    val distance = if (point != null && visit.machineLatitude != null && visit.machineLongitude != null) {
        GeoPolicy.distanceMeters(point.latitude, point.longitude, visit.machineLatitude, visit.machineLongitude)
    } else null

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("طلب تغيير موقع الماكينة") },
        text = {
            Column(
                Modifier.fillMaxWidth().height(520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("الموقع المثبت: ${visit.machineLatitude}, ${visit.machineLongitude}")
                Text(if (point == null) "الموقع المقترح: غير متاح" else "الموقع المقترح: %.6f, %.6f".format(point.latitude, point.longitude))
                Text(if (point == null) "دقة GPS: —" else "الدقة: ±${point.accuracyMeters.toInt()} م · ${if (point.isMock) "محاكى" else "GPS غير محاكى"}")
                Text(if (distance == null) "المسافة: —" else "المسافة بين الموقعين: ${distance.toInt()} م")
                if (!coordinatesValid) Text("يلزم تثبيت GPS حديث غير محاكى بدقة 100 متر أو أفضل.")
                OutlinedButton(onClick = vm::refreshLocation, modifier = Modifier.fillMaxWidth()) { Text("تحديث قراءة GPS") }
                OutlinedTextField(
                    value = note, onValueChange = { note = it.take(2000) },
                    modifier = Modifier.fillMaxWidth(), label = { Text("ملاحظة للإدارة (اختياري)") },
                    minLines = 2, maxLines = 4,
                )
                OutlinedButton(onClick = { evidencePicker.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (evidenceUri == null) "إرفاق صورة دليل (اختياري)" else "تم اختيار صورة دليل")
                }
                Text("يلزم الاتصال لإرسال الطلب. عند انقطاع الاتصال يُعاد المحاولة بنفس معرّف الطلب.")
                state.message?.let { Text(it) }
                if (state.loading) CircularProgressIndicator()
                Text("سجل طلبات المواقع")
                val history = state.requests.filter { it.machineId == visitMachineId(vm, visit.cardId) }
                if (history.isEmpty()) Text("لا توجد طلبات سابقة لهذه الماكينة.")
                history.forEach { request ->
                    val status = when (request.status) {
                        "pending" -> "قيد المراجعة"
                        "approved" -> "مقبول"
                        "rejected" -> "مرفوض"
                        else -> request.status
                    }
                    Text("$status · ${request.createdAt}")
                    request.note?.takeIf(String::isNotBlank)?.let { Text("ملاحظة المندوب: $it") }
                    request.reviewNote?.takeIf(String::isNotBlank)?.let { Text("قرار الإدارة: $it") }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { vm.submitLocationChangeRequest(visit.cardId, note, evidenceUri) },
                enabled = coordinatesValid && !state.busy,
            ) {
                if (state.busy) CircularProgressIndicator() else Text("إرسال الطلب")
            }
        },
        dismissButton = { OutlinedButton(onClick = onDismiss) { Text("إغلاق") } },
    )
}

private fun visitMachineId(vm: MadarViewModel, cardId: Long): Long? =
    vm.route.value?.route?.regions?.asSequence()?.flatMap { it.machines.asSequence() }
        ?.firstOrNull { it.cardId == cardId }?.machineId
