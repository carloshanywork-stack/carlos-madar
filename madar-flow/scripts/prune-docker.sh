#!/usr/bin/env bash
#
# Madar Flow — Docker housekeeping.
#
# Binding policy (DECISIONS.md): Docker is the ONLY thing that may be pruned.
# This script removes dangling (untagged) images and the local builder cache.
# It never touches:
#   - tagged images in use (no `-a` / `--all`)
#   - volumes (database, Valkey, backups)
#   - running containers
#   - application data, execution logs, audit logs or archives
#
# Usage: ./scripts/prune-docker.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed; nothing to prune." >&2
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "Cannot access the Docker daemon (check /var/run/docker.sock permissions)." >&2
  exit 1
fi

echo "== Current Docker disk usage =="
docker system df

if [[ "$DRY_RUN" == "true" ]]; then
  echo
  echo "== Dry run: images that would be removed (dangling only) =="
  docker images --filter "dangling=true" --format "table {{.ID}}\t{{.Repository}}\t{{.Size}}"
  echo
  echo "Dry run complete; nothing was removed."
  exit 0
fi

echo
echo "== Removing dangling images (tagged images are preserved) =="
docker image prune --force

echo
echo "== Removing build cache =="
docker builder prune --force

echo
echo "== Disk usage after pruning =="
docker system df

echo
echo "Done. Volumes and application data were not touched."
