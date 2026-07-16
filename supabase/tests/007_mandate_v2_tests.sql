begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

-- Fixtures: one customer with a household, vehicle and property.
insert into auth.users (id, email, raw_user_meta_data)
values ('e1000000-0000-0000-0000-000000000001', 'mandate-customer@example.com', '{"full_name":"Mandate Customer","role":"customer"}');

insert into households (id, owner_profile_id, name, province)
values ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'Mandate Household', 'AB');

insert into household_members (household_id, profile_id, member_role)
values ('e1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'owner');

insert into vehicles (id, household_id, year, make, model, vin, primary_use)
values (
  'e1000000-0000-0000-0000-000000000003',
  'e1000000-0000-0000-0000-000000000002',
  2020,
  'Honda',
  'Civic',
  '1HGCM82633A123456',
  'commute'
);

insert into properties (id, household_id, address_line1, city, province, postal_code, year_built, dwelling_type)
values (
  'e1000000-0000-0000-0000-000000000004',
  'e1000000-0000-0000-0000-000000000002',
  '123 Main St',
  'Calgary',
  'AB',
  'T2P2Y5',
  2010,
  'detached'
);

-- Another household with a vehicle, used for cross-household guard tests.
insert into auth.users (id, email, raw_user_meta_data)
values ('e2000000-0000-0000-0000-000000000001', 'other-customer@example.com', '{"full_name":"Other Customer","role":"customer"}');

insert into households (id, owner_profile_id, name, province)
values ('e2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'Other Household', 'AB');

insert into household_members (household_id, profile_id, member_role)
values ('e2000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 'owner');

insert into vehicles (id, household_id, year, make, model, vin, primary_use)
values (
  'e2000000-0000-0000-0000-000000000003',
  'e2000000-0000-0000-0000-000000000002',
  2021,
  'Toyota',
  'Corolla',
  'JTDBU4EE3B9123456',
  'commute'
);

-- Authenticated as the customer.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 1. Save a V2 mandate successfully.
select is(
  (
    select save_household_mandate_v2(
      'e1000000-0000-0000-0000-000000000002'::uuid,
      0,
      0,
      '{"coverageForm":{"value":"comprehensive","preference":"required"},"liability":{"rule":"minimum","amountCents":200000000},"collisionDeductible":{"rule":"any"},"comprehensiveDeductible":{"rule":"any"},"glassDeductible":{"rule":"any"},"endorsements":{"accident_forgiveness":"required","rental_vehicle_coverage":"preferred","non_owned_automobile":"indifferent","family_protection":"indifferent","depreciation_waiver":"indifferent","oem_parts":"indifferent","roadside_assistance":"indifferent","disappearing_deductible":"indifferent","glass_coverage":"indifferent","telematics":"indifferent"}}'::jsonb,
      '{"coverageForm":{"value":"comprehensive","preference":"required"},"settlementBasis":{"value":"replacement_cost","preference":"required"},"dwellingLimit":{"rule":"minimum","amountCents":450000000},"contentsLimit":{"rule":"minimum","amountCents":300000000},"detachedStructuresLimit":{"rule":"minimum","amountCents":50000000},"personalLiabilityLimit":{"rule":"minimum","amountCents":2000000000},"additionalLivingExpenseLimit":{"rule":"minimum","amountCents":20000000},"baseDeductible":{"rule":"any"},"waterDeductible":{"rule":"any"},"windHailDeductible":{"rule":"any"},"earthquakeDeductible":{"rule":"any"},"sewerBackup":{"preference":"indifferent","limit":{"rule":"any"},"deductible":{"rule":"any"}},"overlandWater":{"preference":"indifferent","limit":{"rule":"any"},"deductible":{"rule":"any"}},"optionalCoverages":{"equipment_breakdown":"indifferent","service_line":"indifferent","bylaw_coverage":"indifferent","home_systems":"indifferent","cyber":"indifferent","scheduled_valuables":"indifferent","home_business":"indifferent","short_term_rental_permission":"indifferent","claims_forgiveness":"indifferent","groundwater_seepage":"indifferent","ice_dam":"indifferent","earthquake":"indifferent"}}'::jsonb,
      ('[' || jsonb_build_object('vehicleId','e1000000-0000-0000-0000-000000000003','values',jsonb_build_object('liability',jsonb_build_object('rule','minimum','amountCents',250000000)))::text || ']')::jsonb,
      '[]'::jsonb,
      '{"minNetAnnualSavingsCents":20000,"maxDeductibleIncreaseCents":0,"renewalOnlySwitching":true,"householdOptimizationEnabled":true,"splitInsurersAllowed":true,"allowBundleBreakup":false,"deductibleIncreasesAllowed":false,"excludedInsurerIds":[],"minimumInsurerFinancialRating":"any","preferredPaymentFrequency":"annual","preferredBillingMethod":"automatic_bank","brokerDirectPreference":"indifferent"}'::jsonb,
      'AB',
      now()
    ) ->> 'success'
  )::boolean,
  true,
  'save_household_mandate_v2 succeeds for valid V2 mandate'
);

-- 2. One current mandate row exists.
select is(
  (select count(*)::int from household_coverage_mandates where household_id = 'e1000000-0000-0000-0000-000000000002' and is_current = true),
  1,
  'a single current V2 mandate is stored'
);

-- 3. Vehicle override row was created.
select is(
  (select count(*)::int from vehicle_mandate_overrides vmo
   join household_coverage_mandates hcm on vmo.mandate_id = hcm.id
   where hcm.household_id = 'e1000000-0000-0000-0000-000000000002'),
  1,
  'vehicle override row is stored'
);

-- 4. Switching preferences row was created.
select is(
  (select count(*)::int from switching_preferences where household_id = 'e1000000-0000-0000-0000-000000000002' and is_current = true),
  1,
  'switching preferences row is stored'
);

-- 5. Customer can read their own V2 mandate.
select is(
  (select count(*)::int from household_coverage_mandates where household_id = 'e1000000-0000-0000-0000-000000000002'),
  1,
  'customer can read their own V2 mandate'
);

-- 6. Customer cannot directly insert a V2 mandate.
select throws_ok(
  $$insert into household_coverage_mandates (household_id, schema_version, version, jurisdiction, effective_from, household_auto_defaults, household_property_defaults, is_current)
     values ('e1000000-0000-0000-0000-000000000002', 2, 99, 'AB', now(), '{}'::jsonb, '{}'::jsonb, true)$$,
  '42501',
  'new row violates row-level security policy for table "household_coverage_mandates"',
  'customer cannot directly insert a V2 mandate'
);

-- 7. Customer cannot directly insert a vehicle override.
select throws_ok(
  $$insert into vehicle_mandate_overrides (mandate_id, vehicle_id, override_values)
     select id, 'e1000000-0000-0000-0000-000000000003', '{}'::jsonb
     from household_coverage_mandates where household_id = 'e1000000-0000-0000-0000-000000000002'$$,
  '42501',
  'new row violates row-level security policy for table "vehicle_mandate_overrides"',
  'customer cannot directly insert a vehicle override'
);

-- 8. Stale mandate version is rejected.
select is(
  (
    select save_household_mandate_v2(
      'e1000000-0000-0000-0000-000000000002'::uuid,
      0,
      1,
      '{}'::jsonb,
      '{}'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      '{}'::jsonb,
      'AB',
      now()
    ) ->> 'code'
  ),
  'STALE_VERSION',
  'save with stale mandate version returns STALE_VERSION'
);

-- 9. Cross-household vehicle override is rejected by the trigger.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"e2000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_like(
  $$select save_household_mandate_v2(
    'e2000000-0000-0000-0000-000000000002'::uuid,
    0,
    0,
    '{}'::jsonb,
    '{}'::jsonb,
    '[{"vehicleId":"e1000000-0000-0000-0000-000000000003","values":{}}]'::jsonb,
    '[]'::jsonb,
    '{}'::jsonb,
    'AB',
    now()
  )$$,
  '%Override asset does not belong to mandate household%',
  'cross-household vehicle override is rejected'
);

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"e2000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 10. A different customer cannot see the first household's mandate.
select is(
  (select count(*)::int from household_coverage_mandates where household_id = 'e1000000-0000-0000-0000-000000000002'),
  0,
  'other customer cannot read another household V2 mandate'
);

select * from finish();
rollback;
