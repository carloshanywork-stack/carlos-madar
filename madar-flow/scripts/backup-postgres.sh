#!/usr/bin/env bash
#
# Madar Flow — PostgreSQL backup (daily + monthly + yearly, kept forever).
#
# Policy (DECISIONS.md): business data and its backups are never deleted
# automatically. This script only creates backups; it has no pruning option.
# Manual deletion is an owner-only, audited operation outside this script.
#
# Usage:
#   ./scripts/backup-postgres.sh
#   BACKUP_ROOT=/srv/madar-flow/backups ./scripts/backup-postgres.sh
#
# Run it from the repository root. If Docker Compose Postgres is running it
# uses `docker compose exec`; otherwise it falls back to local `pg_dump` with
# DATABASE_URL.

set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-./backups}"
POSTGRES_USER="${POSTGRES_USER:-madar}"
POSTGRES_DB="${POSTGRES_DB:-madar_flow}"
STAMP="$(date -u +%Y-%m-%d)"
YEAR="${STAMP:0:4}"
MONTH="${STAMP:0:7}"

mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/monthly" "$BACKUP_ROOT/yearly"

DAILY="$BACKUP_ROOT/daily/madar_flow_${STAMP}.dump"
MONTHLY="$BACKUP_ROOT/monthly/madar_flow_${MONTH}.dump"
YEARLY="$BACKUP_ROOT/yearly/madar_flow_${YEAR}.dump"

if [[ -f "$DAILY" ]]; then
  echo "Daily backup already exists: $DAILY"
else
  echo "Creating daily backup: $DAILY"
  TMP="${DAILY}.tmp"
  if docker compose ps postgres >/dev/null 2>&1; then
    docker compose exec -T postgres \
      pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$TMP"
  else
    if [[ -z "${DATABASE_URL:-}" ]]; then
      echo "DATABASE_URL is required when Docker Compose Postgres is not running." >&2
      rm -f "$TMP"
      exit 1
    fi
    pg_dump "$DATABASE_URL" -Fc > "$TMP"
  fi
  mv "$TMP" "$DAILY"
fi

sha256sum "$DAILY" > "${DAILY}.sha256"

# Hardlink the first backup of each month/year so three retention tiers cost
# almost no extra disk space. Missing links are created; existing ones are
# never overwritten or deleted.
if [[ ! -e "$MONTHLY" ]]; then
  ln "$DAILY" "$MONTHLY"
  echo "Created monthly link: $MONTHLY"
else
  echo "Monthly backup already exists: $MONTHLY"
fi

if [[ ! -e "$YEARLY" ]]; then
  ln "$DAILY" "$YEARLY"
  echo "Created yearly link: $YEARLY"
else
  echo "Yearly backup already exists: $YEARLY"
fi

echo
echo "Backup complete. No old backups were removed."
ls -lh "$DAILY" "$MONTHLY" "$YEARLY"
