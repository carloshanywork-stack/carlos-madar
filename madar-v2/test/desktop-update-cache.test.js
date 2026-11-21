import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import verification from '../desktop-app/update-security.cjs';
import webCache from '../desktop-app/web-cache.cjs';
import { sanitizeWindowsFilename, buildOperationalFilename } from '../client/src/lib/operational-filename.js';

const { readUpdateChannel, verifyWindowsInstaller, isMediaOrApiUrl, sanitizeDiagnostics } = verification;
const { commitWebBuild } = webCache;

test('the updater enables only the publisher and HTTPS feed packaged for a release', () => {
  const url = 'https://example.test/download/desktop/';
  const runtime = { releaseBuild: true, updateUrl: url, publisherName: 'MADAR ERP' };
  const config = { provider: 'generic', url, publisherName: ['MADAR ERP'] };
  assert.deepEqual(readUpdateChannel(runtime, config), { url, publisher: 'MADAR ERP' });
  assert.throws(() => readUpdateChannel(runtime, { ...config, publisherName: [] }));
  assert.throws(() => readUpdateChannel(runtime, { ...config, publisherName: ['Other Publisher'] }));
  assert.throws(() => readUpdateChannel({ ...runtime, releaseBuild: false }, config));
  const insecure = url.replace('https:', 'http:');
  assert.throws(() => readUpdateChannel({ ...runtime, updateUrl: insecure }, { ...config, url: insecure }));
});

test('failure to run the Windows signature verifier rejects the update', async () => {
  const rejected = await verifyWindowsInstaller('C:\\MADAR Setup.exe', 'MADAR ERP', async () => {
    throw new Error('Windows could not verify signature');
  });
  assert.ok(rejected);
});

function buildFixture(version, failDependency = false) {
  const file = `assets/main-${version}.js`;
  const html = `<!doctype html><script src="/${file}"></script>`;
  const dependency = `assets/lazy-${version}.js`;
  const manifest = { entry: { file, isEntry: true, dynamicImports: ['lazy'] }, lazy: { file: dependency } };
  const fetchFile = async (path) => {
    if (path === '/asset-manifest.json') {
      return { contentType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) };
    }
    if (path === `/${dependency}` && failDependency) return null;
    return { contentType: 'text/javascript', buffer: Buffer.from('export {}') };
  };
  return { html, fetchFile, dependency };
}

test('an interrupted lazy chunk download keeps the previous offline build available', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'madar-desktop-cache-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const initial = buildFixture('one');
  await commitWebBuild(directory, initial.html, initial.fetchFile);
  const next = buildFixture('two', true);
  await assert.rejects(commitWebBuild(directory, next.html, next.fetchFile));
  assert.equal(readFileSync(join(directory, 'index.html'), 'utf8'), initial.html);
  assert.equal(readFileSync(join(directory, initial.dependency), 'utf8'), 'export {}');
  await commitWebBuild(directory, next.html, buildFixture('two').fetchFile);
  assert.equal(readFileSync(join(directory, 'index.html'), 'utf8'), next.html);
  assert.equal(readFileSync(join(directory, next.dependency), 'utf8'), 'export {}');
});

test('a deploy race between the HTML response and manifest cannot publish mismatched assets', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'madar-desktop-cache-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(
    commitWebBuild(directory, buildFixture('one').html, buildFixture('two').fetchFile),
    /do not describe the same build/,
  );
  assert.throws(() => readFileSync(join(directory, 'index.html')));
});

test('sanitizeWindowsFilename sanitizes illegal characters, control characters, and reserved DOS device names', () => {
  // Reserved DOS device names
  assert.equal(sanitizeWindowsFilename('CON.jpg'), '_CON.jpg');
  assert.equal(sanitizeWindowsFilename('prn'), '_prn');
  assert.equal(sanitizeWindowsFilename('aux.png'), '_aux.png');
  assert.equal(sanitizeWindowsFilename('NUL'), '_NUL');
  assert.equal(sanitizeWindowsFilename('com1.txt'), '_com1.txt');
  assert.equal(sanitizeWindowsFilename('lpt9.dat'), '_lpt9.dat');

  // Illegal Windows characters (\ / : * ? " < > |) and control chars
  assert.equal(
    sanitizeWindowsFilename('report:test/one\\two*three?four"five<six>seven|eight\x01\x1f.png'),
    'report_test_one_two_three_four_five_six_seven_eight__.png',
  );

  // Trailing dots and spaces
  assert.equal(sanitizeWindowsFilename('test-file...   '), 'test-file');

  // Fallbacks
  assert.equal(sanitizeWindowsFilename('', 'fallback.jpg'), 'fallback.jpg');
  assert.equal(sanitizeWindowsFilename(null, 'fallback.jpg'), 'fallback.jpg');
});

test('buildOperationalFilename creates structured, Windows-safe filename for field and maintenance evidence', () => {
  const filename = buildOperationalFilename({
    machineCode: 'MC/102:A',
    phase: 'قبل الصيانة',
    timestamp: '2026-11-21T10:30:00.000Z',
    index: 0,
    originalUrl: '/storage/Areas/test.JPEG',
  });
  assert.equal(filename, 'MADAR_MC_102_A_قبل الصيانة_2026-11-21T10-30-00_1.jpg');

  const fallbackName = buildOperationalFilename({
    machineCode: 'NUL',
    phase: '',
    index: 1,
    originalUrl: 'https://example.com/assets/vector.svg?query=1',
  });
  assert.equal(fallbackName, 'MADAR__NUL_2.svg');
});

test('isMediaOrApiUrl catches media files, storage assets, and API routes to protect main window navigation', () => {
  // Storage and API paths
  assert.equal(isMediaOrApiUrl('/api/system/health'), true);
  assert.equal(isMediaOrApiUrl('/storage/Areas/rep_1/photo.jpg'), true);
  assert.equal(isMediaOrApiUrl('/download/apk?target=rep'), true);
  assert.equal(isMediaOrApiUrl('/download/desktop'), true);
  assert.equal(isMediaOrApiUrl('http://127.0.0.1:3000/storage/evidence.png'), true);

  // Media file extensions
  assert.equal(isMediaOrApiUrl('/files/photo.webp'), true);
  assert.equal(isMediaOrApiUrl('/files/document.pdf'), true);
  assert.equal(isMediaOrApiUrl('/files/archive.zip'), true);

  // Application routes (must NOT be treated as media or API downloads)
  assert.equal(isMediaOrApiUrl('/'), false);
  assert.equal(isMediaOrApiUrl('/orders'), false);
  assert.equal(isMediaOrApiUrl('/maintenance/123'), false);
  assert.equal(isMediaOrApiUrl('/settings'), false);
  assert.equal(isMediaOrApiUrl('http://127.0.0.1:49152/orders'), false);
  assert.equal(isMediaOrApiUrl(''), false);
  assert.equal(isMediaOrApiUrl(null), false);
});

test('sanitizeDiagnostics sanitizes telemetry without exposing credentials, sensitive query tokens, or arbitrary properties', () => {
  const raw = {
    uiSource: 'live-sync',
    loadedBuildVersion: 'assets/main-hash123.js',
    lastSyncTime: '2026-11-21T12:00:00.000Z',
    lastSyncError: null,
    secretToken: 'sensitive-token-12345',
    internalPath: 'C:\\Users\\Admin\\AppData\\Local\\madar',
  };

  const sanitized = sanitizeDiagnostics(raw, '1.0.4', 'https://user:password123@erp.madar.test:8443/some/path?token=secret');

  assert.deepEqual(sanitized, {
    electronVersion: '1.0.4',
    serverUrl: 'https://erp.madar.test:8443',
    loadedBuildVersion: 'assets/main-hash123.js',
    uiSource: 'live-sync',
    lastSyncTime: '2026-11-21T12:00:00.000Z',
    lastSyncError: null,
  });

  // Verify secret properties are stripped
  assert.equal('secretToken' in sanitized, false);
  assert.equal('internalPath' in sanitized, false);

  // Verify invalid uiSource falls back to 'unknown'
  const fallback = sanitizeDiagnostics({ uiSource: 'tampered-source' }, '1.0.4', '');
  assert.equal(fallback.uiSource, 'unknown');
  assert.equal(fallback.serverUrl, '');
});
