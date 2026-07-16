# Insurance Autopilot MVP Remediation Plan

This document tracks the defects required to make the MVP secure and functionally end-to-end, the proposed fixes, affected files, required regression tests, and any schema migrations.

## Operating principles

- Do not disable RLS or grant broad client permissions.
- Do not move service-role credentials into client apps.
- Do not trust client-supplied roles or `actor_role` values.
- Do not bypass validation in local mode.
- Do not weaken state-machine guards.
- Prefer security-definer database functions or authenticated Edge Functions for workflow mutations.
- Keep the TypeScript monorepo architecture intact unless correctness requires a change.

---

## 1. Eliminate signup role escalation

### Defect

`handle_new_user()` in the schema migration derives the `profiles.role` from `raw_user_meta_data.role`. Public signup can therefore create `admin`, `reviewer`, or `operations` accounts.

### Fix

- Change the trigger so every signup receives `role = 'customer'` and does not read `raw_user_meta_data ->> 'role'`.
- Add a security-definer function `assign_staff_role(target_profile_id uuid, target_role user_role)` that:
  - is callable only by the `service_role` role;
  - accepts only `operations`, `reviewer`, or `admin`;
  - writes an `audit_events` row;
  - is used by a small admin-provision Edge Function or seed script.

### Affected files

- `supabase/migrations/20260715000001_schema.sql` (`handle_new_user`)
- New/updated migration for `assign_staff_role`
- `supabase/seed.sql` (staff seeding must continue to work)

### Regression tests

- Signup with `{"role":"admin"}` still creates a `customer`.
- Signup with `{"role":"reviewer"}` still creates a `customer`.
- A customer cannot update their own `role`.
- An authenticated user cannot invoke `assign_staff_role`.
- A service-role call can assign a staff role.

---

## 2. Redesign workflow write authorization

### Defect

RLS policies grant `update` on `optimization_cases`, `recommendations`, `customer_questions`, `switch_events`, `audit_events`, and other workflow tables to broad household membership or `can_access_case`. Customers can directly mutate regulated workflow state, recommendation values, and audit trails.

### Fix

Create transactional RPCs (security-definer functions) and revoke direct authenticated `insert`/`update` where they replace writes:

| RPC                                                                                                  | Caller           | Action                                   |
| ---------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------- |
| `answer_customer_question(question_id, answer)`                                                      | customer         | answers their own pending question       |
| `create_customer_support_question(case_id, prompt)`                                                  | customer         | creates a support question on their case |
| `approve_customer_recommendation(recommendation_id, expected_rec_version, expected_mandate_version)` | customer         | approves a published recommendation      |
| `decline_customer_recommendation(recommendation_id, expected_rec_version, expected_mandate_version)` | customer         | declines a published recommendation      |
| `review_recommendation(recommendation_id, approved, notes)`                                          | reviewer/admin   | licensed-review approve/reject           |
| `advance_switch_event(switch_event_id, target_state)`                                                | operations/admin | advances switch state                    |

Each RPC must:

1. Derive identity from `auth.uid()`.
2. Derive role from `profiles`.
3. Verify household/case access.
4. Verify current record and workflow state.
5. Validate the requested transition (use `state-machines.ts` logic in SQL).
6. Update only permitted columns.
7. Perform all related changes in one transaction.
8. Create the audit event internally.
9. Reject stale versions.
10. Return a structured JSON result.

RLS changes:

- `optimization_cases`: customers `select` only; staff `select`/`update` (with state-machine trigger handling writes); authenticated direct `update` to workflow columns is removed.
- `recommendations`: customers `select` only for published/final states; staff `insert`/`update`.
- `recommendation_approvals`: customers `select`; RPC inserts; remove direct authenticated `insert`.
- `switch_events`: operations/admin `update`; customer `select`; remove customer `insert`/`update`.
- `audit_events`: revoke authenticated `insert`; all audit rows created by triggers or security-definer RPCs.
- `customer_questions`: customers `select` and `update` only the `answer` column via RPC; staff `insert`/`update`.

### Affected files

- `supabase/migrations/20260715000002_rls.sql`
- New migration with workflow RPCs
- `apps/mobile/app/recommendation.tsx`
- `apps/mobile/app/(tabs)/home.tsx` and `(tabs)/autopilot.tsx` (question answering)
- `apps/admin/src/app/cases/[id]/tabs/recommendation.tsx`
- `apps/admin/src/app/cases/[id]/tabs/switching.tsx`
- `apps/admin/src/app/cases/[id]/tabs/questions.tsx`
- `packages/schemas/src/state-machines.ts` (referenced for transition lists)

### Regression tests

- Customer cannot `update optimization_cases` directly.
- Customer cannot `update recommendations` directly.
- Customer cannot `insert switch_events` directly.
- Customer cannot `insert audit_events` directly.
- Customer cannot insert a recommendation approval with `approver_role = reviewer`.
- Customer can answer only their own pending question.
- Customer cannot overwrite `prompt` or `question_type`.
- Reviewer can approve only a recommendation in `awaiting_review` for a case in `licensed_review`.
- Operations users cannot impersonate reviewers.
- Stale recommendation/mandate versions are rejected.
- A recommendation cannot be approved twice.
- A customer cannot approve another household's recommendation.

---

## 3. Repair document upload end to end

### Defects

- Mobile UI uses invalid enum values `current_policy` and `authorization`.
- Database enum `document_category` uses `current_auto_policy`, `current_property_policy`, `signed_authorization`.
- `policy_documents.uploaded_by` is `not null` but the upload helper omits it.
- Storage upload occurs before metadata insertion; failed metadata leaves orphaned objects.
- No MIME or size validation.

### Fix

- Add a shared `DocumentCategory` schema in `packages/schemas` with the valid enum values and use it in mobile, admin, and upload helper.
- Update mobile Documents tab and onboarding documents screen to show:
  - Current auto policy
  - Current property policy
  - Renewal notice
  - Competing quote
  - Proof of insurance
  - Signed authorization
  - Cancellation confirmation
  - Other
- Update `uploadPolicyDocument` to:
  1. Check `auth.getUser()`.
  2. Validate MIME type against an allow-list (PDF, PNG, JPG).
  3. Validate size against a configurable MVP limit.
  4. Create a safe path `householdId/uuid-fileName`.
  5. Upload to the private `policy-documents` bucket.
  6. Insert metadata row including `uploaded_by: user.id`.
  7. Delete the storage object on metadata insert failure.
  8. Return a structured result.

### Affected files

- `packages/schemas/src/index.ts` (export document category)
- `apps/mobile/lib/upload.ts`
- `apps/mobile/app/(tabs)/documents.tsx`
- `apps/mobile/app/onboarding/documents.tsx`
- `apps/admin/src/app/cases/[id]/tabs/documents.tsx`
- `apps/mobile/components/ui.tsx` (Select, if reused)

### Regression tests

- Customer can upload a valid PDF to their household.
- Customer can upload a valid image.
- Metadata row contains `uploaded_by`.
- Invalid categories are rejected.
- Unsupported MIME types are rejected.
- Oversized files are rejected.
- One customer cannot write into another household's storage path.
- Failed metadata insert cleans up the storage object.
- Signed URLs work only for authorized users.

---

## 4. Repair recommendation approval and decline flows

### Defects

- Mobile `recommendation.tsx` inserts `metadata` (nonexistent column), sets invalid `accepted`/`declined` enum values, performs non-atomic sequential client writes, and directly inserts a `customer_questions` row despite staff-only policy.
- Admin `recommendation.tsx` directly inserts `recommendation_approvals` with `approver_role: "reviewer"` from the client and performs multiple non-atomic case transitions.

### Fix

- Remove direct writes from mobile.
- Replace with `approve_customer_recommendation` and `decline_customer_recommendation` RPCs.
- Approval transaction must:
  1. Verify recommendation is `published`.
  2. Verify case is `customer_decision`.
  3. Verify recommendation belongs to caller's household.
  4. Verify expected recommendation version and mandate version.
  5. Verify quote IDs and recommendation have not been superseded.
  6. Insert `recommendation_approvals` with server-derived `customer` role.
  7. Set recommendation status to `customer_approved`.
  8. Create one `switch_events` row in `customer_approved`.
  9. Transition case to `switching`.
  10. Create audit event.
  11. Commit atomically.
- Decline transaction must set `customer_declined`, transition case to `retained_incumbent`, and audit.
- Customer questions must use `create_customer_support_question` RPC.
- Admin review must use `review_recommendation` RPC (reviewer/admin only, case in `licensed_review`, recommendation in `awaiting_review`).
- Reauthentication in mobile UI remains as UX-only; database does not trust client claims.

### Affected files

- `apps/mobile/app/recommendation.tsx`
- `apps/admin/src/app/cases/[id]/tabs/recommendation.tsx`
- New migration with approval/decline/review RPCs

### Regression tests

- Approval succeeds for a valid published recommendation.
- Correct enum value `customer_approved` is stored.
- Decline succeeds and stores `customer_declined`.
- Approval creates exactly one switch event.
- Approval and case transition are atomic.
- Failed operation leaves no partial approval.
- Stale versions fail.
- A recommendation cannot be approved after it is superseded.
- A customer cannot approve another household's recommendation.
- Support-question creation works only for the customer's case.

---

## 5. Repair subscriptions and Stripe webhook processing

### Defects

- `subscriptions.profile_id` is not unique, but the webhook uses `upsert(..., { onConflict: "profile_id" })`.
- The webhook records the event in `stripe_webhook_events` before completing the business operation; a later retry treats the event as a duplicate even if the first processing failed.
- Missing retry-state columns.

### Fix

- Add a forward migration with `alter table subscriptions add unique (profile_id);` (or make `profile_id` the primary key).
- Add `status`, `attempt_count`, `last_error`, `completed_at` to `stripe_webhook_events`.
- Rewrite the Stripe webhook Edge Function to:
  1. Verify Stripe signature.
  2. Check whether the event was already completed.
  3. Begin a transaction (or call an RPC).
  4. Upsert subscription.
  5. Store Stripe customer/subscription IDs and current-period end.
  6. Record the event as `completed` only after successful processing; on failure, store `failed`, increment attempts, set `last_error`, return non-2xx so Stripe retries.
  7. Create an audit event.
  8. Commit.
- Update payment bypass to use the same valid path and check all database errors.
- Document that `PAYMENTS_BYPASS` is `false` in production.

### Affected files

- `supabase/migrations/20260715000001_schema.sql` (new migration for changes)
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/create-checkout-session/index.ts` (bypass path)

### Regression tests

- One subscription exists per profile.
- Repeated webhook delivery is idempotent.
- A failed first processing attempt can be retried.
- An event is not marked completed before subscription persistence succeeds.
- Subscription deletion produces `cancelled`.
- Active renewal events update the stored period end.
- Bypass activation succeeds with the same uniqueness rules.

---

## 6. Generate and use Supabase database types

### Defect

No generated database types are present; invalid columns, enum values, and payloads are not caught at compile time.

### Fix

- Generate `packages/database/src/database.types.ts` from local Supabase (`pnpm db:types`).
- Use the generated `Database` type in:
  - `apps/mobile/lib/supabase.ts`
  - `apps/admin/src/lib/supabase.ts`
  - `packages/database/src/client.ts`
  - Edge Functions where feasible.
- Add a CI step that regenerates types and fails if the committed file differs.
- Limit `any`/casts to documented schema boundaries and validate external JSON with Zod.

### Affected files

- `packages/database/src/database.types.ts` (new)
- `packages/database/package.json`
- `package.json` (add `db:types` script)
- `apps/mobile/lib/supabase.ts`
- `apps/admin/src/lib/supabase.ts`
- `packages/database/src/client.ts`
- `.github/workflows/ci.yml`

### Regression tests

- CI type-regeneration check passes.
- Existing TypeScript checks still pass.

---

## 7. Strengthen database constraints

### Defects

No partial-unique indexes prevent multiple `is_current = true` rows for coverage requirements, switching preferences, duplicate active approvals, duplicate switch events per recommendation, or duplicate subscriptions per profile.

### Fix

- Add partial unique indexes:
  - `coverage_requirements(household_id) where is_current = true`
  - `switching_preferences(household_id) where is_current = true`
  - `recommendation_approvals(recommendation_id) where approved = true` (one active approval per recommendation)
  - `switch_events(recommendation_id) where state != 'failed'` (one active switch per recommendation)
  - `subscriptions(profile_id)` unique
- Add check constraints for valid recommendation/case relationships where enforceable.
- Add `not null` ownership fields where missing and tighten `created_by`/`updated_by`.

### Affected files

- New forward migration for constraints

### Regression tests

- Two current mandate rows cannot exist for one household.
- Two current preference rows cannot exist for one household.
- Two active approvals cannot exist for one recommendation.
- Two active switch events cannot exist for one recommendation.

---

## 8. Remove unsafe client-created audit events

### Defect

Clients insert `audit_events` directly. The `audit_insert` policy allows any authenticated user to insert.

### Fix

- Revoke authenticated `insert` on `audit_events`.
- Move audit creation into:
  - database triggers on state transitions (already partially done);
  - the new security-definer RPCs;
  - any remaining Edge Functions that perform mutations.
- Ensure each audit row derives `actor_profile_id`, `actor_role`, `created_at`, `household_id`, and `case_id` from trusted database context.

### Affected files

- `supabase/migrations/20260715000002_rls.sql`
- `apps/mobile/app/(tabs)/profile.tsx` (autopilot toggle audit)
- `apps/mobile/app/edit-mandate.tsx` (audit on save)
- `apps/mobile/app/onboarding/activate.tsx`
- `apps/admin/*` any direct audit inserts

### Regression tests

- Customers cannot insert audit events directly.
- Triggered audit events still populate after state transitions.

---

## 9. Improve quote request email reliability

### Defect

`send-quote-request` Edge Function uses an in-memory rate limiter that resets on instance restart and does not work across instances. It does not validate the quote request state, verify assignment, check the Resend response, or audit failures.

### Fix

- Replace the in-memory map with a database-backed rate limit table or use Postgres advisory locks on the `quote_requests` row.
- Validate `quoteRequestId` and verify the request is in `queued`.
- Verify the caller is assigned to the case or is an admin.
- Check the Resend HTTP response; do not mark `sent` if the call fails.
- Only set `sent_at` after successful provider or local outbox processing.
- Prevent duplicate send actions.
- Record provider response or failure in the audit trail.

### Affected files

- `supabase/functions/send-quote-request/index.ts`
- New migration for rate-limit/quote lock table (if needed)

### Regression tests

- Unassigned operations user cannot send a quote request.
- Sending a non-queued quote request fails.
- Duplicate send is rejected.
- Failed Resend call leaves the request in `queued`.
- `sent_at` is set only on success.

---

## 10. Correct active-case and terminal-state handling

### Defect

`useActiveCase()` selects the latest non-terminal case but can return a completed historical case if no active case exists, and a completed case may block creating a new case.

### Fix

- Update `useActiveCase()` to distinguish:
  - no case;
  - one active case;
  - one or more completed/historical cases (return the most recent for display but not as active work).
- Ensure `home`/`autopilot` tabs show completed outcome separately and allow new renewal cases.
- Update onboarding/finish to create a new case only when no active non-terminal case exists.

### Affected files

- `apps/mobile/lib/household.ts`
- `apps/mobile/app/(tabs)/home.tsx`
- `apps/mobile/app/(tabs)/autopilot.tsx`
- `apps/mobile/app/onboarding/activate.tsx`

### Regression tests

- Household with no case shows appropriate empty state.
- Household with one active case shows active work.
- Household with one completed case shows outcome and allows new case.
- Household with completed + active case shows both correctly.

---

## 11. Expand end-to-end CI coverage

### Defect

CI does not run Playwright or Maestro, and the Maestro flow asserts removed text.

### Fix

- Update `.github/workflows/ci.yml` to:
  - run migrations and seed;
  - run generated type verification (`pnpm db:types --check`);
  - run pgTAP tests;
  - build admin;
  - run Playwright tests against a started admin app;
  - run API/integration tests for the customer workflow RPCs.
- If a stable emulator is unavailable in CI, keep Maestro as a documented manual release check and add a robust API/mobile integration equivalent.
- Update `apps/mobile/.maestro/customer-golden-path.yaml` to match the current UI and remove assertions on removed text.

### Affected files

- `.github/workflows/ci.yml`
- `apps/mobile/.maestro/customer-golden-path.yaml`
- New test files in `packages/database/test/` or `apps/admin/e2e/`

### Regression tests (golden path)

1. Public customer registration.
2. Role is `customer`.
3. Household creation.
4. Membership activation.
5. Valid auto-policy upload.
6. Valid property-policy upload.
7. Case creation.
8. Staff extraction / policy entry.
9. Staff insurer shortlist.
10. Staff quote entry.
11. Deterministic recommendation generation.
12. Licensed-review approval.
13. Customer retrieves published recommendation.
14. Customer approval.
15. Switch event creation.
16. Replacement confirmation.
17. Incumbent cancellation confirmation.
18. Case completion.
19. Customer dashboard update.
20. Audit-event verification.

---

## 12. Add negative security integration tests

### Scope

Create a dedicated security test suite covering:

- role escalation;
- cross-household reads and writes;
- direct case/recommendation/switch manipulation;
- fake reviewer approval;
- fake audit insertion;
- storage path traversal;
- customer access to insurer internal notes;
- operations access outside assigned cases;
- reviewer access outside review-relevant states;
- unauthorized Edge Function invocation;
- expired/superseded recommendation approval;
- repeated approval requests.

### Affected files

- `supabase/tests/002_security_tests.sql` (new)
- `packages/database/test/security.test.ts` (new, if TypeScript integration tests are used)

---

## 13. Update documentation

### Documents to update

- `README.md`
- `docs/security.md`
- `docs/demo.md`
- `docs/regulatory-boundaries.md`
- `docs/deployment.md`
- `docs/architecture.md`
- `docs/data-model.md`

### Topics

- Corrected authorization model and RPC usage.
- Staff role provisioning via `assign_staff_role`.
- Webhook idempotency and retry semantics.
- Audit event generation (server-side only).
- Document upload file-size and MIME restrictions.
- Database type generation (`pnpm db:types`).
- End-to-end test commands.
- Simulated functions and why the platform is not ready for real insurance transactions.

---

## 14. PR hygiene

- Keep all work on `devin/1784150712-mvp-scaffold`.
- Commit logically, for example:
  1. `fix(security): prevent signup role escalation and restrict workflow writes`
  2. `fix(mobile): repair document upload and recommendation actions`
  3. `fix(payments): make subscription webhooks transactional and retryable`
  4. `test(e2e): exercise the complete customer and operations workflow`
  5. `docs: align security and demo documentation with implementation`
