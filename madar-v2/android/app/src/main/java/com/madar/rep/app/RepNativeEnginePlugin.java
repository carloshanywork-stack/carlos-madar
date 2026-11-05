package com.madar.rep.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RectF;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.TextUtils;

import androidx.core.content.ContextCompat;
import androidx.exifinterface.media.ExifInterface;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "RepEngine")
public final class RepNativeEnginePlugin extends Plugin {
    private static final ExecutorService IO = Executors.newFixedThreadPool(2);
    private static final String[] INITIAL_PERMISSIONS = new String[] {
        Manifest.permission.CAMERA,
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION
    };
    private static final long MAX_PHOTO_BYTES = 3L * 1024L * 1024L;

    @PluginMethod
    public void getPermissionState(PluginCall call) {
        call.resolve(permissionState());
    }

    @PluginMethod
    public void requestInitialPermissions(PluginCall call) {
        getContext().getSharedPreferences("madar_rep_permissions", Context.MODE_PRIVATE)
            .edit().putBoolean("initial_request_made", true).apply();
        List<String> permissions = new ArrayList<>();
        for (String permission : INITIAL_PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(getContext(), permission) != PackageManager.PERMISSION_GRANTED) permissions.add(permission);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        requestContractPermissions(call, permissions.toArray(new String[0]));
    }

    @PluginMethod
    public void requestBackgroundPermission(PluginCall call) {
        getContext().getSharedPreferences("madar_rep_permissions", Context.MODE_PRIVATE)
            .edit().putBoolean("background_request_made", true).apply();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || hasPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            call.resolve(permissionState());
            return;
        }
        // Android 11+ requires the user to grant "Allow all the time" in app settings.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            call.resolve(new JSObject().put("granted", false).put("settingsRequired", true));
            return;
        }
        requestContractPermissions(call, new String[] { Manifest.permission.ACCESS_BACKGROUND_LOCATION });
    }

    private void requestContractPermissions(PluginCall call, String[] permissions) {
        if (permissions.length == 0) {
            call.resolve(permissionState());
            return;
        }
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("تعذر فتح بوابة صلاحيات أندرويد.", "PERMISSION_GATE_UNAVAILABLE");
            return;
        }
        try {
            ((MainActivity) getActivity()).requestRuntimePermissions(permissions, ignored -> call.resolve(permissionState()));
        } catch (Exception error) {
            call.reject("تعذر طلب صلاحيات أندرويد.", "PERMISSION_REQUEST_FAILED", error);
        }
    }

    private JSObject permissionState() {
        JSObject state = new JSObject();
        state.put("camera", hasPermission(Manifest.permission.CAMERA));
        state.put("fineLocation", hasPermission(Manifest.permission.ACCESS_FINE_LOCATION));
        state.put("coarseLocation", hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION));
        state.put("backgroundLocation", Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || hasPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION));
        state.put("notifications", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasPermission(Manifest.permission.POST_NOTIFICATIONS));
        state.put("sdkInt", Build.VERSION.SDK_INT);
        state.put("batteryOptimizationIgnored", isBatteryOptimizationIgnored());
        android.content.SharedPreferences requested = getContext().getSharedPreferences("madar_rep_permissions", Context.MODE_PRIVATE);
        state.put("initialRequestMade", requested.getBoolean("initial_request_made", false));
        state.put("backgroundRequestMade", requested.getBoolean("background_request_made", false));
        return state;
    }

    private boolean hasPermission(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception error) {
            call.reject("تعذر فتح إعدادات التطبيق.", "APP_SETTINGS_FAILED", error);
        }
    }

    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || isBatteryOptimizationIgnored()) {
            call.resolve(new JSObject().put("ignored", true));
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(new JSObject().put("opened", true));
        } catch (Exception error) {
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve(new JSObject().put("opened", true));
            } catch (Exception fallbackError) {
                call.reject("تعذر فتح إعدادات تحسين البطارية.", "BATTERY_SETTINGS_FAILED", fallbackError);
            }
        }
    }

    private boolean isBatteryOptimizationIgnored() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager manager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return manager != null && manager.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void saveSession(PluginCall call) {
        String token = call.getString("token");
        JSObject rep = call.getObject("rep");
        if (token == null || rep == null || !"rep".equals(rep.optString("role"))) {
            call.reject("تعذر حفظ جلسة المندوب.", "INVALID_REP_SESSION");
            return;
        }
        try {
            RepAuthStore.save(getContext(), token, rep.getLong("id"), rep.optString("username", ""));
            MadarSyncScheduler.ensurePeriodic(getContext());
            MadarSyncScheduler.enqueueNow(getContext(), true);
            call.resolve(new JSObject().put("saved", true));
        } catch (Exception error) {
            call.reject("تعذر حفظ رمز الجلسة المشفر على الهاتف.", "SECURE_SESSION_SAVE_FAILED", error);
        }
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        try {
            RepAuthStore.clear(getContext());
            MadarSyncScheduler.cancelImmediate(getContext());
            call.resolve(new JSObject().put("cleared", true));
        } catch (Exception error) {
            call.reject("تعذر إنهاء الجلسة المحلية الآمنة.", "SECURE_SESSION_CLEAR_FAILED", error);
        }
    }

    @PluginMethod
    public void cacheRoute(PluginCall call) {
        long repId = call.getData().optLong("repId", 0L);
        String route = call.getString("route");
        if (repId < 1 || route == null) { call.reject("مسار المندوب غير صالح."); return; }
        IO.execute(() -> {
            try (RepLocalStore store = new RepLocalStore(getContext())) {
                store.cacheRoute(repId, route);
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception error) { call.reject("تعذر حفظ مسار الماكينات محلياً.", "ROUTE_CACHE_FAILED", error); }
        });
    }

    @PluginMethod
    public void cacheReasons(PluginCall call) {
        long repId = call.getData().optLong("repId", 0L);
        String reasons = call.getString("reasons");
        if (repId < 1 || reasons == null) { call.reject("قائمة أسباب الأعطال غير صالحة."); return; }
        IO.execute(() -> {
            try (RepLocalStore store = new RepLocalStore(getContext())) {
                store.cacheReasons(repId, reasons);
                call.resolve(new JSObject().put("saved", true));
            } catch (Exception error) { call.reject("تعذر حفظ أسباب الأعطال محلياً.", "REASONS_CACHE_FAILED", error); }
        });
    }

    @PluginMethod
    public void getCachedRepData(PluginCall call) {
        long repId = call.getData().optLong("repId", 0L);
        if (repId < 1L) { call.reject("معرّف المندوب غير صالح."); return; }
        IO.execute(() -> {
            try (RepLocalStore store = new RepLocalStore(getContext())) {
                call.resolve(new JSObject(store.cachedData(repId).toString()));
            } catch (Exception error) { call.reject("تعذر قراءة نسخة المندوب المحلية.", "NATIVE_CACHE_READ_FAILED", error); }
        });
    }

    @PluginMethod
    public void processVisitPhoto(PluginCall call) {
        String visitUuid = call.getString("visitUuid");
        String phase = call.getString("phase");
        int index = call.getInt("index", -1);
        String sourceUri = call.getString("sourceUri");
        JSObject watermark = call.getObject("watermark");
        if (!validPhotoTarget(visitUuid, phase, index) || sourceUri == null || watermark == null) {
            call.reject("بيانات صورة الزيارة غير مكتملة.", "INVALID_VISIT_PHOTO");
            return;
        }
        IO.execute(() -> {
            try {
                JSONObject location = watermark.optJSONObject("location");
                File output = writeWatermarkedPhoto(visitUuid, phase, index, sourceUri, watermark, location);
                JSObject result = new JSObject();
                result.put("path", output.getAbsolutePath());
                result.put("sizeBytes", output.length());
                result.put("uri", Uri.fromFile(output).toString());
                call.resolve(result);
            } catch (Exception error) {
                call.reject("تعذر ضغط الصورة وختمها وحفظها داخل الهاتف.", "VISIT_PHOTO_SAVE_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void deleteVisitPhoto(PluginCall call) {
        String visitUuid = call.getString("visitUuid");
        String phase = call.getString("phase");
        int index = call.getInt("index", -1);
        if (!validPhotoTarget(visitUuid, phase, index)) { call.reject("مسار صورة الزيارة غير صالح."); return; }
        File image = new File(new File(new File(getContext().getFilesDir(), "visits"), visitUuid), phase + "_" + index + ".jpg");
        boolean deleted = !image.exists() || image.delete();
        call.resolve(new JSObject().put("deleted", deleted));
    }

    @PluginMethod
    public void enqueueVisit(PluginCall call) {
        JSONObject visit = call.getData();
        if (visit == null) { call.reject("بيانات الزيارة غير صالحة."); return; }
        IO.execute(() -> {
            try (RepLocalStore store = new RepLocalStore(getContext())) {
                store.enqueueVisit(getContext(), visit);
                MadarSyncScheduler.ensurePeriodic(getContext());
                MadarSyncScheduler.enqueueNow(getContext(), false);
                call.resolve(new JSObject()
                    .put("saved", true)
                    .put("nativeStoragePath", "internal://visits/" + visit.optString("visitUuid")));
            } catch (Exception error) {
                call.reject("تعذر حفظ الزيارة والصور في التخزين الأصلي المحلي.", "NATIVE_VISIT_SAVE_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void listVisits(PluginCall call) {
        long repId = call.getData().optLong("repId", 0L);
        if (repId < 1) { call.reject("معرّف المندوب غير صالح."); return; }
        IO.execute(() -> {
            try (RepLocalStore store = new RepLocalStore(getContext())) {
                JSONArray visits = store.listVisits(repId);
                JSObject result = new JSObject();
                result.put("visits", new JSArray(visits.toString()));
                call.resolve(result);
            } catch (Exception error) { call.reject("تعذر قراءة الزيارات المحلية الأصلية.", "NATIVE_VISIT_READ_FAILED", error); }
        });
    }

    @PluginMethod
    public void retryVisit(PluginCall call) {
        String visitUuid = call.getString("visitUuid");
        long repId = call.getData().optLong("repId", 0L);
        if (visitUuid == null || repId < 1L) { call.reject("بيانات إعادة المحاولة غير صالحة."); return; }
        IO.execute(() -> {
            try (RepLocalStore store = new RepLocalStore(getContext())) {
                boolean updated = store.requeueVisit(visitUuid, repId);
                if (updated) MadarSyncScheduler.enqueueNow(getContext(), true);
                call.resolve(new JSObject().put("updated", updated));
            } catch (Exception error) { call.reject("تعذرت إعادة وضع الزيارة في طابور المزامنة.", "NATIVE_VISIT_RETRY_FAILED", error); }
        });
    }

    @PluginMethod
    public void requestSync(PluginCall call) {
        MadarSyncScheduler.enqueueNow(getContext(), false);
        call.resolve(new JSObject().put("scheduled", true));
    }

    private boolean validPhotoTarget(String visitUuid, String phase, int index) {
        return visitUuid != null
            && visitUuid.matches("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
            && ("before".equals(phase) || "after".equals(phase))
            && index >= 0 && index < 3;
    }

    private File writeWatermarkedPhoto(String visitUuid, String phase, int index, String sourceUri,
        JSONObject watermark, JSONObject location) throws Exception {
        Uri uri = sourceUri.startsWith("file:") || sourceUri.startsWith("content:")
            ? Uri.parse(sourceUri) : Uri.fromFile(new File(sourceUri));
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalArgumentException("تعذر قراءة ملف الصورة الأصلي.");
            BitmapFactory.decodeStream(input, null, bounds);
        }
        if (bounds.outWidth < 1 || bounds.outHeight < 1) throw new IllegalArgumentException("ملف الصورة غير صالح.");
        int sampleSize = 1;
        while (Math.max(bounds.outWidth / sampleSize, bounds.outHeight / sampleSize) > 3200) sampleSize *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize;
        Bitmap decoded;
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) throw new IllegalArgumentException("تعذر قراءة ملف الصورة الأصلي.");
            decoded = BitmapFactory.decodeStream(input, null, options);
        }
        if (decoded == null) throw new IllegalArgumentException("تعذر فك ترميز الصورة.");
        int orientation = ExifInterface.ORIENTATION_NORMAL;
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input != null) orientation = new ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        } catch (Exception ignored) { /* Some provider URIs do not expose EXIF; camera orientation is corrected by Capacitor. */ }
        Bitmap oriented = orient(decoded, orientation);
        if (oriented != decoded) decoded.recycle();
        float scale = Math.min(1f, 1600f / Math.max(oriented.getWidth(), oriented.getHeight()));
        Bitmap scaled = oriented;
        if (scale < 1f) {
            scaled = Bitmap.createScaledBitmap(oriented,
                Math.max(1, Math.round(oriented.getWidth() * scale)),
                Math.max(1, Math.round(oriented.getHeight() * scale)), true);
            oriented.recycle();
        }
        Bitmap stamped = drawWatermark(scaled, watermark, location, phase);
        if (stamped != scaled) scaled.recycle();

        File directory = new File(new File(getContext().getFilesDir(), "visits"), visitUuid);
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("تعذر إنشاء مجلد الزيارة الداخلي.");
        File target = new File(directory, phase + "_" + index + ".jpg");
        File temporary = new File(directory, phase + "_" + index + ".jpg.tmp");
        boolean written = false;
        try {
            for (int quality : new int[] { 82, 76, 70 }) {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                stamped.compress(Bitmap.CompressFormat.JPEG, quality, bytes);
                byte[] image = bytes.toByteArray();
                if (image.length > MAX_PHOTO_BYTES && quality > 70) continue;
                if (image.length > MAX_PHOTO_BYTES) throw new IllegalArgumentException("حجم الصورة أكبر من الحد الذي يقبله الخادم.");
                try (java.io.FileOutputStream output = new java.io.FileOutputStream(temporary)) {
                    output.write(image);
                    output.getFD().sync();
                }
                if (target.exists() && !target.delete()) throw new IllegalStateException("تعذر استبدال الصورة القديمة.");
                if (!temporary.renameTo(target)) throw new IllegalStateException("تعذر تثبيت ملف الصورة النهائي.");
                written = true;
                break;
            }
        } finally {
            stamped.recycle();
            if (!written) temporary.delete();
        }
        return target;
    }

    private static Bitmap orient(Bitmap source, int orientation) {
        Matrix matrix = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.setScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_ROTATE_180: matrix.setRotate(180f); break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.setRotate(180f); matrix.postScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_TRANSPOSE: matrix.setRotate(90f); matrix.postScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_ROTATE_90: matrix.setRotate(90f); break;
            case ExifInterface.ORIENTATION_TRANSVERSE: matrix.setRotate(-90f); matrix.postScale(-1f, 1f); break;
            case ExifInterface.ORIENTATION_ROTATE_270: matrix.setRotate(-90f); break;
            default: return source;
        }
        return Bitmap.createBitmap(source, 0, 0, source.getWidth(), source.getHeight(), matrix, true);
    }

    private static Bitmap drawWatermark(Bitmap source, JSONObject data, JSONObject location, String phase) throws Exception {
        Bitmap output = source.copy(Bitmap.Config.ARGB_8888, true);
        Canvas canvas = new Canvas(output);
        int width = output.getWidth();
        int height = output.getHeight();
        float fontSize = Math.max(15f, Math.round(width * 0.022f));
        float lineHeight = Math.round(fontSize * 1.38f);
        float padding = Math.max(12f, Math.round(fontSize * 0.65f));
        float panelWidth = Math.min(width, Math.max(width * 0.58f, 300f));
        float panelHeight = Math.min(height, padding * 2f + lineHeight * 6f);
        float top = Math.max(0f, height - panelHeight);
        Paint background = new Paint(Paint.ANTI_ALIAS_FLAG);
        background.setColor(Color.argb(210, 7, 19, 31));
        canvas.drawRect(new RectF(0f, top, panelWidth, height), background);
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.SUBPIXEL_TEXT_FLAG);
        text.setColor(Color.WHITE);
        text.setTextSize(fontSize);
        text.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        text.setTextAlign(Paint.Align.RIGHT);
        text.setTextLocale(new Locale("ar"));
        String capturedAt = data.optString("capturedAt", "");
        Date timestamp;
        try { timestamp = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US).parse(capturedAt); }
        catch (Exception ignored) {
            try { timestamp = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssX", Locale.US).parse(capturedAt); }
            catch (Exception ignoredAgain) { timestamp = new Date(); }
        }
        SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        SimpleDateFormat weekdayFormat = new SimpleDateFormat("EEEE", new Locale("ar"));
        SimpleDateFormat timeFormat = new SimpleDateFormat("hh:mm:ss a", Locale.US);
        TimeZone cairo = TimeZone.getTimeZone("Africa/Cairo");
        dateFormat.setTimeZone(cairo); weekdayFormat.setTimeZone(cairo); timeFormat.setTimeZone(cairo);
        String gps = location == null ? "الموقع غير متاح"
            : String.format(Locale.US, "%.5f, %.5f · ±%dم", location.optDouble("latitude"), location.optDouble("longitude"), Math.round(location.optDouble("accuracy")));
        String region = data.optString("regionName", "");
        String area = data.optString("areaName", "");
        String lines[] = new String[] {
            "مَــدَارْ · " + ("before".equals(phase) ? "قبل الصيانة" : "بعد الصيانة"),
            "التاريخ: " + dateFormat.format(timestamp) + " · " + weekdayFormat.format(timestamp),
            "الوقت: " + timeFormat.format(timestamp),
            "GPS: " + gps,
            "المنطقة: " + (region.isEmpty() ? "غير محددة" : region) + (area.isEmpty() ? "" : " · " + area),
            "الماكينة: " + data.optString("machineCode", "") + " · " + data.optString("machineName", ""),
        };
        float maxWidth = Math.max(40f, panelWidth - padding * 2f);
        for (int index = 0; index < lines.length; index += 1) {
            CharSequence clipped = TextUtils.ellipsize(lines[index], new android.text.TextPaint(text), maxWidth, TextUtils.TruncateAt.END);
            float baseline = top + padding + lineHeight * index + lineHeight * 0.75f;
            canvas.drawText(clipped.toString(), panelWidth - padding, baseline, text);
        }
        return output;
    }
}
