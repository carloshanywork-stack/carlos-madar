import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8');

test('Desktop package version is bumped to 1.0.5 in package.json and package-lock.json', () => {
  const pkg = JSON.parse(read('desktop-app/package.json'));
  assert.equal(pkg.version, '1.0.5', 'desktop-app/package.json must be 1.0.5');

  const lock = JSON.parse(read('desktop-app/package-lock.json'));
  assert.equal(lock.version, '1.0.5', 'desktop-app/package-lock.json top version must be 1.0.5');
  assert.equal(lock.packages[''].version, '1.0.5', 'desktop-app/package-lock.json root package version must be 1.0.5');
});

test('Client web bundle is compiled and synced into desktop-app/web/', () => {
  const webDir = resolve(projectRoot, 'desktop-app/web');
  assert.ok(existsSync(webDir), 'desktop-app/web must exist');
  assert.ok(existsSync(resolve(webDir, 'index.html')), 'desktop-app/web/index.html must exist');
  assert.ok(existsSync(resolve(webDir, 'asset-manifest.json')), 'desktop-app/web/asset-manifest.json must exist');

  const manifest = JSON.parse(readFileSync(resolve(webDir, 'asset-manifest.json'), 'utf8'));
  assert.ok(manifest['index.html'], 'manifest must include index.html entry');
  assert.ok(manifest['index.html'].dynamicImports.includes('src/modules/workshop/WorkshopOrderDetail.jsx'), 'manifest must include WorkshopOrderDetail');
  assert.ok(manifest['index.html'].dynamicImports.includes('src/modules/workshop/WorkshopPage.jsx'), 'manifest must include WorkshopPage');

  // Verify that Workshop / M1-M5 assets are present in bundle
  const indexHtml = readFileSync(resolve(webDir, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('assets/'), 'index.html should reference bundled assets');
});

test('Windows Electron installer MADAR-Windows-1.0.5-Setup.exe exists and is properly sized', () => {
  const exePath = resolve(projectRoot, 'dist-desktop/MADAR-Windows-1.0.5-Setup.exe');
  assert.ok(existsSync(exePath), 'MADAR-Windows-1.0.5-Setup.exe must exist in dist-desktop');

  const stat = statSync(exePath);
  assert.ok(stat.size > 50 * 1024 * 1024, `Installer size (${stat.size} bytes) should be > 50MB`);

  // Verify PE header starts with MZ
  const fd = readFileSync(exePath);
  assert.equal(fd.toString('ascii', 0, 2), 'MZ', 'File must be a valid Windows PE binary (MZ header)');
});

test('Authenticode code signature is verified with osslsigncode', () => {
  const exePath = resolve(projectRoot, 'dist-desktop/MADAR-Windows-1.0.5-Setup.exe');
  const pemPath = resolve(projectRoot, 'desktop/madar-codesign.pem');
  assert.ok(existsSync(pemPath), 'madar-codesign.pem must exist');

  const output = execFileSync('osslsigncode', [
    'verify',
    '-in', exePath,
    '-CAfile', pemPath,
  ], { encoding: 'utf8' });

  assert.match(output, /Signature verification: ok/, 'Signature verification must be ok');
  assert.match(output, /CN=MADAR ERP/, 'Signer subject must be CN=MADAR ERP');
  assert.match(output, /Succeeded/, 'osslsigncode verify must report Succeeded');
});

test('Release manifest latest.yml matches signed installer hashes and size', () => {
  const ymlPath = resolve(projectRoot, 'dist-desktop/latest.yml');
  assert.ok(existsSync(ymlPath), 'latest.yml must exist');
  const yml = read('dist-desktop/latest.yml');

  assert.match(yml, /version: 1\.0\.5/);
  assert.match(yml, /path: MADAR-Windows-1\.0\.5-Setup\.exe/);

  const exePath = resolve(projectRoot, 'dist-desktop/MADAR-Windows-1.0.5-Setup.exe');
  const buf = readFileSync(exePath);
  const sha256Hex = createHash('sha256').update(buf).digest('hex');
  const sha512Base64 = createHash('sha512').update(buf).digest('base64');
  const actualSize = statSync(exePath).size;

  assert.ok(yml.includes(sha256Hex), `latest.yml must contain calculated SHA256: ${sha256Hex}`);
  assert.ok(yml.includes(sha512Base64), `latest.yml must contain calculated SHA512 (base64): ${sha512Base64}`);
  assert.ok(yml.includes(`size: ${actualSize}`), `latest.yml must contain exact size: ${actualSize}`);
});

test('Windows automated install.ps1 and update.ps1 scripts exist and meet requirements', () => {
  const installPs1 = read('dist-desktop/install.ps1');
  const updatePs1 = read('dist-desktop/update.ps1');

  // Verify root cert registration command
  assert.match(installPs1, /certutil.*-addstore -f "Root"/);
  assert.match(updatePs1, /certutil.*-addstore -f "Root"/);

  // Verify silent execution
  assert.match(installPs1, /\/S/);
  assert.match(updatePs1, /\/S/);

  // Verify preservation of %APPDATA%\MADAR and SQLite databases
  assert.match(installPs1, /\$env:APPDATA.*MADAR/);
  assert.match(installPs1, /\.sqlite/);
  assert.match(updatePs1, /\$env:APPDATA.*MADAR/);
  assert.match(updatePs1, /\.sqlite/);
});
