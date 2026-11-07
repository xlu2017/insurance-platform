# Insurance Autopilot

![CI](https://github.com/xlu2017/insurance-platform/actions/workflows/ci.yml/badge.svg)

A mobile-first platform that optimizes a Canadian household's auto and property insurance the way
a managed investment account optimizes a portfolio: set your requirements once, and the service
monitors renewals, collects competing quotes, compares whole-household configurations and presents
a clear, licensed-reviewed recommendation. You approve every change.

> Insurance Autopilot is currently a demonstration and workflow platform. Quotes, recommendations
> and switch statuses in this environment are simulated and do not constitute insurance advice,
> binding coverage or brokerage services.

## Monorepo layout

```text
apps/
  mobile/              Expo + React Native customer app (iOS/Android)
  admin/               Next.js operations console
packages/
  schemas/             Shared Zod schemas, enums and state machines
  insurance-engine/    Deterministic quote comparison and household optimization
  database/            Supabase client helpers and provider adapters (email, push, extraction)
  design-tokens/       Shared colors, spacing, typography
  config/              Shared ESLint config
  test-fixtures/       Deterministic engine fixtures, incl. the bundle-loss scenario
supabase/
  migrations/          Schema, triggers, RLS and remediation migrations
  functions/           Edge Functions (Stripe webhook, checkout, quote-request email, recommendation generator)
  seed.sql             Demo users, insurers, household and active case
  tests/               pgTAP tests for RLS, state-machine guards, security and workflow RPCs
docs/                  Architecture, data model, security, demo, deployment, regulatory, roadmap
```

## Prerequisites

- Node 20+, pnpm 9 (`npm i -g pnpm@9`)
- Docker (for local Supabase)
- Supabase CLI (`https://supabase.com/docs/guides/cli`)

## Quick start

```bash
pnpm install

# 1. Start the local backend (Postgres, Auth, Storage, Edge Functions)
supabase start
supabase db reset        # applies migrations + seed data

# 2. Admin console — http://localhost:3000
cp apps/admin/.env.example apps/admin/.env.local   # paste the anon key printed by supabase start
pnpm --filter @autopilot/admin dev

# 3. Mobile app (Expo)
cp apps/mobile/.env.example apps/mobile/.env       # same values; use your LAN IP on a device
pnpm --filter @autopilot/mobile dev
```

Edge Functions run automatically with `supabase start`. `PAYMENTS_BYPASS` defaults to on locally,
so no Stripe keys are needed for the demo.

## Demo accounts (local development only)

| Role       | Email                  | Password           |
| ---------- | ---------------------- | ------------------ |
| Customer   | customer@example.com   | DemoCustomer123!   |
| Operations | operations@example.com | DemoOperations123! |
| Reviewer   | reviewer@example.com   | DemoReviewer123!   |
| Admin      | admin@example.com      | DemoAdmin123!      |

The seed contains an Alberta household with two drivers, two vehicles, an owner-occupied property,
current auto + property policies, eight fictional insurers, an active case in licensed review with
a bundle-loss quote scenario, and a completed historical switch.

## Tests

```bash
pnpm test                 # unit tests (schemas, engine incl. bundle-loss scenario, mobile)
pnpm typecheck            # strict TypeScript across the workspace
pnpm lint
pnpm format:check
pnpm db:types             # regenerate packages/database/src/database.types.ts from local Supabase
pnpm db:types:check       # fail if generated database types are out of sync
supabase test db          # pgTAP: RLS isolation, transition guards, audit immutability, security and workflow RPCs
pnpm --filter @autopilot/admin build
pnpm --filter @autopilot/mobile expo:doctor
```

## Documentation

- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Security](docs/security.md)
- [Demo walkthrough](docs/demo.md)
- [Deployment](docs/deployment.md)
- [Regulatory boundaries](docs/regulatory-boundaries.md)
- [Roadmap](docs/roadmap.md)

## License

[MIT](LICENSE)
