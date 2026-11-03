// Runs the pull-based deploy check every 30 seconds.
// .cjs is required: madar-v2/package.json sets "type": "module".
const { execFile } = require('node:child_process');
const path = require('node:path');

const script = path.join(__dirname, 'auto-pull.sh');
const INTERVAL_MS = 30_000;
let running = false;

function check() {
  if (running) return;
  running = true;
  execFile(script, { timeout: 600_000 }, (error, stdout, stderr) => {
    running = false;
    const out = String(stdout).trim();
    const err = String(stderr).trim();
    if (out) console.log(out);
    if (err) console.error(err);
    if (error) console.error('auto-pull failed:', error.message);
  });
}

check();
setInterval(check, INTERVAL_MS);
console.log(`MADAR auto-deploy watcher started (every ${INTERVAL_MS / 1000}s)`);
