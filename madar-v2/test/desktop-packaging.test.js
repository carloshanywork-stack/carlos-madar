import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8');

test('Windows desktop shell is isolated and restricted to its configured HTTPS server', () => {
  const main = read('desktop-app/main.cjs');
  const preload = read('desktop-app/preload.cjs');

  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /webSecurity: true/);
  assert.match(main, /The Windows app requires an HTTPS server origin/);
  assert.match(main, /will-navigate/);
  assert.match(main, /will-redirect/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /callback\(false\)/, 'unneeded browser permissions are denied by default');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('madarDesktop'/);
  assert.match(preload, /checkForUpdates: \(\) => ipcRenderer\.invoke/);
  assert.doesNotMatch(preload, /require\(['"]node:|process\.env|child_process|exec\(/);
});

test('Windows updater asks before download and does not clear app data', () => {
  const main = read('desktop-app/main.cjs');
  const builder = read('desktop/electron-builder.config.cjs');
  const settings = read('client/src/modules/settings/SettingsPage.jsx');

  assert.match(main, /autoUpdater\.autoDownload = false/);
  assert.match(main, /تحديث MADAR متاح/);
  assert.match(main, /تنزيل الآن/);
  assert.match(main, /لاحقاً/);
  assert.match(main, /quitAndInstall\(false, true\)/);
  assert.match(builder, /deleteAppDataOnUninstall: false/);
  assert.match(builder, /provider: 'generic'/);
  assert.match(settings, /desktopApp\.checkForUpdates\(\)/);
  assert.match(settings, /بيانات MADAR محفوظة على السيرفر/);
  assert.match(settings, /تطبيق Windows قريباً/);
});

test('desktop release build requires HTTPS endpoints and a Windows signing identity', () => {
  const build = read('scripts/build-desktop.js');
  const packageJson = JSON.parse(read('package.json'));
  const ignore = read('.gitignore');

  assert.match(build, /MADAR_DESKTOP_SERVER_URL/);
  assert.match(build, /MADAR_DESKTOP_UPDATE_URL/);
  assert.match(build, /MADAR_WINDOWS_PUBLISHER_NAME/);
  assert.match(build, /CSC_LINK/);
  assert.match(build, /WIN_CSC_LINK/);
  assert.match(build, /CSC_NAME/);
  assert.match(build, /runtime-config\.json/);
  assert.match(build, /install-desktop-deps\.js/);
  assert.equal(packageJson.scripts['desktop:dev'], 'node scripts/run-desktop.js');
  assert.equal(packageJson.devDependencies.electron, undefined,
    'Electron must not be installed with MADAR V2 backend dependencies on Ubuntu');
  assert.equal(packageJson.devDependencies['electron-builder'], undefined,
    'Electron Builder must not be installed with MADAR V2 backend dependencies on Ubuntu');
  const desktopPackage = JSON.parse(read('desktop-app/package.json'));
  assert.ok(desktopPackage.dependencies['electron-updater']);
  assert.equal(desktopPackage.dependencies['better-sqlite3'], undefined, 'the Windows shell must not package the server database driver');
  const buildPackage = JSON.parse(read('desktop-build/package.json'));
  assert.ok(buildPackage.dependencies.electron);
  assert.ok(buildPackage.dependencies['electron-builder']);
  assert.equal(JSON.parse(read('package-lock.json')).packages['node_modules/electron'], undefined,
    'the backend lockfile must not include Windows-only desktop build dependencies');
  assert.match(read('desktop/electron-builder.config.cjs'), /app: 'desktop-app'/,
    'Electron Builder must package the minimal desktop application, not the API dependency tree');
  assert.match(ignore, /^desktop-app\/runtime-config\.json$/m);
  assert.match(ignore, /^desktop-build\/node_modules\/$/m);
  assert.match(ignore, /^build\/windows\/$/m);
  const icon = readFileSync(resolve(projectRoot, 'desktop/madar.ico'));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 1);
  assert.equal(icon.readUInt32LE(18), 22);
});

test('desktop app bundles local web client, provides loopback proxy, offline fallback, and persistent server config', () => {
  const main = read('desktop-app/main.cjs');
  const preload = read('desktop-app/preload.cjs');
  const offline = read('desktop-app/offline.html');
  const serverSettings = read('desktop-app/server-settings.html');
  const build = read('scripts/build-desktop.js');

  assert.match(main, /startLoopbackServer/);
  assert.match(main, /server-config\.json/);
  assert.match(main, /offline\.html/);
  assert.match(main, /server-settings\.html/);
  assert.match(main, /did-fail-load/);
  assert.match(main, /madar:desktop:get-server-config/);
  assert.match(main, /madar:desktop:set-server-config/);
  assert.match(main, /madar:desktop:test-server/);
  assert.match(main, /madar:desktop:open-server-settings/);
  assert.match(main, /madar:desktop:reload/);
  assert.match(preload, /getServerConfig/);
  assert.match(preload, /setServerConfig/);
  assert.match(preload, /testServer/);
  assert.match(preload, /openServerSettings/);
  assert.match(offline, /الاتصال بالخادم/);
  assert.match(offline, /serverUrl/);
  assert.match(offline, /testBtn/);
  assert.match(offline, /saveBtn/);
  assert.match(serverSettings, /إعدادات الاتصال بالخادم/);
  assert.match(build, /desktop-app\/web/);
  assert.match(build, /client\/dist/);
});
