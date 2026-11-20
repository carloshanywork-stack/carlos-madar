package com.madar.rep.app.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.madar.rep.app.ui.theme.MadarMuted
import com.madar.rep.app.ui.theme.MadarTeal

private const val KEY_PERMISSIONS_PROMPTED = "first_launch_permissions_prompted_v3"

fun getRequiredAppPermissions(): List<String> = buildList {
    add(Manifest.permission.ACCESS_FINE_LOCATION)
    add(Manifest.permission.ACCESS_COARSE_LOCATION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        add(Manifest.permission.POST_NOTIFICATIONS)
        add(Manifest.permission.READ_MEDIA_IMAGES)
    } else {
        add(Manifest.permission.READ_EXTERNAL_STORAGE)
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
    }
}

fun getMissingAppPermissions(context: Context): List<String> {
    val required = getRequiredAppPermissions()
    return required.filter { permission ->
        ContextCompat.checkSelfPermission(context, permission) != PackageManager.PERMISSION_GRANTED
    }
}

@Composable
fun FirstLaunchPermissions(onPermissionResult: () -> Unit) {
    val context = LocalContext.current
    val preferences = remember(context) {
        context.getSharedPreferences("madar.onboarding", Context.MODE_PRIVATE)
    }

    var showDialog by remember { mutableStateOf(false) }

    val permissionsLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        preferences.edit().putBoolean(KEY_PERMISSIONS_PROMPTED, true).apply()
        showDialog = false
        onPermissionResult()
    }

    LaunchedEffect(Unit) {
        val alreadyPrompted = preferences.getBoolean(KEY_PERMISSIONS_PROMPTED, false)
        val missing = getMissingAppPermissions(context)
        if (!alreadyPrompted && missing.isNotEmpty()) {
            showDialog = true
        }
    }

    if (showDialog) {
        AlertDialog(
            onDismissRequest = {
                preferences.edit().putBoolean(KEY_PERMISSIONS_PROMPTED, true).apply()
                showDialog = false
            },
            shape = RoundedCornerShape(20.dp),
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.Security,
                        contentDescription = null,
                        tint = MadarTeal,
                        modifier = Modifier.size(26.dp)
                    )
                    Spacer(Modifier.width(10.dp))
                    Text(
                        "صلاحيات العمل الميداني",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                }
            },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Text(
                        "مرحباً بك في نظام مدار الميداني. لضمان دقة توثيق الزيارات وسلاسة العمل، يرجى منح الصلاحيات الأساسية التالية:",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )

                    PermissionItemRow(
                        icon = Icons.Default.LocationOn,
                        title = "📍 الموقع الجغرافي (Location)",
                        description = "لتسجيل الحضور والانصراف، والتحقق من التواجد عند الماكينات، واستمرار التتبع أثناء العمل الميداني وعند تشغيل التطبيق في الخلفية."
                    )

                    PermissionItemRow(
                        icon = Icons.Default.Notifications,
                        title = "🔔 الإشعارات (Notifications)",
                        description = "لتنبيهك فور صدور تحديثات التطبيق الجديدة والمهام الميدانية الطارئة ومتابعة المزامنة."
                    )

                    PermissionItemRow(
                        icon = Icons.Default.PhotoLibrary,
                        title = "📁 الصور والملفات (Files / Media)",
                        description = "لإنشاء مجلد Pictures/MADAR وحفظ صور الماكينات بالتسلسل المعتمد لسهولة مراجعتها في المعرض واستعادتها دون فقدان."
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val missing = getMissingAppPermissions(context)
                        if (missing.isNotEmpty()) {
                            permissionsLauncher.launch(missing.toTypedArray())
                        } else {
                            preferences.edit().putBoolean(KEY_PERMISSIONS_PROMPTED, true).apply()
                            showDialog = false
                        }
                    },
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MadarTeal)
                ) {
                    Text("متابعة ومنح الصلاحيات", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        preferences.edit().putBoolean(KEY_PERMISSIONS_PROMPTED, true).apply()
                        showDialog = false
                    }
                ) {
                    Text("لاحقاً")
                }
            }
        )
    }
}

@Composable
private fun PermissionItemRow(
    icon: ImageVector,
    title: String,
    description: String,
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = MadarTeal,
                modifier = Modifier.size(24.dp).padding(top = 2.dp)
            )
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MadarMuted,
                    lineHeight = 18.sp
                )
            }
        }
    }
}
