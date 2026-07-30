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

## External SSO (OAuth/OIDC)

- Users can sign in with an external identity provider (Google OAuth/OIDC) in both the admin console
  and the mobile app, in addition to email/password. The provider is configured in
  `supabase/config.toml` under `[auth.external.google]`; `client_id` and `secret` are sourced from
  environment variables (`env(...)`) and never hardcoded or committed.
- **SSO users are not privileged.** A first-time SSO sign-in creates the auth user, which fires the
  same `handle_new_user()` trigger as any other signup and forces the profile role to `customer`.
  SSO does not and cannot set a staff role. Staff elevation remains exclusively through the
  service-role `assign_staff_role()` RPC invoked from a trusted backend context.
- **The admin console stays staff-only.** After an SSO round-trip, the callback route
  (`apps/admin/src/app/auth/callback/route.ts`) exchanges the code for a session using the
  `@supabase/ssr` server client and then applies the identical role gate used by the password flow:
  it reads `profiles.role`, and if the role is `customer` or missing it signs the user out and
  redirects to `/login` with the "This console is for operations, reviewer and administrator
  accounts." error. Only `operations`, `reviewer` and `admin` reach the console; the existing
  middleware repeats the same check on every subsequent request.
- The mobile client keeps `detectSessionInUrl: false`, so the OAuth deep link is parsed explicitly
  and the session is established via `exchangeCodeForSession` / `setSession` before persisting to
  Expo SecureStore. Redirect targets (admin callback origin and the `insurance-autopilot://` /
  `exp://` deep-link schemes) are allow-listed in `additional_redirect_urls`.

## Sensitive data handling

- Documents live in the private `policy-documents` bucket; access is via short-lived signed URLs
  (60 s) and RLS on `storage.objects` scoped to the household path prefix.
- Logs and audit summaries never include policy contents, identity documents, full addresses,
  tokens or payment data — audit rows carry compact JSON summaries only.
- No raw card data anywhere; Stripe hosted checkout handles payment details.
- Sessions are stored with Expo SecureStore on device; switch approval requires reauthentication
  (biometric where available).

## `SECURITY DEFINER` executor grants

Every `SECURITY DEFINER` function is classified by who may invoke it directly over PostgREST.
Internal helpers and triggers have no direct grants; workflow RPCs are granted to `authenticated`
and service-only functions to `service_role`.

| Function                                               | Classification            | Allowed direct grant |
| ------------------------------------------------------ | ------------------------- | -------------------- |
| `app_role()`                                           | RLS helper                | `authenticated`      |
| `is_staff()`                                           | RLS helper                | `authenticated`      |
| `is_admin()`                                           | RLS helper                | `authenticated`      |
| `is_household_member(uuid)`                            | RLS helper                | `authenticated`      |
| `staff_can_access_household(uuid)`                     | RLS helper                | `authenticated`      |
| `can_access_household(uuid)`                           | RLS helper                | `authenticated`      |
| `can_access_case(uuid)`                                | RLS helper                | `authenticated`      |
| `activate_autopilot(uuid)`                             | Customer workflow RPC     | `authenticated`      |
| `answer_customer_question(uuid, text)`                 | Customer workflow RPC     | `authenticated`      |
| `create_customer_support_question(uuid, text)`         | Customer workflow RPC     | `authenticated`      |
| `approve_customer_recommendation(uuid, int, int, int)` | Customer workflow RPC     | `authenticated`      |
| `decline_customer_recommendation(uuid, int, int, int)` | Customer workflow RPC     | `authenticated`      |
| `persist_engine_recommendation_v2(...)`                | Internal service-only RPC | `service_role`       |
| `start_recommendation_generation_attempt(...)`         | Internal service-only RPC | `service_role`       |
| `complete_recommendation_generation_attempt(...)`      | Internal service-only RPC | `service_role`       |
| `fail_recommendation_generation_attempt(...)`          | Internal service-only RPC | `service_role`       |
| `persist_recommendation(...)` (legacy)                 | Revoked / replaced        | none                 |
| `review_recommendation(uuid, boolean, text)`           | Staff workflow RPC        | `authenticated`      |
| `advance_switch_event(uuid, switch_state)`             | Staff workflow RPC        | `authenticated`      |
| `update_case_state(uuid, case_state)`                  | Staff workflow RPC        | `authenticated`      |
| `send_quote_request_email(uuid, text, boolean)`        | Staff workflow RPC        | `authenticated`      |
| `process_stripe_event(...)`                            | Service-only RPC          | `service_role`       |
| `assign_staff_role(uuid, uuid, user_role)`             | Service-only RPC          | `service_role`       |
| `handle_new_user()`                                    | Auth trigger              | none                 |
| `set_updated_at()`                                     | Trigger                   | none                 |
| `set_household_updated_by()`                           | Trigger                   | none                 |
| `set_coverage_requirements_updated_by()`               | Trigger                   | none                 |
| `set_switching_preferences_updated_by()`               | Trigger                   | none                 |
| `set_policy_document_uploaded_by()`                    | Trigger                   | none                 |
| `set_customer_questions_created_by()`                  | Trigger                   | none                 |
| `set_coverage_requirements_ownership()`                | Trigger                   | none                 |
| `set_switching_preferences_ownership()`                | Trigger                   | none                 |
| `audit_context()`                                      | Audit helper              | none                 |
| `log_audit(...)`                                       | Audit helper              | none                 |
| `audit_policy_document_insert()`                       | Audit trigger             | none                 |
| `audit_household_changes()`                            | Audit trigger             | none                 |
| `audit_coverage_requirements_change()`                 | Audit trigger             | none                 |
| `audit_switching_preferences_change()`                 | Audit trigger             | none                 |
| `audit_customer_question_insert()`                     | Audit trigger             | none                 |
| `reject_audit_mutation()`                              | Audit trigger             | none                 |
| `validate_case_transition()`                           | State-machine trigger     | none                 |
| `validate_quote_request_transition()`                  | State-machine trigger     | none                 |
| `validate_quote_transition()`                          | State-machine trigger     | none                 |
| `validate_switch_transition()`                         | State-machine trigger     | none                 |
| `require_household_member_for_recommendation(uuid)`    | Internal helper           | none                 |
| `supersede_prior_recommendations(uuid)`                | Internal helper           | none                 |

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

## Corrective Phase 1D security notes

- Recommendation persistence is internal-only: `persist_engine_recommendation_v2` is `SECURITY DEFINER`,
  granted only to `service_role`, and verifies the actor profile from `profiles`. Direct
  authenticated RPC calls are denied by revoked grants. The Edge Function supplies the
  authenticated user ID as the human actor and is the only trusted caller.
- Quote data quality is enforced at the schema and loader boundary: `quote_coverages` stores
  `validation_status`, `validation_errors`, and `data_source`; only `valid` components are fed to the
  engine. Unknown insurer metadata (rating, payment frequency, billing method, distribution channel)
  is mapped to `undefined` and fails closed against customer requirements.

## Known MVP limitations

- Rate limiting on Edge Functions is in-memory per instance (not distributed).
- No 2FA for staff accounts yet.
- Signed URL lifetime is fixed rather than per-category.
- No field-level encryption beyond Postgres/storage encryption at rest.
- The validated quote-write Edge Function is planned; current quote writes through the admin UI still
  require separate validation of `validation_status` before engine evaluation.
