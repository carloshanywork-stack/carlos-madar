import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8');

test('Android application ID, namespace, Capacitor ID, and native packages are aligned', () => {
  const gradle = read('android/app/build.gradle');
  const capacitor = JSON.parse(read('capacitor.config.json'));
  const generatedCapacitor = JSON.parse(read('android/app/src/main/assets/capacitor.config.json'));
  const strings = read('android/app/src/main/res/values/strings.xml');
  const instrumentedTest = read('android/app/src/androidTest/java/com/madar/rep/app/ExampleInstrumentedTest.java');

  assert.match(gradle, /namespace\s*=\s*["']com\.madar\.rep\.app["']/);
  assert.match(gradle, /applicationId\s+["']com\.madar\.rep\.app["']/);
  assert.equal(capacitor.appId, 'com.madar.rep.app');
  assert.equal(generatedCapacitor.appId, 'com.madar.rep.app');
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
});

test('release signing credentials are loaded locally and missing signing blocks release builds', () => {
  const gradle = read('android/app/build.gradle');
  const buildScript = read('scripts/build-android.js');
  const ignore = read('.gitignore');
  const paths = read('server/config/paths.js');

  assert.match(gradle, /rootProject\.file\('key\.properties'\)/);
  assert.match(gradle, /gradle\.taskGraph\.whenReady/);
  assert.match(gradle, /Release signing is not configured/);
  assert.match(buildScript, /android\/key\.properties/);
  assert.match(buildScript, /madar-rep-release\.apk/);
  assert.match(ignore, /^key\.properties$/m);
  assert.match(ignore, /^madar-rep-release\.apk$/m);
  assert.match(paths, /env\.repApkPath\s*\?\?\s*'madar-rep-release\.apk'/);
});
