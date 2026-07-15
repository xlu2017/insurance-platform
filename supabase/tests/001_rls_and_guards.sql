begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- Fixtures: two customers with separate households.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-00000000a001', 'rls-customer-a@example.com', '{"full_name":"Customer A","role":"customer"}'),
  ('00000000-0000-0000-0000-00000000a002', 'rls-customer-b@example.com', '{"full_name":"Customer B","role":"customer"}');

insert into households (id, owner_profile_id, name, province)
values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'Household A', 'AB'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000a002', 'Household B', 'AB');

insert into household_members (household_id, profile_id, member_role)
values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-00000000a001', 'owner'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-00000000a002', 'owner');

-- 1. Customer A sees only their own household.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}';

select is(
  (select count(*)::int from households),
  1,
  'customer sees exactly one household'
);

select is(
  (select count(*)::int from households where id = '00000000-0000-0000-0000-00000000b002'),
  0,
  'customer cannot see another customer''s household'
);

-- 2. Customer cannot write to another household.
select throws_ok(
  $$insert into policies (household_id, insurer_name, product_line, annual_premium_cents, is_current)
    values ('00000000-0000-0000-0000-00000000b002', 'Foreign Insurer', 'auto', 100000, true)$$,
  '42501',
  'new row violates row-level security policy for table "policies"',
  'customer cannot insert a policy into another household'
);

reset role;
set local request.jwt.claims to '';

-- 3. Case state machine: skipping licensed review is rejected.
insert into optimization_cases (id, household_id, state)
values ('00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000b001', 'comparing_quotes');

select throws_like(
  $$update optimization_cases set state = 'customer_decision'
    where id = '00000000-0000-0000-0000-00000000c001'$$,
  '%Invalid case transition%',
  'cases cannot skip licensed review'
);

select lives_ok(
  $$update optimization_cases set state = 'licensed_review'
    where id = '00000000-0000-0000-0000-00000000c001'$$,
  'comparing_quotes -> licensed_review is allowed'
);

-- 4. Switch guard: incumbent cancellation cannot precede replacement confirmation.
insert into switch_events (id, case_id, state)
values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000c001', 'customer_approved');

update switch_events set state = 'replacement_pending'
where id = '00000000-0000-0000-0000-00000000d001';

select throws_like(
  $$update switch_events set state = 'incumbent_cancellation_pending'
    where id = '00000000-0000-0000-0000-00000000d001'$$,
  '%Invalid switch transition%',
  'cancellation cannot be reached before replacement is confirmed'
);

update switch_events
set state = 'replacement_confirmed', replacement_confirmed_at = now()
where id = '00000000-0000-0000-0000-00000000d001';

select lives_ok(
  $$update switch_events set state = 'incumbent_cancellation_pending'
    where id = '00000000-0000-0000-0000-00000000d001'$$,
  'cancellation is allowed once replacement coverage is confirmed'
);

-- 5. Audit events are append-only.
insert into audit_events (action, entity_type, household_id)
values ('test_event', 'household', '00000000-0000-0000-0000-00000000b001');

select throws_like(
  $$delete from audit_events where action = 'test_event'$$,
  '%append-only%',
  'audit events cannot be deleted'
);

select finish();
rollback;
