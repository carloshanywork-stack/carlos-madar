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
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.Image;
import android.media.ImageReader;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
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
    public static final String EXTRA_VISIT_UUID = "visitUuid";
    public static final String EXTRA_REP_ID = "repId";
    public static final String EXTRA_PHASE = "phase";
    public static final String EXTRA_START_INDEX = "startIndex";
    public static final String EXTRA_FALLBACK_LOCATION = "fallbackLocation";
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
    private int maxPhotos = RepVisitPhotoPolicy.MAX_PER_PHASE;
    private String phaseLabel = "الصور";
    private boolean captureInFlight;
    private String captureTimestamp;
    private JSONObject captureLocation;
    private JSONObject fallbackLocation;
    private String visitUuid;
    private String phase;
    private long repId;
    private int startIndex;
    private volatile boolean paused;
    private boolean cameraOpening;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        maxPhotos = Math.max(1, Math.min(RepVisitPhotoPolicy.MAX_PER_PHASE, getIntent().getIntExtra(EXTRA_MAX_PHOTOS, RepVisitPhotoPolicy.MAX_PER_PHASE)));
        phaseLabel = getIntent().getStringExtra(EXTRA_PHASE_LABEL);
        if (phaseLabel == null || phaseLabel.trim().isEmpty()) phaseLabel = "الصور";
        visitUuid = getIntent().getStringExtra(EXTRA_VISIT_UUID);
        phase = getIntent().getStringExtra(EXTRA_PHASE);
        repId = getIntent().getLongExtra(EXTRA_REP_ID, 0L);
        startIndex = getIntent().getIntExtra(EXTRA_START_INDEX, -1);
        String fallback = getIntent().getStringExtra(EXTRA_FALLBACK_LOCATION);
        try { if (fallback != null) fallbackLocation = new JSONObject(fallback); } catch (Exception ignored) { }
        if (visitUuid == null || !visitUuid.matches("(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
            || repId < 1L || !("before".equals(phase) || "after".equals(phase))
            || startIndex < 0 || startIndex + maxPhotos > RepVisitPhotoPolicy.MAX_PER_PHASE) {
            setResult(RESULT_CANCELED);
            finish();
            return;
        }
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
        captureButton.setEnabled(false);
        Handler handler = cameraHandler;
        if (handler == null) { captureInFlight = false; fail("الكاميرا غير جاهزة؛ أعد المحاولة."); return; }
        handler.post(() -> {
            captureTimestamp = isoTimestamp(System.currentTimeMillis());
            captureLocation = currentGpsLocation(fallbackLocation);
            try {
                CameraDevice activeCamera = camera;
                CameraCaptureSession activeSession = session;
                if (activeCamera == null || activeSession == null || paused) throw new IllegalStateException("Camera is not active.");
                CaptureRequest.Builder request = activeCamera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
                request.addTarget(imageReader.getSurface());
                request.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
                int rotation = getWindowManager().getDefaultDisplay().getRotation();
                int degrees = rotation == Surface.ROTATION_90 ? 90 : rotation == Surface.ROTATION_180 ? 180 : rotation == Surface.ROTATION_270 ? 270 : 0;
                request.set(CaptureRequest.JPEG_ORIENTATION, (sensorOrientation - degrees + 360) % 360);
                activeSession.capture(request.build(), new CameraCaptureSession.CaptureCallback() { }, cameraHandler);
            } catch (Exception error) {
                runOnUiThread(() -> {
                    captureInFlight = false;
                    captureButton.setEnabled(camera != null);
                    doneButton.setEnabled(!photos.isEmpty());
                    fail("تعذر التقاط الصورة. حاول مرة أخرى.");
                });
            }
        });
    }

    private void saveCapturedImage(Image image) {
        if (image == null) return;
        File output = null;
        boolean staged = false;
        try (Image captured = image) {
            ByteBuffer buffer = captured.getPlanes()[0].getBuffer();
            byte[] bytes = new byte[buffer.remaining()];
            buffer.get(bytes);
            File directory = new File(getFilesDir(), "visit-camera-captures");
            if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("تعذر حفظ الصورة محلياً.");
            output = new File(directory, "capture-" + java.util.UUID.randomUUID() + ".jpg");
            try (FileOutputStream stream = new FileOutputStream(output)) {
                stream.write(bytes);
                stream.flush();
                stream.getFD().sync();
            }
            JSONObject item = new JSONObject();
            item.put("sourceUri", android.net.Uri.fromFile(output).toString());
            item.put("capturedAt", captureTimestamp);
            item.put("location", captureLocation == null ? JSONObject.NULL : captureLocation);
            int photoIndex;
            int photoCount;
            synchronized (photos) {
                photoIndex = startIndex + photos.size();
                item.put("photoIndex", photoIndex);
                item.put("captureId", java.util.UUID.randomUUID().toString());
                try (RepLocalStore store = new RepLocalStore(this)) {
                    if (RepAuthStore.repId(this) != repId) throw new SecurityException("Representative changed during camera capture.");
                    store.stageVisitPhoto(this, repId, visitUuid, phase, photoIndex, item.getString("captureId"),
                        output.getAbsolutePath(), captureTimestamp, captureLocation);
                }
                staged = true;
                photos.add(item);
                photoCount = photos.size();
            }
            int countForUi = photoCount;
            runOnUiThread(() -> {
                captureInFlight = false;
                counter.setText("صور " + phaseLabel + " · " + countForUi + " / " + maxPhotos);
                doneButton.setEnabled(countForUi > 0);
                captureButton.setEnabled(countForUi < maxPhotos);
                if (countForUi == maxPhotos) captureButton.setText("بلغت الحد التقني للمجموعة");
            });
        } catch (Exception error) {
            if (!staged && output != null && output.exists()) output.delete();
            runOnUiThread(() -> { captureInFlight = false; captureButton.setEnabled(true); doneButton.setEnabled(!photos.isEmpty()); fail("تعذر حفظ الصورة على الهاتف؛ أعد التقاطها."); });
        }
    }

    private JSONObject currentGpsLocation(JSONObject fallback) {
        try {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null;
            LocationManager manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            Location best = null;
            for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER }) {
                try {
                    Location candidate = manager.getLastKnownLocation(provider);
                    if (candidate != null && (best == null || candidate.getTime() > best.getTime())) best = candidate;
                } catch (Exception ignored) {}
            }
            long now = System.currentTimeMillis();
            if (best == null || (now - best.getTime()) > 60_000L) {
                try {
                    String cachedJson = getSharedPreferences("madar_rep_duty", Context.MODE_PRIVATE).getString("last_location_json", null);
                    if (cachedJson != null) {
                        JSONObject locObj = new JSONObject(cachedJson);
                        if (!locObj.optBoolean("mocked", false) && locObj.has("updatedAt")) {
                            long cachedTime = java.time.Instant.parse(locObj.getString("updatedAt")).toEpochMilli();
                            if ((now - cachedTime) <= 5 * 60_000L && (best == null || cachedTime > best.getTime())) {
                                Location loc = new Location("duty_cache");
                                loc.setLatitude(locObj.getDouble("latitude"));
                                loc.setLongitude(locObj.getDouble("longitude"));
                                loc.setAccuracy((float) locObj.optDouble("accuracy", 25.0));
                                loc.setTime(cachedTime);
                                best = loc;
                            }
                        }
                    }
                } catch (Exception ignored) {}
            }
            boolean hasFreshBest = best != null && (now - best.getTime()) <= 3 * 60_000L && best.hasAccuracy() && best.getAccuracy() <= 250f;
            if (!hasFreshBest) {
                final java.util.concurrent.CountDownLatch latch = new java.util.concurrent.CountDownLatch(1);
                final Location[] fresh = new Location[1];
                final LocationListener oneShotListener = new LocationListener() {
                    @Override
                    public void onLocationChanged(Location loc) {
                        if (loc != null && !RepLocationPlugin.isMockLocation(loc)) {
                            fresh[0] = loc;
                        }
                        latch.countDown();
                    }
                };
                runOnUiThread(() -> {
                    try {
                        if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                            manager.requestSingleUpdate(LocationManager.GPS_PROVIDER, oneShotListener, Looper.getMainLooper());
                        } else if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                            manager.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, oneShotListener, Looper.getMainLooper());
                        } else {
                            latch.countDown();
                        }
                    } catch (Exception ex) {
                        latch.countDown();
                    }
                });
                try {
                    latch.await(300, java.util.concurrent.TimeUnit.MILLISECONDS);
                } catch (InterruptedException ignored) {}
                runOnUiThread(() -> {
                    try { manager.removeUpdates(oneShotListener); } catch (Exception ignored) {}
                });
                if (fresh[0] != null) best = fresh[0];
            }
            if (best != null) {
                if (RepLocationPlugin.isMockLocation(best)) return null;
                long age = now - best.getTime();
                if (age >= -30_000L && age <= 5 * 60_000L && best.hasAccuracy() && best.getAccuracy() <= 350f) {
                    JSONObject result = new JSONObject();
                    result.put("latitude", best.getLatitude());
                    result.put("longitude", best.getLongitude());
                    result.put("accuracy", best.getAccuracy());
                    result.put("updatedAt", isoTimestamp(best.getTime()));
                    return result;
                }
            }
            if (fallback != null) {
                if (fallback.optBoolean("mocked", false) || fallback.optBoolean("isMocked", false)) return null;
                long fallbackTime = java.time.Instant.parse(fallback.getString("updatedAt")).toEpochMilli();
                long age = now - fallbackTime;
                double accuracy = fallback.getDouble("accuracy");
                if (age >= -30_000L && age <= 5 * 60_000L && accuracy >= 0 && accuracy <= 100
                    && fallback.getDouble("latitude") >= -90 && fallback.getDouble("latitude") <= 90
                    && fallback.getDouble("longitude") >= -180 && fallback.getDouble("longitude") <= 180) return fallback;
            }
            return null;
        } catch (Exception ignored) { return null; }
    }

    private void finishWithPhotos() {
        if (captureInFlight) return;
        ArrayList<JSONObject> resultCopy;
        synchronized (photos) { resultCopy = new ArrayList<>(photos); }
        if (resultCopy.isEmpty()) return;
        Intent result = new Intent();
        JSONArray resultPhotos = new JSONArray();
        for (JSONObject photo : resultCopy) resultPhotos.put(photo);
        result.putExtra(EXTRA_PHOTOS, resultPhotos.toString());
        setResult(RESULT_OK, result);
        finish();
    }

    private void fail(String message) {
        if (isFinishing()) return;
        runOnUiThread(() -> {
            if (!isFinishing()) android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show();
        });
    }

    @Override public void onBackPressed() {
        if (captureInFlight) return;
        if (!photos.isEmpty()) finishWithPhotos();
        else { setResult(RESULT_CANCELED); finish(); }
    }

    private static String isoTimestamp(long milliseconds) {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date(milliseconds));
    }

    private void openCamera() {
        Handler handler = cameraHandler;
        if (handler != null) handler.post(this::openCameraOnThread);
    }

    private void openCameraOnThread() {
        if (paused || isFinishing() || camera != null || cameraOpening) return;
        cameraOpening = true;
        if (session != null) { session.close(); session = null; }
        try {
            CameraManager manager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics characteristics = manager.getCameraCharacteristics(id);
                if (characteristics.get(CameraCharacteristics.LENS_FACING) != CameraCharacteristics.LENS_FACING_BACK) continue;
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
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    cameraOpening = false;
                    fail("يلزم السماح للكاميرا من إعدادات التطبيق.");
                    return;
                }
                manager.openCamera(cameraId, new CameraDevice.StateCallback() {
                    @Override public void onOpened(CameraDevice device) {
                        cameraOpening = false;
                        if (paused || isFinishing()) { device.close(); return; }
                        camera = device;
                        configurePreview();
                    }
                    @Override public void onDisconnected(CameraDevice device) {
                        cameraOpening = false;
                        device.close();
                        if (camera == device) camera = null;
                    }
                    @Override public void onError(CameraDevice device, int error) {
                        cameraOpening = false;
                        device.close();
                        if (camera == device) camera = null;
                        fail("تعذر تشغيل كاميرا الهاتف.");
                    }
                }, cameraHandler);
                return;
            }
            cameraOpening = false;
            fail("لا توجد كاميرا خلفية متاحة.");
        } catch (Exception error) {
            cameraOpening = false;
            fail(error.getMessage() == null ? "تعذر فتح الكاميرا." : error.getMessage());
        }
    }

    private void closeCamera() {
        if (session != null) { session.close(); session = null; }
        if (camera != null) { camera.close(); camera = null; }
        if (imageReader != null) { imageReader.close(); imageReader = null; }
        cameraOpening = false;
    }

    @Override protected void onPause() {
        paused = true;
        Handler handler = cameraHandler;
        if (handler != null) handler.post(this::closeCamera);
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        paused = false;
        if (preview != null && preview.isAvailable()) openCamera();
    }
    @Override protected void onDestroy() {
        paused = true;
        Handler handler = cameraHandler;
        if (handler != null) {
            handler.post(() -> {
                closeCamera();
                if (cameraThread != null) cameraThread.quitSafely();
            });
        } else if (cameraThread != null) {
            cameraThread.quitSafely();
        }
        super.onDestroy();
    }
}
