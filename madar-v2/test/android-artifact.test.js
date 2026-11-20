import assert from 'node:assert/strict';
import test from 'node:test';
import { assertApkIdentity, assertReleaseProgression } from '../scripts/android-artifact.js';

const advertised = { versionCode: 29, versionName: '2.4.9', apkSha256: 'same-file' };
const binary = { applicationId: 'com.madar.system.app', versionCode: 26, versionName: '2.4.6', debuggable: false };

test('a matching file hash does not excuse an APK binary version mismatch', () => {
  assert.throws(() => assertApkIdentity(
    { ...binary, apkSha256: advertised.apkSha256 },
    { ...advertised, applicationId: binary.applicationId, release: true },
  ), /versionCode is 26, expected 29/);
  assert.throws(() => assertApkIdentity(binary, { ...binary, applicationId: 'com.madar.rep.app' }), /applicationId/);
  assert.throws(() => assertApkIdentity({ ...binary, debuggable: true }, { ...binary, release: true }), /debuggable/);
});

test('manager release must supersede both published and advertised versions', () => {
  assert.throws(() => assertReleaseProgression(binary, binary, advertised), /greater than 29/);
  assert.doesNotThrow(() => assertReleaseProgression({ ...binary, versionCode: 30 }, binary, advertised));
});

test('a release code can only be reused for the identical coherent artifact', () => {
  const current = { ...binary, versionCode: 29, versionName: '2.4.9', apkSha256: 'same-file' };
  assert.doesNotThrow(() => assertReleaseProgression(current, current, advertised));
  assert.throws(() => assertReleaseProgression({ ...current, apkSha256: 'other-file' }, current, advertised), /greater than 29/);
  assert.throws(() => assertReleaseProgression(current, { ...current, apkSha256: 'different-binary' }, advertised), /greater than 29/);
});
