package com.madar.rep.app.core

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

data class GeoPoint(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val capturedAtMillis: Long,
    val provider: String? = null,
    val isMock: Boolean = false,
) {
    fun isFresh(nowMillis: Long, maxAgeMillis: Long = 30_000L): Boolean =
        nowMillis - capturedAtMillis in 0..maxAgeMillis

    val isApproximate: Boolean get() = accuracyMeters > GeoPolicy.MAX_ACCURACY_METERS
}

sealed interface LocationDecision {
    data object Valid : LocationDecision
    data object InvalidCoordinates : LocationDecision
    data object Missing : LocationDecision
    data object Mocked : LocationDecision
    data class Invalid(val reason: String) : LocationDecision
    data class Stale(val ageMillis: Long) : LocationDecision
    data class Inaccurate(val accuracyMeters: Float) : LocationDecision
    data class Outside(
        val distanceMeters: Double,
        val effectiveDistanceMeters: Double,
        val allowedRadiusMeters: Double,
    ) : LocationDecision
}

object GeoPolicy {
    const val MAX_FIX_AGE_MILLIS = 300_000L
    const val MAX_ACCURACY_METERS = 250f
    const val REJECTION_COMPROMISED_ENVIRONMENT = "تم رفض تسجيل الموقع: تم اكتشاف بيئة نظام غير موثوقة أو أداة تزييف موقع"

    val COMMON_ROOT_PATHS: List<String> = listOf(
        "/system/bin/su",
        "/system/xbin/su",
        "/sbin/su",
        "/data/local/xbin/su",
        "/system/app/Superuser.apk",
    )

    fun isEnvironmentCompromised(
        rootPaths: List<String> = COMMON_ROOT_PATHS,
        buildTags: String? = try { android.os.Build.TAGS } catch (_: Throwable) { null },
    ): Boolean {
        if (buildTags != null && buildTags.contains("test-keys")) return true
        for (path in rootPaths) {
            try {
                if (java.io.File(path).exists()) return true
            } catch (_: Throwable) {
                // Ignore access errors on individual paths
            }
        }
        return false
    }

    /** The server uses the same effective-distance rule: distance minus reported accuracy. */
    fun evaluate(
        point: GeoPoint?,
        machineLatitude: Double?,
        machineLongitude: Double?,
        radiusMeters: Double = 50.0,
        nowMillis: Long = System.currentTimeMillis(),
        maxAgeMillis: Long = MAX_FIX_AGE_MILLIS,
        maxAccuracyMeters: Float = MAX_ACCURACY_METERS,
        environmentCompromised: Boolean = isEnvironmentCompromised(),
    ): LocationDecision {
        if (point == null) return LocationDecision.Missing
        if (environmentCompromised) {
            return LocationDecision.Invalid(REJECTION_COMPROMISED_ENVIRONMENT)
        }
        if (!point.latitude.isFinite() || point.latitude !in -90.0..90.0 ||
            !point.longitude.isFinite() || point.longitude !in -180.0..180.0 ||
            (machineLatitude == null) != (machineLongitude == null) ||
            (machineLatitude != null && (!machineLatitude.isFinite() || machineLatitude !in -90.0..90.0)) ||
            (machineLongitude != null && (!machineLongitude.isFinite() || machineLongitude !in -180.0..180.0)) ||
            !radiusMeters.isFinite() || radiusMeters < 0 || maxAgeMillis < 0 ||
            !maxAccuracyMeters.isFinite() || maxAccuracyMeters <= 0f) return LocationDecision.InvalidCoordinates
        if (point.isMock) return LocationDecision.Mocked
        if (!validCoordinates(point.latitude, point.longitude)) {
            return LocationDecision.Invalid("موقع GPS خارج النطاق الجغرافي الصحيح.")
        }
        if (!maxAccuracyMeters.isFinite() || maxAccuracyMeters <= 0f || maxAgeMillis <= 0L) {
            return LocationDecision.Invalid("سياسة دقة/عمر الموقع غير صالحة.")
        }
        val age = nowMillis - point.capturedAtMillis
        if (age < -60_000L || age > maxAgeMillis) return LocationDecision.Stale(age)
        if (!point.accuracyMeters.isFinite() || point.accuracyMeters < 0f || point.accuracyMeters > maxAccuracyMeters) {
            return LocationDecision.Inaccurate(point.accuracyMeters)
        }
        if ((machineLatitude == null) != (machineLongitude == null)) {
            return LocationDecision.Invalid("إحداثيات الماكينة غير مكتملة.")
        }
        if (machineLatitude != null && machineLongitude != null &&
            !validCoordinates(machineLatitude, machineLongitude)
        ) {
            return LocationDecision.Invalid("إحداثيات الماكينة غير صالحة.")
        }
        if (!radiusMeters.isFinite() || radiusMeters <= 0.0) {
            return LocationDecision.Invalid("نطاق الماكينة غير صالح.")
        }
        if (machineLatitude != null && machineLongitude != null) {
            val distance = distanceMeters(point.latitude, point.longitude, machineLatitude, machineLongitude)
            val effective = max(0.0, distance - point.accuracyMeters.toDouble())
            if (effective > radiusMeters) {
                return LocationDecision.Outside(distance, effective, radiusMeters)
            }
        }
        return LocationDecision.Valid
    }

    private fun validCoordinates(latitude: Double, longitude: Double): Boolean =
        latitude.isFinite() && longitude.isFinite() && latitude in -90.0..90.0 && longitude in -180.0..180.0

    /** Equirectangular approximation is not used; haversine matches the server. */
    fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val radius = 6_371_000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        return radius * 2 * asin(min(1.0, sqrt(a)))
    }
}
