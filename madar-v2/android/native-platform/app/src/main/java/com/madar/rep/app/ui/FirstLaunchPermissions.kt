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
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        preferences.edit().putBoolean(KEY_PROMPTED, true).apply()
        showRationale = false
    }

    LaunchedEffect(Unit) {
        if (preferences.getBoolean(KEY_PROMPTED, false)) showRationale = false
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
    }
}

private const val KEY_PROMPTED = "first_launch_permissions_prompted"
