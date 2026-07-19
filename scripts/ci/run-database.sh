#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

scripts/ci/check-supabase.sh
supabase db reset
pnpm db:types:check
supabase test db
pnpm --filter @autopilot/database test:integration
pnpm --filter @autopilot/document-extraction test:integration
