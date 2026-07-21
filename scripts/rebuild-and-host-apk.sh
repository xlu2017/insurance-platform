#!/usr/bin/env bash
set -euo pipefail

# Rebuilds the mobile release APK, verifies the embedded Supabase URL,
# serves the output folder over a local HTTP server, and exposes it through
# a public LocalTunnel URL. The public URL is printed once the tunnel is ready.

PORT="${1:-18082}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/apps/mobile/.env.local"

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

echo "Building release APK with EXPO_PUBLIC_SUPABASE_URL=${EXPO_PUBLIC_SUPABASE_URL}..."
export ANDROID_HOME=/home/ubuntu/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
cd "${ROOT}/apps/mobile/android"
./gradlew :app:assembleRelease

APK="${ROOT}/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK" ]; then
  echo "APK not found at ${APK}" >&2
  exit 1
fi

echo "Verifying embedded backend URL in APK bundle..."
EMBEDDED_URL=$(unzip -p "$APK" assets/index.android.bundle 2>/dev/null | strings | grep -oE 'https://[a-zA-Z0-9_-]+\.loca\.lt' | head -n1 || true)
if [ -n "$EMBEDDED_URL" ]; then
  echo "Embedded backend URL: ${EMBEDDED_URL}"
  if [ "$EMBEDDED_URL" != "$EXPO_PUBLIC_SUPABASE_URL" ]; then
    echo "WARNING: embedded URL does not match EXPO_PUBLIC_SUPABASE_URL." >&2
  fi
else
  echo "Could not verify embedded URL from bundle." >&2
fi

cd "$(dirname "$APK")"

echo "Starting HTTP server on port ${PORT}..."
python3 -m http.server "$PORT" > /tmp/apk-server.log 2>&1 &
SERVER_PID=$!
sleep 1

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
echo "Public APK URL: ${APK_URL}"
echo "If a LocalTunnel reminder page appears, click Continue, then download."
echo "Direct curl download:"
echo "  curl -H 'Bypass-Tunnel-Reminder: true' -O ${APK_URL}"

cleanup() {
  echo "Stopping APK server and tunnel..."
  kill "$LT_PID" "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait "$LT_PID"
