# Architecture

## Overview

Insurance Autopilot is a pnpm/Turborepo monorepo with two applications sharing one Supabase
backend and a set of pure TypeScript packages.

```mermaid
flowchart LR
  subgraph Clients
    M[Expo mobile app\ncustomer]
    A[Next.js admin console\noperations / reviewer / admin]
  end
  subgraph Supabase
    AUTH[Auth]
    PG[(Postgres\nRLS + triggers)]
    ST[Storage\nprivate bucket]
    EF[Edge Functions\nstripe-webhook / checkout / send-quote-request / recommendation-generator]
  end
  E[packages/insurance-engine\ndeterministic comparison]
  M --> AUTH & PG & ST & EF
  A --> AUTH & PG & ST & EF
  A --> E
  EF --> PG
  S[Stripe test mode] --> EF
  R[Resend or email_outbox] --- EF
```

## Key decisions

- **State machines defined once, enforced twice.** Allowed transitions for cases, quote requests,
  quotes and switches live in `packages/schemas/src/state-machines.ts` and are re-implemented as
  `security definer` Postgres triggers. Clients cannot skip licensed review or cancel an incumbent
  policy before replacement coverage is confirmed, even with direct API access.
- **Workflow authorization is RPC-based.** Customer and staff workflow mutations (recommendation
  approve/decline, licensed review, switch advancement, support questions) are exposed only as
  `security definer` functions. Direct `update`/`insert` on workflow tables is denied to
  `authenticated` by RLS; the RPCs verify household membership, role and state before changing data.
- **Deterministic engine.** `packages/insurance-engine` is pure and side-effect free. It builds
  every bundled/split household configuration from usable quotes, always includes the incumbent,
  applies hard mandate constraints, computes total cost in integer cents (premiums + fees +
  cancellation charges − bundle discounts) and ranks with explicit reason codes. No AI decides
  coverage equivalence.
- **Provider adapters.** Email (Resend → `email_outbox` fallback), push (Expo → local log) and
  document extraction (`manual` default, `mock` for demos) are interfaces in
  `packages/database/src/providers`, so the demo runs with zero external services.
- **Money and time.** All money is integer Canadian cents. All timestamps are UTC; UIs render in
  `America/Edmonton`.
- **Audit.** Every state transition and sensitive mutation writes an `audit_events` row; the table
  is append-only via trigger and revoked privileges. Audit rows are never created by client code.
- **Type safety from generated schema.** `packages/database/src/database.types.ts` is generated
  with `pnpm db:types` from the local Supabase schema and consumed by `createClient<Database>` in
  both apps; `db:types:check` runs in CI to prevent drift.
- **Payments idempotency.** The Stripe webhook endpoint verifies signatures and delegates
  processing to the `process_stripe_event` RPC, which records every event, handles retries and
  never double-applies a subscription update.

## Case flow

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> awaiting_documents
  awaiting_documents --> extracting_information
  extracting_information --> awaiting_customer_confirmation
  awaiting_customer_confirmation --> ready_for_market_search
  ready_for_market_search --> requesting_quotes
  requesting_quotes --> awaiting_quotes
  awaiting_quotes --> comparing_quotes
  comparing_quotes --> licensed_review
  licensed_review --> recommendation_ready
  recommendation_ready --> customer_decision
  customer_decision --> switching
  customer_decision --> retained_incumbent
  switching --> completed
```

## Workspaces

| Workspace                   | Purpose                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile`               | Customer app: onboarding, 5-tab navigation, documents, questions, recommendation approval with reauthentication       |
| `apps/admin`                | Operations console: dashboard, case queue, case detail (11 tabs), quote entry, comparison, licensed review, switching |
| `packages/schemas`          | Zod schemas, enums, transition maps                                                                                   |
| `packages/insurance-engine` | Comparison and ranking engine + unit tests                                                                            |
| `packages/database`         | Supabase typed client (`Database`), generated types and provider adapters                                             |
| `packages/test-fixtures`    | Deterministic fixtures including the mandatory bundle-loss scenario                                                   |
