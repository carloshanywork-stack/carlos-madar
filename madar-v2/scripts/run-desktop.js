import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const result = spawnSync(process.execPath, [
  resolve(projectRoot, 'desktop-build/node_modules/electron/cli.js'),
  resolve(projectRoot, 'desktop-app/main.cjs'),
  ...process.argv.slice(2),
], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
