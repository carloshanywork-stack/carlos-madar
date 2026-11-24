package com.madar.rep.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

@CapacitorPlugin(name = "AppUpdate")
public final class AppUpdatePlugin extends Plugin {
    private static final String TAG = "AppUpdatePlugin";
    private static final String TRUSTED_SIGNER_SHA256 = "f4c8bffc9f852ea6056e350b65156eb880d05629991682492159b9e3937c02a1";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private final OkHttpClient httpClient = new OkHttpClient.Builder()
        .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        .build();

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageManager pm = ctx.getPackageManager();
            PackageInfo pInfo = pm.getPackageInfo(ctx.getPackageName(), 0);
            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? pInfo.getLongVersionCode()
                : pInfo.versionCode;
            JSObject res = new JSObject();
            res.put("packageName", ctx.getPackageName());
            res.put("versionCode", versionCode);
            res.put("versionName", pInfo.versionName != null ? pInfo.versionName : "");
            res.put("isNative", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Could not get app info: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        String serverUrl = call.getString("serverUrl");
        String target = call.getString("target", "system");
        if (serverUrl == null || serverUrl.trim().isEmpty()) {
            serverUrl = BuildConfig.REP_SERVER_URL;
        }
        if (serverUrl.endsWith("/")) {
            serverUrl = serverUrl.substring(0, serverUrl.length() - 1);
        }
        final String finalServerUrl = serverUrl;
        final String finalTarget = target;

        IO.execute(() -> {
            try {
                Context ctx = getContext();
                PackageManager pm = ctx.getPackageManager();
                PackageInfo pInfo = pm.getPackageInfo(ctx.getPackageName(), 0);
                long currentVersionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? pInfo.getLongVersionCode()
                    : pInfo.versionCode;

                String url = finalServerUrl + "/api/app-version?target=" + finalTarget;
                Request request = new Request.Builder().url(url).get().build();
                try (Response response = httpClient.newCall(request).execute()) {
                    if (!response.isSuccessful() || response.body() == null) {
                        call.reject("Server returned status " + response.code());
                        return;
                    }
                    String bodyStr = response.body().string();
                    JSONObject json = new JSONObject(bodyStr);
                    long latestVersionCode = json.optLong("latestVersionCode", 0);
                    String versionName = json.optString("versionName", "");
                    String sha256 = json.optString("sha256", "");
                    String releaseNotes = json.optString("releaseNotes", "");
                    String apkUrl = json.optString("apkUrl", "/download/apk?target=" + finalTarget);

                    boolean updateAvailable = latestVersionCode > currentVersionCode;

                    JSObject ret = new JSObject();
                    ret.put("updateAvailable", updateAvailable);
                    ret.put("currentVersionCode", currentVersionCode);
                    ret.put("latestVersionCode", latestVersionCode);
                    ret.put("versionName", versionName);
                    ret.put("sha256", sha256);
                    ret.put("releaseNotes", releaseNotes);
                    ret.put("apkUrl", apkUrl);
                    call.resolve(ret);
                }
            } catch (Exception e) {
                Log.e(TAG, "checkForUpdate failed", e);
                call.reject("Failed to check for updates: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String serverUrl = call.getString("serverUrl");
        String target = call.getString("target", "system");
        String token = call.getString("token");
        String expectedSha256 = call.getString("expectedSha256");
        long expectedVersionCode = call.getInt("expectedVersionCode", 0);

        if (serverUrl == null || serverUrl.trim().isEmpty()) {
            serverUrl = BuildConfig.REP_SERVER_URL;
        }
        if (serverUrl.endsWith("/")) {
            serverUrl = serverUrl.substring(0, serverUrl.length() - 1);
        }
        final String finalServerUrl = serverUrl;
        final String finalTarget = target;

        IO.execute(() -> {
            File destination = null;
            File temporary = null;
            try {
                Context context = getContext();
                File updatesDir = new File(context.getCacheDir(), "updates");
                if (!updatesDir.exists() && !updatesDir.mkdirs()) {
                    call.reject("Cannot create updates cache directory");
                    return;
                }

                destination = new File(updatesDir, "madar-" + finalTarget + "-update.apk");
                temporary = new File(updatesDir, "madar-" + finalTarget + "-update.apk.part");
                if (temporary.exists()) temporary.delete();

                String downloadUrl = finalServerUrl + "/download/apk?target=" + finalTarget;
                Request.Builder reqBuilder = new Request.Builder().url(downloadUrl).get();
                if (token != null && !token.trim().isEmpty()) {
                    reqBuilder.header("Authorization", "Bearer " + token.trim());
                }

                Request request = reqBuilder.build();
                MessageDigest sha256Digest = MessageDigest.getInstance("SHA-256");

                try (Response response = httpClient.newCall(request).execute()) {
                    if (!response.isSuccessful()) {
                        call.reject("Download failed with HTTP " + response.code());
                        return;
                    }
                    ResponseBody body = response.body();
                    if (body == null) {
                        call.reject("Empty response body from APK download endpoint");
                        return;
                    }

                    long totalBytes = body.contentLength();
                    long bytesReadTotal = 0;
                    byte[] buffer = new byte[65536];

                    try (InputStream input = body.byteStream();
                         FileOutputStream output = new FileOutputStream(temporary)) {
                        int read;
                        while ((read = input.read(buffer)) != -1) {
                            output.write(buffer, 0, read);
                            sha256Digest.update(buffer, 0, read);
                            bytesReadTotal += read;

                            if (totalBytes > 0) {
                                int percent = (int) ((bytesReadTotal * 100) / totalBytes);
                                JSObject progress = new JSObject();
                                progress.put("percent", percent);
                                progress.put("bytesRead", bytesReadTotal);
                                progress.put("totalBytes", totalBytes);
                                notifyListeners("updateProgress", progress);
                            }
                        }
                        output.flush();
                    }
                }

                if (destination.exists()) destination.delete();
                if (!temporary.renameTo(destination)) {
                    call.reject("Failed to finalize downloaded APK file");
                    return;
                }

                // Verify SHA-256
                byte[] hashBytes = sha256Digest.digest();
                StringBuilder actualHashBuilder = new StringBuilder();
                for (byte b : hashBytes) {
                    actualHashBuilder.append(String.format("%02x", b));
                }
                String actualHash = actualHashBuilder.toString();

                if (expectedSha256 != null && !expectedSha256.trim().isEmpty()) {
                    if (!expectedSha256.trim().equalsIgnoreCase(actualHash)) {
                        destination.delete();
                        call.reject("HASH_MISMATCH: Downloaded APK digest does not match expected release metadata.");
                        return;
                    }
                }

                // Verify Package and Signer Integrity
                PackageManager pm = context.getPackageManager();
                PackageInfo packageInfo;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    packageInfo = pm.getPackageArchiveInfo(destination.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
                } else {
                    packageInfo = pm.getPackageArchiveInfo(destination.getAbsolutePath(), PackageManager.GET_SIGNATURES);
                }

                if (packageInfo == null) {
                    destination.delete();
                    call.reject("PACKAGE_INVALID: Cannot parse package information from downloaded APK.");
                    return;
                }

                String currentPackage = context.getPackageName();
                if (!currentPackage.equals(packageInfo.packageName) &&
                    !packageInfo.packageName.startsWith("com.madar.")) {
                    destination.delete();
                    call.reject("PACKAGE_MISMATCH: Downloaded APK package name (" + packageInfo.packageName + ") does not match application.");
                    return;
                }

                // Verify Signature matches trusted MADAR release key
                boolean signatureMatches = false;
                Signature[] signatures = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    SigningInfo signingInfo = packageInfo.signingInfo;
                    if (signingInfo != null) {
                        signatures = signingInfo.hasMultipleSigners()
                            ? signingInfo.getApkContentsSigners()
                            : signingInfo.getSigningCertificateHistory();
                    }
                } else {
                    signatures = packageInfo.signatures;
                }

                if (signatures != null) {
                    MessageDigest certDigest = MessageDigest.getInstance("SHA-256");
                    for (Signature sig : signatures) {
                        byte[] certHash = certDigest.digest(sig.toByteArray());
                        StringBuilder certSb = new StringBuilder();
                        for (byte b : certHash) {
                            certSb.append(String.format("%02x", b));
                        }
                        if (TRUSTED_SIGNER_SHA256.equalsIgnoreCase(certSb.toString())) {
                            signatureMatches = true;
                            break;
                        }
                    }
                }

                if (!signatureMatches) {
                    destination.delete();
                    call.reject("SIGNER_MISMATCH: Downloaded APK was not signed by the approved MADAR release key.");
                    return;
                }

                // Check install permission for Android 8.0+
                Activity activity = getActivity();
                if (activity == null) {
                    call.reject("Activity unavailable for triggering package installation.");
                    return;
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.getPackageManager().canRequestPackageInstalls()) {
                    Intent manageIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(manageIntent);
                    JSObject prompt = new JSObject();
                    prompt.put("permissionRequired", true);
                    prompt.put("message", "يرجى تفعيل صلاحية تثبيت التطبيقات غير المعروفة لمتابعة تثبيت التحديث.");
                    call.resolve(prompt);
                    return;
                }

                // Trigger Android Package Installer
                Uri contentUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", destination);
                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(contentUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(installIntent);

                JSObject success = new JSObject();
                success.put("success", true);
                success.put("installed", true);
                call.resolve(success);

            } catch (Exception e) {
                Log.e(TAG, "downloadAndInstall failed", e);
                if (temporary != null && temporary.exists()) temporary.delete();
                if (destination != null && destination.exists()) destination.delete();
                call.reject("Update failed: " + e.getMessage(), e);
            }
        });
    }
}
