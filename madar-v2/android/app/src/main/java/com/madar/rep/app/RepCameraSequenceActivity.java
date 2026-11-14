package com.madar.rep.app;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.ImageFormat;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.location.Location;
import android.location.LocationManager;
import android.media.Image;
import android.media.ImageReader;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** One continuous camera session for capturing a phase's consecutive evidence photos. */
public final class RepCameraSequenceActivity extends Activity {
    public static final String EXTRA_MAX_PHOTOS = "maxPhotos";
    public static final String EXTRA_PHASE_LABEL = "phaseLabel";
    public static final String EXTRA_PHOTOS = "photosJson";
    private final ArrayList<JSONObject> photos = new ArrayList<>();
    private TextureView preview;
    private TextView counter;
    private Button captureButton;
    private Button doneButton;
    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader imageReader;
    private HandlerThread cameraThread;
    private Handler cameraHandler;
    private String cameraId;
    private int sensorOrientation;
    private int maxPhotos = 3;
    private String phaseLabel = "الصور";
    private boolean captureInFlight;
    private String captureTimestamp;
    private JSONObject captureLocation;
    private boolean completed;
    private final ArrayList<File> temporaryFiles = new ArrayList<>();

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        maxPhotos = Math.max(1, Math.min(3, getIntent().getIntExtra(EXTRA_MAX_PHOTOS, 3)));
        phaseLabel = getIntent().getStringExtra(EXTRA_PHASE_LABEL);
        if (phaseLabel == null || phaseLabel.trim().isEmpty()) phaseLabel = "الصور";
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            setResult(RESULT_CANCELED);
            finish();
            return;
        }
        buildCaptureUi();
        startCameraThread();
        if (preview.isAvailable()) openCamera();
        else preview.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) { openCamera(); }
            @Override public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int width, int height) { }
            @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) { return true; }
            @Override public void onSurfaceTextureUpdated(SurfaceTexture texture) { }
        });
    }

    private void buildCaptureUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xff101820);
        preview = new TextureView(this);
        root.addView(preview, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.VERTICAL);
        controls.setPadding(24, 20, 24, 28);
        controls.setBackgroundColor(0xdd101820);
        FrameLayout.LayoutParams controlParams = new FrameLayout.LayoutParams(-1, -2, android.view.Gravity.BOTTOM);
        counter = new TextView(this);
        counter.setTextColor(0xffffffff);
        counter.setTextSize(17);
        counter.setGravity(android.view.Gravity.CENTER);
        counter.setText("افتح الكاميرا والتقط " + phaseLabel + " · 0 / " + maxPhotos);
        controls.addView(counter, new LinearLayout.LayoutParams(-1, -2));
        captureButton = new Button(this);
        captureButton.setText("التقاط صورة");
        controls.addView(captureButton, new LinearLayout.LayoutParams(-1, -2));
        doneButton = new Button(this);
        doneButton.setText("إنهاء هذه المجموعة");
        doneButton.setEnabled(false);
        controls.addView(doneButton, new LinearLayout.LayoutParams(-1, -2));
        TextView privacy = new TextView(this);
        privacy.setTextColor(0xffd7e2e8);
        privacy.setGravity(android.view.Gravity.CENTER);
        privacy.setTextSize(12);
        privacy.setText("تبقى الكاميرا مفتوحة بين الصور. صور هذه المجموعة تحفظ بالترتيب.");
        controls.addView(privacy, new LinearLayout.LayoutParams(-1, -2));
        root.addView(controls, controlParams);
        setContentView(root);
        captureButton.setOnClickListener(view -> captureStill());
        doneButton.setOnClickListener(view -> finishWithPhotos());
    }

    private void startCameraThread() {
        cameraThread = new HandlerThread("madar-visit-camera");
        cameraThread.start();
        cameraHandler = new Handler(cameraThread.getLooper());
    }

    private void openCamera() {
        if (isFinishing() || camera != null) return;
        try {
            CameraManager manager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics characteristics = manager.getCameraCharacteristics(id);
                if (characteristics.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK) {
                    cameraId = id;
                    sensorOrientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) == null
                        ? 90 : characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION);
                    StreamConfigurationMap map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
                    android.util.Size[] sizes = map == null ? null : map.getOutputSizes(ImageFormat.JPEG);
                    if (sizes == null || sizes.length == 0) throw new IllegalStateException("لا توجد دقة تصوير JPEG متاحة.");
                    android.util.Size selected = Arrays.stream(sizes)
                        .filter(size -> size.getWidth() <= 4000 && size.getHeight() <= 3000)
                        .max(Comparator.comparingLong(size -> (long) size.getWidth() * size.getHeight()))
                        .orElse(sizes[0]);
                    imageReader = ImageReader.newInstance(selected.getWidth(), selected.getHeight(), ImageFormat.JPEG, 2);
                    imageReader.setOnImageAvailableListener(reader -> saveCapturedImage(reader.acquireNextImage()), cameraHandler);
                    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
                    manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                        @Override public void onOpened(CameraDevice device) { camera = device; configurePreview(); }
                        @Override public void onDisconnected(CameraDevice device) { device.close(); camera = null; }
                        @Override public void onError(CameraDevice device, int error) { device.close(); camera = null; fail("تعذر تشغيل كاميرا الهاتف."); }
                    }, cameraHandler);
                    return;
                }
            }
            fail("لا توجد كاميرا خلفية متاحة.");
        } catch (Exception error) {
            fail(error.getMessage() == null ? "تعذر فتح الكاميرا." : error.getMessage());
        }
    }

    private void configurePreview() {
        try {
            SurfaceTexture texture = preview.getSurfaceTexture();
            if (texture == null || camera == null || imageReader == null) return;
            texture.setDefaultBufferSize(imageReader.getWidth(), imageReader.getHeight());
            Surface surface = new Surface(texture);
            CaptureRequest.Builder request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            request.addTarget(surface);
            request.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
            camera.createCaptureSession(Arrays.asList(surface, imageReader.getSurface()), new CameraCaptureSession.StateCallback() {
                @Override public void onConfigured(CameraCaptureSession configured) {
                    if (camera == null) { configured.close(); return; }
                    session = configured;
                    try { session.setRepeatingRequest(request.build(), null, cameraHandler); }
                    catch (CameraAccessException error) { fail("تعذر تجهيز معاينة الكاميرا."); }
                }
                @Override public void onConfigureFailed(CameraCaptureSession configured) { fail("تعذر بدء معاينة الكاميرا."); }
            }, cameraHandler);
        } catch (Exception error) { fail("تعذر تجهيز معاينة الكاميرا."); }
    }

    private void captureStill() {
        if (camera == null || session == null || captureInFlight || photos.size() >= maxPhotos) return;
        captureInFlight = true;
        doneButton.setEnabled(false);
        captureTimestamp = isoTimestamp(System.currentTimeMillis());
        captureLocation = currentGpsLocation();
        captureButton.setEnabled(false);
        try {
            CaptureRequest.Builder request = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            request.addTarget(imageReader.getSurface());
            request.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
            int rotation = getWindowManager().getDefaultDisplay().getRotation();
            int degrees = rotation == Surface.ROTATION_90 ? 90 : rotation == Surface.ROTATION_180 ? 180 : rotation == Surface.ROTATION_270 ? 270 : 0;
            request.set(CaptureRequest.JPEG_ORIENTATION, (sensorOrientation - degrees + 360) % 360);
            session.capture(request.build(), new CameraCaptureSession.CaptureCallback() { }, cameraHandler);
        } catch (Exception error) {
            captureInFlight = false;
            captureButton.setEnabled(true);
            doneButton.setEnabled(!photos.isEmpty());
            fail("تعذر التقاط الصورة. حاول مرة أخرى.");
        }
    }

    private void saveCapturedImage(Image image) {
        if (image == null) return;
        try (Image captured = image) {
            ByteBuffer buffer = captured.getPlanes()[0].getBuffer();
            byte[] bytes = new byte[buffer.remaining()];
            buffer.get(bytes);
            File directory = new File(getFilesDir(), "visit-camera-captures");
            if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("تعذر حفظ الصورة محلياً.");
            File output = new File(directory, "capture-" + java.util.UUID.randomUUID() + ".jpg");
            try (FileOutputStream stream = new FileOutputStream(output)) {
                stream.write(bytes);
                stream.flush();
                stream.getFD().sync();
            }
            JSONObject item = new JSONObject();
            item.put("sourceUri", android.net.Uri.fromFile(output).toString());
            item.put("capturedAt", captureTimestamp);
            item.put("location", captureLocation == null ? JSONObject.NULL : captureLocation);
            photos.add(item);
            temporaryFiles.add(output);
            runOnUiThread(() -> {
                captureInFlight = false;
                counter.setText("صور " + phaseLabel + " · " + photos.size() + " / " + maxPhotos);
                doneButton.setEnabled(!photos.isEmpty());
                captureButton.setEnabled(photos.size() < maxPhotos);
                if (photos.size() == maxPhotos) captureButton.setText("اكتمل العدد المطلوب");
            });
        } catch (Exception error) {
            runOnUiThread(() -> { captureInFlight = false; captureButton.setEnabled(true); doneButton.setEnabled(!photos.isEmpty()); fail("تعذر حفظ الصورة على الهاتف؛ أعد التقاطها."); });
        }
    }

    private JSONObject currentGpsLocation() {
        try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null;
            LocationManager manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            Location best = null;
            for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
                Location candidate = manager.getLastKnownLocation(provider);
                if (candidate != null && (best == null || candidate.getTime() > best.getTime())) best = candidate;
            }
            if (best == null) return null;
            long age = System.currentTimeMillis() - best.getTime();
            if (age < -30_000L || age > 2 * 60_000L || !best.hasAccuracy() || best.getAccuracy() > 100f) return null;
            JSONObject result = new JSONObject();
            result.put("latitude", best.getLatitude());
            result.put("longitude", best.getLongitude());
            result.put("accuracy", best.getAccuracy());
            result.put("updatedAt", isoTimestamp(best.getTime()));
            return result;
        } catch (Exception ignored) { return null; }
    }

    private void finishWithPhotos() {
        if (photos.isEmpty()) return;
        Intent result = new Intent();
        JSONArray resultPhotos = new JSONArray();
        for (JSONObject photo : photos) resultPhotos.put(photo);
        result.putExtra(EXTRA_PHOTOS, resultPhotos.toString());
        completed = true;
        setResult(RESULT_OK, result);
        finish();
    }

    private void fail(String message) {
        if (isFinishing()) return;
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show();
    }

    private static String isoTimestamp(long milliseconds) {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date(milliseconds));
    }

    private void closeCamera() {
        if (session != null) { session.close(); session = null; }
        if (camera != null) { camera.close(); camera = null; }
        if (imageReader != null) { imageReader.close(); imageReader = null; }
    }

    @Override protected void onPause() { closeCamera(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (preview != null && preview.isAvailable() && camera == null) openCamera(); }
    @Override protected void onDestroy() {
        closeCamera();
        if (cameraThread != null) { cameraThread.quitSafely(); try { cameraThread.join(1000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); } }
        if (isFinishing() && !isChangingConfigurations() && !completed && photos.size() > 0) {
            for (File file : temporaryFiles) if (file.exists()) file.delete();
        }
        super.onDestroy();
    }
}
