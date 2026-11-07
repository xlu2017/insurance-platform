# Local Development

This project uses a pnpm monorepo with a local Supabase stack. Most verification runs locally through `pnpm` scripts; the GitHub Actions workflow is manually triggered only.

## Prerequisites

- Node.js 20 or later
- pnpm 9.15.9 (the package manager pinned in `package.json`)
- Docker Desktop or Docker Engine (Linux/WSL2)
- Supabase CLI 2.109.1 (pinned in `.tool-versions`)
- At least 8 GB RAM for the full local stack
- Free ports: `54321` (API), `54322` (DB), `54323` (Studio), `54324` (Mailpit)

## Initial setup

```bash
pnpm install --frozen-lockfile
pnpm --filter @autopilot/admin exec playwright install chromium
supabase start
pnpm ci:local
```

## Normal development loop

Start Supabase once, then run focused checks as needed:

```bash
supabase start
pnpm test:engine
pnpm ci:database
pnpm ci:e2e
```

## Full pre-push verification

```bash
pnpm ci:local
```

`ci:local` runs `ci:static`, `ci:database`, and `ci:e2e` in sequence and stops at the first failure.

## Manual GitHub verification

Automatic GitHub Actions runs are disabled during active development. To run the full clean-environment check before merging:

1. Open the **Actions** tab in the repository.
2. Select the **CI** workflow.
3. Click **Run workflow** and choose the branch.

The workflow runs the same `pnpm ci:*` scripts used locally.

## Supabase CLI version

The Supabase CLI version is pinned in `.tool-versions`. Use the same version locally and in any manually triggered CI run.

## Notes

- `scripts/ci/check-supabase.sh` starts the local Supabase stack only when it is not already running. Subsequent local runs reuse the same stack and Docker images.
- `scripts/ci/export-supabase-env.sh` writes temporary credential files with restrictive permissions and is intended for local sourcing only.
- The mobile app can load an unsigned JSON remote config via `EXPO_PUBLIC_CONFIG_ENDPOINT` (`loadRemoteConfig` in `apps/mobile/lib/config.ts`). This exists for local dev/demo only — it carries the public anon key and demo credentials and must not point at a production endpoint.
- Do not commit `.env` files or temporary credential files.
