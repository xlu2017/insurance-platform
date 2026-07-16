# Security

## Trust boundaries

1. **Clients (mobile, admin)** hold only the anon key plus a user JWT. They are untrusted; every
   authorization decision is repeated in the database.
2. **Postgres with RLS** is the enforcement point. Every exposed table has RLS enabled; baseline
   grants give `authenticated` no more than the policies allow, and `anon` nothing.
3. **Edge Functions** hold the service-role key server-side only (never shipped to clients) and
   validate JWTs, inputs (shared Zod schemas) and apply rate limiting on sensitive endpoints.

## Roles and authorization

- One role per user (`customer`, `operations`, `reviewer`, `admin`) stored in `profiles` and read
  through a `security definer` helper (`app_role()`), never from client-editable claims.
- New signups are always forced to `customer` in `handle_new_user()`; staff roles can only be assigned
  by the service-role `assign_staff_role()` RPC invoked from a trusted backend context.
- Customers: only their own household data (ownership or membership).
- Operations: cases assigned to them (`case_assignments`); admins see everything.
- Reviewers: cases in review states plus their approvals.
- Customers can read quotes and published recommendations but can never write them; workflow
  mutations (recommendation approval, decline, review, switch advancement and support questions) must
  go through `security definer` RPCs. Direct `update` on `optimization_cases`, `recommendations`,
  `switch_events` and related tables is blocked by RLS for non-staff callers.

## Sensitive data handling

- Documents live in the private `policy-documents` bucket; access is via short-lived signed URLs
  (60 s) and RLS on `storage.objects` scoped to the household path prefix.
- Logs and audit summaries never include policy contents, identity documents, full addresses,
  tokens or payment data — audit rows carry compact JSON summaries only.
- No raw card data anywhere; Stripe hosted checkout handles payment details.
- Sessions are stored with Expo SecureStore on device; switch approval requires reauthentication
  (biometric where available).

## Auditability

`audit_events` is append-only: update/delete are revoked and a trigger raises on any attempt.
`audit_events` insert is restricted to staff through RLS; all client-side audit inserts were removed
and replaced with database triggers or transactional `security definer` RPCs.
All state transitions and workflow actions write audit rows.

## Secrets

- No secrets are committed; `.env.example` templates document required variables.
- Local demo runs entirely without external keys (`PAYMENTS_BYPASS`, email outbox, local push log).
- CI requires no production secrets.

## Incident response (MVP)

Rotate the affected Supabase keys, revoke sessions via Auth admin, review `audit_events` and
Postgres logs for the affected window, and notify affected users. A fuller runbook is roadmap work.

## Type safety

The `Database` type in `packages/database/src/database.types.ts` is generated from the local
Supabase schema (`pnpm db:types`) and the `db:types:check` script runs in CI. Both mobile and admin
apps use this type with `createClient<Database>` / `createBrowserClient<Database>` so column and
enum mismatches are caught at compile time.

## Known MVP limitations

- Rate limiting on Edge Functions is in-memory per instance (not distributed).
- No 2FA for staff accounts yet.
- Signed URL lifetime is fixed rather than per-category.
- No field-level encryption beyond Postgres/storage encryption at rest.
