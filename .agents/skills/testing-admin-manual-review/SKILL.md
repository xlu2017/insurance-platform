---
name: Testing the Insurance Autopilot admin manual-review flow
description: How to test the staff manual-review flow in apps/admin against the local Supabase backend, including RLS and cookie pitfalls.
---

# Testing the Insurance Autopilot admin manual-review flow

## Devin Secrets Needed

None for local testing beyond the local Supabase stack.

## Repository setup

- Repo root: `/home/ubuntu/repos/insurance-platform`
- App package: `@autopilot/admin`
- Start the local Supabase backend:
  ```bash
  supabase start && supabase db reset
  ```
- Create `apps/admin/.env.local`:
  ```
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<local-anon-key>
  PAYMENTS_BYPASS=true
  ```
- Start the admin dev server:
  ```bash
  pnpm --filter @autopilot/admin dev
  ```
- Admin login: `http://localhost:3000/login`
  - Demo admin: `admin@example.com` / `DemoAdmin123!`
  - Demo operations/reviewer accounts also exist.

## Common blockers and workarounds

### 1. Admin `supabaseBrowser` does not read the auth cookie

`apps/admin/src/lib/supabase.ts` calls `createBrowserClient(url, key)` without a `cookies` option. In the test Chrome environment this fails to load the `sb-127-auth-token` cookie, so client queries run as anon and manual-review screens show no documents.

Workaround for testing: temporarily patch `apps/admin/src/lib/supabase.ts` to pass an explicit `cookies` object (or a `cookieOptions.name` matching the actual cookie name). Revert the file after the run.

### 2. Missing table privileges for authenticated role

The migrations `20260720000011_dangerous_mode_document_batches.sql` and related files create RLS policies for `document_processing_batches`, `document_processing_batch_items`, `asset_candidates`, and `policy_documents` but do not `GRANT` table-level privileges to `authenticated`. The admin `supabaseBrowser` (once authenticated) still gets `permission denied for table ...` because RLS policies cannot execute without the underlying table privileges.

Workaround for testing: run as postgres:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_processing_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_processing_batch_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_candidates TO authenticated;
GRANT SELECT, UPDATE ON public.policy_documents TO authenticated;
"
```

These grants should be added to the migration/seed pipeline.

### 3. React-controlled inputs do not update with `input.value`

The admin manual-review form uses controlled `Input`/`Select` components. Setting `element.value` and dispatching `input`/`change` events does not update React state, so the **Save manual candidate** validation will still see empty fields.

Workarounds:

- Use actual mouse/keyboard typing via the `computer` tool. Note: in the test Chrome environment, sequential `Tab`-and-type interactions can shift values by one field; pause between typing and `Tab`, or use single-character clicks.
- Use the native value setter from `HTMLInputElement.prototype` and then dispatch `input`/`change`/`blur` events. This updates both the DOM value and React's internal state in the test environment.
- Use the RPCs directly from the browser console with an authenticated token:
  - `save_staff_manual_policy_candidate_v1`
  - `set_manual_entry_document_status_v1` (mark documents `reviewed` or `not_relevant`)
  - `complete_manual_review_v1` (transition batch to `ready_for_review`)
  - `approve_candidate_assets_v2` (create final assets/policies; see caveat below)

### 4. `complete_manual_review_v1` does not approve candidates

Calling `complete_manual_review_v1` transitions the batch to `ready_for_review` and the case to `extracting_information`, but it does **not** call `approve_candidate_assets_v2`. The candidate remains `decision = undecided` and `review_status = pending` with no `approved_asset_id`/`approved_policy_id`.

To produce an asset/policy from a staff manual-review candidate you must either:

- Call `approve_candidate_assets_v2` separately with `decision = approve_new`/`link_existing` and the candidate id(s).
- Note that `approve_candidate_assets_v2` currently only allows `service_role` or a household member, not staff, so testing staff approval may require a `service_role` token.

### 5. `approve_candidate_assets_v2` is not staff-accessible

`approve_candidate_assets_v2` raises `only a household member or service_role may approve candidates`. The intended caller is the customer on the mobile review/reconcile flow. Staff cannot approve their own manual-review candidates; customer approval produces the final assets/policies.

### 6. `save_staff_manual_policy_candidate_v1` now accepts `ready_for_review` and populates draft-decision columns

Migration `20260804200011` relaxed `save_staff_manual_policy_candidate_v1` and `complete_manual_review_v1` to accept `ready_for_review` as well as `manual_review`, while preventing duplicate staff completions via `manual_entry_idempotency`. Staff can now save a candidate after the customer has completed manual entry.

The same migration also populates `asset_candidates.draft_decision`, `draft_existing_asset_id`, and `draft_existing_asset_type` from `selected_facts_json` (defaulting to `approve_new`), so `complete_manual_review_v1` should succeed without manual column updates.

`set_manual_entry_document_status_v1` now accepts `ready_for_review` (plus `manual_review` and `processing_unavailable`), so the admin UI **Reviewed**/**Not relevant** buttons work after customer completion.

### 7. Admin sign-in UI may be unresponsive in the test Chrome environment

The `/login` form sometimes does not respond to pointer clicks in the test Chrome environment (fields can be filled but the **Sign in** button does nothing). In that case, authenticate via the Supabase auth endpoint and use the staff RPCs directly from `curl` or the browser console:

```bash
curl -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
  -H 'apikey: <anon-key>' \
  -H 'Content-Type: application/json' \
  -d '{"email":"operations@example.com","password":"DemoOperations123!"}'
```

Then call:

- `save_staff_manual_policy_candidate_v1`
- `set_manual_entry_document_status_v1`
- `complete_manual_review_v1`

### 8. Operations staff need a `case_assignments` row to access a household

`can_access_household` grants staff access only when `app_role() = 'operations'` and a `case_assignments` row exists for that profile on a case in the household, or when `app_role() = 'reviewer'` and the case is in specific states. If the admin case page loads but no cases appear, or the case detail 404s, insert a `case_assignments` row for the operations user:

```sql
INSERT INTO case_assignments (case_id, assignee_profile_id, assignment_role)
VALUES ('<case_id>', '<operations_profile_id>', 'operations')
ON CONFLICT DO NOTHING;
```

## Useful direct DB queries

```sql
-- Verify a staff-created candidate was approved
select id, display_label, decision, review_status, approved_asset_id, approved_policy_id
from asset_candidates
where household_id = '20000000-0000-0000-0000-000000000001'
order by created_at desc;

-- Verify policies, asset links, and document provenance
select p.id, p.policy_number, p.product_line, p.annual_premium_cents, p.is_current, pal.asset_id, pal.asset_type
from policies p
left join policy_asset_links pal on pal.policy_id = p.id
where p.household_id = '20000000-0000-0000-0000-000000000001';

select pdpl.policy_id, pd.file_name, p.policy_number
from policy_document_policy_links pdpl
join policy_documents pd on pd.id = pdpl.policy_document_id
join policies p on p.id = pdpl.policy_id
where p.household_id = '20000000-0000-0000-0000-000000000001';
```

## Console log signals

- `permission denied for table document_processing_batches` — missing `GRANT` to `authenticated` (see blocker #2).
- `only a household member or service_role may approve candidates` — `approve_candidate_assets_v2` rejected the caller; use service_role or a household-member token for verification.
- `Batch is not in manual_review` — the batch has already been completed or was never submitted to `manual_review`.
- `Candidate source documents do not belong to batch` — the `source_document_ids` on a candidate reference a document not in the current batch.
