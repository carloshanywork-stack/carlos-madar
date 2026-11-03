#!/usr/bin/env bash
set -Eeuo pipefail

MOUNT_PATH="${1:-/mnt/storage}"
THRESHOLD_PERCENT="${2:-15}"

if [[ "$MOUNT_PATH" != /* || "$MOUNT_PATH" == / ]]; then
  printf 'ERROR: storage mount path must be an absolute, non-root path: %s\n' "$MOUNT_PATH" >&2
  exit 2
fi

if [[ ! "$THRESHOLD_PERCENT" =~ ^[0-9]+$ ]] || (( THRESHOLD_PERCENT < 1 || THRESHOLD_PERCENT > 99 )); then
  printf 'ERROR: free-space threshold must be an integer from 1 to 99.\n' >&2
  exit 2
fi

alert() {
  local message="$1"
  printf 'MADAR STORAGE ALERT: %s\n' "$message" >&2
  if command -v logger >/dev/null 2>&1; then
    logger -p user.warning -t madar-storage-alert -- "$message" || true
  fi
}

if [[ ! -d "$MOUNT_PATH" || -L "$MOUNT_PATH" ]] || ! mountpoint -q "$MOUNT_PATH"; then
  alert "expected storage filesystem is not mounted at $MOUNT_PATH; no capacity reading was taken."
  exit 2
fi

MOUNT_DEVICE="$(stat -c '%d' "$MOUNT_PATH" 2>/dev/null || true)"
ROOT_DEVICE="$(stat -c '%d' / 2>/dev/null || true)"
if [[ ! "$MOUNT_DEVICE" =~ ^[0-9]+$ || ! "$ROOT_DEVICE" =~ ^[0-9]+$ ]]; then
  alert "could not verify that $MOUNT_PATH is on a separate filesystem device."
  exit 2
fi

if [[ "$MOUNT_DEVICE" == "$ROOT_DEVICE" ]]; then
  alert "$MOUNT_PATH is on the same filesystem device as /; no capacity reading was taken."
  exit 2
fi

CAPACITY="$(LC_ALL=C df --block-size=1 --output=size,avail -- "$MOUNT_PATH" 2>/dev/null | awk 'NR == 2 { print $1, $2 }')" || CAPACITY=''
read -r TOTAL_BYTES AVAILABLE_BYTES <<< "$CAPACITY"

if [[ ! "${TOTAL_BYTES:-}" =~ ^[0-9]+$ || ! "${AVAILABLE_BYTES:-}" =~ ^[0-9]+$ ]] || (( TOTAL_BYTES == 0 )); then
  alert "could not read valid capacity data for $MOUNT_PATH."
  exit 2
fi

FREE_PERCENT=$(( AVAILABLE_BYTES * 100 / TOTAL_BYTES ))
if (( FREE_PERCENT < THRESHOLD_PERCENT )); then
  alert "$MOUNT_PATH has ${FREE_PERCENT}% free (${AVAILABLE_BYTES} of ${TOTAL_BYTES} bytes); threshold is ${THRESHOLD_PERCENT}%."
  exit 1
fi
