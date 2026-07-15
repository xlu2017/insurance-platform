# Decisions and Assumptions

1. **Money**: all monetary values are integer Canadian cents (`*_cents` columns / fields). Display formatting happens at the UI edge only.
2. **Timezone**: timestamps stored UTC (`timestamptz`); UI renders in `America/Edmonton`.
3. **Auth**: Supabase Auth email/password. Roles stored on `profiles.role` and mirrored into JWT via a `custom_access_token_hook`-free approach: RLS policies read `profiles.role` through a `security definer` helper (`app_role()`), avoiding client-editable claims.
4. **Role model**: single role per user (`customer`, `operations`, `reviewer`, `admin`). Operations access is scoped by `case_assignments`; admins see everything; reviewers see cases in `licensed_review` and their history.
5. **State machines**: allowed transitions encoded once in `packages/schemas` and enforced server-side by Postgres triggers using the same transition table (generated into SQL). Every transition writes an `audit_events` row.
6. **Stripe**: test-mode Checkout via Edge Function. `PAYMENTS_BYPASS=true` (default for local demo) marks the subscription active without Stripe so the demo needs no keys.
7. **Email**: `EmailProvider` interface — `resend` when `RESEND_API_KEY` set, else `outbox` provider writing to `email_outbox` table (visible in admin console).
8. **Push**: `PushProvider` interface — Expo push when configured, else rows in `notifications` with `channel='local_log'`.
9. **Document extraction**: `DocumentExtractionProvider` with `manual` (default) and `mock` implementations. No OCR dependency.
10. **Storage**: single private bucket `policy-documents`, path convention `household/{household_id}/...`; access via short-lived signed URLs (60s) created server-side after RLS-checked lookups.
11. **Seed users**: created by `supabase/seed.sql` inserting into `auth.users` with `crypt()` password hashes — acceptable for local demo only; documented as development-only.
12. **Incumbent representation**: the incumbent configuration is synthesized by the engine from current policies (as an implicit quote) so it always participates in ranking.
13. **Cancellation guard**: DB trigger + engine/state-machine check both prevent `incumbent_cancelled`/`incumbent_cancellation_pending → confirmed` before `replacement_confirmed`.
14. **E2E tests**: Admin Playwright and mobile Maestro golden paths are documented as next steps; the current CI runs build, unit tests, lint and typecheck without requiring a live backend.
15. **CI scope**: GitHub Actions runs `pnpm install`, `format:check`, `lint`, `typecheck`, `test`, admin build and Expo config validation; DB/RLS tests run via a documented local `supabase test db` command.
16. **No real insurer names** in seed data; 8 fictional Alberta insurers.
17. **Dark mode**: skipped for MVP speed (allowed by spec).
18. **Edge Function engine copy**: `supabase/functions/recommendation-generator/engine.ts` is a vendored copy of `packages/insurance-engine` so the Deno/Edge runtime can execute it without external module resolution; it must be kept in sync with the workspace engine.
19. **Package versions**: current stable at build time, pinned via `pnpm-lock.yaml`.
