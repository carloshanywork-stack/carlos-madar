package com.madar.rep;

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

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;

import org.json.JSONArray;
import org.json.JSONException;

public class RepLocationService extends Service implements LocationListener {

    public static final String ACTION_START = "com.madar.rep.action.START_DUTY";
    public static final String ACTION_STOP = "com.madar.rep.action.STOP_DUTY";
    public static final String PREFERENCES_NAME = "madar_rep_duty";
    private static final String CHANNEL_ID = "madar-rep-duty-location";
    private static final int NOTIFICATION_ID = 43102;
    private static final int MAX_TRACK_POINTS = 2000;
    private static volatile boolean running;

    private LocationManager locationManager;

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTracking();
            return START_NOT_STICKY;
        }

        if (!hasRequiredPermissions()) {
            getPreferences().edit().putBoolean("duty_active", false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }

        getPreferences().edit()
            .putBoolean("duty_active", true)
            .putBoolean("last_location_mocked", false)
            .putString("duty_trail_json", "[]")
            .apply();
        startForegroundCompat();
        beginGpsUpdates();
        return START_STICKY;
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
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    5000L,
                    10f,
                    this,
                    Looper.getMainLooper()
                );
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
        appendTrackPoint(json);
    }

    private void appendTrackPoint(JSObject point) {
        try {
            String existing = getPreferences().getString("duty_trail_json", "[]");
            JSONArray trail = new JSONArray(existing);
            trail.put(new org.json.JSONObject(point.toString()));
            while (trail.length() > MAX_TRACK_POINTS) trail.remove(0);
            getPreferences().edit().putString("duty_trail_json", trail.toString()).apply();
        } catch (JSONException ignored) {
            getPreferences().edit().putString("duty_trail_json", "[]").apply();
        }
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

    private void stopTracking() {
        getPreferences().edit().putBoolean("duty_active", false).apply();
        if (locationManager != null) locationManager.removeUpdates(this);
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
            : "يُسجّل MADAR موقع GPS أثناء الوردية.";
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(mocked ? "تحذير أمان الموقع" : "MADAR · الوردية نشطة")
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
        running = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
