#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

scripts/ci/check-supabase.sh
pnpm --filter @autopilot/insurance-engine build:edge
supabase db reset

# Export local Supabase credentials for the admin app and lifecycle scripts.
ENV_FILE=$(mktemp)
trap 'rm -f "$ENV_FILE"' EXIT

scripts/ci/export-supabase-env.sh "$ENV_FILE"
set -a
source "$ENV_FILE"
set +a

cat > apps/admin/.env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
PAYMENTS_BYPASS=true
EOF

# Ensure Playwright Chromium is installed. Do not reinstall system dependencies on every run.
pnpm --filter @autopilot/admin exec playwright install chromium

pnpm --filter @autopilot/admin exec playwright test

supabase db reset

node scripts/e2e-v2-mandate-lifecycle.mjs
