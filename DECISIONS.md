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
14. **Mobile e2e**: Maestro flow committed and documented; running it requires a local simulator/emulator and seeded Supabase (documented in `docs/demo.md`).
15. **Admin e2e**: Playwright tests run against `next dev` + local Supabase; CI runs build + unit tests only (no Supabase container in PR CI to keep it secret-free and fast); DB/RLS tests run via a documented local command.
16. **No real insurer names** in seed data; 8 fictional Alberta insurers.
17. **Dark mode**: skipped for MVP speed (allowed by spec).
18. **Package versions**: current stable at build time, pinned via `pnpm-lock.yaml`.
