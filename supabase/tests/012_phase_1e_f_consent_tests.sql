begin;
create extension if not exists pgtap with schema extensions;

select plan(11);

-- Set up two customers and households.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('60000000-0000-0000-0000-00000000a001', 'consentowner@example.com', '{"role":"customer"}'::jsonb),
  ('60000000-0000-0000-0000-00000000a002', 'othercustomer@example.com', '{"role":"customer"}'::jsonb);

insert into profiles (id, email, full_name, role)
values ('60000000-0000-0000-0000-00000000a001', 'consentowner@example.com', 'Consent Owner', 'customer')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

insert into profiles (id, email, full_name, role)
values ('60000000-0000-0000-0000-00000000a002', 'othercustomer@example.com', 'Other Customer', 'customer')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

insert into households (id, name, province, owner_profile_id, onboarding_step, autopilot_active)
values
  ('60000000-0000-0000-0000-00000000b001', 'Consent Household', 'AB', '60000000-0000-0000-0000-00000000a001', 'complete', true),
  ('60000000-0000-0000-0000-00000000b002', 'Other Household', 'AB', '60000000-0000-0000-0000-00000000a002', 'complete', true);

insert into household_members (household_id, profile_id)
values
  ('60000000-0000-0000-0000-00000000b001', '60000000-0000-0000-0000-00000000a001'),
  ('60000000-0000-0000-0000-00000000b002', '60000000-0000-0000-0000-00000000a002');

-- 1. The owner can record consent through the trusted RPC.
set local role authenticated;
set local request.jwt.claims to '{"sub":"60000000-0000-0000-0000-00000000a001","role":"authenticated"}';

select lives_ok(
  $$select record_document_processing_consent(
    '60000000-0000-0000-0000-00000000b001'::uuid,
    '60000000-0000-0000-0000-00000000a001'::uuid,
    'insurance_policy_extraction',
    '1.0.0',
    '1.0.0',
    true,
    true,
    true
  )$$,
  'owner records document processing consent'
);

-- 2. Authenticated customers cannot read other households' consent records directly.
select throws_ok(
  $$select count(*) from document_processing_consent where household_id = '60000000-0000-0000-0000-00000000b002'::uuid$$,
  '42501',
  'permission denied for table document_processing_consent',
  'authenticated customer cannot select another household consent'
);

-- 3. Authenticated customers cannot insert consent directly.
select throws_ok(
  $$insert into document_processing_consent (household_id, profile_id, purpose, privacy_notice_version, processor_contract_version, foreign_processing_acknowledged, automated_processing_acknowledged, raw_processing_approved) values ('60000000-0000-0000-0000-00000000b001'::uuid, '60000000-0000-0000-0000-00000000a001'::uuid, 'insurance_policy_extraction', '1.0.0', '1.0.0', true, true, true)$$,
  '42501',
  'permission denied for table document_processing_consent',
  'authenticated direct insert is denied'
);

-- 4. Authenticated customers cannot update consent directly.
select throws_ok(
  $$update document_processing_consent set status = 'withdrawn' where household_id = '60000000-0000-0000-0000-00000000b001'::uuid$$,
  '42501',
  'permission denied for table document_processing_consent',
  'authenticated direct update is denied'
);

-- 5. Authenticated customers cannot delete consent directly.
select throws_ok(
  $$delete from document_processing_consent where household_id = '60000000-0000-0000-0000-00000000b001'::uuid$$,
  '42501',
  'permission denied for table document_processing_consent',
  'authenticated direct delete is denied'
);

-- Switch to service_role so the test can inspect protected consent records.
set local role service_role;

-- 6. The owner can replace consent; the old record is superseded and points to the new one.
select lives_ok(
  $$select record_document_processing_consent(
    '60000000-0000-0000-0000-00000000b001'::uuid,
    '60000000-0000-0000-0000-00000000a001'::uuid,
    'insurance_policy_extraction',
    '2.0.0',
    '2.0.0',
    true,
    true,
    true
  )$$,
  'owner replaces consent with a new notice version'
);

select set_eq(
  $$select status from document_processing_consent where household_id = '60000000-0000-0000-0000-00000000b001'::uuid$$,
  $$values ('superseded'::text), ('active'::text)$$,
  'replacement leaves old consent superseded and new consent active'
);

select ok(
  (select superseded_by is not null from document_processing_consent where status = 'superseded'),
  'superseded record links to replacement'
);

-- 7. The owner can withdraw consent; re-consenting after withdrawal creates a new active record.
select lives_ok(
  $$select withdraw_document_processing_consent(
    '60000000-0000-0000-0000-00000000b001'::uuid,
    '60000000-0000-0000-0000-00000000a001'::uuid,
    'insurance_policy_extraction'
  )$$,
  'owner withdraws consent'
);

select lives_ok(
  $$select record_document_processing_consent(
    '60000000-0000-0000-0000-00000000b001'::uuid,
    '60000000-0000-0000-0000-00000000a001'::uuid,
    'insurance_policy_extraction',
    '3.0.0',
    '3.0.0',
    true,
    true,
    true
  )$$,
  'owner re-records consent after withdrawal'
);

select set_eq(
  $$select status from document_processing_consent where household_id = '60000000-0000-0000-0000-00000000b001'::uuid$$,
  $$values ('superseded'::text), ('withdrawn'::text), ('active'::text)$$,
  'withdrawal and re-consent leave historical states intact'
);

select * from finish();
rollback;
