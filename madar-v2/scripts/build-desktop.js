import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { publishDesktopArtifacts } from './publish-desktop.js';

const projectRoot = resolve(import.meta.dirname, '..');
if (!process.env.ELECTRON_MIRROR) {
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
}
if (!process.env.ELECTRON_BUILDER_BINARIES_MIRROR) {
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/';
}
const releaseBuild = process.argv.includes('--release');
const serverUrlValue = process.env.MADAR_DESKTOP_SERVER_URL?.trim()
  || (releaseBuild ? '' : 'http://127.0.0.1:3000');

function parseHttpsUrl(value, label, { originOnly = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a valid URL.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be an HTTPS URL without credentials, query, or fragment.`);
  }
  if (originOnly && url.pathname !== '/') throw new Error(`${label} must be an HTTPS origin without a path.`);
  return url.toString().replace(/\/?$/, '/');
}

let serverUrl;
if (!serverUrlValue && releaseBuild) {
  throw new Error('Set MADAR_DESKTOP_SERVER_URL to the approved production HTTPS server before making a release build.');
}
if (serverUrlValue.startsWith('http://') && !releaseBuild
  && ['localhost', '127.0.0.1'].includes(new URL(serverUrlValue).hostname)) {
  serverUrl = new URL(serverUrlValue).origin;
} else {
  serverUrl = parseHttpsUrl(serverUrlValue, 'MADAR_DESKTOP_SERVER_URL', { originOnly: true });
}

const updateUrlValue = process.env.MADAR_DESKTOP_UPDATE_URL?.trim() || '';
const updateUrl = updateUrlValue ? parseHttpsUrl(updateUrlValue, 'MADAR_DESKTOP_UPDATE_URL') : '';
if (releaseBuild) {
  if (!updateUrl) throw new Error('Set MADAR_DESKTOP_UPDATE_URL to the HTTPS generic update feed before making a release build.');
  if (!process.env.MADAR_WINDOWS_PUBLISHER_NAME?.trim()) {
    throw new Error('Set MADAR_WINDOWS_PUBLISHER_NAME to the exact Windows code-signing publisher name.');
  }
  if (!process.env.CSC_LINK?.trim() && !process.env.WIN_CSC_LINK?.trim() && !process.env.CSC_NAME?.trim()) {
    throw new Error('Configure Windows code signing with CSC_LINK, WIN_CSC_LINK, or CSC_NAME before making a release build.');
  }
}

const desktopConfig = {
  serverUrl,
  updateUrl,
  releaseBuild,
};
writeFileSync(resolve(projectRoot, 'desktop-app/runtime-config.json'), `${JSON.stringify(desktopConfig, null, 2)}\n`, { mode: 0o600 });

// Build the client web assets and bundle them into desktop-app/web for offline/local execution
console.log('[BuildDesktop] Compiling web client bundle for desktop shell...');
const clientBuild = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: resolve(projectRoot, 'client'),
  stdio: 'inherit',
});
if (clientBuild.error) throw clientBuild.error;
if (clientBuild.status !== 0) process.exit(clientBuild.status ?? 1);

const webTarget = resolve(projectRoot, 'desktop-app/web');
rmSync(webTarget, { recursive: true, force: true });
mkdirSync(webTarget, { recursive: true });
cpSync(resolve(projectRoot, 'client/dist'), webTarget, { recursive: true });
console.log('[BuildDesktop] Bundled local client into desktop-app/web successfully.');

const install = spawnSync(process.execPath, [resolve(projectRoot, 'scripts/install-desktop-deps.js')], {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (install.error) throw install.error;
if (install.status !== 0) process.exit(install.status ?? 1);

const targetType = process.env.MADAR_WINDOWS_TARGET || 'nsis';
const args = ['--win', targetType, '--config', 'desktop/electron-builder.config.cjs', '--publish', 'never'];
const result = spawnSync(process.execPath, [resolve(projectRoot, 'desktop-build/node_modules/electron-builder/cli.js'), ...args], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, MADAR_DESKTOP_RELEASE_BUILD: releaseBuild ? 'true' : 'false' },
});

if (result.error) throw result.error;
if (result.status === 0) {
  try {
    publishDesktopArtifacts();
  } catch (err) {
    console.warn('[BuildDesktop] Could not stage desktop artifacts:', err.message);
  }
}
process.exitCode = result.status ?? 1;
