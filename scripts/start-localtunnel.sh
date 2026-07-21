#!/usr/bin/env bash
set -euo pipefail

# Starts a public LocalTunnel to the local Supabase API (port 54321 by default),
# writes the tunnel URL to the mobile .env.local, and updates supabase/config.toml
# so the JWT issuer matches the tunnel. Re-run this script whenever the tunnel dies.

PORT="${1:-54321}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

pkill -f "npx localtunnel --port ${PORT}" 2>/dev/null || true
pkill -f "npm exec localtunnel --port ${PORT}" 2>/dev/null || true
pkill -f "lt --port ${PORT}" 2>/dev/null || true
sleep 1

LT_OUT="$(mktemp)"
trap 'rm -f "$LT_OUT"' EXIT

echo "Starting localtunnel on port ${PORT}..."
npx localtunnel --port "${PORT}" > "$LT_OUT" 2>&1 &
LT_PID=$!

URL=""
for _ in $(seq 1 30); do
  URL=$(grep -oE 'https://[a-zA-Z0-9_-]+\.loca\.lt' "$LT_OUT" | head -n1 || true)
  if [ -n "$URL" ]; then break; fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Failed to obtain localtunnel URL. Logs:" >&2
  cat "$LT_OUT" >&2 || true
  kill "$LT_PID" 2>/dev/null || true
  exit 1
fi

echo "LocalTunnel URL: ${URL}"

# Update mobile environment (gitignored)
ENV_FILE="${ROOT}/apps/mobile/.env.local"
if [ -f "$ENV_FILE" ]; then
  sed -i "s|^EXPO_PUBLIC_SUPABASE_URL=.*|EXPO_PUBLIC_SUPABASE_URL=${URL}|" "$ENV_FILE"
else
  echo "EXPO_PUBLIC_SUPABASE_URL=${URL}" > "$ENV_FILE"
fi

# Update Supabase config so the JWT issuer matches the public tunnel.
python3 - "$URL" "$ROOT/supabase/config.toml" <<'PY'
import re
import sys
url, path = sys.argv[1], sys.argv[2]
with open(path) as f:
    text = f.read()
# Replace any bare *.loca.lt hostnames with the new tunnel URL.
text = re.sub(r'https://[a-zA-Z0-9_-]+\.loca\.lt(?!/auth/v1)', url, text)
# Update the JWT issuer explicitly.
text = re.sub(
    r'jwt_issuer = "https://[a-zA-Z0-9_-]+\.loca\.lt/auth/v1"',
    f'jwt_issuer = "{url}/auth/v1"',
    text,
)
with open(path, "w") as f:
    f.write(text)
PY

echo "Updated ${ENV_FILE} and ${ROOT}/supabase/config.toml"
echo "Run 'supabase stop && supabase start' to apply the new issuer if Supabase is already running."
echo "Then rebuild the mobile app so the bundle embeds the new URL."

# Keep localtunnel in the foreground so a watchdog can restart it if it exits.
wait "$LT_PID"
