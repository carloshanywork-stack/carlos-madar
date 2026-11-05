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

    private ActivityResultLauncher<String[]> permissionLauncher;
    private PermissionResultCallback permissionResultCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RepLocationPlugin.class);
        registerPlugin(RepNativeEnginePlugin.class);
        super.onCreate(savedInstanceState);
        permissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(),
            result -> {
                PermissionResultCallback callback = permissionResultCallback;
                permissionResultCallback = null;
                if (callback != null) callback.onResult(result);
            }
        );
        MadarSyncScheduler.ensurePeriodic(this);
    }

    public void requestRuntimePermissions(String[] permissions, PermissionResultCallback callback) {
        if (permissionLauncher == null) throw new IllegalStateException("Android permission launcher is not ready.");
        if (permissionResultCallback != null) throw new IllegalStateException("Another permission request is already active.");
        permissionResultCallback = callback;
        permissionLauncher.launch(permissions);
    }
}
