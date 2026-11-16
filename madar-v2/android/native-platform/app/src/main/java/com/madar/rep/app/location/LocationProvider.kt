package com.madar.rep.app.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.GeoPolicy
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resume

sealed interface LocationResult {
    data class Success(val point: GeoPoint, val gpsEnabled: Boolean) : LocationResult
    data object PermissionDenied : LocationResult
    data object ProvidersDisabled : LocationResult
    data object Timeout : LocationResult
    data class Failure(val message: String) : LocationResult
}

/**
 * Uses Android's LocationManager only. There is intentionally no Play Services
 * dependency: the app must remain usable on de-Googled/builds without GMS.
 */
class LocationProvider(private val context: Context) {
    private val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val mutex = Mutex()

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun isGpsEnabled(): Boolean = runCatching { manager.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false)

    fun isNetworkEnabled(): Boolean = runCatching { manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }.getOrDefault(false)

    fun lastKnown(): GeoPoint? {
        if (!hasPermission()) return null
        val candidates = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER)
            .mapNotNull { provider ->
                val location = try {
                    manager.getLastKnownLocation(provider)
                } catch (_: SecurityException) {
                    null
                }
                location?.let { provider to it }
            }
        val fresh = candidates
            .filter { (_, location) -> System.currentTimeMillis() - location.time in 0..GeoPolicy.MAX_FIX_AGE_MILLIS }
            .minByOrNull { (_, location) -> location.accuracy }
        return fresh?.let { (provider, location) -> location.toGeoPoint(provider) }
    }

    suspend fun currentFix(timeoutMillis: Long = 25_000L): LocationResult = mutex.withLock {
        if (!hasPermission()) return@withLock LocationResult.PermissionDenied
        val gpsEnabled = isGpsEnabled()
        val networkEnabled = isNetworkEnabled()
        if (!gpsEnabled && !networkEnabled) return@withLock LocationResult.ProvidersDisabled

        val hasFine = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val providers = buildList {
            if (hasFine && gpsEnabled) add(LocationManager.GPS_PROVIDER)
            if (networkEnabled) add(LocationManager.NETWORK_PROVIDER)
        }
        if (providers.isEmpty()) return@withLock LocationResult.ProvidersDisabled

        val lastKnown = lastKnown()
        if (lastKnown != null && !lastKnown.isApproximate) {
            return@withLock LocationResult.Success(lastKnown, gpsEnabled)
        }

        return@withLock suspendCancellableCoroutine { continuation ->
            val handler = Handler(Looper.getMainLooper())
            var best: GeoPoint? = lastKnown
            var finished = false
            lateinit var listener: LocationListener

            fun finish(result: LocationResult) {
                if (finished) return
                finished = true
                runCatching { manager.removeUpdates(listener) }
                handler.removeCallbacksAndMessages(null)
                if (continuation.isActive) continuation.resume(result)
            }

            listener = object : LocationListener {
                override fun onLocationChanged(location: Location) {
                    val candidate = location.toGeoPoint(location.provider ?: "unknown")
                    if (best == null || candidate.accuracyMeters < best!!.accuracyMeters) best = candidate
                    if (candidate.accuracyMeters <= GeoPolicy.MAX_ACCURACY_METERS &&
                        candidate.isFresh(System.currentTimeMillis())
                    ) {
                        finish(LocationResult.Success(candidate, gpsEnabled))
                    }
                }

                @Deprecated("Deprecated in API 29")
                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

                override fun onProviderEnabled(provider: String) = Unit

                override fun onProviderDisabled(provider: String) {
                    if (provider == LocationManager.GPS_PROVIDER && !isNetworkEnabled()) {
                        finish(LocationResult.ProvidersDisabled)
                    }
                }
            }

            try {
                for (provider in providers) {
                    manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
                }
            } catch (error: SecurityException) {
                finish(LocationResult.PermissionDenied)
                return@suspendCancellableCoroutine
            } catch (error: Exception) {
                finish(LocationResult.Failure(error.message ?: "تعذر تشغيل مزود الموقع"))
                return@suspendCancellableCoroutine
            }

            handler.postDelayed({
                val value = best
                finish(
                    if (value != null) LocationResult.Success(value, gpsEnabled)
                    else LocationResult.Timeout
                )
            }, timeoutMillis)

            continuation.invokeOnCancellation {
                handler.post {
                    runCatching { manager.removeUpdates(listener) }
                }
            }
        }
    }

    private fun Location.toGeoPoint(providerName: String): GeoPoint {
        val mocked = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            isMock
        } else {
            @Suppress("DEPRECATION")
            isFromMockProvider
        }
        return GeoPoint(
            latitude = latitude,
            longitude = longitude,
            accuracyMeters = if (hasAccuracy()) accuracy else Float.MAX_VALUE,
            capturedAtMillis = time,
            provider = providerName,
            isMock = mocked,
        )
    }
}
