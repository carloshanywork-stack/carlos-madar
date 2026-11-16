package com.madar.rep.app.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/**
 * Representatives only need notification permission so the system can notify them of updates.
 * No blocking dialogs or unnecessary permissions are requested.
 */
@Composable
fun FirstLaunchPermissions() {
    val context = LocalContext.current
    val preferences = remember(context) {
        context.getSharedPreferences("madar.onboarding", android.content.Context.MODE_PRIVATE)
    }

    val notificationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) {
        preferences.edit().putBoolean(KEY_NOTIFICATIONS_PROMPTED, true).apply()
    }

    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val alreadyPrompted = preferences.getBoolean(KEY_NOTIFICATIONS_PROMPTED, false)
            val hasPermission = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED

            if (!alreadyPrompted && !hasPermission) {
                preferences.edit().putBoolean(KEY_NOTIFICATIONS_PROMPTED, true).apply()
                notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
}

private const val KEY_NOTIFICATIONS_PROMPTED = "notifications_prompted_v2"
