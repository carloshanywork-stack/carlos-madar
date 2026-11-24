package com.madar.rep.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.madar.rep.app.BuildConfig
import com.madar.rep.app.core.ServerClockTracker
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun DiagnosticScreen(
    vm: MadarViewModel,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val diagnostics = vm.diagnostics
    val locationProvider = vm.locationProvider
    val installationId = vm.installationId

    var sendingHeartbeat by remember { mutableStateOf(false) }
    var heartbeatMessage by remember { mutableStateOf<String?>(null) }
    var heartbeatSuccess by remember { mutableStateOf<Boolean?>(null) }

    val hasFine = locationProvider.hasFinePermission()
    val hasCoarse = locationProvider.hasCoarsePermission()
    val gpsEnabled = locationProvider.isGpsEnabled()
    val networkEnabled = locationProvider.isNetworkEnabled()
    val isSkewSuspicious = ServerClockTracker.isSkewSuspicious()
    val skewText = ServerClockTracker.skewDescriptionArabic()

    Scaffold(
        topBar = {
            MadarTopBar(
                title = "تشخيص الجهاز والنظام",
                subtitle = "حالة البيئة والموقع والتوقيت (يعمل بدون إنترنت)",
                onBack = onBack,
                actions = {
                    IconButton(onClick = {
                        val shareIntent = Intent(Intent.ACTION_SEND).apply {
                            type = "text/plain"
                            putExtra(Intent.EXTRA_TEXT, diagnostics.generateShareableSummary())
                            putExtra(Intent.EXTRA_SUBJECT, "تقرير تشخيص تطبيق مدار")
                        }
                        context.startActivity(Intent.createChooser(shareIntent, "مشاركة تقرير التشخيص"))
                    }) {
                        Icon(Icons.Default.Share, contentDescription = "مشاركة التقرير")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Heartbeat feedback message if present
            if (heartbeatMessage != null) {
                InlineMessage(
                    text = heartbeatMessage!!,
                    tone = if (heartbeatSuccess == true) MessageTone.Success else MessageTone.Error
                )
            }

            // 1. Device and Installation Card
            SectionCard(
                title = "معلومات الجهاز والتطبيق",
                subtitle = "هوية نسخة التثبيت الحالية ومواصفات النظام"
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("كود التثبيت (Installation ID)", fontSize = 12.sp, color = Color.Gray)
                            Text(
                                text = installationId,
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        IconButton(onClick = {
                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                            clipboard.setPrimaryClip(ClipData.newPlainText("Installation ID", installationId))
                            Toast.makeText(context, "تم نسخ كود التثبيت", Toast.LENGTH_SHORT).show()
                        }) {
                            Icon(Icons.Default.ContentCopy, contentDescription = "نسخ", modifier = Modifier.size(18.dp))
                        }
                    }

                    InfoRow("إصدار تطبيق مدار", "${BuildConfig.VERSION_NAME} (بناء ${BuildConfig.VERSION_CODE})")
                    InfoRow("طراز الهاتف والشركة", "${Build.MANUFACTURER} ${Build.MODEL}")
                    InfoRow("نظام أندرويد", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
                }
            }

            // 2. Clock Synchronization Card
            SectionCard(
                title = "مزامنة التوقيت مع الخادم",
                subtitle = "الخادم يرفض اعتماد المواقع إذا كان فارق التوقيت كبيراً"
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    InfoRow("حالة التوقيت", skewText, emphasize = isSkewSuspicious)

                    if (isSkewSuspicious) {
                        InlineMessage(
                            text = "تحذير: ساعة الهاتف غير مضبوطة بدقة مقارنة بتوقيت الخادم. لتجنب رفض اعتماد المواقع، يرجى تفعيل ضبط التاريخ والوقت التلقائي.",
                            tone = MessageTone.Warning
                        )
                        Button(
                            onClick = {
                                runCatching {
                                    context.startActivity(Intent(Settings.ACTION_DATE_SETTINGS))
                                }.onFailure {
                                    Toast.makeText(context, "تعذر فتح إعدادات التاريخ والوقت", Toast.LENGTH_SHORT).show()
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Icon(Icons.Default.AccessTime, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("فتح إعدادات التاريخ والوقت")
                        }
                    }
                }
            }

            // 3. Location and Permissions Card
            SectionCard(
                title = "حالة خدمات وأذونات الموقع",
                subtitle = "المتطلبات الإلزامية لاعتماد الماكينات والتسجيل الجغرافي"
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    InfoRow(
                        "إذن الموقع الدقيق (Fine Location)",
                        if (hasFine) "ممنوح ✓" else "غير ممنوح ✗",
                        emphasize = !hasFine
                    )
                    InfoRow(
                        "إذن الموقع التقريبي (Coarse Location)",
                        if (hasCoarse) "ممنوح ✓" else "غير ممنوح ✗"
                    )
                    InfoRow(
                        "خدمة GPS (الأقمار الصناعية)",
                        if (gpsEnabled) "مفعلة ✓" else "معطلة ✗",
                        emphasize = !gpsEnabled
                    )
                    InfoRow(
                        "خدمة Network (الأبراج والواي فاي)",
                        if (networkEnabled) "مفعلة ✓" else "معطلة ✗"
                    )

                    if (!gpsEnabled) {
                        OutlinedButton(
                            onClick = {
                                runCatching {
                                    context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                                }.onFailure {
                                    Toast.makeText(context, "تعذر فتح إعدادات الموقع", Toast.LENGTH_SHORT).show()
                                }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Icon(Icons.Default.LocationOn, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("تفعيل خدمة الموقع (GPS)")
                        }
                    }
                }
            }

            // 4. Last Location Attempt Card
            SectionCard(
                title = "آخر محاولة التقاط موقع",
                subtitle = "سجل الفحص الأخير للإشارة"
            ) {
                val dateFmt = remember { SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()) }
                val timeStr = diagnostics.lastLocationTimestamp?.let { dateFmt.format(Date(it)) } ?: "لا توجد محاولة سابقة"

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    InfoRow("نتيجة المحاولة", diagnostics.lastLocationOutcome)
                    if (diagnostics.lastLocationAccuracy != null) {
                        InfoRow("دقة الإشارة الملتقطة", "${diagnostics.lastLocationAccuracy!!.toInt()} متر")
                    }
                    InfoRow("وقت المحاولة", timeStr)
                    if (!diagnostics.lastLocationError.isNullOrBlank()) {
                        InfoRow("رسالة الخطأ", diagnostics.lastLocationError!!, emphasize = true)
                    }
                }
            }

            // 5. Actions Card
            SectionCard(
                title = "الإجراءات والتقرير",
                subtitle = "إرسال البيانات التشخيصية للخادم للمساعدة والدعم"
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = {
                            sendingHeartbeat = true
                            heartbeatMessage = null
                            vm.sendDeviceHeartbeat { success, msg ->
                                sendingHeartbeat = false
                                heartbeatSuccess = success
                                heartbeatMessage = msg
                            }
                        },
                        enabled = !sendingHeartbeat,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        if (sendingHeartbeat) {
                            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                            Spacer(Modifier.width(8.dp))
                            Text("جارٍ إرسال التقرير التشخيصي…")
                        } else {
                            Icon(Icons.Default.Send, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text("إرسال تقرير تشخيصي للخادم")
                        }
                    }

                    OutlinedButton(
                        onClick = {
                            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, diagnostics.generateShareableSummary())
                                putExtra(Intent.EXTRA_SUBJECT, "تقرير تشخيص تطبيق مدار")
                            }
                            context.startActivity(Intent.createChooser(shareIntent, "مشاركة تقرير التشخيص"))
                        },
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Icon(Icons.Default.Share, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("مشاركة أو نسخ ملخص التقرير")
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
        }
    }
}
