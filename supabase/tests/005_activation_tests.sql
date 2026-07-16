begin;
create extension if not exists pgtap with schema extensions;

select plan(7);

-- Setup: two customers and a household. a001 owns the household; a002 is another customer.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('50000000-0000-0000-0000-00000000a001', 'actcustomer@example.com', '{"role":"customer"}'::jsonb),
  ('50000000-0000-0000-0000-00000000a002', 'actother@example.com', '{"role":"customer"}'::jsonb);

insert into profiles (id, email, full_name, role)
values
  ('50000000-0000-0000-0000-00000000a001', 'actcustomer@example.com', 'Act Customer', 'customer'),
  ('50000000-0000-0000-0000-00000000a002', 'actother@example.com', 'Act Other', 'customer')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

insert into households (id, name, province, owner_profile_id, onboarding_step, autopilot_active)
values ('50000000-0000-0000-0000-00000000b001', 'Act Household', 'AB', '50000000-0000-0000-0000-00000000a001', 'activate', false);

insert into household_members (household_id, profile_id)
values ('50000000-0000-0000-0000-00000000b001', '50000000-0000-0000-0000-00000000a001');

set local role authenticated;
set local request.jwt.claims to '{"sub":"50000000-0000-0000-0000-00000000a001","role":"authenticated"}';

-- A document is required to activate.
insert into policy_documents (id, household_id, category, status, storage_path, file_name, mime_type, size_bytes)
values ('50000000-0000-0000-0000-00000000d001', '50000000-0000-0000-0000-00000000b001', 'current_auto_policy', 'uploaded', '50000000-0000-0000-0000-00000000b001/test.pdf', 'test.pdf', 'application/pdf', 1234);

-- 1. Missing consents and subscription: activation fails.
set local request.jwt.claims to '{"sub":"50000000-0000-0000-0000-00000000a001","role":"authenticated"}';
select throws_like(
  $$select activate_autopilot('50000000-0000-0000-0000-00000000b001')$$,
  '%required consents are missing%',
  'activation fails without consents'
);

-- Add consents.
set local role none;
insert into consents (id, profile_id, household_id, consent_type, granted, disclosure_version)
values ('50000000-0000-0000-0000-00000000c001', '50000000-0000-0000-0000-00000000a001', '50000000-0000-0000-0000-00000000b001', 'store_documents', true, 'v1'),
       ('50000000-0000-0000-0000-00000000c002', '50000000-0000-0000-0000-00000000a001', '50000000-0000-0000-0000-00000000b001', 'generate_recommendations', true, 'v1');

-- 2. Missing active subscription: activation still fails.
set local role authenticated;
set local request.jwt.claims to '{"sub":"50000000-0000-0000-0000-00000000a001","role":"authenticated"}';
select throws_like(
  $$select activate_autopilot('50000000-0000-0000-0000-00000000b001')$$,
  '%subscription is not active%',
  'activation fails without active subscription'
);

-- 3. Another customer cannot activate the household.
set local request.jwt.claims to '{"sub":"50000000-0000-0000-0000-00000000a002","role":"authenticated"}';
select throws_like(
  $$select activate_autopilot('50000000-0000-0000-0000-00000000b001')$$,
  '%only the household owner can activate autopilot%',
  'non-owner cannot activate autopilot'
);

-- 4. Pending subscription cannot activate.
set local role none;
insert into subscriptions (id, profile_id, status, current_period_end)
values ('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-00000000a001', 'pending', now() + interval '1 year');

set local role authenticated;
set local request.jwt.claims to '{"sub":"50000000-0000-0000-0000-00000000a001","role":"authenticated"}';
select throws_like(
  $$select activate_autopilot('50000000-0000-0000-0000-00000000b001')$$,
  '%subscription is not active%',
  'activation fails with pending subscription'
);

-- 5. Active subscription allows activation.
set local role none;
update subscriptions set status = 'active' where id = '50000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims to '{"sub":"50000000-0000-0000-0000-00000000a001","role":"authenticated"}';
select is(
  (select activate_autopilot('50000000-0000-0000-0000-00000000b001'))->>'success',
  'true',
  'activation succeeds with active subscription'
);

-- 6. Household is now marked active and onboarding complete.
select is(
  (select autopilot_active from households where id = '50000000-0000-0000-0000-00000000b001'),
  true,
  'household is marked autopilot_active after activation'
);

select is(
  (select onboarding_step from households where id = '50000000-0000-0000-0000-00000000b001'),
  'complete',
  'onboarding is marked complete after activation'
);

select * from finish();
rollback;
