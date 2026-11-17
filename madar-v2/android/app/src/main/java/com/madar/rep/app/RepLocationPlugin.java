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

import org.json.JSONObject;

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
    private static final long LOCATION_TIMEOUT_MS = 15000;
    private static final float MAX_CLOCK_ACCURACY_METERS = 250f;
    private static final float MAX_FALLBACK_ACCURACY_METERS = 500f;

    @PluginMethod
    public void getGpsAvailability(PluginCall call) {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        boolean gps = manager != null && manager.isProviderEnabled(LocationManager.GPS_PROVIDER);
        boolean network = manager != null && manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        boolean enabled = gps || network;
        call.resolve(new JSObject()
            .put("enabled", enabled)
            .put("gpsEnabled", gps)
            .put("networkEnabled", network)
            .put("fineLocationGranted", hasFineLocationPermission())
            .put("coarseLocationGranted", hasLocationPermission()));
    }

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
        result.put("foregroundGranted", hasLocationPermission());
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

    private Location getBestLastKnownLocation(LocationManager locationManager) {
        if (locationManager == null || !hasLocationPermission()) return null;
        String[] providers = { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER };
        Location best = null;
        long now = System.currentTimeMillis();
        for (String provider : providers) {
            try {
                if (!locationManager.isProviderEnabled(provider)) continue;
                Location candidate = locationManager.getLastKnownLocation(provider);
                if (candidate == null) continue;
                long age = now - candidate.getTime();
                if (age < 0 || age > 15 * 60 * 1000) continue; // within 15 minutes
                if (best == null || (candidate.hasAccuracy() && (!best.hasAccuracy() || candidate.getAccuracy() < best.getAccuracy()))) {
                    best = candidate;
                }
            } catch (SecurityException | IllegalArgumentException ignored) {}
        }
        return best;
    }

    @PluginMethod
    public void getCurrentPosition(PluginCall call) {
        if (!hasLocationPermission()) {
            call.reject("يلزم السماح بالموقع قبل التقاط الزيارة.", "LOCATION_PERMISSION_REQUIRED");
            return;
        }

        LocationManager locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        boolean gpsEnabled = locationManager != null && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);
        boolean networkEnabled = locationManager != null && locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);

        if (!gpsEnabled && !networkEnabled) {
            call.reject("فعّل خدمة الموقع (GPS أو الشبكة) ثم حاول مرة أخرى.", "GPS_DISABLED");
            return;
        }

        // Fast-path: check best last known location across GPS, Network, and Passive providers
        Location fastKnown = getBestLastKnownLocation(locationManager);
        if (fastKnown != null && fastKnown.hasAccuracy() && fastKnown.getAccuracy() <= MAX_CLOCK_ACCURACY_METERS) {
            if (isMockLocation(fastKnown)) {
                call.reject(MOCK_WARNING, "MOCK_LOCATION_DETECTED");
                return;
            }
            call.resolve(locationToJson(fastKnown, false));
            return;
        }

        Handler handler = new Handler(Looper.getMainLooper());
        AtomicBoolean settled = new AtomicBoolean(false);
        LocationListener[] listenerRef = new LocationListener[1];
        Location[] bestLocationRef = new Location[1];
        if (fastKnown != null) {
            bestLocationRef[0] = fastKnown;
        }

        Runnable timeout = () -> {
            if (!settled.compareAndSet(false, true)) return;
            if (listenerRef[0] != null && locationManager != null) {
                try { locationManager.removeUpdates(listenerRef[0]); } catch (Exception ignored) {}
            }
            Location best = bestLocationRef[0];
            if (best == null) {
                best = getBestLastKnownLocation(locationManager);
            }
            if (best != null && best.hasAccuracy() && best.getAccuracy() <= MAX_FALLBACK_ACCURACY_METERS) {
                call.resolve(locationToJson(best, false));
            } else {
                call.reject("إشارة GPS ضعيفة؛ انتقل إلى مكان مفتوح أو فعّل شبكة الهاتف وحاول مجدداً.", "GPS_TIMEOUT");
            }
        };

        listenerRef[0] = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                if (isMockLocation(location)) {
                    if (!settled.compareAndSet(false, true)) return;
                    handler.removeCallbacks(timeout);
                    if (locationManager != null) {
                        try { locationManager.removeUpdates(this); } catch (Exception ignored) {}
                    }
                    getContext().getSharedPreferences(RepLocationService.PREFERENCES_NAME, Context.MODE_PRIVATE)
                        .edit()
                        .putBoolean("last_location_mocked", true)
                        .putString("last_location_json", locationToJson(location, true).toString())
                        .putString("last_location_warning", MOCK_WARNING)
                        .apply();
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
                if (locationManager != null) {
                    try { locationManager.removeUpdates(this); } catch (Exception ignored) {}
                }
                call.resolve(locationToJson(location, false));
            }

            @Override
            public void onProviderDisabled(String provider) {
                // Do not reject on a single provider being disabled if another is active
                if (locationManager != null
                    && !locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                    && !locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    if (!settled.compareAndSet(false, true)) return;
                    handler.removeCallbacks(timeout);
                    try { locationManager.removeUpdates(this); } catch (Exception ignored) {}
                    call.reject("تم إيقاف خدمة الموقع.", "GPS_DISABLED");
                }
            }
        };

        boolean requestedAny = false;
        if (gpsEnabled && hasFineLocationPermission()) {
            try {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    0L,
                    0f,
                    listenerRef[0],
                    Looper.getMainLooper()
                );
                requestedAny = true;
            } catch (Exception ignored) {}
        }
        if (networkEnabled) {
            try {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    0L,
                    0f,
                    listenerRef[0],
                    Looper.getMainLooper()
                );
                requestedAny = true;
            } catch (Exception ignored) {}
        }

        if (!requestedAny) {
            if (fastKnown != null) {
                call.resolve(locationToJson(fastKnown, false));
            } else {
                call.reject("تعذر تشغيل موفرات الموقع على هذا الجهاز.", "GPS_UNAVAILABLE");
            }
            return;
        }

        handler.postDelayed(timeout, LOCATION_TIMEOUT_MS);
    }

    @PluginMethod
    public void startDutyTracking(PluginCall call) {
        if (!hasLocationPermission()) {
            call.reject("يلزم السماح بالموقع لبدء الوردية.", "LOCATION_PERMISSION_REQUIRED");
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
        try (RepTrackStore trackStore = new RepTrackStore(getContext())) {
            if (trackStore.pendingCount(RepAuthStore.repId(getContext())) > 0) {
                call.reject("لن يتوقف تتبع الوردية قبل تأكيد مزامنة جميع نقاط GPS المحفوظة.", "GPS_TRAIL_PENDING");
                return;
            }
        } catch (Exception error) {
            call.reject("تعذر التحقق من مزامنة نقاط GPS؛ سيظل التتبع نشطاً لحماية سجل الوردية.", "GPS_TRAIL_CHECK_FAILED", error);
            return;
        }
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
        LocationManager locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        boolean hardwareGpsEnabled = locationManager != null
            && (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                || locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
        boolean isDutyRunning = preferences.getBoolean("duty_active", false) && RepLocationService.isRunning();

        JSObject result = new JSObject();
        result.put("active", isDutyRunning);
        result.put("gpsEnabled", isDutyRunning ? preferences.getBoolean("gps_provider_enabled", false) : hardwareGpsEnabled);
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
            result.put("trail", new JSArray(trackStore.pendingTrail(RepAuthStore.repId(getContext())).toString()));
        }
    } catch (Exception error) {
        call.reject("تعذر قراءة نقاط GPS المحلية؛ لم تُعتبر القائمة فارغة.", "TRACK_QUEUE_READ_FAILED", error);
        return;
    }
    call.resolve(result);
}

@PluginMethod
public void getRecoveryQueue(PluginCall call) {
    long requestedRepId = call.getData().optLong("repId", 0L);
    long authenticatedRepId = RepAuthStore.repId(getContext());
    if (requestedRepId < 1L || authenticatedRepId != requestedRepId) {
        call.reject("يلزم حساب المندوب نفسه لقراءة نقاط GPS المحلية.", "TRACK_QUEUE_OWNER_MISMATCH");
        return;
    }
    try (RepTrackStore trackStore = new RepTrackStore(getContext())) {
        JSONObject queues = trackStore.recoveryQueue(requestedRepId);
        call.resolve(new JSObject(queues.toString()));
    } catch (Exception error) {
        call.reject("تعذر قراءة طوابير GPS المحلية؛ لم تُعتبر فارغة.", "TRACK_RECOVERY_READ_FAILED", error);
    }
}

@PluginMethod
public void acknowledgeDutyTracking(PluginCall call) {
    Integer throughId = call.getInt("throughId");
    if (throughId == null || throughId < 1) {
        call.reject("A valid local GPS tracking cursor is required.", "INVALID_TRACK_CURSOR");
            return;
        }
        try (RepTrackStore trackStore = new RepTrackStore(getContext())) {
            int removed = trackStore.acknowledgeThrough(throughId.longValue(), RepAuthStore.repId(getContext()));
            call.resolve(new JSObject().put("removed", removed));
        } catch (Exception error) {
            call.reject("تعذر تأكيد مزامنة نقاط GPS المحلية.", "TRACK_ACK_FAILED", error);
        }
    }

    private boolean hasFineLocationPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasLocationPermission() {
        return hasFineLocationPermission()
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION)
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
