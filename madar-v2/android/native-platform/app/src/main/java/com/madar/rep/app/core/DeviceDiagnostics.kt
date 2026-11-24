package com.madar.rep.app.core

import android.content.Context
import android.os.Build
import com.madar.rep.app.BuildConfig
import com.madar.rep.app.data.api.DeviceHeartbeatRequest
import com.madar.rep.app.location.LocationProvider
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Diagnostics engine collecting app environment, location state, and clock accuracy.
 *
 * Strictly adheres to privacy constraints:
 * - NO IMEI, serial numbers, MAC addresses, or phone hardware identifiers.
 * - NO user passwords, session tokens, or API secrets.
 * - NO representative photos, documents, or personal data.
 * - NO precise GPS coordinates (lat/lng) are exposed in diagnostics reports.
 */
class DeviceDiagnostics(
    private val context: Context,
    private val locationProvider: LocationProvider,
    private val installationManager: InstallationManager,
) {
    @Volatile
    var lastLocationOutcome: String = "لم يتم التقاط موقع مؤخراً"
        private set

    @Volatile
    var lastLocationAccuracy: Float? = null
        private set

    @Volatile
    var lastLocationTimestamp: Long? = null
        private set

    @Volatile
    var lastLocationError: String? = null
        private set

    fun recordLocationAttempt(outcome: String, accuracy: Float? = null, error: String? = null) {
        lastLocationOutcome = outcome
        lastLocationAccuracy = accuracy
        lastLocationTimestamp = System.currentTimeMillis()
        lastLocationError = error
        SupportDiagnostics.record("location", if (error != null) "fail" else "ok")
    }

    fun buildHeartbeatRequest(): DeviceHeartbeatRequest {
        val hasFine = locationProvider.hasFinePermission()
        val hasCoarse = locationProvider.hasCoarsePermission()
        val gpsEnabled = locationProvider.isGpsEnabled()
        val networkEnabled = locationProvider.isNetworkEnabled()

        val provider = when {
            gpsEnabled && hasFine -> "gps"
            networkEnabled -> "network"
            else -> "none"
        }

        return DeviceHeartbeatRequest(
            installationId = installationManager.installationId,
            appVersionName = BuildConfig.VERSION_NAME,
            appVersionCode = BuildConfig.VERSION_CODE,
            deviceManufacturer = Build.MANUFACTURER,
            deviceModel = Build.MODEL,
            osVersion = Build.VERSION.RELEASE ?: "unknown",
            apiLevel = Build.VERSION.SDK_INT,
            locationProvider = provider,
            hasFinePermission = hasFine,
            hasCoarsePermission = hasCoarse,
            isGpsEnabled = gpsEnabled,
            isNetworkEnabled = networkEnabled,
            clientTimestamp = System.currentTimeMillis(),
            lastLocationError = lastLocationError,
        )
    }

    fun generateShareableSummary(): String {
        val dateFmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault())
        val skewDesc = ServerClockTracker.skewDescriptionArabic()
        val lastAttemptDate = lastLocationTimestamp?.let { dateFmt.format(Date(it)) } ?: "—"

        return buildString {
            appendLine("=== تقرير تشخيص تطبيق مندوبي مدار ===")
            appendLine("كود التثبيت: ${installationManager.installationId}")
            appendLine("الإصدار: ${BuildConfig.VERSION_NAME} (بناء ${BuildConfig.VERSION_CODE})")
            appendLine("الجهاز: ${Build.MANUFACTURER} ${Build.MODEL}")
            appendLine("نظام التشغيل: Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            appendLine("---")
            appendLine("إذن الموقع الدقيق (Fine): ${if (locationProvider.hasFinePermission()) "ممنوح" else "مرفوض"}")
            appendLine("إذن الموقع التقريبي (Coarse): ${if (locationProvider.hasCoarsePermission()) "ممنوح" else "مرفوض"}")
            appendLine("خدمة GPS مفعلة: ${if (locationProvider.isGpsEnabled()) "نعم" else "لا"}")
            appendLine("خدمة Network مفعلة: ${if (locationProvider.isNetworkEnabled()) "نعم" else "لا"}")
            appendLine("---")
            appendLine("مزامنة التوقيت: $skewDesc")
            appendLine("نتيجة آخر محاولة موقع: $lastLocationOutcome")
            if (lastLocationAccuracy != null) {
                appendLine("دقة آخر موقع: ${lastLocationAccuracy!!.toInt()} متر")
            }
            appendLine("توقيت آخر محاولة: $lastAttemptDate")
            if (!lastLocationError.isNullOrBlank()) {
                appendLine("آخر خطأ مسجل: $lastLocationError")
            }
            appendLine("=====================================")
        }
    }
}
