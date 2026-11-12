#!/bin/bash
set -u
cd /home/carlos/Desktop/MADAR
export NODE_ENV=test COOKIE_SECURE=false STORAGE_MOUNT_PATH=
audit_fixture_root=$(mktemp -d /tmp/madar-final-audit-business-XXXXXX)
export MADAR_V2_DATA_DIR="$audit_fixture_root/data"
export MADAR_V2_STORAGE_ROOT="$audit_fixture_root/storage"
export MADAR_V2_BACKUP_ROOT="$audit_fixture_root/backups"
export MADAR_V2_DATABASE_PATH="$audit_fixture_root/fallback.sqlite"
export MADAR_V2_OFFLINE_MAP_PATH="$audit_fixture_root/offline-map.mbtiles"
export MADAR_REP_APK_PATH="$audit_fixture_root/synthetic.apk"
export MADAR_V2_JWT_SECRET=final-audit-only-secret-at-least-32-characters
export MADAR_INITIAL_ADMIN_PASSWORD=Audit-only-temporary-password
node --test --test-reporter=tap --test-concurrency=1 madar-v2/test/*.test.js > audit/final-integration-20261111/business-full-suite.tap 2>&1
