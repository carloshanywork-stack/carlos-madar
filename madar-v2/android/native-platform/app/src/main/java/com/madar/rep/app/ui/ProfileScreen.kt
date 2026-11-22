package com.madar.rep.app.ui

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.madar.rep.app.BuildConfig
import com.madar.rep.app.data.api.ApkUpdateManager
import com.madar.rep.app.data.db.SupportReportState
import com.madar.rep.app.data.session.Session
import java.io.File

@Composable
fun ProfileScreen(
    vm: MadarViewModel,
    session: Session,
    onAttendance: () -> Unit,
    onNotifications: () -> Unit,
    onSync: () -> Unit,
    onSupport: () -> Unit,
    onMigration: () -> Unit,
    onLogout: () -> Unit,
) {
    val context = LocalContext.current
    val update by vm.apkUpdate.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.checkForApkUpdate() }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(session.fullName?.takeIf(String::isNotBlank) ?: session.username)
        Text("الإصدار الحالي: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
        Text("الحساب: ${session.username}")
        OutlinedButton(onClick = onAttendance, modifier = Modifier.fillMaxWidth()) { Text("الحضور والانصراف") }
        OutlinedButton(onClick = onNotifications, modifier = Modifier.fillMaxWidth()) { Text("الإشعارات") }
        OutlinedButton(onClick = onSync, modifier = Modifier.fillMaxWidth()) { Text("المزامنة وقائمة الرفع") }
        OutlinedButton(onClick = onSupport, modifier = Modifier.fillMaxWidth()) { Text("الدعم وبلاغات التطبيق") }
        OutlinedButton(onClick = onMigration, modifier = Modifier.fillMaxWidth()) { Text("استيراد البيانات المحلية القديمة") }

        Text("حالة الصلاحيات")
        PermissionLine("الموقع", hasAnyPermission(context, Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        PermissionLine("الكاميرا", hasPermission(context, Manifest.permission.CAMERA))
        if (Build.VERSION.SDK_INT >= 33) PermissionLine("الإشعارات", hasPermission(context, Manifest.permission.POST_NOTIFICATIONS))

        Text("تحديث التطبيق")
        Text("المثبت: ${update.currentVersion}")
        Text("المتاح: ${update.availableVersion ?: "جارٍ التحقق أو لا يوجد إصدار أحدث"}")
        if (!update.message.isNullOrBlank()) Text(update.message!!)
        if (update.busy) CircularProgressIndicator()
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = vm::checkForApkUpdate, enabled = !update.busy) { Text("التحقق من التحديث") }
            if (update.downloadedApk == null && update.availableVersion != null && update.updateAvailable) {
                Button(onClick = vm::downloadApkUpdate, enabled = !update.busy) { Text("تنزيل والتحقق") }
            }
            update.downloadedApk?.let { file ->
                Button(onClick = {
                    val activity = context as? Activity
                    if (activity == null) vm.showMessage("تعذر فتح مثبت Android من هذه الشاشة.")
                    else runCatching { ApkUpdateManager(context).install(activity, file) }
                        .onSuccess { opened -> if (!opened) vm.showMessage("اسمح بتثبيت تطبيقات غير معروفة لهذا التطبيق، ثم ارجع واضغط «تثبيت التحديث» مرة أخرى.") }
                        .onFailure { vm.showMessage("تعذر فتح مثبت Android: ${it.message ?: "خطأ غير معروف"}") }
                }) { Text("تثبيت التحديث") }
            }
        }
        Text("لن يبدأ التثبيت إلا بعد موافقتك في مثبت Android. لا يُحذف التطبيق الحالي ولا تُمسح بياناته.")
        Button(onClick = onLogout, modifier = Modifier.fillMaxWidth()) { Text("قفل التطبيق (للعمل دون اتصال)") }
    }
}

@Composable
private fun PermissionLine(label: String, granted: Boolean) {
    Text("$label: ${if (granted) "مسموح" else "غير مسموح"}")
}

private fun hasPermission(context: android.content.Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

private fun hasAnyPermission(context: android.content.Context, vararg permissions: String): Boolean =
    permissions.any { hasPermission(context, it) }

@Composable
fun SupportScreen(vm: MadarViewModel, screenName: String = "profile/support") {
    var description by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("bug") }
    var severity by rememberSaveable { mutableStateOf("normal") }
    var includeDiagnostics by rememberSaveable { mutableStateOf(false) }
    var screenshotUri by rememberSaveable { mutableStateOf<android.net.Uri?>(null) }
    val busy by vm.supportBusy.collectAsStateWithLifecycle()
    val message by vm.supportMessage.collectAsStateWithLifecycle()
    val reports by vm.supportReports.collectAsStateWithLifecycle()
    val screenshotPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { screenshotUri = it }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("إرسال بلاغ للدعم")
        Text("يُحفظ البلاغ محليًا أولًا، ثم يُرسل عند توفر الاتصال. إنشاء تذكرة GitHub يتطلب إجراء المدير.")
        ChoiceMenu("التصنيف", category, mapOf("bug" to "خلل", "sync" to "مزامنة", "location" to "موقع", "camera" to "كاميرا", "account" to "حساب", "other" to "أخرى")) { category = it }
        ChoiceMenu("الخطورة", severity, mapOf("low" to "منخفضة", "normal" to "عادية", "high" to "مرتفعة", "critical" to "حرجة")) { severity = it }
        OutlinedTextField(
            value = description,
            onValueChange = { description = it.take(8000) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("وصف المشكلة") }, minLines = 4, maxLines = 9,
        )
        Text("الشاشة الحالية: $screenName")
        OutlinedButton(onClick = { screenshotPicker.launch("image/*") }, modifier = Modifier.fillMaxWidth()) {
            Text(if (screenshotUri == null) "إرفاق لقطة شاشة اختيارية" else "تم اختيار صورة؛ اضغط لتغييرها")
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Switch(checked = includeDiagnostics, onCheckedChange = { includeDiagnostics = it })
            Text("إرفاق تشخيصات من سجل التطبيق المنقّح (اختياري)")
        }
        Button(
            onClick = { vm.submitSupportReport(description, category, severity, screenName, includeDiagnostics, screenshotUri) },
            enabled = !busy && description.trim().length >= 5,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (busy) CircularProgressIndicator() else Text("حفظ البلاغ وإضافته للمزامنة")
        }
        message?.takeIf { it.isNotBlank() }?.let { Text(it) }
        Text("بلاغات هذا الجهاز")
        reports.take(10).forEach { report ->
            val status = when (report.state) {
                SupportReportState.SENT -> "تم الإرسال"
                SupportReportState.NEEDS_LOGIN -> "بانتظار تسجيل الدخول"
                SupportReportState.NEEDS_REVIEW -> "يحتاج مراجعة"
                SupportReportState.RETRY_WAIT, SupportReportState.SYNCING -> "جارٍ المزامنة / إعادة المحاولة"
                else -> "في قائمة الانتظار"
            }
            Text("${report.reportUuid.take(8)} · $status${report.lastError?.let { " · $it" } ?: ""}")
        }
    }
}

@Composable
private fun ChoiceMenu(label: String, value: String, options: Map<String, String>, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(label)
        OutlinedButton(onClick = { expanded = true }) { Text(options[value] ?: value) }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (key, title) ->
                DropdownMenuItem(text = { Text(title) }, onClick = { onSelect(key); expanded = false })
            }
        }
    }
}
