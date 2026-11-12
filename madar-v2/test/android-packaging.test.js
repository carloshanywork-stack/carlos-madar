import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8');

test('Android application ID, namespace, Capacitor ID, and native packages are aligned', () => {
  const gradle = read('android/app/build.gradle');
  const capacitor = read('capacitor.config.ts');
  const buildScript = read('scripts/build-android.js');
  const generatedCapacitor = JSON.parse(read('android/app/src/main/assets/capacitor.config.json'));
  const strings = read('android/app/src/main/res/values/strings.xml');
  const instrumentedTest = read('android/app/src/androidTest/java/com/madar/rep/app/ExampleInstrumentedTest.java');

  assert.match(gradle, /namespace\s*=\s*["']com\.madar\.rep\.app["']/);
  assert.match(gradle, /applicationId\s+["']com\.madar\.rep\.app["']/);
  assert.match(capacitor, /appId:\s*'com\.madar\.rep\.app'/);
  assert.match(capacitor, /MADAR_REP_SERVER_URL/);
  assert.match(capacitor, /Non-local MADAR_REP_SERVER_URL must use HTTPS/);
  assert.match(capacitor, /MADAR_REP_LIVE_RELOAD/);
  assert.match(capacitor, /const standaloneBuild = !liveReloadBuild/);
  assert.match(buildScript, /const liveReloadBuild = process\.argv\.includes\('--live-reload'\)/);
  assert.match(buildScript, /process\.env\.MADAR_REP_LIVE_RELOAD = liveReloadBuild \? 'true' : 'false'/);
  assert.match(buildScript, /capacitorConfig\.server\?\.url/);
  assert.match(buildScript, /http:\/\/localhost:3000/);
  assert.match(capacitor, /liveReloadBuild \? \{/);
  assert.match(capacitor, /CapacitorHttp: \{ enabled: standaloneBuild \}/);
  assert.match(capacitor, /CapacitorCookies: \{ enabled: standaloneBuild \}/);
  assert.match(capacitor, /loggingBehavior: releaseBuild \? 'none' : 'debug'/);
  assert.equal(generatedCapacitor.appId, 'com.madar.rep.app');
  assert.equal(generatedCapacitor.server, undefined, 'default Android packaging must use the bundled UI and must not navigate to localhost');
  assert.equal(generatedCapacitor.plugins.CapacitorHttp.enabled, true);
  assert.equal(generatedCapacitor.plugins.CapacitorCookies.enabled, true);
  assert.match(strings, /<string name="package_name">com\.madar\.rep\.app<\/string>/);
  assert.match(strings, /<string name="custom_url_scheme">com\.madar\.rep\.app<\/string>/);
  assert.match(instrumentedTest, /assertEquals\("com\.madar\.rep\.app", appContext\.getPackageName\(\)\)/);

  for (const source of [
    'MainActivity.java', 'RepLocationPlugin.java', 'RepLocationService.java', 'RepTrackStore.java',
    'RepNativeEnginePlugin.java', 'RepBiometricAuth.java', 'RepLocalStore.java', 'RepAuthStore.java', 'MadarSyncScheduler.java', 'MadarSyncWorker.java',
  ]) {
    const path = `android/app/src/main/java/com/madar/rep/app/${source}`;
    assert.ok(existsSync(resolve(projectRoot, path)), `${path} should be in the app namespace package`);
    assert.match(read(path), /^package com\.madar\.rep\.app;/m);
  }
});

test('native rep gate, private SQLite queue, and WorkManager upload contract are configured', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const activity = read('android/app/src/main/java/com/madar/rep/app/MainActivity.java');
  const engine = read('android/app/src/main/java/com/madar/rep/app/RepNativeEnginePlugin.java');
  const store = read('android/app/src/main/java/com/madar/rep/app/RepLocalStore.java');
  const worker = read('android/app/src/main/java/com/madar/rep/app/MadarSyncWorker.java');
  const scheduler = read('android/app/src/main/java/com/madar/rep/app/MadarSyncScheduler.java');
  const secureStore = read('android/app/src/main/java/com/madar/rep/app/RepAuthStore.java');
  const biometric = read('android/app/src/main/java/com/madar/rep/app/RepBiometricAuth.java');
  const gradle = read('android/app/build.gradle');
  const gate = read('client/src/NativePermissionGate.jsx');
  const nativeBridges = read('client/src/modules/rep/native-bridges.js');
  const visitSheet = read('client/src/modules/rep/MachineVisitSheet.jsx');
  const locationService = read('android/app/src/main/java/com/madar/rep/app/RepLocationService.java');
  const repApp = read('client/src/modules/rep/RepApp.jsx');
  const nativeSession = read('client/src/modules/rep/native-session.js');

  assert.match(activity, /ActivityResultContracts\.RequestMultiplePermissions/);
  assert.match(activity, /registerPlugin\(RepNativeEnginePlugin\.class\)/);
  assert.match(gate, /requestInitialPermissions/);
  assert.match(gate, /requestBackgroundPermission/);
  assert.match(gate, /openAppSettings/);
  assert.match(gate, /requestBatteryExemption/);
  for (const permission of ['CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'POST_NOTIFICATIONS']) {
    assert.match(manifest, new RegExp(`android.permission.${permission}`));
  }
  assert.match(secureStore, /EncryptedSharedPreferences\.create/);
  assert.match(gradle, /androidx\.biometric:biometric/);
  assert.match(biometric, /BiometricManager\.from\(context\)\.canAuthenticate/);
  assert.match(engine, /authenticateAttendance/);
  assert.match(engine, /activity\.runOnUiThread\(\(\) -> \{/);
  assert.match(engine, /biometricPromptStarting/);
  assert.match(engine, /call\.reject\("تعذر فتح نافذة المصادقة الحيوية\."[,\s]*"BIOMETRIC_PROMPT_FAILED"[,\s]*error\)/);
  assert.match(biometric, /DEVICE_CREDENTIAL/);
  assert.match(biometric, /setDeviceCredentialAllowed\(true\)/);
  assert.match(engine, /\.put\("verified", true\)/);
  assert.match(engine, /isoTimestamp\(new Date\(\)\)/);
  assert.doesNotMatch(manifest, /android\.permission\.(?:BLUETOOTH|BLUETOOTH_SCAN|BLUETOOTH_CONNECT|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_IMAGES)/);
  assert.match(gradle, /androidx\.work:work-runtime/);
  assert.match(gradle, /security-crypto/);
  assert.match(store, /CREATE TABLE machines/);
  assert.match(store, /CREATE TABLE fault_reasons/);
  assert.match(store, /CREATE TABLE pending_visits/);
  assert.match(store, /CREATE TABLE visit_photos/);
  assert.match(store, /pending_attendance_actions/);
  assert.match(store, /pending_attendance_sync/);
  assert.match(store, /attendance_rejected/);
  assert.match(store, /markAttendanceRejected/);
  assert.match(store, /pending_machine_actions/);
  assert.match(store, /blockingMachineCardIds/);
  assert.match(store, /markMachineActionPendingApproval/);
  assert.match(worker, /processMachineActions/);
  assert.match(worker, /confirm-location/);
  assert.match(worker, /\/corrections/);
  assert.match(worker, /markAttendanceRejected/);
  assert.match(worker, /String serverMessage = result == null[\s\S]*?optString\("error"/,
    'the native sync worker extracts the actual API error for local administrator reconciliation');
  assert.match(worker, /markAttendanceRejected\(attendanceAction\.actionUuid,[\s\S]*?serverMessage[\s\S]*?\);\s*continue;/,
    'a rejected attendance item is preserved with the server reason and does not block later queue work');
  assert.match(store, /UPDATE pending_attendance_actions SET status = 'attendance_rejected',[\s\S]*?last_error = \?/,
    'permanently rejected attendance remains in local SQLite with its actual error text');
  assert.match(worker, /Set<Long> blockedCardIds = store\.blockingMachineCardIds\(repId\);[\s\S]*?store\.nextVisit\(repId, blockedCardIds\)/,
    'attendance rejection does not prevent the independent visit queue from syncing');
  assert.match(worker, /blockingMachineCardIds/);
  assert.match(worker, /acknowledgeTrackingBatch/);
  assert.match(worker, /clientPointId/);
  assert.match(nativeBridges, /enqueueNativeMachineAction/);
  assert.match(nativeBridges, /listNativeMachineActions/);
  assert.match(repApp, /enqueueNativeMachineAction/);
  assert.match(repApp, /listNativeMachineActions/);
  assert.match(store, /seenPaths\.add\(photoFile\.getPath\(\)\)/);
  assert.match(store, /validNewFilename/);
  const trackStore = read('android/app/src/main/java/com/madar/rep/app/RepTrackStore.java');
  assert.match(trackStore, /TABLE = "breadcrumbs"/);
  assert.match(trackStore, /CREATE TABLE IF NOT EXISTS/);
  assert.match(trackStore, /rep_id INTEGER NOT NULL DEFAULT 0/);
  assert.match(trackStore, /pendingTrail\(long repId\)/);
  assert.match(trackStore, /rejected_breadcrumbs/);
  assert.match(trackStore, /DATABASE_VERSION = 4/);
  assert.match(scheduler, /NetworkType\.CONNECTED/);
  assert.match(scheduler, /15,\s*TimeUnit\.MINUTES/);
  assert.match(worker, /addFormDataPart\("visit"/);
  assert.match(worker, /addFormDataPart\(field, filename/);
  assert.match(worker, /response\.code\(\) == 202[\s\S]*?Result\.retry\(\)/);
  assert.match(worker, /response\.code\(\) == 200[\s\S]*?markSynced/);
  assert.match(worker, /Authorization/);
  assert.match(worker, /x-madar-native-client/);
  assert.match(worker, /\/api\/rep\/attendance\/sync/);
  assert.match(worker, /flushTracking\(/);
  const photoProcessor = engine.slice(engine.indexOf('private File writeWatermarkedPhoto'), engine.indexOf('private File visitPhotoDirectory'));
  assert.match(photoProcessor, /ExifInterface\(input\)\.getAttributeInt\(ExifInterface\.TAG_ORIENTATION/);
  assert.match(photoProcessor, /Bitmap oriented = orient\(decoded, orientation\)/);
  assert.match(photoProcessor, /oriented\.getWidth\(\) > oriented\.getHeight\(\)[\s\S]*?portraitMatrix\.setRotate\(90f\)/);
  assert.match(photoProcessor, /drawWatermark\(scaled, watermark, location, phase\)/);
  const watermarkRenderer = engine.slice(engine.indexOf('private static Bitmap drawWatermark'));
  for (const watermarkField of ['machineCode', 'machineName', 'repName', 'capturedAt', 'latitude', 'longitude', 'accuracy']) {
    assert.match(watermarkRenderer, new RegExp(watermarkField));
  }
  assert.match(visitSheet, /photos\.before\.length !== 3 \|\| photos\.after\.length > 3/);
  assert.match(visitSheet, /const remaining = 3 - photos\[phase\]\.length/);
  assert.match(engine, /new File\(new File\(getContext\(\)\.getFilesDir\(\), "visits"\), visitUuid\)/);
  assert.match(nativeBridges, /sourceUri: photo\.path/);
  assert.match(nativeBridges, /enqueueNativeAttendanceAction/);
  assert.match(repApp, /attendance\/sync/);
  assert.match(repApp, /pendingAttendanceActions/);
  assert.match(nativeSession, /x-madar-native-client/);
  assert.match(locationService, /MOVING_SPEED_METERS_PER_SECOND = 2f \/ 3\.6f/);
  assert.match(locationService, /مدار - جاري تتبع المسار الميداني/);
  assert.doesNotMatch(nativeBridges.match(/export async function captureNativeCameraPhoto\(\)[\s\S]*?\n\}/)?.[0] ?? '', /fetch\(|\.blob\(/);
  assert.match(visitSheet, /processNativeVisitPhoto/);
  assert.match(visitSheet, /path: saved\.path/);
  assert.match(visitSheet, /await deleteNativeVisitPhoto/);
  assert.match(visitSheet, /result\?\.deleted === false/);
});

test('FileProvider authority is application-specific and only exposes app-owned camera files', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const paths = read('android/app/src/main/res/xml/file_paths.xml');
  const provider = manifest.match(/<provider\b[\s\S]*?<\/provider>/)?.[0];

  assert.ok(provider, 'manifest should declare the camera FileProvider');
  assert.match(provider, /android:authorities="\$\{applicationId\}\.fileprovider"/);
  assert.match(provider, /android:exported="false"/);
  assert.match(provider, /android:grantUriPermissions="true"/);
  assert.match(provider, /android:name="android\.support\.FILE_PROVIDER_PATHS"/);
  assert.match(provider, /android:resource="@xml\/file_paths"/);
  assert.match(paths, /<external-files-path\b[^>]*name="rep_camera_images"[^>]*path="Pictures\/"/);
  assert.match(paths, /<cache-path\b[^>]*name="rep_camera_cache"/);
  assert.doesNotMatch(paths, /<external-path\b/);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:hardwareAccelerated="true"/);
});

test('representative Android bundle stays local in standalone mode and lazy-loads capture and map modules', () => {
  const vite = read('client/vite.config.js');
  const api = read('client/src/lib/api.js');
  const capacitor = read('capacitor.config.ts');
  const nativeBridges = read('client/src/modules/rep/native-bridges.js');
  const rep = read('client/src/modules/rep/RepApp.jsx');
  const offlineMapPanel = read('client/src/modules/rep/OfflineMapPanel.jsx');
  const offlineRouteMap = read('client/src/modules/rep/OfflineRouteMap.jsx');
  assert.match(vite, /__MADAR_API_BASE_URL__/);
  assert.match(vite, /Standalone Android build needs a valid HTTPS MADAR_REP_SERVER_URL/);
  assert.match(vite, /MADAR_REP_LIVE_RELOAD/);
  assert.match(vite, /capacitorBuild && !liveReloadBuild/);
  assert.match(api, /new URL\(path, `\$\{API_BASE_URL\}\/`\)/);
  assert.match(capacitor, /webDir: 'public\/rep'/);
  assert.match(capacitor, /liveReloadBuild \? \{/);
  assert.match(capacitor, /server:\s*\{\s*url: serverUrl\.toString\(\)/);
  assert.match(nativeBridges, /if \(!isPermissionGranted\(status\.location\)\)/);
  assert.match(nativeBridges, /requestPermissions\(\{ permissions: \['location'\] \}\)/);
  assert.match(rep, /lazy\(\(\) => import\('\.\/MachineVisitSheet\.jsx'\)\)/);
  assert.match(rep, /lazy\(\(\) => import\('\.\/OfflineMapPanel\.jsx'\)\)/);
  assert.match(rep, /await saveGpsSample\(userId, location\)/);
  assert.match(rep, /attendance\/sync[\s\S]*?timeoutMs: 15000/);
  assert.doesNotMatch(rep, /from ['"].*modules\/(?:finance|warehouse|workshop|accounting)\//);
  assert.match(rep, /MAX_CLOCK_ACCURACY_METERS = 250/);
  assert.match(rep, /lastLocation: location/);
  assert.match(offlineMapPanel, /timeoutMs: 6000/);
  assert.match(offlineMapPanel, /attempt <= 3/);
  assert.match(offlineMapPanel, /slice\(index, index \+ 6\)/);
  assert.match(offlineMapPanel, /Promise\.allSettled/);
  assert.match(offlineMapPanel, /listOfflineMapTileKeys/);
  assert.match(offlineMapPanel, /\['ready', 'partial'\]/);
  assert.match(offlineRouteMap, /rep-map-machine-popup/);
  assert.match(offlineRouteMap, /ابدأ الزيارة/);
});

test('release signing credentials are loaded locally and missing signing blocks release builds', () => {
  const gradle = read('android/app/build.gradle');
  const buildScript = read('scripts/build-android.js');
  const ignore = read('.gitignore');
  const paths = read('server/config/paths.js');
  const keyTemplate = read('android/key.properties.example');
  const versionFile = read('android/version.properties');

  assert.match(gradle, /rootProject\.file\('key\.properties'\)/);
  assert.match(gradle, /gradle\.taskGraph\.whenReady/);
  assert.match(gradle, /Release signing is not configured/);
  assert.match(buildScript, /android\/key\.properties/);
  assert.match(buildScript, /madar-rep-release\.apk/);
  assert.match(ignore, /^key\.properties$/m);
  assert.match(ignore, /^madar-rep-release\.apk$/m);
  assert.match(paths, /existsSync\(join\(projectRoot, 'madar-rep-release\.apk'\)\)/);
  assert.match(paths, /existsSync\(join\(projectRoot, 'madar-rep\.apk'\)\)/);
  assert.match(keyTemplate, /^storeFile=/m);
  assert.match(keyTemplate, /^storePassword=REPLACE_WITH_/m);
  assert.match(versionFile, /^versionCode=\d+$/m);
  assert.match(versionFile, /^versionName=\d+\.\d+\.\d+$/m);
  assert.match(gradle, /rootProject\.file\('version\.properties'\)/);
  assert.match(gradle, /MADAR_REP_VERSION_CODE/);
  assert.match(gradle, /MADAR_REP_VERSION_NAME/);
  assert.match(gradle, /versionCode repVersionCode/);
  assert.match(gradle, /versionName repVersionName/);
  assert.match(buildScript, /android\/version\.properties/);
  assert.match(buildScript, /Android version:/);
});
