begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

set local request.jwt.claims to '{"sub":"80000000-0000-0000-0000-00000000a001"}';

insert into auth.users (id, email, raw_user_meta_data)
values (
  '80000000-0000-0000-0000-00000000a001',
  'onboarding@example.com',
  '{"role":"customer"}'::jsonb
);
insert into profiles (id, email, full_name, role)
values (
  '80000000-0000-0000-0000-00000000a001',
  'onboarding@example.com',
  'Onboarding Customer',
  'customer'
)
on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;

insert into households (id, name, province, owner_profile_id, onboarding_step, autopilot_active)
values (
  '80000000-0000-0000-0000-00000000b001',
  'Onboarding Household',
  'AB',
  '80000000-0000-0000-0000-00000000a001',
  'membership',
  false
)
on conflict (id) do nothing;
insert into household_members (household_id, profile_id, member_role)
values (
  '80000000-0000-0000-0000-00000000b001',
  '80000000-0000-0000-0000-00000000a001',
  'owner'
)
on conflict (household_id, profile_id) do nothing;

set local request.jwt.claims to '{"sub":"80000000-0000-0000-0000-00000000a001"}';

-- Membership step can transition to consent step and enable Dangerous mode.
-- The default psql role (postgres) has table access and exercises the security
-- definer function on behalf of the JWT user.
select lives_ok(
  $$select enable_dangerous_mode_v1(
    '80000000-0000-0000-0000-00000000b001',
    'dangerous-mode-v1', 'processor-contract-v1', 'kimi-k3', 'kimi-k3-test',
    true, true, true, true
  )$$,
  'authenticated user can enable Dangerous mode and record document-processing consent'
);

set local role service_role;
set local request.jwt.claims to '{"sub":"80000000-0000-0000-0000-00000000a001","role":"service_role"}';

select is(
  (select onboarding_step from households where id = '80000000-0000-0000-0000-00000000b001'),
  'membership',
  'onboarding step is not changed by the consent RPC; the app controls routing'
);

select ok(
  (select dangerous_mode_enabled from household_document_processing_settings
    where household_id = '80000000-0000-0000-0000-00000000b001'),
  'Dangerous mode setting is enabled after explicit consent'
);

select is(
  (select disclosure_version from household_document_processing_settings
    where household_id = '80000000-0000-0000-0000-00000000b001'),
  'dangerous-mode-v1',
  'the enabled setting stores the canonical disclosure version'
);

select ok(
  exists (
    select 1 from document_processing_consent
    where household_id = '80000000-0000-0000-0000-00000000b001'
      and purpose = 'insurance_policy_extraction'
      and status = 'active'
      and privacy_notice_version = 'dangerous-mode-v1'
      and processor_contract_version = 'processor-contract-v1'
      and foreign_processing_acknowledged = true
      and automated_processing_acknowledged = true
      and raw_processing_approved = true
  ),
  'enable_dangerous_mode_v1 records an active versioned consent row'
);

-- A batch created after enabling Dangerous mode should reference the active consent.
insert into document_extraction_sessions (id, household_id, created_by, status)
values (
  '80000000-0000-0000-0000-00000000c001',
  '80000000-0000-0000-0000-00000000b001',
  '80000000-0000-0000-0000-00000000a001',
  'open'
)
on conflict (id) do nothing;

insert into policy_documents (
  id, household_id, category, status, storage_path, file_name, mime_type, size_bytes, uploaded_by, content_sha256
) values (
  '80000000-0000-0000-0000-00000000e001',
  '80000000-0000-0000-0000-00000000b001',
  'current_auto_policy',
  'uploaded',
  '80000000-0000-0000-0000-00000000b001/80000000-0000-0000-0000-00000000e001.pdf',
  'policy.pdf',
  'application/pdf',
  100,
  '80000000-0000-0000-0000-00000000a001',
  repeat('b', 64)
);

insert into document_processing_batches (
  id, household_id, created_by, client_request_id, session_id, mode_snapshot, settings_version, consent_id, disclosure_version, configured_provider, configured_model_id
)
select
  '80000000-0000-0000-0000-00000000d001',
  '80000000-0000-0000-0000-00000000b001',
  '80000000-0000-0000-0000-00000000a001',
  'onboarding-request-1',
  '80000000-0000-0000-0000-00000000c001',
  'dangerous',
  2,
  c.id,
  'dangerous-mode-v1',
  'kimi-k3',
  'kimi-k3-test'
from document_processing_consent c
where c.household_id = '80000000-0000-0000-0000-00000000b001'
  and c.purpose = 'insurance_policy_extraction'
  and c.status = 'active';

select ok(
  exists (
    select 1 from document_processing_batches
    where id = '80000000-0000-0000-0000-00000000d001'
      and mode_snapshot = 'dangerous'
      and consent_id is not null
  ),
  'a Dangerous-mode batch snapshot references the active consent'
);

insert into document_processing_batch_items (
  batch_id, household_id, client_item_id, policy_document_id, selected_file_name,
  category, content_sha256, deduplicated, status
) values (
  '80000000-0000-0000-0000-00000000d001', '80000000-0000-0000-0000-00000000b001',
  'selection-1', '80000000-0000-0000-0000-00000000e001', 'policy.pdf',
  'current_auto_policy', repeat('b', 64), false, 'uploaded'
);

-- Submit (queue) the batch and claim it as the worker would.
update document_processing_batches
set status = 'queued', submitted_at = now()
where id = '80000000-0000-0000-0000-00000000d001';

select is(
  claim_document_processing_batch_v1(
    '80000000-0000-0000-0000-00000000d001',
    '80000000-0000-0000-0000-00000000b001',
    120
  ),
  true,
  'the worker acquires the batch lease after it is submitted'
);

-- Simulate the extraction service creating a processing authorization.
insert into document_processing_authorizations (
  household_id, actor_profile_id, consent_id, purpose,
  privacy_notice_version, processor_contract_version,
  foreign_processing_acknowledged, automated_processing_acknowledged, raw_processing_approved,
  external_processing_enabled, authorization_result
)
select
  '80000000-0000-0000-0000-00000000b001',
  '80000000-0000-0000-0000-00000000a001',
  c.id,
  'insurance_policy_extraction',
  c.privacy_notice_version,
  c.processor_contract_version,
  c.foreign_processing_acknowledged,
  c.automated_processing_acknowledged,
  c.raw_processing_approved,
  true,
  'authorized'
from document_processing_consent c
where c.household_id = '80000000-0000-0000-0000-00000000b001'
  and c.purpose = 'insurance_policy_extraction'
  and c.status = 'active';

select ok(
  exists (
    select 1 from document_processing_authorizations
    where household_id = '80000000-0000-0000-0000-00000000b001'
      and authorization_result = 'authorized'
  ),
  'provider transmission authorization is created with the active consent snapshot'
);

-- The pre-transmission guard: live setting and active consent must still match.
select ok(
  (
    select dangerous_mode_enabled from household_document_processing_settings
    where household_id = '80000000-0000-0000-0000-00000000b001'
  )
  and exists (
    select 1 from document_processing_consent
    where household_id = '80000000-0000-0000-0000-00000000b001'
      and purpose = 'insurance_policy_extraction'
      and status = 'active'
      and withdrawn_at is null
  ),
  'live Dangerous mode setting and active consent are present for provider transmission'
);

-- Withdrawal must invalidate the live consent check.
select lives_ok(
  $$select withdraw_document_processing_consent(
    '80000000-0000-0000-0000-00000000b001',
    '80000000-0000-0000-0000-00000000a001',
    'insurance_policy_extraction'
  )$$,
  'consent can be withdrawn by the household owner'
);

select ok(
  not exists (
    select 1 from document_processing_consent
    where household_id = '80000000-0000-0000-0000-00000000b001'
      and purpose = 'insurance_policy_extraction'
      and status = 'active'
      and withdrawn_at is null
  ),
  'after withdrawal there is no active consent; provider transmission must be blocked'
);

select * from finish();
rollback;
