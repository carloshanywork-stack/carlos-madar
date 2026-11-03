#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$PROJECT_DIR"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

printf '%s\n' '=========================================================='
printf '%s\n' '          MADAR V2 - Ubuntu Production Deployment         '
printf '%s\n' '=========================================================='

if [[ "${EUID}" -eq 0 ]]; then
  die 'Run this script as the unprivileged MADAR service/deployment user, not root.'
fi
[[ -f "$PROJECT_DIR/.env" ]] || die 'Missing .env. Copy .env.example to .env, set a strong MADAR_V2_JWT_SECRET, and configure production paths first.'
[[ ! -L "$PROJECT_DIR/.env" ]] || die '.env must be a regular file so its permissions can be protected.'
[[ -f "$PROJECT_DIR/package-lock.json" ]] || die 'Backend package-lock.json is missing; npm ci requires the committed lockfile.'
[[ -f "$PROJECT_DIR/client/package-lock.json" ]] || die 'Client package-lock.json is missing; npm ci requires the committed lockfile.'
grep -Eq '^[[:space:]]*MADAR_V2_JWT_SECRET[[:space:]]*=[[:space:]]*[[:xdigit:]]{64}[[:space:]]*$' "$PROJECT_DIR/.env" \
  || die 'Set MADAR_V2_JWT_SECRET to exactly 64 hexadecimal characters (for example, output from openssl rand -hex 32).'
MOUNT_LINE="$(grep -m 1 -E '^[[:space:]]*STORAGE_MOUNT_PATH[[:space:]]*=' "$PROJECT_DIR/.env" | tr -d '\r' || true)"
if [[ "$MOUNT_LINE" =~ ^[[:space:]]*STORAGE_MOUNT_PATH[[:space:]]*=[[:space:]]*(/[^[:space:]#]+)[[:space:]]*$ ]]; then
  STORAGE_MOUNT_PATH="${BASH_REMATCH[1]}"
else
  die 'Set STORAGE_MOUNT_PATH=/mnt/storage (unquoted absolute path) in .env before deployment.'
fi

command -v node >/dev/null 2>&1 || die 'Node.js 22+ is required.'
command -v npm >/dev/null 2>&1 || die 'npm is required.'
command -v pm2 >/dev/null 2>&1 || die 'PM2 is required. Install it with: sudo npm install -g pm2'
command -v curl >/dev/null 2>&1 || die 'curl is required for the post-deployment health check.'
command -v mountpoint >/dev/null 2>&1 || die 'mountpoint is required to verify the configured storage filesystem.'

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$NODE_MAJOR" -ge 22 ]] || die "Node.js 22 or newer is required; found $(node --version)."

export NODE_ENV=production

printf '[1/6] Verifying the mounted storage filesystem and protecting local configuration...\n'
[[ -d "$STORAGE_MOUNT_PATH" && ! -L "$STORAGE_MOUNT_PATH" ]] || die "STORAGE_MOUNT_PATH must be an existing real directory: $STORAGE_MOUNT_PATH"
mountpoint -q "$STORAGE_MOUNT_PATH" || die "Storage is not mounted at $STORAGE_MOUNT_PATH; refusing to write persistent data to /."
[[ "$(stat -c '%d' "$STORAGE_MOUNT_PATH")" != "$(stat -c '%d' /)" ]] || die 'The storage mount is on the same filesystem device as /; use a separate mounted filesystem.'
[[ -w "$STORAGE_MOUNT_PATH" ]] || die "The MADAR service user cannot write to $STORAGE_MOUNT_PATH."
[[ ! -L "$PROJECT_DIR/logs" ]] || die 'logs must be a real directory, not a symlink.'
mkdir -p logs server/assets
chmod 700 logs
chmod 600 .env

if pm2 describe madar-v2 >/dev/null 2>&1; then
  printf 'Stopping the existing PM2 process before replacing dependencies or applying migrations...\n'
  pm2 stop madar-v2
fi

printf '[2/6] Installing locked backend dependencies and rebuilding native addons...\n'
npm ci --omit=dev
npm rebuild better-sqlite3 sharp

printf '[3/6] Installing locked frontend dependencies and building the client bundle...\n'
npm --prefix client ci
npm --prefix client run build
[[ -f "$PROJECT_DIR/client/dist/index.html" ]] || die 'Client build did not produce client/dist/index.html.'

printf '[4/6] Validating mount-backed paths and preparing private runtime directories...\n'
node --input-type=module <<'NODE'
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { backupRoot, dataDirectory, storageRoot, thumbnailCacheDirectory } from './server/config/paths.js';

for (const directory of new Set([dataDirectory, storageRoot, backupRoot, thumbnailCacheDirectory])) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Runtime path must be a real directory: ${directory}`);
  }
  await chmod(directory, 0o700);
}
NODE

printf 'Initializing additive SQLite schema...\n'
npm run db:init

printf '[5/6] Restricting access to local runtime data...\n'
chmod 700 logs
chmod 600 .env

printf '[6/6] Starting/reloading the single PM2 process...\n'
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

printf 'Waiting for MADAR V2 health check...\n'
healthy=false
for ((attempt = 1; attempt <= 30; attempt += 1)); do
  response="$(curl --fail --silent --show-error --max-time 2 http://127.0.0.1:3000/api/health 2>/dev/null || true)"
  if [[ "$response" == *'"status":"ok"'* && "$response" == *'"service":"madar-v2"'* ]]; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ "$healthy" != true ]]; then
  pm2 logs madar-v2 --lines 40 --nostream >&2 || true
  die 'MADAR V2 did not become healthy on 127.0.0.1:3000. Check PM2 logs before retrying.'
fi

printf '%s\n' '=========================================================='
printf '%s\n' ' Deployment completed. MADAR V2 is healthy on 127.0.0.1:3000.'
printf '%s\n' '=========================================================='
