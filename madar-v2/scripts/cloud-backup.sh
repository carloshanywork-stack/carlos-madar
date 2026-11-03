#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

resolve_from_project() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$PROJECT_ROOT" "$1" ;;
  esac
}

if [[ -n "${STORAGE_MOUNT_PATH:-}" ]]; then
  if [[ "$STORAGE_MOUNT_PATH" != /* ]]; then
    echo 'STORAGE_MOUNT_PATH must be absolute.' >&2
    exit 1
  fi
  DEFAULT_DATA_DIRECTORY="$STORAGE_MOUNT_PATH/data"
  DEFAULT_STORAGE_ROOT="$STORAGE_MOUNT_PATH/uploads"
  DEFAULT_BACKUP_ROOT="$STORAGE_MOUNT_PATH/Backups"
else
  DEFAULT_DATA_DIRECTORY='data'
  DEFAULT_STORAGE_ROOT='../storage'
  DEFAULT_BACKUP_ROOT='Backups'
fi

DATA_DIRECTORY="$(resolve_from_project "${MADAR_V2_DATA_DIR:-$DEFAULT_DATA_DIRECTORY}")"
DATABASE_PATH="$(resolve_from_project "${MADAR_V2_DATABASE_PATH:-$DATA_DIRECTORY/madar-v2.sqlite}")"
BACKUP_ROOT="$(resolve_from_project "${MADAR_V2_BACKUP_ROOT:-$DEFAULT_BACKUP_ROOT}")"
STORAGE_ROOT="$(resolve_from_project "${MADAR_V2_STORAGE_ROOT:-$DEFAULT_STORAGE_ROOT}")"

if [[ -n "${MADAR_BACKUP_PASSPHRASE_FILE:-}" ]]; then
  PASSPHRASE_FILE="$(resolve_from_project "$MADAR_BACKUP_PASSPHRASE_FILE")"
  if [[ ! -f "$PASSPHRASE_FILE" || -L "$PASSPHRASE_FILE" ]]; then
    echo 'MADAR_BACKUP_PASSPHRASE_FILE must point to a regular, non-symlink key file.' >&2
    exit 1
  fi
  PASSPHRASE=''
  IFS= read -r PASSPHRASE < "$PASSPHRASE_FILE" || [[ -n "$PASSPHRASE" ]]
else
  PASSPHRASE="${MADAR_BACKUP_PASSPHRASE:-}"
fi

if [[ ${#PASSPHRASE} -lt 16 ]]; then
  echo 'Set MADAR_BACKUP_PASSPHRASE or MADAR_BACKUP_PASSPHRASE_FILE to a key of at least 16 characters.' >&2
  exit 1
fi
for command_name in python3 zip gpg realpath; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required backup command not found: $command_name" >&2
    exit 1
  fi
done
if [[ ! -f "$DATABASE_PATH" || -L "$DATABASE_PATH" ]]; then
  echo "SQLite database was not found as a regular file: $DATABASE_PATH" >&2
  exit 1
fi

mkdir -p -- "$BACKUP_ROOT"
STORAGE_CANONICAL="$(realpath -m -- "$STORAGE_ROOT")"
BACKUP_CANONICAL="$(realpath -m -- "$BACKUP_ROOT")"
if [[ "$BACKUP_CANONICAL" == "$STORAGE_CANONICAL" || "$BACKUP_CANONICAL" == "$STORAGE_CANONICAL/"* ]]; then
  echo 'Backup output must remain outside the customer storage root.' >&2
  exit 1
fi
WORK_DIRECTORY="$(mktemp -d "$BACKUP_ROOT/.madar-cloud-backup.XXXXXX")"
cleanup() {
  rm -rf -- "$WORK_DIRECTORY"
  unset PASSPHRASE
}
trap cleanup EXIT

mkdir -p -- "$WORK_DIRECTORY/database" "$WORK_DIRECTORY/config"
python3 - "$DATABASE_PATH" "$WORK_DIRECTORY/database/madar-v2.sqlite" <<'PY'
import sqlite3
import sys

source_path, snapshot_path = sys.argv[1:]
source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True, timeout=30)
snapshot = sqlite3.connect(snapshot_path, timeout=30)
try:
    source.backup(snapshot, pages=256, sleep=0.05)
    result = snapshot.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise SystemExit(f"SQLite snapshot integrity check failed: {result}")
finally:
    snapshot.close()
    source.close()
PY

python3 - "$STORAGE_ROOT" "$WORK_DIRECTORY/storage" <<'PY'
import os
import shutil
import stat
import sys

source_path, destination_path = sys.argv[1:]
if os.path.lexists(source_path):
    if os.path.realpath(source_path) != os.path.abspath(source_path):
        raise SystemExit(f"Storage root path must not pass through a symbolic link: {source_path}")
    root_mode = os.lstat(source_path).st_mode
    if stat.S_ISLNK(root_mode) or not stat.S_ISDIR(root_mode):
        raise SystemExit(f"Storage root must be a real directory: {source_path}")
    os.mkdir(destination_path)
    for current, directory_names, file_names in os.walk(source_path, topdown=True, followlinks=False):
        relative = os.path.relpath(current, source_path)
        if relative == ".":
            directory_names[:] = [name for name in directory_names if name not in {".incoming", ".madar-recovery"}]
        destination_directory = destination_path if relative == "." else os.path.join(destination_path, relative)
        for name in list(directory_names):
            item_path = os.path.join(current, name)
            mode = os.lstat(item_path).st_mode
            if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
                raise SystemExit(f"Storage contains an unsafe directory entry: {item_path}")
            os.mkdir(os.path.join(destination_directory, name))
        for name in file_names:
            item_path = os.path.join(current, name)
            mode = os.lstat(item_path).st_mode
            if stat.S_ISLNK(mode) or not stat.S_ISREG(mode):
                raise SystemExit(f"Storage contains an unsafe non-regular file: {item_path}")
            shutil.copy2(item_path, os.path.join(destination_directory, name))
else:
    os.mkdir(destination_path)
PY

copy_config() {
  local source_path="$1"
  local archive_name="$2"
  if [[ -e "$source_path" ]]; then
    if [[ ! -f "$source_path" || -L "$source_path" ]]; then
      echo "Refusing non-regular configuration file: $source_path" >&2
      exit 1
    fi
    cp -- "$source_path" "$WORK_DIRECTORY/config/$archive_name"
  fi
}

copy_config "$PROJECT_ROOT/.env" 'madar-v2.env'
copy_config "$(dirname -- "$PROJECT_ROOT")/.env" 'repository.env'
copy_config "$PROJECT_ROOT/server/config/env.js" 'env.js'
copy_config "$PROJECT_ROOT/package.json" 'package.json'
copy_config "$PROJECT_ROOT/package-lock.json" 'package-lock.json'
copy_config "$PROJECT_ROOT/capacitor.config.ts" 'capacitor.config.ts'
copy_config "$PROJECT_ROOT/capacitor.config.json" 'capacitor.config.json'

ARCHIVE_NAME="madar-v2_backup_$(date -u +%Y%m%d_%H%M%S_%N).zip.gpg"
ENCRYPTED_TEMP="$WORK_DIRECTORY/$ARCHIVE_NAME"
FINAL_PATH="$BACKUP_ROOT/$ARCHIVE_NAME"
(
  cd -- "$WORK_DIRECTORY"
  zip -q -r - database config storage
) | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 \
  --s2k-digest-algo SHA512 --passphrase-fd 3 --output "$ENCRYPTED_TEMP" \
  3<<<"$PASSPHRASE"
unset PASSPHRASE
mv -- "$ENCRYPTED_TEMP" "$FINAL_PATH"

SIZE_BYTES="$(stat -c '%s' "$FINAL_PATH")"
SIZE_HUMAN="$(python3 - "$SIZE_BYTES" <<'PY'
import sys
size = int(sys.argv[1])
units = ("B", "KiB", "MiB", "GiB", "TiB")
value = float(size)
for unit in units:
    if value < 1024 or unit == units[-1]:
        print(f"{value:.1f} {unit}" if unit != "B" else f"{size} B")
        break
    value /= 1024
PY
)"
echo "Encrypted MADAR V2 ZIP backup: $FINAL_PATH"
echo "Size: $SIZE_HUMAN ($SIZE_BYTES bytes)"
echo "Created: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
