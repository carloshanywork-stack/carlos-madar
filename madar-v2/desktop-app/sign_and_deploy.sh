#!/usr/bin/env bash
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_APP="${PROJECT_ROOT}/desktop-app"
CERTS="${DESKTOP_APP}/certs"

REMOTE_HOST="carlos-pc.tail852ef0.ts.net"
REMOTE_USER="carlos"
REMOTE_PATH="updates"

# Keep existing downloads in place until a new release has been built.
: "${CSC_KEY_PASSWORD:?Provide the approved Windows signing password in the environment}"

echo "=== Step 1: Build desktop installer (release mode) ==="
export MADAR_DESKTOP_SERVER_URL="https://${REMOTE_HOST}"
export MADAR_DESKTOP_UPDATE_URL="https://${REMOTE_HOST}/download/desktop/"
export MADAR_WINDOWS_PUBLISHER_NAME="MADAR ERP"
export CSC_LINK="${PROJECT_ROOT}/desktop/madar-codesign.pfx"
export CSC_KEY_PASSWORD
export MADAR_WINDOWS_TARGET="nsis"
export USE_SYSTEM_OSSLSIGNCODE="true"

cd "${PROJECT_ROOT}"
node scripts/build-desktop.js --release

echo ""
echo "=== Step 2: Locate built artifacts ==="
BUILD_DIR="${PROJECT_ROOT}/build/windows"
EXE=$(ls -t "${BUILD_DIR}"/*.exe 2>/dev/null | grep -v "signed" | head -n1)
YML=$(ls -t "${BUILD_DIR}"/latest.yml 2>/dev/null | head -n1)
BLOCKMAP=$(ls -t "${BUILD_DIR}"/*.blockmap 2>/dev/null | head -n1)

if [[ -z "$EXE" ]]; then
  echo "❌ No .exe found in ${BUILD_DIR}"
  exit 1
fi
echo "  EXE:      $EXE"
echo "  YML:      $YML"
echo "  BLOCKMAP: $BLOCKMAP"

echo ""
echo "=== Step 3: Verify or sign with osslsigncode ==="
SIGNED_EXE="${EXE%.exe}-signed.exe"
if osslsigncode verify -in "$EXE" 2>/dev/null; then
  echo "✅ Executable is already signed: $EXE"
  SIGNED_EXE="$EXE"
else
  osslsigncode sign \
    -pkcs12 "${PROJECT_ROOT}/desktop/madar-codesign.pfx" \
    -pass "$CSC_KEY_PASSWORD" \
    -h sha256 \
    -n "MADAR Desktop" \
    -i "https://${REMOTE_HOST}" \
    -t "http://timestamp.digicert.com" \
    -in "$EXE" \
    -out "$SIGNED_EXE"
  echo "✅ Signed: $SIGNED_EXE"
fi

echo ""
echo "=== Step 4: Upload to ${REMOTE_HOST}:~/${REMOTE_PATH} ==="
FILES_TO_UPLOAD=("$SIGNED_EXE")
[[ -n "$YML" ]]      && FILES_TO_UPLOAD+=("$YML")
[[ -n "$BLOCKMAP" ]]  && FILES_TO_UPLOAD+=("$BLOCKMAP")
FILES_TO_UPLOAD+=("${CERTS}/cert.cer")

ssh "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p ~/${REMOTE_PATH}"
scp "${FILES_TO_UPLOAD[@]}" ${REMOTE_USER}@${REMOTE_HOST}:~/${REMOTE_PATH}/
echo "✅ All files uploaded to ${REMOTE_HOST}:~/${REMOTE_PATH}"

echo ""
echo "=== DONE ==="
echo "Signed installer and update files deployed successfully."
