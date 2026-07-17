#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

pnpm format:check
pnpm lint
pnpm typecheck
pnpm typecheck:edge
pnpm test
pnpm --filter @autopilot/admin build
pnpm --filter @autopilot/mobile expo:doctor
pnpm --filter @autopilot/insurance-engine check:edge
