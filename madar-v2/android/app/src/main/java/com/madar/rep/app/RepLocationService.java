package com.madar.rep.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

public class RepLocationService extends Service implements LocationListener {

    public static final String ACTION_START = "com.madar.rep.app.action.START_DUTY";
    public static final String ACTION_STOP = "com.madar.rep.app.action.STOP_DUTY";
    public static final String PREFERENCES_NAME = "madar_rep_duty";
    private static final String CHANNEL_ID = "madar-rep-duty-location";
    private static final int NOTIFICATION_ID = 43102;
    private static final long MOVING_INTERVAL_MS = 5000L;
    private static final long STATIONARY_INTERVAL_MS = 60000L;
    private static final long STATIONARY_AFTER_MS = 3 * 60 * 1000L;
    private static final float MOVING_SPEED_METERS_PER_SECOND = 2f / 3.6f;
    private static final float MOVING_DISTANCE_METERS = 15f;
    private static volatile boolean running;

    private LocationManager locationManager;
    private RepTrackStore trackStore;
    private PowerManager.WakeLock wakeLock;
    private Location stationaryAnchor;
    private long stationarySinceMs;
    private boolean lowPowerUpdates;
    private boolean updatesRegistered;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        trackStore = new RepTrackStore(this);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            // Stop collecting immediately; WorkManager owns uploading the preserved backlog.
            MadarSyncScheduler.enqueueNow(getApplicationContext(), false);
            stopTracking();
            return START_NOT_STICKY;
        }

        boolean explicitStart = intent != null && ACTION_START.equals(intent.getAction());
        if (intent == null && !getPreferences().getBoolean("duty_active", false)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!hasRequiredPermissions()) {
            getPreferences().edit().putBoolean("duty_active", false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }

        long currentRep = RepAuthStore.repId(this);
        long dutyOwner = getPreferences().getLong("duty_rep_id", 0L);
        if (explicitStart) {
            dutyOwner = currentRep;
            getPreferences().edit().putLong("duty_rep_id", dutyOwner).commit();
        }
        if (dutyOwner < 1L || dutyOwner != currentRep) { stopTracking(); return START_NOT_STICKY; }
        acquireWakeLock();
        getPreferences().edit()
            .putBoolean("duty_active", true)
            .putBoolean("last_location_mocked", false)
            .apply();
        if (explicitStart) getPreferences().edit().putString("last_location_warning", "").apply();
        startForegroundCompat();
        beginGpsUpdates();
        return START_STICKY;
    }

    private boolean hasUnacknowledgedBreadcrumbs() {
        if (trackStore == null) return true;
        try {
            return trackStore.pendingCount(RepAuthStore.repId(this)) > 0;
        } catch (Exception error) {
            return true;
        }
    }

    private void startForegroundCompat() {
        Notification notification = buildNotification(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void beginGpsUpdates() {
        if (locationManager == null || !hasRequiredPermissions()) return;
        try {
            if (!locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                getPreferences().edit().putBoolean("gps_provider_enabled", false).apply();
            } else {
                getPreferences().edit().putBoolean("gps_provider_enabled", true).apply();
                requestGpsUpdates(false);
            }
        } catch (SecurityException error) {
            getPreferences().edit().putBoolean("duty_active", false).apply();
            stopSelf();
        } catch (IllegalArgumentException error) {
            getPreferences().edit().putBoolean("gps_provider_enabled", false).apply();
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        boolean mocked = RepLocationPlugin.isMockLocation(location);
        JSObject json = RepLocationPlugin.locationToJson(location, mocked);
        getPreferences().edit()
            .putString("last_location_json", json.toString())
            .putBoolean("last_location_mocked", mocked)
            .putBoolean("duty_active", !mocked)
            .apply();
        if (mocked) {
            getPreferences().edit().putString("last_location_warning", "تم رصد تطبيق لتزييف الموقع، يرجى إغلاقه للمتابعة.").apply();
            if (locationManager != null) locationManager.removeUpdates(this);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(true));
            stopForeground(STOP_FOREGROUND_DETACH);
            stopSelf();
            return;
        }
        updateAdaptiveGpsMode(location);
        appendTrackPoint(location);
    }

    private void requestGpsUpdates(boolean lowPower) {
        if (locationManager == null || !hasRequiredPermissions()) return;
        try {
            if (updatesRegistered && lowPowerUpdates == lowPower) return;
            locationManager.removeUpdates(this);
            locationManager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                lowPower ? STATIONARY_INTERVAL_MS : MOVING_INTERVAL_MS,
                0f,
                this,
                Looper.getMainLooper()
            );
            lowPowerUpdates = lowPower;
            updatesRegistered = true;
            getPreferences().edit().putString("gps_polling_mode", lowPower ? "stationary" : "moving").apply();
        } catch (SecurityException error) {
            getPreferences().edit().putBoolean("duty_active", false).apply();
            stopSelf();
        } catch (IllegalArgumentException error) {
            updatesRegistered = false;
            getPreferences().edit().putBoolean("gps_provider_enabled", false).apply();
        }
    }

    private void updateAdaptiveGpsMode(Location location) {
        long observedAt = SystemClock.elapsedRealtime();
        boolean moving = location.hasSpeed() && location.getSpeed() >= MOVING_SPEED_METERS_PER_SECOND;
        if (!moving && stationaryAnchor != null && stationaryAnchor.distanceTo(location) > MOVING_DISTANCE_METERS) {
            moving = true;
        }

        if (moving) {
            stationaryAnchor = new Location(location);
            stationarySinceMs = 0L;
            if (lowPowerUpdates) requestGpsUpdates(false);
            return;
        }

        if (stationaryAnchor == null) {
            stationaryAnchor = new Location(location);
            stationarySinceMs = observedAt;
            return;
        }
        if (stationarySinceMs <= 0L) stationarySinceMs = observedAt;
        if (!lowPowerUpdates && observedAt - stationarySinceMs >= STATIONARY_AFTER_MS) {
            requestGpsUpdates(true);
        }
    }

    private void appendTrackPoint(Location location) {
        long owner = getPreferences().getLong("duty_rep_id", 0L);
        if (owner < 1L || owner != RepAuthStore.repId(this)) { stopTracking(); return; }
        if (trackStore != null) trackStore.append(location, owner);
    }

    @Override
    public void onProviderDisabled(String provider) {
        if (LocationManager.GPS_PROVIDER.equals(provider)) {
            getPreferences().edit().putBoolean("gps_provider_enabled", false).apply();
        }
    }

    @Override
    public void onProviderEnabled(String provider) {
        if (LocationManager.GPS_PROVIDER.equals(provider)) beginGpsUpdates();
    }

    @Override
    public void onStatusChanged(String provider, int status, android.os.Bundle extras) {
        // Kept for older Android releases; modern Android uses provider callbacks above.
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager == null) return;
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "madar-rep:duty-location");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock == null) return;
        if (wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private void stopTracking() {
        getPreferences().edit().putBoolean("duty_active", false).apply();
        if (locationManager != null) locationManager.removeUpdates(this);
        updatesRegistered = false;
        lowPowerUpdates = false;
        stationaryAnchor = null;
        stationarySinceMs = 0L;
        releaseWakeLock();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private boolean hasRequiredPermissions() {
        boolean fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        boolean background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        boolean notifications = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
        return fine && background && notifications;
    }

    private android.content.SharedPreferences getPreferences() {
        return getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "تتبع الوردية للمندوب",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("إشعار دائم أثناء تسجيل موقع المندوب في الوردية.");
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(boolean mocked) {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = null;
        if (launchIntent != null) {
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            contentIntent = PendingIntent.getActivity(this, 0, launchIntent, flags);
        }
        String content = mocked
            ? "تم رصد موقع مزيف. أوقفنا تتبع الوردية."
            : "المدار يعمل أثناء الوردية؛ لا تُغلق التطبيق قبل تسجيل الانصراف.";
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(mocked ? "تحذير أمان الموقع" : "مدار - جاري تتبع المسار الميداني")
            .setContentText(content)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(!mocked)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW);
        if (contentIntent != null) builder.setContentIntent(contentIntent);
        return builder.build();
    }

    private boolean hasForegroundPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onDestroy() {
        if (locationManager != null && hasForegroundPermission()) locationManager.removeUpdates(this);
        updatesRegistered = false;
        releaseWakeLock();
        running = false;
        if (trackStore != null) {
            trackStore.close();
            trackStore = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
