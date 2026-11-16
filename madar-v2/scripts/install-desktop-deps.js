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
process.exitCode = electronInstall.status ?? 1;
