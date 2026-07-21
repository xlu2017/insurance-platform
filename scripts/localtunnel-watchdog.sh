#!/usr/bin/env bash
set -euo pipefail

# Keeps a localtunnel to the local Supabase API alive. If the tunnel process
# exits (e.g. LocalTunnel server hiccups), it is restarted after a short delay.
# Each restart receives a new public URL, so you must rebuild the mobile app
# with the new URL before reinstalling it on a phone.

PORT="${1:-54321}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "LocalTunnel watchdog started for port ${PORT}. Press Ctrl+C to stop."
while true; do
  echo "[$(date -Iseconds)] Starting tunnel..."
  "${SCRIPT_DIR}/start-localtunnel.sh" "${PORT}" || true
  echo "[$(date -Iseconds)] Tunnel exited. Restarting in 5 seconds..."
  sleep 5
done
