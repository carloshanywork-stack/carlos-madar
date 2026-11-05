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
  assert.match(engine, /\.put\("verified", true\)/);
  assert.match(engine, /isoTimestamp\(new Date\(\)\)/);
  assert.doesNotMatch(manifest, /android\.permission\.(?:BLUETOOTH|BLUETOOTH_SCAN|BLUETOOTH_CONNECT|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|READ_MEDIA_IMAGES)/);
  assert.match(gradle, /androidx\.work:work-runtime/);
  assert.match(gradle, /security-crypto/);
  assert.match(store, /CREATE TABLE machines/);
  assert.match(store, /CREATE TABLE fault_reasons/);
  assert.match(store, /CREATE TABLE pending_visits/);
  assert.match(store, /CREATE TABLE visit_photos/);
  assert.match(store, /seenPaths\.add\(photoFile\.getPath\(\)\)/);
  assert.match(store, /validNewFilename/);
  const trackStore = read('android/app/src/main/java/com/madar/rep/app/RepTrackStore.java');
  assert.match(trackStore, /TABLE = "breadcrumbs"/);
  assert.match(trackStore, /CREATE TABLE IF NOT EXISTS/);
  assert.match(scheduler, /NetworkType\.CONNECTED/);
  assert.match(scheduler, /15,\s*TimeUnit\.MINUTES/);
  assert.match(worker, /addFormDataPart\("visit"/);
  assert.match(worker, /addFormDataPart\(field, filename/);
  assert.match(worker, /response\.code\(\) == 202[\s\S]*?Result\.retry\(\)/);
  assert.match(worker, /response\.code\(\) == 200[\s\S]*?markSynced/);
  assert.match(worker, /Authorization/);
  assert.match(engine, /new File\(new File\(getContext\(\)\.getFilesDir\(\), "visits"\), visitUuid\)/);
  assert.match(nativeBridges, /sourceUri: photo\.path/);
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
  assert.match(rep, /clock-\$\{action\}[\s\S]*?timeoutMs: 15000/);
  assert.doesNotMatch(rep, /from ['"].*modules\/(?:finance|warehouse|workshop|accounting)\//);
  assert.match(rep, /MAX_CLOCK_ACCURACY_METERS = 250/);
  assert.match(rep, /lastLocation: location/);
});

test('release signing credentials are loaded locally and missing signing blocks release builds', () => {
  const gradle = read('android/app/build.gradle');
  const buildScript = read('scripts/build-android.js');
  const ignore = read('.gitignore');
  const paths = read('server/config/paths.js');
  const keyTemplate = read('android/key.properties.example');

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
});
