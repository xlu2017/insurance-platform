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

supabase db reset

# Ensure Playwright Chromium is installed. Do not reinstall system dependencies on every run.
pnpm --filter @autopilot/admin exec playwright install chromium

pnpm --filter @autopilot/admin exec playwright test

supabase db reset

node scripts/e2e-v2-mandate-lifecycle.mjs
