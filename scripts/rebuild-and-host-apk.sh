#!/usr/bin/env bash
set -euo pipefail

# Rebuilds the mobile release APK, serves the output folder with a small
# HTTP server, and exposes it through a public LocalTunnel URL.
#
# Usage:
#   ./scripts/rebuild-and-host-apk.sh [port] [config-endpoint]
# If you want the APK to fetch a remote config at startup, set
# EXPO_PUBLIC_CONFIG_ENDPOINT before building and pass it as the second arg.

PORT="${1:-18082}"
CONFIG_ENDPOINT="${2:-${EXPO_PUBLIC_CONFIG_ENDPOINT:-}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/apps/mobile/.env.local"

cd "$ROOT"

if [ -f "$ENV_FILE" ]; then
  # shellcheck source=/dev/null
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

if [ -z "${EXPO_PUBLIC_SUPABASE_URL:-}" ]; then
  echo "EXPO_PUBLIC_SUPABASE_URL is not set in ${ENV_FILE}." >&2
  echo "Run ./scripts/start-localtunnel.sh first to generate a public backend URL." >&2
  exit 1
fi

if [ -n "$CONFIG_ENDPOINT" ]; then
  echo "EXPO_PUBLIC_CONFIG_ENDPOINT=${CONFIG_ENDPOINT}"
  if grep -q "^EXPO_PUBLIC_CONFIG_ENDPOINT=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^EXPO_PUBLIC_CONFIG_ENDPOINT=.*|EXPO_PUBLIC_CONFIG_ENDPOINT=${CONFIG_ENDPOINT}|" "$ENV_FILE"
  else
    echo "EXPO_PUBLIC_CONFIG_ENDPOINT=${CONFIG_ENDPOINT}" >> "$ENV_FILE"
  fi
fi

echo "Building release APK..."
export ANDROID_HOME=/home/ubuntu/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
cd "${ROOT}/apps/mobile/android"
./gradlew :app:assembleRelease

APK="${ROOT}/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK" ]; then
  echo "APK not found at ${APK}" >&2
  exit 1
fi

echo "Verifying embedded backend/config endpoint in APK bundle..."
EMBEDDED_URL=$(unzip -p "$APK" assets/index.android.bundle 2>/dev/null | strings | grep -oE 'https://[a-zA-Z0-9_-]+\.loca\.lt' | head -n1 || true)
EMBEDDED_CONFIG=$(unzip -p "$APK" assets/index.android.bundle 2>/dev/null | strings | grep -oE 'https://[^" ]+/config' | head -n1 || true)
if [ -n "$EMBEDDED_URL" ]; then
  echo "Embedded backend URL hint: ${EMBEDDED_URL}"
fi
if [ -n "$EMBEDDED_CONFIG" ]; then
  echo "Embedded config endpoint: ${EMBEDDED_CONFIG}"
fi

echo "Starting HTTP server on port ${PORT}..."
node "${ROOT}/scripts/host-apk-and-config.mjs" "$PORT" > /tmp/apk-server.log 2>&1 &
SERVER_PID=$!
sleep 2

echo "Starting LocalTunnel on port ${PORT}..."
npx localtunnel --port "$PORT" > /tmp/apk-lt.txt 2>&1 &
LT_PID=$!

URL=""
for _ in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-zA-Z0-9_-]+\.loca\.lt' /tmp/apk-lt.txt | head -n1 || true)
  if [ -n "$URL" ]; then break; fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Failed to obtain LocalTunnel URL." >&2
  cat /tmp/apk-lt.txt >&2 || true
  kill "$LT_PID" "$SERVER_PID" 2>/dev/null || true
  exit 1
fi

APK_URL="${URL}/app-release.apk"
CONFIG_URL="${URL}/config"
echo "Public APK URL: ${APK_URL}"
echo "Public config endpoint: ${CONFIG_URL}"
echo "If a LocalTunnel reminder page appears, click Continue, then download."
echo "Direct curl download:"
echo "  curl -H 'Bypass-Tunnel-Reminder: true' -O ${APK_URL}"

cleanup() {
  echo "Stopping APK server and tunnel..."
  kill "$LT_PID" "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait "$LT_PID"
