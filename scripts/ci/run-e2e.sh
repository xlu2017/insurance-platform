#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

scripts/ci/check-supabase.sh
pnpm --filter @autopilot/insurance-engine build:edge

# Export local Supabase credentials for the admin app, lifecycle scripts, and Edge Functions.
ENV_FILE=$(mktemp)
trap 'rm -f "$ENV_FILE"' EXIT

scripts/ci/export-supabase-env.sh "$ENV_FILE"
set -a
source "$ENV_FILE"
set +a

mkdir -p supabase/functions
cat > supabase/functions/.env <<EOF
EDGE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
EOF

cat > apps/admin/.env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
PAYMENTS_BYPASS=true
EOF

# Clean up any stale Next.js dev server before starting a fresh one.
for pid in $(ss -ltp | grep ':3000' | grep -oP 'pid=\K[0-9]+' || true); do
  kill -9 "$pid" 2>/dev/null || true
done
rm -rf apps/admin/.next

# Start the admin dev server in the background for Playwright.
ADMIN_LOG=$(mktemp)
pnpm --filter @autopilot/admin dev > "$ADMIN_LOG" 2>&1 &
ADMIN_PID=$!
trap 'kill "$ADMIN_PID" 2>/dev/null || true; rm -f "$ADMIN_LOG" "$ENV_FILE"' EXIT

# Wait for the dev server to be ready.
for i in {1..60}; do
  if curl -sf http://localhost:3000/login >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl -sf http://localhost:3000/login >/dev/null 2>&1; then
  echo "Admin dev server failed to start" >&2
  cat "$ADMIN_LOG" >&2
  exit 1
fi

supabase db reset

# Ensure Playwright Chromium is installed. Do not reinstall system dependencies on every run.
pnpm --filter @autopilot/admin exec playwright install chromium

pnpm --filter @autopilot/admin exec playwright test

supabase db reset

node scripts/e2e-v2-mandate-lifecycle.mjs
