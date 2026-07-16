begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

-- Test users and households.
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

-- Legacy coverage row used to create the V2 mandate via the idempotent backfill.
insert into coverage_requirements (id, household_id, is_current, version, auto_requirements, property_requirements, vehicle_mandates, property_mandates, created_by)
values (
  '20000000-0000-0000-0000-00000000c001',
  '20000000-0000-0000-0000-00000000b001',
  true,
  1,
  '{"coverageForm":{"preference":"required","value":"comprehensive"},"liability":{"rule":"minimum","amountCents":200000000},"collisionDeductible":{"rule":"any"},"comprehensiveDeductible":{"rule":"any"},"glassDeductible":{"rule":"any"},"endorsements":{"accident_forgiveness":"indifferent","rental_vehicle_coverage":"indifferent","non_owned_automobile":"indifferent","family_protection":"indifferent","depreciation_waiver":"indifferent","oem_parts":"indifferent","roadside_assistance":"indifferent","disappearing_deductible":"indifferent","glass_coverage":"indifferent","telematics":"indifferent"}}',
  '{"coverageForm":{"preference":"required","value":"comprehensive"},"settlementBasis":{"preference":"required","value":"replacement_cost"},"dwellingLimit":{"rule":"any"},"contentsLimit":{"rule":"any"},"detachedStructuresLimit":{"rule":"any"},"personalLiabilityLimit":{"rule":"any"},"additionalLivingExpenseLimit":{"rule":"any"},"baseDeductible":{"rule":"any"},"waterDeductible":{"rule":"any"},"windHailDeductible":{"rule":"any"},"earthquakeDeductible":{"rule":"any"},"sewerBackup":{"preference":"indifferent","limit":{"rule":"any"},"deductible":{"rule":"any"}},"overlandWater":{"preference":"indifferent","limit":{"rule":"any"},"deductible":{"rule":"any"}},"optionalCoverages":{"equipment_breakdown":"indifferent","service_line":"indifferent","bylaw_coverage":"indifferent","home_systems":"indifferent","cyber":"indifferent","scheduled_valuables":"indifferent","home_business":"indifferent","short_term_rental_permission":"indifferent","claims_forgiveness":"indifferent","groundwater_seepage":"indifferent","ice_dam":"indifferent","earthquake":"indifferent"}}',
  '{}',
  '{}',
  '20000000-0000-0000-0000-00000000a001'
);

insert into switching_preferences (id, household_id, is_current, version, created_by)
values ('20000000-0000-0000-0000-00000000a0a1', '20000000-0000-0000-0000-00000000b001', true, 1, '20000000-0000-0000-0000-00000000a001');

-- Materialize the V2 mandate for this household.
select backfill_coverage_mandate_v2();

insert into optimization_cases (id, household_id, state, created_by)
values ('20000000-0000-0000-0000-00000000d001', '20000000-0000-0000-0000-00000000b001', 'licensed_review', '20000000-0000-0000-0000-00000000a001');

insert into recommendations (
  id, case_id, status, version,
  mandate_id, mandate_version, mandate_schema_version, mandate_jurisdiction,
  switching_preferences_id, switching_preferences_version,
  quote_ids, current_total_cents, proposed_total_cents, net_savings_cents, reason_codes, comparison, created_by
)
select
  '20000000-0000-0000-0000-00000000e001',
  '20000000-0000-0000-0000-00000000d001',
  'awaiting_review',
  1,
  hcm.id,
  hcm.version,
  hcm.schema_version,
  hcm.jurisdiction,
  sp.id,
  sp.version,
  '{}',
  100000,
  90000,
  10000,
  '{}',
  '{}',
  '20000000-0000-0000-0000-00000000a001'
from household_coverage_mandates hcm
join switching_preferences sp on sp.household_id = hcm.household_id and sp.is_current = true
where hcm.household_id = '20000000-0000-0000-0000-00000000b001' and hcm.is_current = true;

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

-- 3. A durable licensed-review approval row was created with the reviewer notes.
select is(
  (select count(*)::int from recommendation_approvals where recommendation_id = '20000000-0000-0000-0000-00000000e001' and approver_role in ('reviewer','admin') and approved = true),
  1,
  'one licensed-review approval row is created'
);
select is(
  (select notes from recommendation_approvals where recommendation_id = '20000000-0000-0000-0000-00000000e001' and approver_role in ('reviewer','admin')),
  'Approved by reviewer',
  'reviewer notes are preserved'
);

-- 4. Customer can decline a published recommendation.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-00000000a001","role":"authenticated"}';
select lives_ok(
  $$select decline_customer_recommendation('20000000-0000-0000-0000-00000000e001', 1)$$,
  'customer can decline a published recommendation'
);
set local role none;
select is(
  (select state from optimization_cases where id = '20000000-0000-0000-0000-00000000d001'),
  'retained_incumbent',
  'declined recommendation moves case to retained_incumbent'
);

-- 5. A fresh case for reviewer rejection flow.
insert into optimization_cases (id, household_id, state, created_by)
values ('20000000-0000-0000-0000-00000000d002', '20000000-0000-0000-0000-00000000b001', 'licensed_review', '20000000-0000-0000-0000-00000000a001');

insert into recommendations (
  id, case_id, status, version,
  mandate_id, mandate_version, mandate_schema_version, mandate_jurisdiction,
  switching_preferences_id, switching_preferences_version,
  quote_ids, current_total_cents, proposed_total_cents, net_savings_cents, reason_codes, comparison, created_by
)
select
  '20000000-0000-0000-0000-00000000e002',
  '20000000-0000-0000-0000-00000000d002',
  'awaiting_review',
  1,
  hcm.id,
  hcm.version,
  hcm.schema_version,
  hcm.jurisdiction,
  sp.id,
  sp.version,
  '{}',
  100000,
  90000,
  10000,
  '{}',
  '{}',
  '20000000-0000-0000-0000-00000000a001'
from household_coverage_mandates hcm
join switching_preferences sp on sp.household_id = hcm.household_id and sp.is_current = true
where hcm.household_id = '20000000-0000-0000-0000-00000000b001' and hcm.is_current = true;

-- 6. Reviewer rejection returns the case to comparing_quotes and records a decision row.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-00000000a002","role":"authenticated"}';
select lives_ok(
  $$select review_recommendation('20000000-0000-0000-0000-00000000e002', false, 'Needs better quotes')$$,
  'reviewer can reject a recommendation'
);
set local role none;
set local request.jwt.claims to '';
select is(
  (select state from optimization_cases where id = '20000000-0000-0000-0000-00000000d002'),
  'comparing_quotes',
  'rejected recommendation returns case to comparing_quotes'
);
select is(
  (select approved from recommendation_approvals where recommendation_id = '20000000-0000-0000-0000-00000000e002' and approver_role in ('reviewer','admin')),
  false,
  'rejection creates a false approved decision row'
);

-- 7. Repeated reviewer decision is rejected.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-00000000a002","role":"authenticated"}';
select throws_like(
  $$select review_recommendation('20000000-0000-0000-0000-00000000e002', true, 'second try')$$,
  '%already been reviewed%',
  'repeated reviewer decision is rejected'
);

-- 8. A fresh case for switch event flow.
set local role none;
set local request.jwt.claims to '';
insert into optimization_cases (id, household_id, state, created_by)
values ('20000000-0000-0000-0000-00000000d003', '20000000-0000-0000-0000-00000000b001', 'switching', '20000000-0000-0000-0000-00000000a001');

insert into recommendations (
  id, case_id, status, version,
  mandate_id, mandate_version, mandate_schema_version, mandate_jurisdiction,
  switching_preferences_id, switching_preferences_version,
  quote_ids, current_total_cents, proposed_total_cents, net_savings_cents, reason_codes, comparison, created_by
)
select
  '20000000-0000-0000-0000-00000000e003',
  '20000000-0000-0000-0000-00000000d003',
  'customer_approved',
  1,
  hcm.id,
  hcm.version,
  hcm.schema_version,
  hcm.jurisdiction,
  sp.id,
  sp.version,
  '{}',
  100000,
  90000,
  10000,
  '{}',
  '{}',
  '20000000-0000-0000-0000-00000000a001'
from household_coverage_mandates hcm
join switching_preferences sp on sp.household_id = hcm.household_id and sp.is_current = true
where hcm.household_id = '20000000-0000-0000-0000-00000000b001' and hcm.is_current = true;

insert into switch_events (id, case_id, recommendation_id, state)
values ('20000000-0000-0000-0000-00000000f001', '20000000-0000-0000-0000-00000000d003', '20000000-0000-0000-0000-00000000e003', 'customer_approved');
insert into case_assignments (case_id, assignee_profile_id, assignment_role)
values ('20000000-0000-0000-0000-00000000d003', '20000000-0000-0000-0000-00000000a003', 'operations');

-- 9. Operations advances switch event through valid states.
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-00000000a003","role":"authenticated"}';
select lives_ok(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f001', 'replacement_pending')$$,
  'operations advances to replacement_pending'
);
select lives_ok(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f001', 'replacement_confirmed')$$,
  'operations advances to replacement_confirmed'
);

-- 10. Skipping replacement confirmation is rejected.
-- f001 is now replacement_confirmed, so create a fresh event at customer_approved.
set local role none;
set local request.jwt.claims to '';
insert into switch_events (id, case_id, recommendation_id, state)
values ('20000000-0000-0000-0000-00000000f002', '20000000-0000-0000-0000-00000000d003', null, 'customer_approved');
set local role authenticated;
set local request.jwt.claims to '{"sub":"20000000-0000-0000-0000-00000000a003","role":"authenticated"}';
select throws_like(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f002', 'incumbent_cancellation_pending')$$,
  '%invalid switch transition%',
  'incumbent cancellation cannot skip replacement confirmation'
);

-- 11. Full valid switch event lifecycle completes the case.
select lives_ok(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f001', 'incumbent_cancellation_pending')$$,
  'operations advances to incumbent_cancellation_pending'
);
select lives_ok(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f001', 'incumbent_cancelled')$$,
  'operations advances to incumbent_cancelled'
);
select lives_ok(
  $$select advance_switch_event('20000000-0000-0000-0000-00000000f001', 'completed')$$,
  'operations completes switch event'
);

-- 12. Completed case is terminal and no longer active.
set local role none;
select is(
  (select state from optimization_cases where id = '20000000-0000-0000-0000-00000000d003'),
  'completed',
  'completed switch event moves case to completed'
);

select finish();
rollback;
