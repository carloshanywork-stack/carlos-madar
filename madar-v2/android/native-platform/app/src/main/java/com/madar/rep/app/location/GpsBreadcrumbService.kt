package com.madar.rep.app.location

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.madar.rep.app.MadarApplication
import com.madar.rep.app.R
import com.madar.rep.app.core.Hashing
import com.madar.rep.app.core.MadarTime
import com.madar.rep.app.data.db.GpsPointEntity
import com.madar.rep.app.data.db.GpsPointState
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONObject

/** User-visible duty recorder. Points are persisted locally; this service never performs network I/O. */
class GpsBreadcrumbService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var locationManager: LocationManager? = null
    private var listener: LocationListener? = null
    private var repId: Long = 0

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopRecording()
            stopSelf(startId)
            return START_NOT_STICKY
        }
        val requestedOwner = intent?.getLongExtra(EXTRA_REP_ID, 0L) ?: 0L
        if (requestedOwner <= 0 || !hasLocationPermission()) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        val session = (application as MadarApplication).container.sessionGateway.current()
        if (session == null || session.repId != requestedOwner) {
            stopSelf(startId)
            return START_NOT_STICKY
        }
        repId = requestedOwner
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification())
        }
        startRecording()
        return START_STICKY
    }

    private fun startRecording() {
        if (listener != null) return
        val manager = getSystemService(LocationManager::class.java) ?: return
        val callback = LocationListener { persist(it) }
        locationManager = manager
        listener = callback
        try {
            if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 60_000L, 0f, callback, mainLooper)
            }
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 120_000L, 0f, callback, mainLooper)
            }
            val initial = manager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: manager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
            if (initial != null && !isMock(initial)) {
                persist(initial)
            }
        } catch (_: SecurityException) {
            stopSelf()
        }

    }

    private fun persist(location: Location) {
        if (repId <= 0 || location.hasAccuracy().not() || !location.latitude.isFinite() || !location.longitude.isFinite()
            || location.latitude !in -90.0..90.0 || location.longitude !in -180.0..180.0
            || location.accuracy < 0 || isMock(location)) return
        // A stored fix keeps its acquisition time. Ignore stale fixes instead of
        // recycling a cached position under a fresh timestamp.
        val elapsedNanos = android.os.SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos
        if (elapsedNanos !in 0L..60_000_000_000L || !location.accuracy.isFinite()) return
        val id = "native-$repId-${UUID.randomUUID()}"
        val updatedAt = MadarTime.isoUtc(location.time)
        val accuracy = location.accuracy.toDouble()
        val speed = if (location.hasSpeed() && location.speed.isFinite() && location.speed >= 0f) location.speed.toDouble() else 0.0
        val payload = JSONObject().put("clientPointId", id).put("latitude", location.latitude)
            .put("longitude", location.longitude).put("accuracy", accuracy).put("speed", speed).put("updatedAt", updatedAt)
        val entity = GpsPointEntity(
            clientPointId = id,
            repId = repId,
            latitude = location.latitude,
            longitude = location.longitude,
            accuracy = accuracy,
            speed = speed,
            updatedAt = updatedAt,
            state = GpsPointState.QUEUED,
            contentHash = Hashing.sha256Hex(payload.toString().toByteArray()),
            createdAt = System.currentTimeMillis(),
        )
        serviceScope.launch {
            val container = (application as MadarApplication).container
            if (container.sessionGateway.current()?.repId != entity.repId) return@launch
            runCatching { container.database.gpsPoints().insert(entity) }
            val now = System.currentTimeMillis()
            if (now - lastEnqueueMillis >= 60_000L) {
                lastEnqueueMillis = now
                container.scheduler.enqueueNow()
            }
        }
    }

    private fun isMock(location: Location): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) location.isMock else location.isFromMockProvider

    private fun hasLocationPermission() = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "تسجيل موقع الوردية", NotificationManager.IMPORTANCE_LOW))
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(getString(R.string.app_name))
            .setContentText("تُحفظ نقاط الموقع محليًا أثناء الوردية")
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun stopRecording() {
        val current = listener
        if (current != null) runCatching { locationManager?.removeUpdates(current) }
        listener = null
        locationManager = null
        repId = 0
    }

    override fun onDestroy() {
        stopRecording()
        serviceScope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.madar.rep.app.location.START_DUTY_RECORDING"
        const val ACTION_STOP = "com.madar.rep.app.location.STOP_DUTY_RECORDING"
        const val EXTRA_REP_ID = "repId"
        private const val CHANNEL_ID = "madar-duty-location"
        private const val NOTIFICATION_ID = 4107
        @Volatile
        private var lastEnqueueMillis = 0L

        fun start(context: android.content.Context, repId: Long) {
            val intent = Intent(context, GpsBreadcrumbService::class.java).setAction(ACTION_START).putExtra(EXTRA_REP_ID, repId)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: android.content.Context) {
            context.stopService(Intent(context, GpsBreadcrumbService::class.java).setAction(ACTION_STOP))
        }
    }
}
