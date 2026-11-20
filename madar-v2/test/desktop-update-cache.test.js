import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import verification from '../desktop-app/update-security.cjs';
import webCache from '../desktop-app/web-cache.cjs';

const { readUpdateChannel, verifyWindowsInstaller } = verification;
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
