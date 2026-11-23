package com.madar.rep.app.location

import android.Manifest
import android.annotation.SuppressLint
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
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.madar.rep.app.core.GeoPoint
import com.madar.rep.app.core.GeoPolicy
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

sealed interface LocationResult {
    data class Success(val point: GeoPoint, val gpsEnabled: Boolean) : LocationResult
    data object PermissionDenied : LocationResult
    data object ApproximateOnlyPermission : LocationResult
    data object ProvidersDisabled : LocationResult
    data object Timeout : LocationResult
    data class WeakSignal(val candidate: GeoPoint?, val accuracyMeters: Float) : LocationResult
    data class Failure(val message: String) : LocationResult
}

sealed interface VisitLocationStatus {
    data object Idle : VisitLocationStatus
    data object Searching : VisitLocationStatus
    data class Provisional(val point: GeoPoint) : VisitLocationStatus
    data class HighAccuracy(val point: GeoPoint) : VisitLocationStatus
    data object Disabled : VisitLocationStatus
    data object PermissionDenied : VisitLocationStatus
    data object ApproximateOnly : VisitLocationStatus
    data class WeakSignal(val lastCandidate: GeoPoint?, val accuracyMeters: Float) : VisitLocationStatus
}

/**
 * Resilient, dual-engine location provider for MADAR field representatives.
 *
 * Uses Google Play Services FusedLocationProviderClient when available for rapid
 * multi-source fix (WiFi/Cellular/GNSS). Seamlessly falls back to native Android
 * LocationManager without GMS (supporting de-Googled ROMs and offline field duty).
 *
 * Concurrency: Eliminates blocking mutexes in favor of shared in-flight request
 * deduplication. Lifecycle-bound visit tracking allows the card, camera, and approval
 * to share one warm, validated fix without redundant 7-25s hardware acquisition delays.
 */
class LocationProvider(private val context: Context) {
    private val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val playServicesAvailable: Boolean by lazy {
        runCatching {
            GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
        }.getOrDefault(false)
    }

    private val fusedClient: FusedLocationProviderClient? by lazy {
        if (playServicesAvailable) {
            runCatching { LocationServices.getFusedLocationProviderClient(context) }.getOrNull()
        } else null
    }

    private val latestFixRef = AtomicReference<GeoPoint?>(null)
    private val inFlightMutex = Mutex()
    private var inFlightDeferred: CompletableDeferred<LocationResult>? = null

    private val _visitStatus = MutableStateFlow<VisitLocationStatus>(VisitLocationStatus.Idle)
    val visitStatus: StateFlow<VisitLocationStatus> = _visitStatus.asStateFlow()

    private var visitTrackingActive = false
    private var visitTrackingRefCount = 0
    private var nativeVisitListener: LocationListener? = null
    private var fusedVisitCallback: LocationCallback? = null

    fun hasFinePermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun hasCoarsePermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun hasPermission(): Boolean = hasFinePermission() || hasCoarsePermission()

    fun isGpsEnabled(): Boolean = runCatching { manager.isProviderEnabled(LocationManager.GPS_PROVIDER) }.getOrDefault(false)

    fun isNetworkEnabled(): Boolean = runCatching { manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) }.getOrDefault(false)

    fun isAnyProviderEnabled(): Boolean = isGpsEnabled() || isNetworkEnabled()

    /**
     * Synchronously returns the most recent cached high-quality fix (< 30s, !isMock).
     * Guaranteed to never block the calling thread.
     */
    fun lastKnownValid(maxAgeMillis: Long = 30_000L): GeoPoint? {
        val now = System.currentTimeMillis()
        val inMemory = latestFixRef.get()
        if (inMemory != null && inMemory.isFresh(now, maxAgeMillis) && !inMemory.isMock) {
            return inMemory
        }
        val fromSystem = lastKnown()
        if (fromSystem != null && fromSystem.isFresh(now, maxAgeMillis) && !fromSystem.isMock) {
            latestFixRef.set(fromSystem)
            return fromSystem
        }
        return null
    }

    fun lastKnown(): GeoPoint? {
        if (!hasPermission()) return null
        val candidates = listOf(
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
            LocationManager.PASSIVE_PROVIDER
        ).mapNotNull { provider ->
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
        return fresh?.let { (provider, location) ->
            val point = location.toGeoPoint(provider)
            latestFixRef.set(point)
            point
        }
    }

    /**
     * Obtains a fresh location fix without sequential mutex bottlenecks.
     * Concurrent requests deduplicate onto a single in-flight hardware query.
     */
    suspend fun currentFix(timeoutMillis: Long = 15_000L): LocationResult {
        if (!hasPermission()) return LocationResult.PermissionDenied
        if (!hasFinePermission()) return LocationResult.ApproximateOnlyPermission
        if (!isAnyProviderEnabled()) return LocationResult.ProvidersDisabled

        val gpsEnabled = isGpsEnabled()
        val now = System.currentTimeMillis()

        // 1. Instant check: Do we already have an uncompromised high-accuracy fix?
        val cached = latestFixRef.get() ?: lastKnown()
        if (cached != null && cached.accuracyMeters <= 15f && cached.isFresh(now, 20_000L) && !cached.isMock) {
            return LocationResult.Success(cached, gpsEnabled)
        }

        // 2. Request deduplication: Join existing in-flight job if one is running
        var deferredToAwait: CompletableDeferred<LocationResult>? = null
        inFlightMutex.withLock {
            if (inFlightDeferred != null && inFlightDeferred!!.isActive) {
                deferredToAwait = inFlightDeferred
            } else {
                val newDeferred = CompletableDeferred<LocationResult>()
                inFlightDeferred = newDeferred
                deferredToAwait = newDeferred
                // Launch the hardware acquisition
                scope.launch {
                    val result = acquireHardwareFix(timeoutMillis, gpsEnabled)
                    newDeferred.complete(result)
                    inFlightMutex.withLock {
                        if (inFlightDeferred == newDeferred) {
                            inFlightDeferred = null
                        }
                    }
                }
            }
        }

        return deferredToAwait?.await() ?: LocationResult.Timeout
    }

    @SuppressLint("MissingPermission")
    private suspend fun acquireHardwareFix(timeoutMillis: Long, gpsEnabled: Boolean): LocationResult = withContext(Dispatchers.Main) {
        val client = fusedClient
        if (client != null && playServicesAvailable) {
            val fusedResult = acquireFusedFix(client, timeoutMillis, gpsEnabled)
            if (fusedResult !is LocationResult.Failure) {
                return@withContext fusedResult
            }
        }
        acquireNativeFix(timeoutMillis, gpsEnabled)
    }

    @SuppressLint("MissingPermission")
    private suspend fun acquireFusedFix(
        client: FusedLocationProviderClient,
        timeoutMillis: Long,
        gpsEnabled: Boolean
    ): LocationResult = withContext(Dispatchers.Main) {
        val deferred = CompletableDeferred<LocationResult>()
        val handler = Handler(Looper.getMainLooper())
        var bestCandidate: GeoPoint? = lastKnown()

        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L)
            .setMinUpdateIntervalMillis(500L)
            .setMaxUpdateDelayMillis(1500L)
            .build()

        val callback = object : LocationCallback() {
            override fun onLocationResult(locationResult: com.google.android.gms.location.LocationResult) {
                for (location in locationResult.locations) {
                    val point = location.toGeoPoint(location.provider ?: "fused")
                    latestFixRef.set(point)
                    if (bestCandidate == null || point.accuracyMeters < bestCandidate!!.accuracyMeters) {
                        bestCandidate = point
                    }
                    if (point.accuracyMeters <= 15f && !point.isMock) {
                        handler.removeCallbacksAndMessages(null)
                        runCatching { client.removeLocationUpdates(this) }
                        if (deferred.isActive) deferred.complete(LocationResult.Success(point, gpsEnabled))
                        return
                    }
                }
            }
        }

        val timeoutRunnable = Runnable {
            runCatching { client.removeLocationUpdates(callback) }
            val candidate = bestCandidate
            if (deferred.isActive) {
                if (candidate != null && !candidate.isMock && candidate.accuracyMeters <= GeoPolicy.MAX_ACCURACY_METERS) {
                    deferred.complete(LocationResult.Success(candidate, gpsEnabled))
                } else if (candidate != null) {
                    deferred.complete(LocationResult.WeakSignal(candidate, candidate.accuracyMeters))
                } else {
                    deferred.complete(LocationResult.Timeout)
                }
            }
        }

        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper())
            handler.postDelayed(timeoutRunnable, timeoutMillis)
        } catch (error: Exception) {
            handler.removeCallbacksAndMessages(null)
            return@withContext LocationResult.Failure(error.message ?: "فشل تشغيل محدد المواقع المدمج")
        }

        val result = deferred.await()
        handler.removeCallbacksAndMessages(null)
        runCatching { client.removeLocationUpdates(callback) }
        result
    }

    @SuppressLint("MissingPermission")
    private suspend fun acquireNativeFix(timeoutMillis: Long, gpsEnabled: Boolean): LocationResult = withContext(Dispatchers.Main) {
        val deferred = CompletableDeferred<LocationResult>()
        val handler = Handler(Looper.getMainLooper())
        var bestCandidate: GeoPoint? = lastKnown()

        val providers = buildList {
            if (hasFinePermission() && gpsEnabled) add(LocationManager.GPS_PROVIDER)
            if (isNetworkEnabled()) add(LocationManager.NETWORK_PROVIDER)
        }
        if (providers.isEmpty()) return@withContext LocationResult.ProvidersDisabled

        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                val candidate = location.toGeoPoint(location.provider ?: "native")
                latestFixRef.set(candidate)
                if (bestCandidate == null || candidate.accuracyMeters < bestCandidate!!.accuracyMeters) {
                    bestCandidate = candidate
                }
                // High precision fix threshold (<=15m) completes immediately
                if (candidate.accuracyMeters <= 15f && !candidate.isMock) {
                    handler.removeCallbacksAndMessages(null)
                    runCatching { manager.removeUpdates(this) }
                    if (deferred.isActive) deferred.complete(LocationResult.Success(candidate, gpsEnabled))
                }
            }

            @Deprecated("Deprecated in Java")
            @Suppress("DEPRECATION")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
            override fun onProviderEnabled(provider: String) = Unit
            override fun onProviderDisabled(provider: String) {
                if (provider == LocationManager.GPS_PROVIDER && !isNetworkEnabled()) {
                    handler.removeCallbacksAndMessages(null)
                    runCatching { manager.removeUpdates(this) }
                    if (deferred.isActive) deferred.complete(LocationResult.ProvidersDisabled)
                }
            }
        }

        val timeoutRunnable = Runnable {
            runCatching { manager.removeUpdates(listener) }
            val candidate = bestCandidate
            if (deferred.isActive) {
                if (candidate != null && !candidate.isMock && candidate.accuracyMeters <= GeoPolicy.MAX_ACCURACY_METERS) {
                    deferred.complete(LocationResult.Success(candidate, gpsEnabled))
                } else if (candidate != null) {
                    deferred.complete(LocationResult.WeakSignal(candidate, candidate.accuracyMeters))
                } else {
                    deferred.complete(LocationResult.Timeout)
                }
            }
        }

        try {
            for (provider in providers) {
                manager.requestLocationUpdates(provider, 1000L, 0f, listener, Looper.getMainLooper())
            }
            handler.postDelayed(timeoutRunnable, timeoutMillis)
        } catch (error: Exception) {
            handler.removeCallbacksAndMessages(null)
            return@withContext LocationResult.Failure(error.message ?: "تعذر تشغيل مزود الموقع")
        }

        val result = deferred.await()
        handler.removeCallbacksAndMessages(null)
        runCatching { manager.removeUpdates(listener) }
        result
    }

    /**
     * Starts continuous warm location tracking bound to the active visit card lifecycle.
     * Prevents cold acquisition delays when taking photos or approving machine locations.
     */
    @SuppressLint("MissingPermission")
    fun startVisitTracking() {
        visitTrackingRefCount++
        if (visitTrackingActive) return
        if (!hasPermission()) {
            _visitStatus.value = VisitLocationStatus.PermissionDenied
            return
        }
        if (!hasFinePermission()) {
            _visitStatus.value = VisitLocationStatus.ApproximateOnly
            return
        }
        if (!isAnyProviderEnabled()) {
            _visitStatus.value = VisitLocationStatus.Disabled
            return
        }

        visitTrackingActive = true
        _visitStatus.value = VisitLocationStatus.Searching

        // Check recent fix first
        val cached = lastKnownValid(20_000L)
        if (cached != null) {
            if (cached.accuracyMeters <= 15f) {
                _visitStatus.value = VisitLocationStatus.HighAccuracy(cached)
            } else {
                _visitStatus.value = VisitLocationStatus.Provisional(cached)
            }
        }

        val client = fusedClient
        if (client != null && playServicesAvailable) {
            val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 3000L)
                .setMinUpdateIntervalMillis(1500L)
                .build()
            val callback = object : LocationCallback() {
                override fun onLocationResult(result: com.google.android.gms.location.LocationResult) {
                    val location = result.lastLocation ?: return
                    val point = location.toGeoPoint(location.provider ?: "fused")
                    latestFixRef.set(point)
                    if (point.accuracyMeters <= 15f && !point.isMock) {
                        _visitStatus.value = VisitLocationStatus.HighAccuracy(point)
                    } else if (!point.isMock) {
                        _visitStatus.value = VisitLocationStatus.Provisional(point)
                    }
                }
            }
            fusedVisitCallback = callback
            runCatching { client.requestLocationUpdates(request, callback, Looper.getMainLooper()) }
            return
        }

        // Native fallback
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                val point = location.toGeoPoint(location.provider ?: "native")
                latestFixRef.set(point)
                if (point.accuracyMeters <= 15f && !point.isMock) {
                    _visitStatus.value = VisitLocationStatus.HighAccuracy(point)
                } else if (!point.isMock) {
                    _visitStatus.value = VisitLocationStatus.Provisional(point)
                }
            }
            override fun onProviderDisabled(provider: String) {
                if (!isAnyProviderEnabled()) _visitStatus.value = VisitLocationStatus.Disabled
            }
            override fun onProviderEnabled(provider: String) = Unit
            @Deprecated("Deprecated in Java")
            @Suppress("DEPRECATION")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
        }
        nativeVisitListener = listener
        runCatching {
            if (isGpsEnabled()) manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 3000L, 0f, listener, Looper.getMainLooper())
            if (isNetworkEnabled()) manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 3000L, 0f, listener, Looper.getMainLooper())
        }
    }

    /**
     * Stops visit tracking when leaving the screen or visit finishes.
     */
    fun stopVisitTracking(force: Boolean = false) {
        if (force) {
            visitTrackingRefCount = 0
        } else if (visitTrackingRefCount > 0) {
            visitTrackingRefCount--
        }
        if (visitTrackingRefCount > 0) return

        visitTrackingActive = false
        fusedVisitCallback?.let { callback ->
            fusedClient?.removeLocationUpdates(callback)
            fusedVisitCallback = null
        }
        nativeVisitListener?.let { listener ->
            manager.removeUpdates(listener)
            nativeVisitListener = null
        }
        _visitStatus.value = VisitLocationStatus.Idle
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
