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
  const generatedCapacitor = JSON.parse(read('android/app/src/main/assets/capacitor.config.json'));
  const strings = read('android/app/src/main/res/values/strings.xml');
  const instrumentedTest = read('android/app/src/androidTest/java/com/madar/rep/app/ExampleInstrumentedTest.java');

  assert.match(gradle, /namespace\s*=\s*["']com\.madar\.rep\.app["']/);
  assert.match(gradle, /applicationId\s+["']com\.madar\.rep\.app["']/);
  assert.match(capacitor, /appId:\s*'com\.madar\.rep\.app'/);
  assert.match(capacitor, /MADAR_REP_SERVER_URL/);
  assert.match(capacitor, /Non-local MADAR_REP_SERVER_URL must use HTTPS/);
  assert.match(capacitor, /standaloneBuild \? \{\} :/);
  assert.match(capacitor, /CapacitorHttp: \{ enabled: standaloneBuild \}/);
  assert.match(capacitor, /CapacitorCookies: \{ enabled: standaloneBuild \}/);
  assert.match(capacitor, /loggingBehavior: releaseBuild \? 'none' : 'debug'/);
  assert.equal(generatedCapacitor.appId, 'com.madar.rep.app');
  assert.match(generatedCapacitor.server.url, /^https?:\/\//);
  assert.match(strings, /<string name="package_name">com\.madar\.rep\.app<\/string>/);
  assert.match(strings, /<string name="custom_url_scheme">com\.madar\.rep\.app<\/string>/);
  assert.match(instrumentedTest, /assertEquals\("com\.madar\.rep\.app", appContext\.getPackageName\(\)\)/);

  for (const source of ['MainActivity.java', 'RepLocationPlugin.java', 'RepLocationService.java', 'RepTrackStore.java']) {
    const path = `android/app/src/main/java/com/madar/rep/app/${source}`;
    assert.ok(existsSync(resolve(projectRoot, path)), `${path} should be in the app namespace package`);
    assert.match(read(path), /^package com\.madar\.rep\.app;/m);
  }
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
  assert.match(api, /new URL\(path, `\$\{API_BASE_URL\}\/`\)/);
  assert.match(capacitor, /webDir: 'public\/rep'/);
  assert.match(capacitor, /standaloneBuild \? \{\} : \{/);
  assert.match(capacitor, /server:\s*\{\s*url: serverUrl\.toString\(\)/);
  assert.match(nativeBridges, /if \(!isPermissionGranted\(status\.location\)\)/);
  assert.match(nativeBridges, /requestPermissions\(\{ permissions: \['location'\] \}\)/);
  assert.match(rep, /lazy\(\(\) => import\('\.\/MachineVisitSheet\.jsx'\)\)/);
  assert.match(rep, /lazy\(\(\) => import\('\.\/OfflineMapPanel\.jsx'\)\)/);
  assert.match(rep, /await saveGpsSample\(userId, location\)/);
  assert.match(rep, /clock-\$\{action\}.*timeoutMs: 15000/);
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
