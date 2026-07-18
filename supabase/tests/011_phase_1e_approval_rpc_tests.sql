begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- Set up service_role-like context and household.
insert into auth.users (id, email, raw_user_meta_data)
values ('50000000-0000-0000-0000-00000000a001', 'appcustomer@example.com', '{"role":"customer"}'::jsonb);

insert into profiles (id, email, full_name, role)
values ('50000000-0000-0000-0000-00000000a001', 'appcustomer@example.com', 'Approval Customer', 'customer')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

insert into households (id, name, province, owner_profile_id, onboarding_step, autopilot_active)
values ('50000000-0000-0000-0000-00000000b001', 'Approval Household', 'AB', '50000000-0000-0000-0000-00000000a001', 'complete', true);

insert into household_members (household_id, profile_id)
values ('50000000-0000-0000-0000-00000000b001', '50000000-0000-0000-0000-00000000a001');

-- Service-role context for extraction records; uploaded_by is set from JWT sub.
set local role service_role;
set local request.jwt.claims to '{"sub":"50000000-0000-0000-0000-00000000a001","role":"service_role"}';

-- Insert a source policy document and extracted document.
insert into policy_documents (id, household_id, policy_id, category, status, storage_path, file_name, mime_type, size_bytes)
values ('50000000-0000-0000-0000-00000000c001', '50000000-0000-0000-0000-00000000b001', null, 'current_auto_policy', 'uploaded', '50000000-0000-0000-0000-50000000b001/auto.pdf', 'auto.pdf', 'application/pdf', 1234);

insert into document_extraction_sessions (id, household_id, status)
values ('50000000-0000-0000-0000-00000000d001', '50000000-0000-0000-0000-00000000b001', 'open');

insert into extracted_documents (id, session_id, household_id, policy_document_id, file_digest, page_count, classification)
values ('50000000-0000-0000-0000-00000000e001', '50000000-0000-0000-0000-00000000d001', '50000000-0000-0000-0000-00000000b001', '50000000-0000-0000-0000-00000000c001', 'digest1', 3, 'auto');

-- Insert an asset candidate with selected facts.
insert into asset_candidates (
  id, session_id, household_id, asset_type, identity_fingerprint, display_label,
  occupancy, match_classification, decision, review_status, source_document_ids, selected_facts_json
) values (
  '50000000-0000-0000-0000-00000000f001',
  '50000000-0000-0000-0000-00000000d001',
  '50000000-0000-0000-0000-00000000b001',
  'vehicle',
  'vehicle:vin:3CZRU5H75GM123456',
  '2016 Honda HR-V',
  'unknown',
  'new',
  'undecided',
  'pending',
  array['50000000-0000-0000-0000-00000000e001'::uuid],
  '{
    "identity": {"year": 2016, "make": "Honda", "model": "HR-V", "vin": "3CZRU5H75GM123456"},
    "currentPolicy": {"insurerName": "Test Insurer", "annualPremiumCents": 120000, "effectiveDate": "2026-01-01", "expiryDate": "2027-01-01"},
    "currentCoverage": {"thirdPartyLiabilityLimitCents": {"value": 2000000}},
    "mandateSuggestions": {"thirdPartyLiabilityLimitCents": {"rule": "minimum", "amountCents": 2000000}}
  }'::jsonb
);

-- 1. approve_candidate_assets_v1 creates a vehicle, policy, and mandate.
select lives_ok(
  $$select approve_candidate_assets_v1(
    '50000000-0000-0000-0000-00000000b001'::uuid,
    '50000000-0000-0000-0000-00000000a001'::uuid,
    'client-request-1',
    array['50000000-0000-0000-0000-00000000f001'::uuid]
  )$$,
  'approve_candidate_assets_v1 succeeds for a vehicle candidate'
);

-- 2. Candidate is marked approved.
select is(
  (select decision || ':' || review_status from asset_candidates where id = '50000000-0000-0000-0000-00000000f001'),
  'approved:approved',
  'candidate decision and review status are approved'
);

-- 3. A vehicle was created.
select is(
  (select count(*)::int from vehicles where household_id = '50000000-0000-0000-0000-00000000b001'),
  1,
  'one vehicle created'
);

-- 4. A policy was created and linked to the source document.
select is(
  (select count(*)::int from policies where household_id = '50000000-0000-0000-0000-00000000b001'),
  1,
  'one policy created'
);

select is(
  (select policy_id from policy_documents where id = '50000000-0000-0000-0000-00000000c001'),
  (select id from policies where household_id = '50000000-0000-0000-0000-00000000b001'),
  'policy document is linked to created policy'
);

-- 5. A mandate version with a vehicle override was created.
select is(
  (select count(*)::int from household_coverage_mandates where household_id = '50000000-0000-0000-0000-00000000b001' and is_current = true),
  1,
  'one current mandate created'
);

select is(
  (select count(*)::int from vehicle_mandate_overrides
   where vehicle_id = (select id from vehicles where household_id = '50000000-0000-0000-0000-00000000b001')),
  1,
  'one vehicle mandate override created'
);

-- 6. Repeated call with the same client_request_id returns the same result.
select lives_ok(
  $$select approve_candidate_assets_v1(
    '50000000-0000-0000-0000-00000000b001'::uuid,
    '50000000-0000-0000-0000-00000000a001'::uuid,
    'client-request-1',
    array['50000000-0000-0000-0000-00000000f001'::uuid]
  )$$,
  'idempotent re-approval with same client request id is allowed'
);

select is(
  (select count(*)::int from candidate_approvals where client_request_id = 'client-request-1'),
  1,
  'only one approval ledger row for idempotent request'
);

-- 7. Non-service_role callers are denied.
set local role authenticated;
set local request.jwt.claims to '{"sub":"50000000-0000-0000-0000-00000000a001","role":"authenticated"}';

select throws_ok(
  $$select approve_candidate_assets_v1(
    '50000000-0000-0000-0000-00000000b001'::uuid,
    '50000000-0000-0000-0000-00000000a001'::uuid,
    'client-request-2',
    array['50000000-0000-0000-0000-00000000f001'::uuid]
  )$$,
  'P0001',
  null,
  'authenticated caller cannot approve candidates'
);

select * from finish();
rollback;
