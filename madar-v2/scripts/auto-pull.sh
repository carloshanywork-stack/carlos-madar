#!/usr/bin/env bash
# MADAR V2 pull-based auto-deploy.
# Runs from cron/PM2 watcher; safe to execute repeatedly.
set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$REPO_ROOT" || exit 0

PROJECT_DIR="$REPO_ROOT/madar-v2"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/auto-pull.log"
mkdir -p "$LOG_DIR"

# Never run two deploys at once.
exec 9>"$LOG_DIR/.autodeploy.lock"
flock -n 9 || exit 0

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >>"$LOG_FILE"; }

STATE_DIR="$LOG_DIR/.auto-pull"
mkdir -p "$STATE_DIR"

# Keep the log bounded across long outage periods.
if [ -f "$LOG_FILE" ] && [ "$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)" -gt 1048576 ]; then
  tail -n 2000 "$LOG_FILE" >"$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

# Log at most once per 10 minutes per key. A blocking condition (missing key,
# dirty tree, divergence) otherwise writes a line every 30s, forever.
log_throttled() {
  local key="$1" stamp now last
  shift
  stamp="$STATE_DIR/last-$key"
  now="$(date +%s)"
  last="$(cat "$stamp" 2>/dev/null || echo 0)"
  [ $((now - last)) -ge 600 ] || return 0
  printf '%s' "$now" >"$stamp"
  log "$@"
}

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
[ -n "$BRANCH" ] || exit 0
REMOTE_REF="origin/$BRANCH"

FETCH_ERR="$(mktemp)"
if ! GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=15' \
     timeout 45 git fetch --quiet origin "$BRANCH" 2>"$FETCH_ERR"; then
  log_throttled fetch-failure "fetch failed (GitHub auth/network); will retry every 30s"
  sed 's/^/  /' "$FETCH_ERR" >>"$LOG_FILE"
  rm -f "$FETCH_ERR"
  exit 0
fi
rm -f "$FETCH_ERR"

if ! git rev-parse --verify --quiet "$REMOTE_REF" >/dev/null; then
  log_throttled no-remote-branch "remote branch $REMOTE_REF not found; nothing to deploy"
  exit 0
fi

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "$REMOTE_REF")"
DEPLOYED="$(cat "$STATE_DIR/deployed-revision" 2>/dev/null || true)"
[ "$LOCAL" = "$REMOTE" ] && [ "$DEPLOYED" = "$REMOTE" ] && exit 0

if [ -n "$(git status --porcelain)" ]; then
  log_throttled dirty-tree "local uncommitted changes present; refusing to update"
  exit 0
fi

if [ -n "$DEPLOYED" ] && git cat-file -e "$DEPLOYED^{commit}" 2>/dev/null; then
  CHANGED="$(git diff --name-only "$DEPLOYED" "$REMOTE")"
else
  CHANGED="$(git ls-tree -r --name-only "$REMOTE")"
fi

# Run a deploy step without dumping its whole output into the log.
# Success -> one summary line. Failure -> summary plus the tail of the output.
run_step() {
  local dir="$1" label="$2" out
  shift 2
  out="$(mktemp)"
  if ( cd "$dir" && "$@" ) >"$out" 2>&1; then
    log "$label: ok"
    rm -f "$out"
    return 0
  fi
  log "$label: FAILED (last 40 lines below)"
  tail -n 40 "$out" | sed 's/^/  /' >>"$LOG_FILE"
  rm -f "$out"
  return 1
}

if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  log_throttled diverged "local main is ahead of or diverged from origin; refusing an unpushed deployment"
  exit 0
fi
MERGE_OUT="$(mktemp)"
if git merge --ff-only --quiet "$REMOTE" >"$MERGE_OUT" 2>&1; then
  rm -f "$MERGE_OUT"
  log "fast-forwarded $LOCAL..$REMOTE"
else
  log_throttled diverged "fast-forward failed: local branch and $REMOTE_REF diverged; manual reconcile required"
  tail -n 20 "$MERGE_OUT" | sed 's/^/  /' >>"$LOG_FILE"
  rm -f "$MERGE_OUT"
  exit 0
fi

if printf '%s\n' "$CHANGED" | grep -qx 'madar-v2/package-lock.json'; then
  log "backend lockfile changed; running npm ci"
  run_step "$PROJECT_DIR" "backend npm ci" npm ci --prefer-offline --no-audit --no-fund \
    || { log "backend deps not updated; not restarting"; exit 0; }
fi

# All tests create their own temporary databases/storage; never pass production paths.
if ! run_step "$PROJECT_DIR" "V2 regression gate" env -u MADAR_V2_DATABASE_PATH -u MADAR_V2_STORAGE_ROOT -u MADAR_V2_DATA_DIR -u MADAR_V2_BACKUP_ROOT NODE_ENV=test npm test; then
  log "tests failed; deployed receipt unchanged; not restarting"
  exit 1
fi

CANDIDATE=""; PREVIOUS_DIST=""
if printf '%s\n' "$CHANGED" | grep -qE '^madar-v2/client/(package-lock\.json|src/|index\.html|vite\.config\.js)'; then
  log "client changed; checking dependencies and building"
  if [ ! -d "$PROJECT_DIR/client/node_modules" ] || printf '%s\n' "$CHANGED" | grep -qx 'madar-v2/client/package-lock.json'; then
    run_step "$PROJECT_DIR/client" "client npm ci" npm ci --prefer-offline --no-audit --no-fund || exit 1
  fi
  if run_step "$PROJECT_DIR/client" "client build" npm run build -- --outDir dist-next --emptyOutDir; then
    PREVIOUS_DIST="$PROJECT_DIR/client/dist-previous"
    if [ -e "$PREVIOUS_DIST" ]; then
      log "previous dist recovery directory exists; refusing to overwrite it"
      exit 1
    fi
    if [ -d "$PROJECT_DIR/client/dist" ]; then mv "$PROJECT_DIR/client/dist" "$PREVIOUS_DIST"; fi
    mv "$PROJECT_DIR/client/dist-next" "$PROJECT_DIR/client/dist"
    CANDIDATE=1
  else
    log "client build failed; keeping the previous dist"
    rm -rf "$PROJECT_DIR/client/dist-next"
    exit 0
  fi
fi

if run_step "$PROJECT_DIR" "PM2 restart" pm2 restart madar-v2 --update-env \
   && run_step "$PROJECT_DIR" "post-deploy revision/asset health" node scripts/verify-deployment.mjs "$REMOTE"; then
  printf '%s\n' "$REMOTE" > "$STATE_DIR/deployed-revision.tmp"
  mv "$STATE_DIR/deployed-revision.tmp" "$STATE_DIR/deployed-revision"
  [ -z "$PREVIOUS_DIST" ] || rm -rf "$PREVIOUS_DIST"
  log "verified deployment $REMOTE"
else
  if [ -n "$CANDIDATE" ] && [ -d "$PREVIOUS_DIST" ]; then
    rm -rf "$PROJECT_DIR/client/dist"
    mv "$PREVIOUS_DIST" "$PROJECT_DIR/client/dist"
    log "previous web assets restored; backend recovery requires operator review (no database rollback)"
  fi
  log "ALERT: deployment FAILED; receipt unchanged, do not infer deployed revision from Git HEAD"
  exit 1
fi
