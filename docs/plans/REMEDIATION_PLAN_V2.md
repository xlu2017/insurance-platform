# Second Security & Correctness Remediation Plan

Repository: `xlu2017/insurance-platform`
Branch: `devin/1784150712-mvp-scaffold`
PR: #1 (do not merge)

## 1. Eliminate direct staff bypasses of workflow RPCs

- **Root cause:** RLS policies still allow authenticated staff with `can_access_case` to `INSERT`/`UPDATE`/`DELETE` protected workflow tables directly. Staff can therefore skip role-specific RPC validations and required side-effects (approval rows, audits, case-state transitions).
- **Affected files:**
  - `supabase/migrations/20260715000002_rls.sql`
  - `supabase/migrations/20260715000007_rpc_lockdown.sql` (new)
  - `supabase/tests/004_rpc_security_tests.sql` (new)
  - `apps/admin/src/app/cases/[id]/tabs/comparison.tsx`
  - `apps/admin/src/app/cases/[id]/tabs/recommendation.tsx`
  - `apps/admin/src/app/cases/[id]/tabs/switching.tsx`
  - `apps/mobile/app/recommendation.tsx`
- **Migration:**
  - Revoke direct `INSERT`/`UPDATE`/`DELETE` on `recommendations`, `recommendation_options`, `recommendation_approvals`, `switch_events` for `authenticated`.
  - Keep `SELECT` for `authenticated` (staff and customers) where the policies already restrict to their cases.
  - Remove generic `optimization_cases` `UPDATE` via PostgREST; route all state transitions through RPCs or trigger-validated functions.
  - Add `WITH CHECK (false)` equivalent policies where needed.
- **Implementation approach:**
  - Narrow workflow RPCs already exist (`review_recommendation`, `advance_switch_event`, `approve_customer_recommendation`, etc.). Make them the only write paths.
  - Harden `review_recommendation` to insert durable `recommendation_approvals` rows.
  - Add an `update_case_state` RPC for non-workflow state transitions, with role/assignment checks.
  - Update admin/mobile call sites to use RPCs and remove direct table writes.
- **Regression tests:** pgTAP negative tests proving operations cannot directly `UPDATE recommendations` to `published` or `rejected`, reviewers cannot `UPDATE switch_events`, reviewers cannot directly set case state to `switching`, etc.
- **Acceptance criteria:** Direct authenticated writes to the four protected tables fail; RPC paths succeed; `supabase test db` passes.

## 2. Restore durable licensed-review decisions

- **Root cause:** `review_recommendation()` updates recommendation/case status but never inserts a `recommendation_approvals` row, drops `p_notes`, and does not protect against repeated reviewer decisions.
- **Affected files:**
  - `supabase/migrations/20260715000006_rpc_renames.sql` (replace `review_recommendation`)
  - `supabase/migrations/20260715000006_rpc_renames.sql` (add partial unique index)
  - `apps/admin/src/app/cases/[id]/tabs/recommendation.tsx`
- **Migration:**
  - Replace `review_recommendation` with an atomic function that derives reviewer from `auth.uid()` and `profiles.role`.
  - Verify case state is `licensed_review`, recommendation is `awaiting_review`.
  - Insert one `recommendation_approvals` row with `recommendation_id`, reviewer `profile_id`, trusted reviewer role, `approved`, `notes`, and timestamp.
  - Update recommendation status and advance the case through valid states.
  - Add partial unique index: `recommendation_id` where `approver_role in ('reviewer','admin')`.
- **Implementation approach:** Rewrite the RPC; pass `p_notes` through; reject duplicate licensed-review decisions.
- **Regression tests:** Reviewer approval creates an approval row, rejection creates a decision row, notes are persisted, duplicate rejected, operations cannot review, approval publishes recommendation, rejection returns case to `comparing_quotes`, rollback on any failure.
- **Acceptance criteria:** One durable licensed-review decision per recommendation; reviewer notes preserved; case transitions correct.

## 3. Lock down every `SECURITY DEFINER` function

- **Root cause:** `SECURITY DEFINER` functions are callable by `authenticated` unless explicit `REVOKE`/`GRANT` statements restrict them. `process_stripe_event`, `log_audit`, `assign_staff_role`, and internal helpers are exposed over PostgREST RPC.
- **Affected files:**
  - `supabase/migrations/20260715000001_schema.sql`
  - `supabase/migrations/20260715000003_remediation.sql`
  - `supabase/migrations/20260715000007_rpc_lockdown.sql` (new)
  - `docs/security.md`
- **Migration:**
  - Inventory every `SECURITY DEFINER` function.
  - `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated;`
  - Grant only to intended roles:
    - `process_stripe_event`, `assign_staff_role` → `service_role`
    - `log_audit`, trigger helpers → internal use only (no direct grants)
    - customer RPCs (`approve_customer_recommendation`, `decline_customer_recommendation`, `answer_customer_question`, `create_customer_support_question`) → `authenticated`
    - reviewer RPC (`review_recommendation`) → `authenticated` with internal role check
    - operations/admin RPCs (`advance_switch_event`, `update_case_state`) → `authenticated` with internal role check
- **Implementation approach:** Add `REVOKE`/`GRANT` statements after all function definitions. Document the executor table in `docs/security.md`.
- **Regression tests:** Direct anonymous/authenticated RPC calls to service-role and internal-only functions fail; authorized RPCs still succeed.
- **Acceptance criteria:** Every `SECURITY DEFINER` function has an explicit grant table; unauthorized direct RPCs fail.

## 4. Make recommendation generation server-side and atomic

- **Root cause:** `apps/admin/src/app/cases/[id]/tabs/comparison.tsx` runs the insurance engine in the browser, then makes several direct table inserts/updates across the network with hardcoded versions and no rollback semantics.
- **Affected files:**
  - `supabase/functions/recommendation-generator/index.ts`
  - `supabase/migrations/20260715000008_generate_recommendation.sql` (new)
  - `apps/admin/src/app/cases/[id]/tabs/comparison.tsx`
  - `packages/insurance-engine`
- **Migration:**
  - Add a `generate_recommendation(p_case_id uuid)` `SECURITY DEFINER` RPC or extend the Edge Function to call a transactional persistence RPC.
  - Add columns to `recommendations` if needed: `switching_preferences_version`, `quote_ids`, `coverage_mandate_version` (already partially present), `engine_version`.
  - Add `switching_preferences_version` to `recommendations`.
- **Implementation approach:**
  - Edge Function authenticates caller and validates role (`operations` or `admin`).
  - Loads current mandate and switching preferences, validates case in `comparing_quotes`.
  - Runs deterministic engine, computes next `version`, marks prior active recommendation superseded.
  - Calls persistence RPC to insert `recommendations`, `recommendation_options`, transition case to `licensed_review`, and write an audit event in one transaction.
  - Persistence RPC validates versions have not changed between load and write.
- **Regression tests:** Generation succeeds from `comparing_quotes`, version increments, mandate/preference versions recorded, old recommendation superseded, stale data rejected, partial failure rolls back, unauthorized callers rejected.
- **Acceptance criteria:** Admin Comparison tab calls one endpoint; no direct client inserts/updates to protected tables.

## 5. Correct recommendation approval version validation

- **Root cause:** Customer approval compares a client-supplied expected mandate version against current mandate but does not compare against the recommendation's stored `mandate_version` or `switching_preferences_version`. Quote expiry/rejection and newer recommendations are not checked.
- **Affected files:**
  - `supabase/migrations/20260715000006_rpc_renames.sql` (replace approval/decline RPCs)
  - `apps/mobile/app/recommendation.tsx`
  - `packages/database/src/database.types.ts`
- **Migration:**
  - Replace `approve_customer_recommendation` and `decline_customer_recommendation` to require `p_expected_rec_version`, `p_expected_mandate_version`, and `p_expected_switching_version`.
  - Validate `recommendation.coverage_mandate_version` and `recommendation.switching_preferences_version` match current and expected values.
  - Validate all referenced quotes exist, are not expired, not superseded, not rejected.
  - Validate no newer active recommendation.
- **Implementation approach:** Update RPC signatures and mobile call site to pass all expected versions.
- **Regression tests:** Approval fails when mandate or preferences changed after generation, quote expired/rejected, newer recommendation exists, stored version differs from expected.
- **Acceptance criteria:** Mobile approval RPC rejects stale or manipulated recommendations.

## 6. Enforce paid membership before activation

- **Root cause:** `PAYMENTS_BYPASS` defaults to `true`; mobile onboarding advances after opening Stripe Checkout without waiting for webhook; `autopilot_active` can be set without an active subscription.
- **Affected files:**
  - `supabase/functions/create-checkout-session/index.ts`
  - `supabase/functions/stripe-webhook/index.ts`
  - `supabase/migrations/20260715000009_activation.sql` (new)
  - `apps/mobile/app/onboarding/payment.tsx`
  - `apps/mobile/app/(tabs)/profile.tsx`
- **Migration:**
  - Add `activate_autopilot(p_household_id uuid)` `SECURITY DEFINER` RPC.
  - Validates caller owns household, consents exist, subscription active (or `PAYMENTS_BYPASS` explicitly `'true'` and transactional).
  - Sets `autopilot_active = true`, marks onboarding complete, writes audit event.
- **Implementation approach:**
  - Change `PAYMENTS_BYPASS` default to `false` (`Deno.env.get("PAYMENTS_BYPASS") === "true"`).
  - Mobile payment screen opens Stripe URL but does not advance onboarding; polls `subscriptions` status or waits for webhook.
  - Profile autopilot toggle calls `activate_autopilot` instead of direct update.
- **Regression tests:** Abandoned checkout does not activate, pending/inactive subscription cannot activate, active subscription can activate, bypass disabled by default, customer cannot activate another household, audit event created.
- **Acceptance criteria:** Autopilot activation is server-side and subscription-gated.

## 7. Correct Stripe webhook architecture

- **Root cause:** `process_stripe_event()` is callable by `authenticated`, may trust missing metadata, and may swallow exceptions inside the function while writing a failed row and returning success.
- **Affected files:**
  - `supabase/functions/stripe-webhook/index.ts`
  - `supabase/migrations/20260715000003_remediation.sql` (replace `process_stripe_event`)
- **Migration:**
  - `process_stripe_event` service-role only and idempotent.
  - Resolve profile by `stripe_subscription_id`, `stripe_customer_id`, then metadata.
  - Wrap subscription update, webhook completion, and audit event in one transaction.
  - On unresolvable profile, record a failed/retryable event and raise an error (Edge Function returns non-2xx).
- **Implementation approach:** Edge Function verifies Stripe signature, calls `process_stripe_event` with `service_role` client. Function raises on failure; Edge Function returns non-2xx. Duplicate events return idempotent success.
- **Regression tests:** checkout completion, subscription update/cancellation, missing metadata with successful ID lookup, missing metadata with failed lookup, duplicate delivery, retry after failure, unauthorized direct invocation.
- **Acceptance criteria:** Webhook handler is idempotent, transactional, and returns non-2xx on unresolvable events.

## 8. Enforce document restrictions server-side

- **Root cause:** Upload limits live in mobile code, Storage bucket does not enforce max size or MIME types, and cleanup requires broad delete permissions.
- **Affected files:**
  - `supabase/migrations/20260715000010_documents.sql` (new)
  - `supabase/functions/upload-document/index.ts` (new, optional)
  - `apps/mobile/app/(tabs)/documents.tsx`
  - `apps/mobile/lib/documents.ts` (if any)
- **Migration:**
  - Configure the `private` Storage bucket: `max_file_size` and `allowed_mime_types` (`application/pdf`, `image/jpeg`, `image/png`).
  - Add a `SECURITY DEFINER` upload finalization/cleanup RPC and restrictive storage policies.
- **Implementation approach:**
  - Prefer an Edge Function or signed-upload flow that validates household ownership, category, MIME type, file size, and path.
  - Metadata record and storage object created atomically where possible; cleanup on failure via service-role function or narrow delete RPC.
- **Regression tests:** Cross-household access denied, forged path denied, oversized file rejected, unsupported MIME rejected, orphan cleanup, signed URL authorization, metadata ownership.
- **Acceptance criteria:** Document storage is size/type-limited and household-scoped.

## 9. Repair quote-request email delivery

- **Root cause:** Edge Function has no CORS, `quote_request_sends` is unused, duplicate sends possible, failed attempts are marked sent, and email/provider DB updates are not atomic.
- **Affected files:**
  - `supabase/functions/send-quote-request/index.ts`
  - `supabase/migrations/20260715000011_quote_request_email.sql` (new)
  - `apps/admin/src/app/cases/[id]/tabs/quotes.tsx` (button that invokes it)
- **Migration:**
  - Add status/error columns to `email_outbox` if needed.
  - Use `quote_request_sends` for idempotency.
  - Wrap reserve/provider call/success or failure/audit in a transaction.
- **Implementation approach:**
  - Edge Function handles `OPTIONS` preflight and CORS headers.
  - Authenticate staff, verify role and assignment, verify quote request is `queued`.
  - Reserve with `ON CONFLICT`, call provider, update `quote_requests` state to `sent` only on success.
- **Regression tests:** Preflight succeeds, assigned operations can send, customer/unassigned cannot, duplicate concurrent send results in one provider call, failure does not mark sent, retry works.
- **Acceptance criteria:** Email sending is CORS-compliant, idempotent, and atomic.

## 10. Add staff authorization to the admin application

- **Root cause:** Admin `Shell` only checks for an authenticated session; customers could access staff routes if they navigated directly.
- **Affected files:**
  - `apps/admin/src/components/shell.tsx`
  - `apps/admin/src/middleware.ts`
  - `apps/admin/src/app/login/page.tsx`
  - `apps/admin/src/components/app-shell.tsx` (nav)
- **Migration:** none.
- **Implementation approach:**
  - In `Shell`, load `profiles.role` from the trusted DB and redirect customers to an access-denied page or sign out.
  - Hide role-inappropriate navigation items (reviewer only sees review queue, operations sees cases/quotes/questions/switching, admin sees all).
  - Keep RLS as final guard.
- **Regression tests:** Customer cannot load admin routes, unauthenticated redirect, operations/reviewer/admin access appropriate tabs.
- **Acceptance criteria:** Admin routes are role-protected and navigation is role-specific.

## 11. Add a real end-to-end CI workflow

- **Root cause:** CI does not run Playwright or complete the full customer-to-operations workflow. Existing Playwright test is incomplete and Maestro test has a stale `current` assertion.
- **Affected files:**
  - `.github/workflows/ci.yml`
  - `e2e/` or `apps/admin/e2e/`
  - `apps/mobile/maestro/`
- **Migration:** none.
- **Implementation approach:**
  - Add a CI job that starts Supabase, resets/seeds, starts the admin dev server, and runs Playwright.
  - The Playwright test completes: registration, role claim rejection, household creation, subscription bypass, document upload simulation, autopilot activation, operations case access, quote entry, server-side recommendation generation, reviewer approval, customer approval, switch advancement, completion, audit verification.
  - Update or remove Maestro stale `current` text assertion.
- **Regression tests:** CI job runs Playwright end-to-end and verifies final DB state.
- **Acceptance criteria:** CI performs the full golden path; tests assert exact expected states.

## 12. Full verification matrix

After all changes:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm --filter @autopilot/admin build`
- `pnpm --filter @autopilot/mobile expo:doctor`
- `supabase test db`
- `pnpm db:types:check`
- `pnpm format:check`
- Playwright CI smoke test (local or CI)

Then update PR #1 with a summary of all V2 changes and ensure the branch is not merged.
