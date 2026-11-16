package com.madar.rep.app.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

@Composable
fun FirstLaunchPermissions() {
    val context = LocalContext.current
    val preferences = remember(context) {
        context.getSharedPreferences("madar.onboarding", android.content.Context.MODE_PRIVATE)
    }
    var showRationale by remember {
        mutableStateOf(!preferences.getBoolean(KEY_PROMPTED, false))
    }
    val manufacturer = remember { Build.MANUFACTURER.lowercase() }
    val isAggressiveOem = remember(manufacturer) {
        manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") ||
            manufacturer.contains("samsung") || manufacturer.contains("oppo") || manufacturer.contains("realme") ||
            manufacturer.contains("oneplus") || manufacturer.contains("huawei") || manufacturer.contains("vivo")
    }
    var showBatteryGuide by remember {
        mutableStateOf(!preferences.getBoolean(KEY_BATTERY_PROMPTED, false) && isAggressiveOem)
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        preferences.edit().putBoolean(KEY_PROMPTED, true).apply()
        showRationale = false
    }

    LaunchedEffect(Unit) {
        if (preferences.getBoolean(KEY_PROMPTED, false)) showRationale = false
        if (preferences.getBoolean(KEY_BATTERY_PROMPTED, false)) showBatteryGuide = false
    }

    if (showRationale) {
        AlertDialog(
            onDismissRequest = {
                preferences.edit().putBoolean(KEY_PROMPTED, true).apply()
                showRationale = false
            },
            title = { Text("إعداد التطبيق لأول مرة") },
            text = { Text("نحتاج إذن الكاميرا لتصوير أعمال الصيانة، وإذن الموقع لتأكيد مواقع العمل وتسجيل الحضور. يمكنك رفض أي إذن، وسيطلب التطبيق ما يلزمه عند استخدام الميزة لاحقًا.") },
            confirmButton = {
                TextButton(onClick = {
                    val permissions = buildList {
                        add(Manifest.permission.CAMERA)
                        add(Manifest.permission.ACCESS_FINE_LOCATION)
                        add(Manifest.permission.ACCESS_COARSE_LOCATION)
                        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
                            add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                        }
                    }.filter { permission ->
                        ContextCompat.checkSelfPermission(context, permission) != PackageManager.PERMISSION_GRANTED
                    }.toTypedArray()
                    if (permissions.isEmpty()) {
                        preferences.edit().putBoolean(KEY_PROMPTED, true).apply()
                        showRationale = false
                    } else {
                        permissionLauncher.launch(permissions)
                    }
                }) { Text("متابعة") }
            },
            dismissButton = {
                TextButton(onClick = {
                    preferences.edit().putBoolean(KEY_PROMPTED, true).apply()
                    showRationale = false
                }) { Text("لاحقًا") }
            },
        )
    } else if (showBatteryGuide) {
        val oemText = when {
            manufacturer.contains("xiaomi") || manufacturer.contains("redmi") || manufacturer.contains("poco") ->
                "لضمان استمرار تسجيل الحضور وتتبع مسار العمل أثناء النهار على أجهزة شاومي/ريدمي: يرجى تفعيل 'التشغيل التلقائي' (Auto-start) وضبط موفر البطارية على 'بلا قيود' (No restrictions)."
            manufacturer.contains("samsung") ->
                "لضمان استمرار تسجيل الحضور وتتبع مسار العمل على أجهزة سامسونج: يرجى إزالة التطبيق من قائمة 'التطبيقات في وضع السكون' وضبط استخدام البطارية على 'غير مقيد' (Unrestricted)."
            manufacturer.contains("oppo") || manufacturer.contains("realme") || manufacturer.contains("oneplus") ->
                "لضمان عمل التطبيق في الخلفية على أجهزة أوبو/ريلمي: يرجى تفعيل 'السماح بالنشاط في الخلفية' وتفعيل 'التشغيل التلقائي'."
            else ->
                "لضمان عمل التطبيق وتسجيل الحضور دون توقف: يرجى استثناء تطبيق MADAR من قيود توفير البطارية في إعدادات النظام."
        }
        AlertDialog(
            onDismissRequest = {
                preferences.edit().putBoolean(KEY_BATTERY_PROMPTED, true).apply()
                showBatteryGuide = false
            },
            title = { Text("تحسين عمل التطبيق في الخلفية") },
            text = { Text(oemText) },
            confirmButton = {
                TextButton(onClick = {
                    preferences.edit().putBoolean(KEY_BATTERY_PROMPTED, true).apply()
                    showBatteryGuide = false
                    try {
                        val intent = android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                        context.startActivity(intent)
                    } catch (_: Exception) {
                        try {
                            val intent = android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                data = android.net.Uri.parse("package:${context.packageName}")
                            }
                            context.startActivity(intent)
                        } catch (_: Exception) {}
                    }
                }) { Text("فتح الإعدادات") }
            },
            dismissButton = {
                TextButton(onClick = {
                    preferences.edit().putBoolean(KEY_BATTERY_PROMPTED, true).apply()
                    showBatteryGuide = false
                }) { Text("تم لاحقًا") }
            },
        )
    }
}

private const val KEY_PROMPTED = "first_launch_permissions_prompted"
private const val KEY_BATTERY_PROMPTED = "oem_battery_guide_prompted"
