begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

-- Setup: a household, case, quote, and recommendation ready for licensed review.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('20000000-0000-0000-0000-00000000a001', 'wf-customer@example.com', '{"full_name":"WF Customer","role":"customer"}'),
  ('20000000-0000-0000-0000-00000000a002', 'wf-reviewer@example.com', '{"full_name":"WF Reviewer","role":"reviewer"}'),
  ('20000000-0000-0000-0000-00000000a003', 'wf-operations@example.com', '{"full_name":"WF Operations","role":"operations"}');

update profiles set role = 'reviewer' where id = '20000000-0000-0000-0000-00000000a002';
update profiles set role = 'operations' where id = '20000000-0000-0000-0000-00000000a003';

insert into households (id, owner_profile_id, name, province)
values ('20000000-0000-0000-0000-00000000b001', '20000000-0000-0000-0000-00000000a001', 'WF Household', 'AB');
insert into household_members (household_id, profile_id, member_role)
values ('20000000-0000-0000-0000-00000000b001', '20000000-0000-0000-0000-00000000a001', 'owner');

insert into coverage_requirements (id, household_id, is_current, version, auto_requirements, property_requirements, created_by)
values ('20000000-0000-0000-0000-00000000c001', '20000000-0000-0000-0000-00000000b001', true, 1, '{}', '{}', '20000000-0000-0000-0000-00000000a001');

insert into optimization_cases (id, household_id, state, created_by)
values ('20000000-0000-0000-0000-00000000d001', '20000000-0000-0000-0000-00000000b001', 'licensed_review', '20000000-0000-0000-0000-00000000a001');

insert into recommendations (id, case_id, status, version, mandate_version, quote_ids, current_total_cents, proposed_total_cents, net_savings_cents, reason_codes, comparison, created_by)
values ('20000000-0000-0000-0000-00000000e001', '20000000-0000-0000-0000-00000000d001', 'awaiting_review', 1, 1, '{}', 100000, 90000, 10000, '{}', '{}', '20000000-0000-0000-0000-00000000a001');

insert into switch_events (id, case_id, state)
values ('20000000-0000-0000-0000-00000000f001', '20000000-0000-0000-0000-00000000d001', 'customer_approved');

-- 1. Reviewer can approve a recommendation in licensed_review.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-00000000a002","role":"authenticated"}';
select lives_ok(
  $$select review_recommendation('20000000-0000-0000-0000-00000000e001', true, 'Approved by reviewer')$$,
  'reviewer can approve a recommendation'
);

-- 2. Recommendation is now published and case is customer_decision.
set local role none;
set local request.jwt.claims to '';
select is(
  (select status from recommendations where id = '20000000-0000-0000-0000-00000000e001'),
  'published',
  'approved recommendation status is published'
);
select is(
  (select state from optimization_cases where id = '20000000-0000-0000-0000-00000000d001'),
  'customer_decision',
  'approved recommendation moves case to customer_decision'
);

-- 3. Customer can decline a published recommendation.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-00000000a001","role":"authenticated"}';
select lives_ok(
  $$select decline_customer_recommendation('20000000-0000-0000-0000-00000000e001', 1, 1)$$,
  'customer can decline a published recommendation'
);
set local role none;
select is(
  (select state from optimization_cases where id = '20000000-0000-0000-0000-00000000d001'),
  'retained_incumbent',
  'declined recommendation moves case to retained_incumbent'
);

-- 4. A fresh case for switch event flow.
set local role none;
insert into optimization_cases (id, household_id, state, created_by)
values ('20000000-0000-0000-0000-00000000d002', '20000000-0000-0000-0000-00000000b001', 'switching', '20000000-0000-0000-0000-00000000a001');
insert into switch_events (id, case_id, state)
values ('20000000-0000-0000-0000-00000000f002', '20000000-0000-0000-0000-00000000d002', 'customer_approved');
insert into case_assignments (case_id, assignee_profile_id, assignment_role)
values ('20000000-0000-0000-0000-00000000d002', '20000000-0000-0000-0000-00000000a003', 'operations');

-- 5. Operations advances switch event through valid states.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-00000000a003","role":"authenticated"}';
select lives_ok(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f002', 'replacement_pending')$$,
  'operations advances to replacement_pending'
);
select lives_ok(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f002', 'replacement_confirmed')$$,
  'operations advances to replacement_confirmed'
);

-- 6. Skipping replacement confirmation is rejected.
-- f002 is now replacement_confirmed, so create a fresh event at customer_approved.
set local role none;
insert into switch_events (id, case_id, state)
values ('20000000-0000-0000-0000-00000000f003', '20000000-0000-0000-0000-00000000d002', 'customer_approved');
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-00000000a003","role":"authenticated"}';
select throws_like(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f003', 'incumbent_cancellation_pending')$$,
  '%invalid switch transition%',
  'incumbent cancellation cannot skip replacement confirmation'
);

-- 7. Full valid switch event lifecycle completes the case.
select lives_ok(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f002', 'incumbent_cancellation_pending')$$,
  'operations advances to incumbent_cancellation_pending'
);
select lives_ok(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f002', 'incumbent_cancelled')$$,
  'operations advances to incumbent_cancelled'
);
select lives_ok(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f002', 'completed')$$,
  'operations completes switch event'
);

-- 8. Completed case is terminal and no longer active.
set local role none;
select is(
  (select state from optimization_cases where id = '20000000-0000-0000-0000-00000000d002'),
  'completed',
  'completed switch event moves case to completed'
);

select finish();
rollback;
