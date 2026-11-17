import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectories = [resolve(projectRoot, 'desktop-app'), resolve(projectRoot, 'desktop-build')];
const childEnvironment = { ...process.env };
for (const key of [
  'npm_config_local_prefix', 'npm_config_prefix', 'npm_config_argv', 'npm_config_workspace',
  'npm_config_allow_scripts', 'npm_execpath', 'npm_node_execpath',
]) {
  delete childEnvironment[key];
}
for (const packageDirectory of packageDirectories) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = npmExecPath
    ? [npmExecPath, 'ci', '--ignore-scripts', ...(packageDirectory.endsWith('desktop-app') ? ['--omit=dev'] : [])]
    : ['ci', '--ignore-scripts', ...(packageDirectory.endsWith('desktop-app') ? ['--omit=dev'] : [])];
  const result = spawnSync(command, args, {
    cwd: packageDirectory,
    stdio: 'inherit',
    shell: !npmExecPath && process.platform === 'win32',
    env: childEnvironment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const electronInstall = spawnSync(process.execPath, [resolve(projectRoot, 'desktop-build/node_modules/electron/install.js')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: childEnvironment,
});
if (electronInstall.error) throw electronInstall.error;

// Ensure NSIS target extracts uninstaller via UninstallerReader on Linux without Wine
try {
  const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
  const nsisTargetFile = resolve(projectRoot, 'desktop-build/node_modules/app-builder-lib/out/targets/nsis/NsisTarget.js');
  if (existsSync(nsisTargetFile)) {
    let content = readFileSync(nsisTargetFile, 'utf8');
    const targetBlock = '        if ((0, macosVersion_1.isMacOsCatalina)()) {\n            try {\n                await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);';
    if (content.includes(targetBlock) && !content.includes('let uninstallerExtracted = false;')) {
      const replacementBlock = `        let uninstallerExtracted = false;
        try {
            await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);
            uninstallerExtracted = true;
        } catch (e) {}
        if (!uninstallerExtracted) {
        if ((0, macosVersion_1.isMacOsCatalina)()) {
            try {
                await nsisUtil_1.UninstallerReader.exec(installerPath, uninstallerPath);`;
      const oldTail = 'await wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });\n        }\n        await packager.signIf(uninstallerPath);';
      const newTail = 'await wineVm.exec(installerPath, [], { env: { __COMPAT_LAYER: "RunAsInvoker" } });\n            }\n        }\n        await packager.signIf(uninstallerPath);';
      content = content.replace(targetBlock, replacementBlock).replace(oldTail, newTail);
      writeFileSync(nsisTargetFile, content, 'utf8');
      console.log('[InstallDesktopDeps] Applied NSIS uninstaller extractor patch.');
    }
  }
} catch (patchErr) {
  console.warn('[InstallDesktopDeps] Could not patch NsisTarget.js:', patchErr.message);
}

process.exitCode = electronInstall.status ?? 1;
