#!/usr/bin/env bash
set -euo pipefail

# MADAR storage relocation — verified move with a retained backup, Linux only.
#
# Copies <repo>/storage to the dedicated ext4 "D:" drive, verifies both the
# active copy and a separate pre-migration backup there, then replaces the
# original path with a symlink. The pre-migration backup is a sibling of the
# active storage directory on the second drive, never inside the live tree.
#
# The source-side temporary copy is cleared only after both second-drive copies
# pass SHA-256 verification and the new storage symlink is confirmed readable.
# Requirements: bash, rsync, find, sha256sum, sudo (to mount the drive).
# Safe to re-run: it aborts if the storage folder is already a symlink, and it
# aborts before changing the original folder if verification fails.

STORAGE_UUID="${MADAR_STORAGE_UUID:-41478fcd-4b9f-4b92-90dc-58a5505424eb}"  # label "d"
MOUNT_POINT="${MADAR_STORAGE_MOUNT:-/mnt/madar-storage}"
DEST_DIR="${MADAR_STORAGE_DEST:-$MOUNT_POINT/madar-storage}"
BACKUP_DIR="${MADAR_STORAGE_BACKUP:-$MOUNT_POINT/storage_pre_migration_backup}"
REPO_ROOT="$(git -C "${MADAR_REPO_ROOT:-$PWD}" rev-parse --show-toplevel)"
SRC="$REPO_ROOT/storage"
LOCAL_HOLD="$REPO_ROOT/.storage-pre-migration-hold-$$"
PM2_APPS="${MADAR_STORAGE_PM2_APPS:-madar-v2 madar-autodeploy}"

log() { printf '[migrate-storage] %s\n' "$*"; }
die() { printf '[migrate-storage] ERROR: %s\n' "$*" >&2; exit 1; }

run_sudo() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else
    if [ -n "${MADAR_STORAGE_SUDO_PASS_FILE:-}" ]; then
      printf '%s\n' "$(cat "$MADAR_STORAGE_SUDO_PASS_FILE")" | sudo -S -p '' "$@"
    else
      sudo "$@"
    fi
  fi
}

[ -d "$REPO_ROOT/.git" ] || die "not a repository root: $REPO_ROOT"
[ -e "$SRC" ] || die "storage folder does not exist: $SRC"
if [ -L "$SRC" ]; then
  log "storage is already a symlink -> $(readlink -f "$SRC"); nothing to do."
  exit 0
fi
[ -d "$SRC" ] || die "storage is not a directory: $SRC"
[ ! -e "$BACKUP_DIR" ] && [ ! -L "$BACKUP_DIR" ] || die "backup path already exists, refusing to overwrite it: $BACKUP_DIR"
[ ! -e "$LOCAL_HOLD" ] && [ ! -L "$LOCAL_HOLD" ] || die "temporary safety path already exists: $LOCAL_HOLD"
DEST_CANONICAL="$(realpath -m "$DEST_DIR")"
BACKUP_CANONICAL="$(realpath -m "$BACKUP_DIR")"
[ "$BACKUP_CANONICAL" != "$DEST_CANONICAL" ] || die "backup and active storage paths must be different"
case "$BACKUP_CANONICAL/" in "$DEST_CANONICAL/"*) die "backup path cannot be inside active storage" ;; esac
case "$DEST_CANONICAL/" in "$BACKUP_CANONICAL/"*) die "active storage path cannot be inside the backup" ;; esac
[ "$BACKUP_CANONICAL" != "$(realpath -m "$SRC")" ] || die "backup and source paths must be different"

# --- 1. Make sure the D drive is mounted ...................................
if ! findmnt -n -M "$MOUNT_POINT" >/dev/null 2>&1; then
  log "mounting UUID=$STORAGE_UUID at $MOUNT_POINT"
  run_sudo mkdir -p "$MOUNT_POINT"
  run_sudo mount -U "$STORAGE_UUID" "$MOUNT_POINT"
  run_sudo chown "$(id -u):$(id -g)" "$MOUNT_POINT"
fi
MOUNT_DEVICE="$(findmnt -n -M "$MOUNT_POINT" -o MAJ:MIN)"
LOG_SRC_DEVICE="$(findmnt -n -T "$REPO_ROOT" -o MAJ:MIN)"
[ -n "$MOUNT_DEVICE" ] || die "$MOUNT_POINT is not an exact mounted filesystem"
[ "$MOUNT_DEVICE" != "$LOG_SRC_DEVICE" ] || die "$MOUNT_POINT is on the same filesystem as the repo; refusing to proceed"
log "source filesystem: $LOG_SRC_DEVICE"
log "second-storage filesystem: $MOUNT_DEVICE ($MOUNT_POINT)"

run_sudo mkdir -p "$DEST_DIR" "$(dirname "$BACKUP_DIR")"
run_sudo chown -R "$(id -u):$(id -g)" "$DEST_DIR"
[ "$(findmnt -n -T "$DEST_DIR" -o MAJ:MIN)" = "$MOUNT_DEVICE" ] || die "active storage is not on the second-storage filesystem"
[ "$(findmnt -n -T "$(dirname "$BACKUP_DIR")" -o MAJ:MIN)" = "$MOUNT_DEVICE" ] || die "pre-migration backup is not on the second-storage filesystem"

# --- 2. Stop the application so no file changes mid-copy .....................
if command -v pm2 >/dev/null 2>&1; then
  log "stopping PM2 apps: $PM2_APPS"
  pm2 stop $PM2_APPS || log "warning: could not stop PM2 apps (already stopped?)"
fi

# --- 3. Copy active data and pre-migration backup, then verify ---------------
log "copying $SRC -> $DEST_DIR (rsync -aH)"
rsync -aH --info=stats "$SRC"/ "$DEST_DIR"/
mkdir -p "$BACKUP_DIR"
log "copying $SRC -> $BACKUP_DIR (independent pre-migration backup)"
rsync -aH --info=stats "$SRC"/ "$BACKUP_DIR"/

verify_copy() {
  local target="$1"
  local label="$2"
  local src_files dst_files src_dirs dst_dirs src_bytes dst_bytes
  src_files=$(find "$SRC" -type f -printf . | wc -c)
  dst_files=$(find "$target" -type f -printf . | wc -c)
  src_dirs=$(find "$SRC" -type d -printf . | wc -c)
  dst_dirs=$(find "$target" -type d -printf . | wc -c)
  src_bytes=$(du -sb "$SRC" | awk '{print $1}')
  dst_bytes=$(du -sb "$target" | awk '{print $1}')
  log "$label counts: files=$src_files/$dst_files directories=$src_dirs/$dst_dirs bytes=$src_bytes/$dst_bytes"
  [ "$src_files" = "$dst_files" ] || die "$label file count mismatch; original left untouched"
  [ "$src_dirs" = "$dst_dirs" ] || die "$label directory count mismatch; original left untouched"
  [ "$src_bytes" = "$dst_bytes" ] || die "$label apparent size mismatch; original left untouched"

  log "comparing SHA-256 of every file against $target (this re-reads both trees)"
  if ! diff <(cd "$SRC" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum) \
            <(cd "$target" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum); then
    die "$label checksum mismatch; original left untouched"
  fi
}

verify_copy "$DEST_DIR" "active storage"
verify_copy "$BACKUP_DIR" "pre-migration backup"

# --- 4. Swap the original for a symlink bridge -------------------------------
restore_source_on_failure() {
  local status=$?
  if [ "$status" -ne 0 ] && [ -d "$LOCAL_HOLD" ]; then
    if [ -L "$SRC" ]; then rm -f -- "$SRC"; fi
    if [ ! -e "$SRC" ] && [ ! -L "$SRC" ]; then
      mv "$LOCAL_HOLD" "$SRC" || log "ERROR: original remains at $LOCAL_HOLD; restore it to $SRC"
    fi
  fi
}
trap restore_source_on_failure EXIT

log "temporarily holding original at $LOCAL_HOLD while installing symlink"
mv "$SRC" "$LOCAL_HOLD"
if ! ln -s "$DEST_DIR" "$SRC"; then
  mv "$LOCAL_HOLD" "$SRC"
  die "could not create storage symlink; original restored"
fi
if [ ! -d "$SRC/Areas" ]; then
  rm -- "$SRC"
  mv "$LOCAL_HOLD" "$SRC"
  die "bridge read check failed; original restored"
fi
log "bridge created: $SRC -> $(readlink -f "$SRC")"
ls "$SRC"

# Remove the primary-disk source hold only after both second-disk copies passed
# full SHA-256 verification and the live symlink was read-checked. The retained
# pre-migration copy is $BACKUP_DIR.
if rm -rf --one-file-system -- "$LOCAL_HOLD"; then
  log "removed the verified temporary source copy; pre-migration backup remains at $BACKUP_DIR"
else
  log "warning: could not remove temporary source hold; it remains at $LOCAL_HOLD"
fi

# --- 5. Restart the application and check health -----------------------------
if command -v pm2 >/dev/null 2>&1; then
  log "starting PM2 apps: $PM2_APPS"
  pm2 start $PM2_APPS || log "warning: could not restart PM2 apps"
fi
if command -v curl >/dev/null 2>&1; then
  sleep 2
  if curl -fsS -m 5 http://127.0.0.1:3000/api/health; then log "health check OK"; else log "warning: health check failed (see: pm2 logs madar-v2)"; fi
fi

log "migration complete. Pre-migration backup kept on second storage at: $BACKUP_DIR"
log "Data on D: lives at: $DEST_DIR"
