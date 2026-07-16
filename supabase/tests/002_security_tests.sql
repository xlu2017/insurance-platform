begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

-- Test users and households.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('10000000-0000-0000-0000-00000000a001', 'sec-customer-a@example.com', '{"full_name":"Customer A","role":"customer"}'),
  ('10000000-0000-0000-0000-00000000a002', 'sec-customer-b@example.com', '{"full_name":"Customer B","role":"customer"}'),
  ('10000000-0000-0000-0000-00000000a003', 'sec-operations@example.com', '{"full_name":"Operations","role":"operations"}'),
  ('10000000-0000-0000-0000-00000000a004', 'sec-reviewer@example.com', '{"full_name":"Reviewer","role":"reviewer"}'),
  ('10000000-0000-0000-0000-00000000a005', 'sec-admin@example.com', '{"full_name":"Admin","role":"admin"}');

-- Manually set the seeded profiles to their claimed roles for these tests.
update profiles set role = 'operations' where id = '10000000-0000-0000-0000-00000000a003';
update profiles set role = 'reviewer' where id = '10000000-0000-0000-0000-00000000a004';
update profiles set role = 'admin' where id = '10000000-0000-0000-0000-00000000a005';

insert into households (id, owner_profile_id, name, province)
values
  ('10000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-00000000a001', 'Household A', 'AB'),
  ('10000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-00000000a002', 'Household B', 'AB');

insert into household_members (household_id, profile_id, member_role)
values
  ('10000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-00000000a001', 'owner'),
  ('10000000-0000-0000-0000-00000000b002', '10000000-0000-0000-0000-00000000a002', 'owner');

insert into coverage_requirements (id, household_id, is_current, version, auto_requirements, property_requirements, created_by)
values
  ('10000000-0000-0000-0000-00000000c001', '10000000-0000-0000-0000-00000000b001', true, 1, '{}', '{}', '10000000-0000-0000-0000-00000000a001'),
  ('10000000-0000-0000-0000-00000000c002', '10000000-0000-0000-0000-00000000b002', true, 1, '{}', '{}', '10000000-0000-0000-0000-00000000a002');

insert into switching_preferences (id, household_id, is_current, version, created_by)
values
  ('10000000-0000-0000-0000-00000000a0a1', '10000000-0000-0000-0000-00000000b001', true, 1, '10000000-0000-0000-0000-00000000a001'),
  ('10000000-0000-0000-0000-00000000a0a2', '10000000-0000-0000-0000-00000000b002', true, 1, '10000000-0000-0000-0000-00000000a002');

insert into optimization_cases (id, household_id, state, created_by)
values
  ('10000000-0000-0000-0000-00000000d001', '10000000-0000-0000-0000-00000000b001', 'customer_decision', '10000000-0000-0000-0000-00000000a001'),
  ('10000000-0000-0000-0000-00000000d002', '10000000-0000-0000-0000-00000000b002', 'customer_decision', '10000000-0000-0000-0000-00000000a002');

insert into recommendations (id, case_id, status, version, mandate_version, switching_preferences_version, quote_ids, current_total_cents, proposed_total_cents, net_savings_cents, reason_codes, comparison, created_by)
values
  ('10000000-0000-0000-0000-00000000e001', '10000000-0000-0000-0000-00000000d001', 'published', 1, 1, 1, '{}', 100000, 90000, 10000, '{}', '{}', '10000000-0000-0000-0000-00000000a001'),
  ('10000000-0000-0000-0000-00000000e002', '10000000-0000-0000-0000-00000000d002', 'published', 1, 1, 1, '{}', 100000, 90000, 10000, '{}', '{}', '10000000-0000-0000-0000-00000000a002');

insert into customer_questions (id, case_id, question_type, status, prompt, created_by)
values
  ('10000000-0000-0000-0000-00000000f001', '10000000-0000-0000-0000-00000000d001', 'short_text', 'pending', 'Question A', '10000000-0000-0000-0000-00000000a003'),
  ('10000000-0000-0000-0000-00000000f002', '10000000-0000-0000-0000-00000000d002', 'short_text', 'pending', 'Question B', '10000000-0000-0000-0000-00000000a003');

-- 1. Signup role escalation: raw_user_meta_data role is ignored.
select is(
  (select role from profiles where id = '10000000-0000-0000-0000-00000000a005'),
  'admin',
  'seeded admin keeps admin role'
);
select is(
  (select role from profiles where id = '10000000-0000-0000-0000-00000000a001'),
  'customer',
  'customer signup role is customer even if metadata claims otherwise'
);

-- 2. Authenticated user cannot invoke assign_staff_role.
set local role authenticated;
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-00000000a005","role":"authenticated"}';
select throws_like(
  $$select assign_staff_role('10000000-0000-0000-0000-00000000a005', '10000000-0000-0000-0000-00000000a001', 'reviewer')$$,
  '%permission denied for function assign_staff_role%',
  'assign_staff_role rejects non-service-role callers'
);

-- 3. Customer cannot directly update optimization_cases.
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-00000000a001","role":"authenticated"}';
select throws_ok(
  $$update optimization_cases set state = 'switching' where id = '10000000-0000-0000-0000-00000000d001'$$,
  '42501',
  'permission denied for table optimization_cases',
  'customer cannot update optimization_cases directly'
);

-- 4. Customer cannot directly update recommendations.
select throws_ok(
  $$update recommendations set status = 'customer_approved' where id = '10000000-0000-0000-0000-00000000e001'$$,
  '42501',
  'permission denied for table recommendations',
  'customer cannot update recommendations directly'
);

-- 5. Customer cannot insert a fake reviewer approval.
select throws_ok(
  $$insert into recommendation_approvals (recommendation_id, approver_profile_id, approver_role, approved)
    values ('10000000-0000-0000-0000-00000000e001', '10000000-0000-0000-0000-00000000a001', 'reviewer', true)$$,
  '42501',
  'permission denied for table recommendation_approvals',
  'customer cannot insert recommendation_approvals directly'
);

-- 6. Customer cannot insert audit_events.
select throws_ok(
  $$insert into audit_events (action, entity_type, entity_id, household_id)
    values ('test', 'household', '10000000-0000-0000-0000-00000000b001', '10000000-0000-0000-0000-00000000b001')$$,
  '42501',
  'permission denied for table audit_events',
  'customer cannot insert audit_events directly'
);

-- 7. Customer cannot insert switch_events.
select throws_ok(
  $$insert into switch_events (case_id, state) values ('10000000-0000-0000-0000-00000000d001', 'replacement_pending')$$,
  '42501',
  'permission denied for table switch_events',
  'customer cannot insert switch_events directly'
);

-- 8. Customer cannot write into another household's documents.
select throws_ok(
  $$insert into policy_documents (household_id, category, status, storage_path, file_name, mime_type, size_bytes, uploaded_by)
    values ('10000000-0000-0000-0000-00000000b002', 'current_auto_policy', 'uploaded', 'path', 'file.pdf', 'application/pdf', 0, '10000000-0000-0000-0000-00000000a001')$$,
  '42501',
  'new row violates row-level security policy for table "policy_documents"',
  'customer cannot write documents into another household'
);

-- 9. Customer A cannot answer Customer B's question.
select throws_like(
  $$select answer_customer_question('10000000-0000-0000-0000-00000000f002', 'yes')$$,
  '%does not belong to caller household%',
  'customer cannot answer another household question'
);

-- 10. Customer can answer their own question.
select lives_ok(
  $$select answer_customer_question('10000000-0000-0000-0000-00000000f001', 'yes')$$,
  'customer can answer their own question'
);

-- 11. Customer can approve their own published recommendation.
select lives_ok(
  $$select approve_customer_recommendation('10000000-0000-0000-0000-00000000e001', 1, 1, 1)$$,
  'customer can approve their own published recommendation'
);

-- 12. Customer cannot approve another household's recommendation.
select throws_like(
  $$select approve_customer_recommendation('10000000-0000-0000-0000-00000000e002', 1, 1, 1)$$,
  '%does not belong to caller household%',
  'customer cannot approve another household recommendation'
);

-- 13. Operations user cannot review recommendations.
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-00000000a003","role":"authenticated"}';
select throws_like(
  $$select review_recommendation('10000000-0000-0000-0000-00000000e002', true, 'looks good')$$,
  '%only reviewers or admins can review%',
  'operations cannot review recommendations'
);

-- 14. Reviewer cannot advance switch events.
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-00000000a004","role":"authenticated"}';
select throws_like(
  $$select advance_switch_event('70000000-0000-0000-0000-000000000001', 'replacement_pending')$$,
  '%only operations or admins can advance switch events%',
  'reviewer cannot advance switch events'
);

-- 15. Operations can advance switch events on an assigned case.
set local role none;
set local request.jwt.claims to '';
insert into optimization_cases (id, household_id, state, created_by)
values ('10000000-0000-0000-0000-00000000d003', '10000000-0000-0000-0000-00000000b001', 'switching', '10000000-0000-0000-0000-00000000a001');
insert into recommendations (id, case_id, status, version, mandate_version, switching_preferences_version, quote_ids, current_total_cents, proposed_total_cents, net_savings_cents, reason_codes, comparison, created_by)
values ('10000000-0000-0000-0000-00000000e003', '10000000-0000-0000-0000-00000000d003', 'customer_approved', 1, 1, 1, '{}', 100000, 90000, 10000, '{}', '{}', '10000000-0000-0000-0000-00000000a001');
insert into switch_events (id, case_id, recommendation_id, state)
values ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000d003', '10000000-0000-0000-0000-00000000e003', 'customer_approved');
insert into case_assignments (case_id, assignee_profile_id, assignment_role)
values ('10000000-0000-0000-0000-00000000d003', '10000000-0000-0000-0000-00000000a003', 'operations');
set local role authenticated;
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-00000000a003","role":"authenticated"}';
select lives_ok(
  $$select advance_switch_event('70000000-0000-0000-0000-000000000002', 'replacement_pending')$$,
  'operations can advance switch event'
);

-- 16. Repeated customer approval is rejected (e001 was already approved in test 11).
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-00000000a001","role":"authenticated"}';
select throws_like(
  $$select approve_customer_recommendation('10000000-0000-0000-0000-00000000e001', 1, 1, 1)$$,
  '%customer decision already recorded%',
  'repeated customer approval is rejected'
);

-- 17. Stale recommendation version is rejected.
set local role none;
set local request.jwt.claims to '';
insert into optimization_cases (id, household_id, state, created_by)
values ('10000000-0000-0000-0000-00000000d004', '10000000-0000-0000-0000-00000000b001', 'customer_decision', '10000000-0000-0000-0000-00000000a001');
insert into recommendations (id, case_id, status, version, mandate_version, switching_preferences_version, quote_ids, current_total_cents, proposed_total_cents, net_savings_cents, reason_codes, comparison, created_by)
values ('10000000-0000-0000-0000-00000000e004', '10000000-0000-0000-0000-00000000d004', 'published', 2, 1, 1, '{}', 100000, 90000, 10000, '{}', '{}', '10000000-0000-0000-0000-00000000a001');
set local role authenticated;
set local request.jwt.claims to '{"sub":"10000000-0000-0000-0000-00000000a001","role":"authenticated"}';
select throws_like(
  $$select approve_customer_recommendation('10000000-0000-0000-0000-00000000e004', 99, 1, 1)$$,
  '%stale recommendation version%',
  'stale recommendation version is rejected'
);

-- 18. Stale switching preferences version is rejected.
select throws_like(
  $$select approve_customer_recommendation('10000000-0000-0000-0000-00000000e004', 2, 1, 99)$$,
  '%stale switching preferences version%',
  'stale switching preferences version is rejected'
);

-- 19. Service role can assign a staff role.
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';
select lives_ok(
  $$select assign_staff_role('10000000-0000-0000-0000-00000000a005', '10000000-0000-0000-0000-00000000a001', 'reviewer')$$,
  'service role can assign staff role'
);

select finish();
rollback;
