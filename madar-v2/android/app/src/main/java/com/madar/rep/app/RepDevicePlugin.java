package com.madar.rep.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * First-launch permission and battery status for the representative app.
 *
 * Background location is deliberately not requested in the same batch as the
 * foreground permissions: Android 11+ rejects that request and requires the
 * representative to choose "Allow all the time" from the app settings screen.
 */
@CapacitorPlugin(
    name = "RepDevice",
    permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        @Permission(alias = "location", strings = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        }),
        @Permission(alias = "notifications", strings = {
            Manifest.permission.POST_NOTIFICATIONS
        })
    }
)
public class RepDevicePlugin extends Plugin {

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(buildStatus());
    }

    @PluginMethod
    public void requestInitialPermissions(PluginCall call) {
        String[] aliases = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? new String[] { "camera", "location", "notifications" }
            : new String[] { "camera", "location" };
        requestPermissionForAliases(aliases, call, "initialPermissionsCallback");
    }

    @PermissionCallback
    private void initialPermissionsCallback(PluginCall call) {
        call.resolve(buildStatus());
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
            call.reject("تعذر فتح إعدادات التطبيق على هذا الهاتف.", error);
        }
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (powerManager != null && powerManager.isIgnoringBatteryOptimizations(context.getPackageName())) {
            call.resolve(new JSObject().put("ignoring", true).put("requested", false));
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve(new JSObject().put("ignoring", true).put("requested", false));
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            call.resolve(new JSObject().put("ignoring", false).put("requested", true));
        } catch (Exception error) {
            // Some manufacturers block the direct intent; the settings screen below
            // still lets the representative exempt MADAR manually.
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(fallback);
                call.resolve(new JSObject().put("ignoring", false).put("requested", true));
            } catch (Exception fallbackError) {
                call.reject("تعذر فتح إعدادات تحسين البطارية على هذا الهاتف.", fallbackError);
            }
        }
    }

    private JSObject buildStatus() {
        JSObject status = new JSObject();
        status.put("camera", isGranted(Manifest.permission.CAMERA));
        status.put("location", isGranted(Manifest.permission.ACCESS_FINE_LOCATION));
        status.put("backgroundLocation", hasBackgroundLocation());
        status.put("notifications", hasNotifications());
        status.put("ignoringBatteryOptimizations", isIgnoringBatteryOptimizations());
        status.put("sdkInt", Build.VERSION.SDK_INT);
        return status;
    }

    private boolean isGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBackgroundLocation() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return isGranted(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        return isGranted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    private boolean hasNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return isGranted(Manifest.permission.POST_NOTIFICATIONS);
    }

    private boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return powerManager != null && powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }
}
