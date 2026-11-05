package com.madar.rep.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.content.pm.PackageManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(
    name = "RepLocation",
    permissions = {
        @Permission(alias = "location", strings = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        }),
        @Permission(alias = "backgroundLocation", strings = {
            Manifest.permission.ACCESS_BACKGROUND_LOCATION
        }),
        @Permission(alias = "notifications", strings = {
            Manifest.permission.POST_NOTIFICATIONS
        })
    }
)
public class RepLocationPlugin extends Plugin {

    private static final String MOCK_WARNING = "تم رصد تطبيق لتزييف الموقع، يرجى إغلاقه للمتابعة.";
    private static final long LOCATION_TIMEOUT_MS = 12000;
    private static final float MAX_CLOCK_ACCURACY_METERS = 120f;
    private static final float MAX_FALLBACK_ACCURACY_METERS = 250f;

    @PluginMethod
    public void requestDutyPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissionForAliases(new String[] { "location", "notifications" }, call, "dutyPermissionsCallback");
        } else {
            requestPermissionForAlias("location", call, "dutyPermissionsCallback");
        }
    }

    @PermissionCallback
    private void dutyPermissionsCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("foregroundGranted", hasFineLocationPermission());
        result.put("backgroundGranted", hasBackgroundLocationPermission());
        result.put("notificationsGranted", hasNotificationPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception error) {
            call.reject("تعذر فتح إعدادات الموقع لهذا التطبيق.", error);
        }
    }

    @PluginMethod
    public void getCurrentPosition(PluginCall call) {
        if (!hasFineLocationPermission()) {
            call.reject("يلزم السماح بالموقع الدقيق قبل التقاط الزيارة.", "LOCATION_PERMISSION_REQUIRED");
            return;
        }

        LocationManager locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null || !locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            call.reject("فعّل GPS بالأقمار الصناعية ثم حاول مرة أخرى.", "GPS_DISABLED");
            return;
        }

        try {
            Location lastKnown = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            if (lastKnown != null
                && System.currentTimeMillis() - lastKnown.getTime() <= 120000
                && lastKnown.hasAccuracy()
                && lastKnown.getAccuracy() <= MAX_CLOCK_ACCURACY_METERS) {
                if (isMockLocation(lastKnown)) {
                    call.reject(MOCK_WARNING, "MOCK_LOCATION_DETECTED");
                    return;
                }
                call.resolve(locationToJson(lastKnown, false));
                return;
            }
        } catch (SecurityException error) {
            call.reject("تعذر الوصول إلى شريحة GPS. تحقق من أذونات الموقع الدقيقة.", "LOCATION_PERMISSION_REQUIRED", error);
            return;
        }

        Handler handler = new Handler(Looper.getMainLooper());
        AtomicBoolean settled = new AtomicBoolean(false);
        LocationListener[] listenerRef = new LocationListener[1];
        Location[] bestLocationRef = new Location[1];
        Runnable timeout = () -> {
            if (!settled.compareAndSet(false, true)) return;
            if (listenerRef[0] != null) locationManager.removeUpdates(listenerRef[0]);
            Location best = bestLocationRef[0];
            if (best != null && best.hasAccuracy() && best.getAccuracy() <= MAX_FALLBACK_ACCURACY_METERS) {
                call.resolve(locationToJson(best, false));
            } else {
                call.reject("إشارة GPS ضعيفة؛ انتقل إلى مكان مفتوح وحاول مجدداً.", "GPS_TIMEOUT");
            }
        };

        listenerRef[0] = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                if (isMockLocation(location)) {
                    if (!settled.compareAndSet(false, true)) return;
                    handler.removeCallbacks(timeout);
                    locationManager.removeUpdates(this);
                    call.reject(MOCK_WARNING, "MOCK_LOCATION_DETECTED");
                    return;
                }
                if (location.hasAccuracy()
                    && (bestLocationRef[0] == null || location.getAccuracy() < bestLocationRef[0].getAccuracy())) {
                    bestLocationRef[0] = location;
                }
                if (!location.hasAccuracy() || location.getAccuracy() > MAX_CLOCK_ACCURACY_METERS
                    || !settled.compareAndSet(false, true)) return;
                handler.removeCallbacks(timeout);
                locationManager.removeUpdates(this);
                call.resolve(locationToJson(location, false));
            }

            @Override
            public void onProviderDisabled(String provider) {
                if (!LocationManager.GPS_PROVIDER.equals(provider) || !settled.compareAndSet(false, true)) return;
                handler.removeCallbacks(timeout);
                locationManager.removeUpdates(this);
                call.reject("تم إيقاف GPS أثناء تحديد الموقع.", "GPS_DISABLED");
            }
        };

        try {
            locationManager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                0L,
                0f,
                listenerRef[0],
                Looper.getMainLooper()
            );
            handler.postDelayed(timeout, LOCATION_TIMEOUT_MS);
        } catch (SecurityException error) {
            call.reject("تعذر الوصول إلى شريحة GPS. تحقق من أذونات الموقع الدقيقة.", "LOCATION_PERMISSION_REQUIRED", error);
        } catch (IllegalArgumentException error) {
            call.reject("موفر GPS غير متاح على هذا الجهاز.", "GPS_UNAVAILABLE", error);
        }
    }

    @PluginMethod
    public void startDutyTracking(PluginCall call) {
        if (!hasFineLocationPermission()) {
            call.reject("يلزم السماح بالموقع الدقيق لبدء الوردية.", "LOCATION_PERMISSION_REQUIRED");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !hasBackgroundLocationPermission()) {
            call.reject("فعّل «السماح طوال الوقت» من إعدادات التطبيق لتشغيل GPS في الخلفية.", "BACKGROUND_LOCATION_REQUIRED");
            return;
        }
        if (!hasNotificationPermission()) {
            call.reject("اسمح بإشعارات MADAR لعرض تنبيه التتبع أثناء الوردية.", "NOTIFICATION_PERMISSION_REQUIRED");
            return;
        }

        Intent intent = new Intent(getContext(), RepLocationService.class);
        intent.setAction(RepLocationService.ACTION_START);
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve(new JSObject().put("active", true));
        } catch (Exception error) {
            call.reject("تعذر تشغيل خدمة تتبع الوردية.", "DUTY_SERVICE_START_FAILED", error);
        }
    }

    @PluginMethod
    public void stopDutyTracking(PluginCall call) {
        Intent intent = new Intent(getContext(), RepLocationService.class);
        intent.setAction(RepLocationService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve(new JSObject().put("active", false));
    }

    @PluginMethod
    public void getDutyState(PluginCall call) {
        android.content.SharedPreferences preferences = getContext().getSharedPreferences(
            RepLocationService.PREFERENCES_NAME,
            Context.MODE_PRIVATE
        );
        JSObject result = new JSObject();
        result.put("active", preferences.getBoolean("duty_active", false) && RepLocationService.isRunning());
        result.put("gpsEnabled", preferences.getBoolean("gps_provider_enabled", false));
        result.put("mocked", preferences.getBoolean("last_location_mocked", false));
        String lastLocation = preferences.getString("last_location_json", null);
        if (lastLocation != null) {
            try {
                result.put("lastLocation", new JSObject(lastLocation));
            } catch (Exception ignored) {
                result.put("lastLocation", (Object) null);
            }
        } else {
            result.put("lastLocation", (Object) null);
        }
        try {
            try (RepTrackStore trackStore = new RepTrackStore(getContext())) {
                result.put("trail", new JSArray(trackStore.pendingTrail().toString()));
            }
        } catch (Exception ignored) {
            result.put("trail", new JSArray());
        }
        call.resolve(result);
    }

    @PluginMethod
    public void acknowledgeDutyTracking(PluginCall call) {
        Integer throughId = call.getInt("throughId");
        if (throughId == null || throughId < 1) {
            call.reject("A valid local GPS tracking cursor is required.", "INVALID_TRACK_CURSOR");
            return;
        }
        try (RepTrackStore trackStore = new RepTrackStore(getContext())) {
            int removed = trackStore.acknowledgeThrough(throughId.longValue());
            call.resolve(new JSObject().put("removed", removed));
        } catch (Exception error) {
            call.reject("تعذر تأكيد مزامنة نقاط GPS المحلية.", "TRACK_ACK_FAILED", error);
        }
    }

    private boolean hasFineLocationPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBackgroundLocationPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasNotificationPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    static boolean isMockLocation(Location location) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return location.isMock();
        return location.isFromMockProvider();
    }

    static JSObject locationToJson(Location location, boolean mocked) {
        JSObject result = new JSObject();
        result.put("latitude", location.getLatitude());
        result.put("longitude", location.getLongitude());
        result.put("accuracy", (double) location.getAccuracy());
        result.put("speed", location.hasSpeed() ? (double) location.getSpeed() : 0.0);
        result.put("timestamp", location.getTime());
        result.put("mocked", mocked || isMockLocation(location));
        return result;
    }
}
