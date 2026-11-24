package com.madar.rep.app;

import android.os.Bundle;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.BridgeActivity;

import java.util.Map;

public class MainActivity extends BridgeActivity {
    public interface PermissionResultCallback {
        void onResult(Map<String, Boolean> result);
    }

    private static class PendingPermissionRequest {
        final String[] permissions;
        final PermissionResultCallback callback;

        PendingPermissionRequest(String[] permissions, PermissionResultCallback callback) {
            this.permissions = permissions;
            this.callback = callback;
        }
    }

    private ActivityResultLauncher<String[]> permissionLauncher;
    private PermissionResultCallback permissionResultCallback;
    private final java.util.Queue<PendingPermissionRequest> permissionQueue = new java.util.concurrent.ConcurrentLinkedQueue<>();
    private volatile boolean isRequestingPermissions = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RepLocationPlugin.class);
        registerPlugin(RepNativeEnginePlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);
        permissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(),
            result -> {
                PermissionResultCallback callback = permissionResultCallback;
                permissionResultCallback = null;
                isRequestingPermissions = false;
                if (callback != null) callback.onResult(result);
                processNextPermissionRequest();
            }
        );
        MadarSyncScheduler.ensurePeriodic(this);
    }

    @Override
    public void onStart() {
        super.onStart();
        try {
            android.webkit.WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                webView.setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);
                android.webkit.WebSettings settings = webView.getSettings();
                settings.setDomStorageEnabled(true);
                settings.setDatabaseEnabled(true);
                settings.setCacheMode(android.webkit.WebSettings.LOAD_DEFAULT);
            }
        } catch (Exception ignored) {}
    }

    public synchronized void requestRuntimePermissions(String[] permissions, PermissionResultCallback callback) {
        if (permissionLauncher == null) {
            if (callback != null) callback.onResult(java.util.Collections.emptyMap());
            return;
        }
        permissionQueue.offer(new PendingPermissionRequest(permissions, callback));
        processNextPermissionRequest();
    }

    private synchronized void processNextPermissionRequest() {
        if (isRequestingPermissions || permissionLauncher == null) return;
        PendingPermissionRequest next = permissionQueue.poll();
        if (next == null) return;
        isRequestingPermissions = true;
        permissionResultCallback = next.callback;
        permissionLauncher.launch(next.permissions);
    }
}
