# Implementation Plan — Insurance Autopilot MVP

## Overview

Monorepo (pnpm + Turborepo, TypeScript strict) delivering:

1. `apps/mobile` — Expo/React Native customer app (Expo Router, TanStack Query, RHF + Zod).
2. `apps/admin` — Next.js App Router operations console (Tailwind, shadcn/ui, TanStack Table/Query).
3. `supabase/` — migrations, RLS policies, seed data, Edge Functions (Stripe webhook, quote-request email dispatch).
4. `packages/schemas` — shared Zod schemas, enums, state machines.
5. `packages/insurance-engine` — deterministic, pure household optimization engine + unit tests.
6. `packages/database` — typed Supabase client helpers and generated types.
7. `packages/design-tokens`, `packages/config`, `packages/test-fixtures` — shared foundations.

## Build order

1. Repo scaffold: workspaces, Turborepo, strict tsconfig, lint/format config, CI skeleton.
2. `packages/schemas`: enums (case/quote-request/quote/switch states), state-machine transition maps, entity schemas in integer CAD cents.
3. `packages/insurance-engine`: configuration construction (bundled + split), hard-constraint filtering, total-cost math, net savings vs incumbent, ranking, reason codes. Unit tests including the exact bundle-loss scenario (Alternative A rejected, Alternative B eligible at ≤ C$200 threshold).
4. `supabase/migrations`: all core tables (UUID PKs, cents, UTC timestamps, created/updated audit columns), enums, transition-validation triggers, append-only `audit_events`, RLS on every exposed table, private storage buckets + storage policies.
5. `supabase/seed.sql`: demo accounts (customer/operations/reviewer/admin), Alberta household, 2 drivers, 2 vehicles, property, policies, mandate, active case, 8 fictional insurers, quote scenarios incl. bundle-loss, recommendation awaiting review, one completed switch.
6. Edge Functions: `stripe-webhook` (idempotent), `create-checkout-session` (with `PAYMENTS_BYPASS` flag), `send-quote-request` (email adapter: Resend or DB outbox), `recommendation-generator` (invokes the deterministic engine and persists recommendation + ranked options).
7. `apps/admin`: auth, overview dashboard, case queue with filters, case detail (household, policies, documents, mandate, shortlist, quote requests, quotes, comparison, questions, recommendation, switching, audit log), document extraction workflow (`DocumentExtractionProvider`: manual default, mock), insurer directory, licensed review, switch execution with ordering guard.
8. `apps/mobile`: onboarding flow (register → household → province → membership → uploads → confirmation → mandate → preferences → consents → activate), 5 tabs (Home, Coverage, Autopilot timeline, Documents, Profile), question answering, recommendation review + reauthenticated approval, biometric unlock.
9. Tests: engine + schema unit tests (Vitest), mobile Jest smoke test, RLS isolation integration tests (against local Supabase). Admin Playwright and mobile Maestro E2E flows are documented as next steps.
10. CI: GitHub Actions — install, format:check, lint, typecheck, unit tests, admin build, Expo config validation. No production secrets required.
11. Docs: README, architecture (Mermaid), data-model (ERD), security, demo script, deployment, regulatory-boundaries, roadmap.

## Non-goals (per spec)

No Kubernetes, microservices, GraphQL, Firebase, NestJS, native apps, scraping, real insurer APIs, AI recommendations, or required OCR.
