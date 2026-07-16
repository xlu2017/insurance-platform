-- Development-only seed data. These credentials must never be used outside local demos.

-- =============================== demo users ===============================

do $$
declare
  users jsonb := '[
    {"id": "00000000-0000-0000-0000-000000000001", "email": "customer@example.com",   "password": "DemoCustomer123!",   "role": "customer",   "name": "Jordan Miller"},
    {"id": "00000000-0000-0000-0000-000000000002", "email": "operations@example.com", "password": "DemoOperations123!", "role": "operations", "name": "Avery Chen"},
    {"id": "00000000-0000-0000-0000-000000000003", "email": "reviewer@example.com",   "password": "DemoReviewer123!",   "role": "reviewer",   "name": "Sam Okafor"},
    {"id": "00000000-0000-0000-0000-000000000004", "email": "admin@example.com",      "password": "DemoAdmin123!",      "role": "admin",      "name": "Riley Tremblay"}
  ]'::jsonb;
  u jsonb;
begin
  for u in select * from jsonb_array_elements(users) loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      (u->>'id')::uuid, 'authenticated', 'authenticated',
      u->>'email', crypt(u->>'password', gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      jsonb_build_object('full_name', u->>'name', 'role', u->>'role'),
      now(), now(), '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), (u->>'id')::uuid, (u->>'id')::uuid,
      jsonb_build_object('sub', u->>'id', 'email', u->>'email', 'email_verified', true),
      'email', now(), now(), now()
    ) on conflict do nothing;

    insert into public.profiles (id, email, full_name, role)
    values ((u->>'id')::uuid, u->>'email', u->>'name', (u->>'role')::user_role)
    on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;
  end loop;
end $$;

-- =============================== insurers (fictional) ===============================

insert into insurers (id, name, active, provinces, products, distribution, contact_method, email_supported, portal_supported, api_supported, bundle_supported, internal_notes) values
  ('10000000-0000-0000-0000-000000000001', 'Prairie Shield Insurance', true, '{AB,SK,MB}', '{auto,property}', 'direct', 'email', true, true, false, true, 'Incumbent for demo household. Slow on cancellations.'),
  ('10000000-0000-0000-0000-000000000002', 'North Anchor Mutual', true, '{AB,BC}', '{auto}', 'broker', 'email', true, false, false, false, 'Auto-only carrier. Competitive on multi-vehicle.'),
  ('10000000-0000-0000-0000-000000000003', 'Bow River Assurance', true, '{AB}', '{auto,property}', 'direct', 'email', true, true, false, true, 'Strong bundle pricing in Calgary and Edmonton.'),
  ('10000000-0000-0000-0000-000000000004', 'Chinook Coverage Co', true, '{AB}', '{property}', 'broker', 'email', true, false, false, false, 'Property specialist; good sewer backup limits.'),
  ('10000000-0000-0000-0000-000000000005', 'Aurora West Insurance', true, '{AB,BC,SK}', '{auto,property}', 'direct', 'portal', false, true, false, true, 'Portal-only intake. 3-5 day turnaround.'),
  ('10000000-0000-0000-0000-000000000006', 'Foothills Family Insurance', true, '{AB}', '{auto,property}', 'broker', 'email', true, false, false, true, 'Requires telematics on most auto quotes.'),
  ('10000000-0000-0000-0000-000000000007', 'Tamarack General', true, '{AB,ON}', '{auto,property}', 'direct', 'email', true, false, true, true, 'Pilot API access. Conditional quotes common.'),
  ('10000000-0000-0000-0000-000000000008', 'Glacier Peak Underwriters', false, '{AB}', '{property}', 'broker', 'email', true, false, false, false, 'Paused new business in hail-prone postal codes.');

insert into insurer_channels (insurer_id, channel_type, address, notes) values
  ('10000000-0000-0000-0000-000000000001', 'email', 'quotes@prairieshield.example', 'General quote intake'),
  ('10000000-0000-0000-0000-000000000002', 'email', 'newbusiness@northanchor.example', 'Broker desk'),
  ('10000000-0000-0000-0000-000000000003', 'email', 'quotes@bowriver.example', 'Bundle desk'),
  ('10000000-0000-0000-0000-000000000004', 'email', 'property@chinookcoverage.example', 'Property intake'),
  ('10000000-0000-0000-0000-000000000005', 'portal', 'https://portal.aurorawest.example', 'Portal submissions only'),
  ('10000000-0000-0000-0000-000000000006', 'email', 'quotes@foothillsfamily.example', 'Include telematics consent'),
  ('10000000-0000-0000-0000-000000000007', 'email', 'api-support@tamarackgeneral.example', 'API pilot contact'),
  ('10000000-0000-0000-0000-000000000008', 'email', 'underwriting@glacierpeak.example', 'Currently paused');

-- =============================== demo household ===============================

insert into households (id, owner_profile_id, name, province, autopilot_active, onboarding_step) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Miller Household', 'AB', true, 'complete');

insert into household_members (household_id, profile_id, member_role) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner');

insert into drivers (id, household_id, full_name, date_of_birth, licence_class, years_licensed) values
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Jordan Miller', '1987-04-12', '5', 18),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Casey Miller', '1989-09-03', '5', 15);

insert into vehicles (id, household_id, year, make, model, vin, annual_km, primary_use, financing_status, vehicle_use_class, is_classic, is_modified) values
  ('22000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 2021, 'Toyota', 'RAV4', 'JTMB1RFV8MD067001', 18000, 'commute', 'financed', 'personal', false, false),
  ('22000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 2017, 'Honda', 'Civic', '2HGFC2F59HH567002', 9000, 'pleasure', 'owned', 'personal', false, false);

insert into properties (id, household_id, address_line1, city, province, postal_code, year_built, dwelling_type, property_type, owner_occupied) values
  ('23000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '128 Larchwood Crescent NW', 'Calgary', 'AB', 'T3A 2V5', 2008, 'detached', 'homeowner', true);

-- Current policies: auto C$2,000 and property C$1,200 with a C$250 bundle discount.
insert into policies (id, household_id, insurer_id, insurer_name, product_line, policy_number, annual_premium_cents, bundle_discount_cents, liability_limit_cents, collision_deductible_cents, comprehensive_deductible_cents, coverage_details, renewal_date, is_current) values
  ('24000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Prairie Shield Insurance', 'auto', 'PS-AUTO-448121', 200000, 25000, 200000000, 50000, 50000,
   '{"thirdPartyLiabilityCents": 200000000, "coverageForm": "comprehensive", "collisionIncluded": true, "collisionDeductibleCents": 50000, "comprehensiveIncluded": true, "comprehensiveDeductibleCents": 50000, "glassDeductibleCents": null, "accidentForgivenessIncluded": true, "rentalVehicleCoverageIncluded": true, "nonOwnedAutomobileIncluded": false, "familyProtectionIncluded": false, "depreciationWaiverIncluded": false, "oemPartsIncluded": false, "roadsideAssistanceIncluded": false, "disappearingDeductibleIncluded": false, "glassCoverageIncluded": false, "telematicsRequired": false, "vehicleClass": "personal", "financingStatus": "owned"}', '2026-09-01', true);

insert into policies (id, household_id, insurer_id, insurer_name, product_line, policy_number, annual_premium_cents, bundle_discount_cents, dwelling_limit_cents, base_deductible_cents, coverage_details, renewal_date, is_current) values
  ('24000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Prairie Shield Insurance', 'property', 'PS-HOME-291778', 120000, 0, 45000000, 100000,
   '{"propertyType": "homeowner", "coverageForm": "comprehensive", "settlementBasis": "replacement_cost", "dwellingLimitCents": 45000000, "contentsLimitCents": 30000000, "detachedStructuresLimitCents": 5000000, "personalLiabilityLimitCents": 2000000000, "additionalLivingExpenseLimitCents": 20000000, "baseDeductibleCents": 100000, "waterDeductibleCents": 200000, "windHailIncluded": false, "windHailDeductibleCents": null, "earthquakeIncluded": false, "earthquakeDeductibleCents": null, "sewerBackupIncluded": true, "sewerBackupLimitCents": null, "sewerBackupDeductibleCents": null, "overlandWaterIncluded": true, "overlandWaterLimitCents": null, "overlandWaterDeductibleCents": null, "groundwaterIncluded": false, "iceDamIncluded": false, "equipmentBreakdownIncluded": false, "serviceLineIncluded": false, "bylawCoverageIncluded": false, "homeSystemsIncluded": false, "cyberCoverageIncluded": false, "scheduledValuablesIncluded": false, "homeBusinessIncluded": false, "shortTermRentalPermissionIncluded": false, "claimsForgivenessIncluded": false}', '2026-09-01', true);

-- Coverage mandate.
insert into coverage_requirements (id, household_id, version, auto_requirements, property_requirements, vehicle_mandates, property_mandates, is_current) values
  ('25000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1,
   '{"coverageForm": {"preference": "required", "value": "comprehensive"}, "liability": {"rule": "minimum", "cents": 200000000}, "collisionDeductible": {"rule": "maximum", "cents": 100000}, "comprehensiveDeductible": {"rule": "maximum", "cents": 100000}, "glassDeductible": {"rule": "any", "cents": 0}, "endorsements": {"accident_forgiveness": "indifferent", "rental_vehicle_coverage": "indifferent", "non_owned_automobile": "indifferent", "family_protection": "indifferent", "depreciation_waiver": "indifferent", "oem_parts": "indifferent", "roadside_assistance": "indifferent", "disappearing_deductible": "indifferent", "glass_coverage": "indifferent", "telematics": "prohibited"}}',
   '{"coverageForm": {"preference": "required", "value": "comprehensive"}, "settlementBasis": {"preference": "required", "value": "replacement_cost"}, "dwellingLimit": {"rule": "minimum", "cents": 45000000}, "contentsLimit": {"rule": "any", "cents": 0}, "detachedStructuresLimit": {"rule": "any", "cents": 0}, "personalLiabilityLimit": {"rule": "any", "cents": 0}, "additionalLivingExpenseLimit": {"rule": "minimum", "cents": 1}, "baseDeductible": {"rule": "maximum", "cents": 200000}, "waterDeductible": {"rule": "maximum", "cents": 500000}, "windHailDeductible": {"rule": "any", "cents": 0}, "earthquakeDeductible": {"rule": "any", "cents": 0}, "sewerBackup": {"preference": "required", "limit": {"rule": "any", "cents": 0}, "deductible": {"rule": "any", "cents": 0}}, "overlandWater": {"preference": "indifferent", "limit": {"rule": "any", "cents": 0}, "deductible": {"rule": "any", "cents": 0}}, "optionalCoverages": {"equipment_breakdown": "indifferent", "service_line": "indifferent", "bylaw_coverage": "indifferent", "home_systems": "indifferent", "cyber": "indifferent", "scheduled_valuables": "indifferent", "home_business": "indifferent", "short_term_rental_permission": "indifferent", "claims_forgiveness": "indifferent", "groundwater_seepage": "indifferent", "ice_dam": "indifferent", "earthquake": "indifferent"}}',
   '{}', '{}',
   true);

insert into switching_preferences (id, household_id, version, min_net_annual_savings_cents, max_premium_increase_cents, max_deductible_increase_cents, renewal_only_switching, household_optimization_enabled, split_insurers_allowed, allow_bundle_breakup, excluded_insurer_ids, deductible_increases_allowed, material_coverage_reductions_allowed, customer_approval_required, switch_only_after_customer_approval, preferred_payment_frequency, preferred_billing_method, broker_direct_preference, minimum_insurer_financial_rating, is_current) values
  ('26000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 20000, 0, 0, true, true, true, false, '{}', false, false, true, true, 'annual', 'automatic_bank', 'indifferent', 'any', true);

insert into consents (profile_id, household_id, consent_type, granted, disclosure_version) values
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'store_documents', true, 'v1'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'share_for_quotation', true, 'v1'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'generate_recommendations', true, 'v1'),
  ('00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'electronic_communications', true, 'v1');

insert into subscriptions (profile_id, status, current_period_end) values
  ('00000000-0000-0000-0000-000000000001', 'active', now() + interval '1 year');

-- =============================== completed historical case ===============================

insert into optimization_cases (id, household_id, state, renewal_date, notes) values
  ('30000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', 'completed', '2025-09-01', 'Historical switch: moved auto+property to Prairie Shield, saved C$310/yr.');

insert into switch_events (id, case_id, state, replacement_confirmed_at, incumbent_cancelled_at) values
  ('39000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000009', 'completed', '2025-08-20 17:00:00+00', '2025-08-28 17:00:00+00');

-- =============================== active case (bundle-loss scenario) ===============================

insert into optimization_cases (id, household_id, state, renewal_date, notes) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'licensed_review', '2026-09-01', 'Renewal cycle 2026. Bundle-loss test case.');

insert into case_assignments (case_id, assignee_profile_id, assignment_role) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'operations');

insert into quote_requests (id, case_id, insurer_id, state, product_lines, inclusion_reason, sent_at) values
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'response_received', '{auto,property}', 'Incumbent renewal pricing', now() - interval '10 days'),
  ('31000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'response_received', '{auto}', 'Competitive auto-only carrier', now() - interval '10 days'),
  ('31000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'response_received', '{auto,property}', 'Strong bundle pricing in Calgary', now() - interval '10 days'),
  ('31000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'declined', '{property}', 'Property specialist', now() - interval '10 days'),
  ('31000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 'no_response', '{auto,property}', 'Bundle capable, portal intake', now() - interval '10 days');

-- Incumbent renewal quote: auto 2,000 + property 1,200 - 250 bundle = 2,950.
insert into quotes (id, case_id, quote_request_id, insurer_id, state, is_incumbent, bundle_discount_cents) values
  ('32000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'bindable', true, 25000);

insert into quote_policy_components (id, quote_id, product_line, annual_premium_cents, asset_id) values
  ('33000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001', 'auto', 200000, '22000000-0000-0000-0000-000000000001'),
  ('33000000-0000-0000-0000-000000000002', '32000000-0000-0000-0000-000000000001', 'property', 120000, '23000000-0000-0000-0000-000000000001');

-- Alternative A: North Anchor auto-only at 1,700 (would break the incumbent bundle).
insert into quotes (id, case_id, quote_request_id, insurer_id, state, is_incumbent) values
  ('32000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'bindable', false);

insert into quote_policy_components (id, quote_id, product_line, annual_premium_cents, asset_id) values
  ('33000000-0000-0000-0000-000000000003', '32000000-0000-0000-0000-000000000002', 'auto', 170000, '22000000-0000-0000-0000-000000000001');

-- Incumbent property re-priced without bundle: 1,350.
insert into quotes (id, case_id, quote_request_id, insurer_id, state, is_incumbent) values
  ('32000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'bindable', false);

insert into quote_policy_components (id, quote_id, product_line, annual_premium_cents, asset_id) values
  ('33000000-0000-0000-0000-000000000004', '32000000-0000-0000-0000-000000000003', 'property', 135000, '23000000-0000-0000-0000-000000000001');

-- Alternative B: Bow River bundled auto+property at 2,700 all-in.
insert into quotes (id, case_id, quote_request_id, insurer_id, state, is_incumbent) values
  ('32000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'bindable', false);

insert into quote_policy_components (id, quote_id, product_line, annual_premium_cents, asset_id) values
  ('33000000-0000-0000-0000-000000000005', '32000000-0000-0000-0000-000000000004', 'auto', 160000, '22000000-0000-0000-0000-000000000001'),
  ('33000000-0000-0000-0000-000000000006', '32000000-0000-0000-0000-000000000004', 'property', 110000, '23000000-0000-0000-0000-000000000001');

-- Standard coverage payloads for each component.
insert into quote_coverages (quote_component_id, coverage, validation_status, validated_at, validated_by, coverage_schema_version, data_source)
select id, case when product_line = 'auto' then
  '{"thirdPartyLiabilityCents": 200000000, "coverageForm": "comprehensive", "collisionIncluded": true, "collisionDeductibleCents": 50000, "comprehensiveIncluded": true, "comprehensiveDeductibleCents": 50000, "glassDeductibleCents": null, "accidentForgivenessIncluded": true, "rentalVehicleCoverageIncluded": true, "nonOwnedAutomobileIncluded": false, "familyProtectionIncluded": false, "depreciationWaiverIncluded": false, "oemPartsIncluded": false, "roadsideAssistanceIncluded": false, "disappearingDeductibleIncluded": false, "glassCoverageIncluded": false, "telematicsRequired": false, "vehicleClass": "personal", "financingStatus": "owned"}'::jsonb
else
  '{"propertyType": "homeowner", "coverageForm": "comprehensive", "settlementBasis": "replacement_cost", "dwellingLimitCents": 45000000, "contentsLimitCents": 30000000, "detachedStructuresLimitCents": 5000000, "personalLiabilityLimitCents": 2000000000, "additionalLivingExpenseLimitCents": 20000000, "baseDeductibleCents": 100000, "waterDeductibleCents": 200000, "windHailIncluded": false, "windHailDeductibleCents": null, "earthquakeIncluded": false, "earthquakeDeductibleCents": null, "sewerBackupIncluded": true, "sewerBackupLimitCents": null, "sewerBackupDeductibleCents": null, "overlandWaterIncluded": true, "overlandWaterLimitCents": null, "overlandWaterDeductibleCents": null, "groundwaterIncluded": false, "iceDamIncluded": false, "equipmentBreakdownIncluded": false, "serviceLineIncluded": false, "bylawCoverageIncluded": false, "homeSystemsIncluded": false, "cyberCoverageIncluded": false, "scheduledValuablesIncluded": false, "homeBusinessIncluded": false, "shortTermRentalPermissionIncluded": false, "claimsForgivenessIncluded": false}'::jsonb
end,
  'valid'::quote_validation_status,
  now(),
  '00000000-0000-0000-0000-000000000002'::uuid,
  2,
  'manual_entry'
from quote_policy_components;

-- Pending customer question.
insert into customer_questions (id, case_id, question_type, status, prompt, options, created_by) values
  ('34000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'yes_no', 'pending', 'Is the basement fully finished?', null, '00000000-0000-0000-0000-000000000002');

-- Recommendation awaiting licensed review: Alternative B, net savings C$250.
insert into recommendations (id, case_id, status, version, mandate_version, quote_ids, current_total_cents, proposed_total_cents, net_savings_cents, effective_date, reason_codes, comparison, disclosure_version) values
  ('35000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'awaiting_review', 1, 1,
   '{32000000-0000-0000-0000-000000000004}', 295000, 270000, 25000, '2026-09-01',
   '{BUNDLED_CONFIGURATION,MEETS_ALL_HARD_REQUIREMENTS,MEETS_SAVINGS_THRESHOLD}',
   '{"proposedInsurer": "Bow River Assurance", "bundled": true, "materialDifferences": [], "deductibleDifferences": []}', 'v1');

insert into recommendation_options (recommendation_id, rank, auto_quote_id, property_quote_id, bundled, total_cents, net_savings_cents, eligible, reason_codes) values
  ('35000000-0000-0000-0000-000000000001', 1, '32000000-0000-0000-0000-000000000004', '32000000-0000-0000-0000-000000000004', true, 270000, 25000, true, '{BUNDLED_CONFIGURATION,MEETS_ALL_HARD_REQUIREMENTS,MEETS_SAVINGS_THRESHOLD}'),
  ('35000000-0000-0000-0000-000000000001', 2, '32000000-0000-0000-0000-000000000002', '32000000-0000-0000-0000-000000000003', false, 305000, -10000, false, '{SPLIT_CONFIGURATION,BELOW_SAVINGS_THRESHOLD}'),
  ('35000000-0000-0000-0000-000000000001', 3, '32000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001', true, 295000, 0, false, '{INCUMBENT_CONFIGURATION}');

-- Seed audit history for the active case.
insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary) values
  ('00000000-0000-0000-0000-000000000001', 'customer', 'policy_document_uploaded', 'policy_document', null, '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '{"category": "current_auto_policy"}'),
  ('00000000-0000-0000-0000-000000000002', 'operations', 'extraction_completed', 'policy', '24000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '{"product_line": "auto"}'),
  ('00000000-0000-0000-0000-000000000001', 'customer', 'information_confirmed', 'optimization_case', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '{"confirmed": true}'),
  ('00000000-0000-0000-0000-000000000002', 'operations', 'quote_created', 'quote', '32000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '{"insurer": "Bow River Assurance"}'),
  ('00000000-0000-0000-0000-000000000002', 'operations', 'recommendation_generated', 'recommendation', '35000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '{"net_savings_cents": 25000}');

-- Notification for the pending question.
insert into notifications (profile_id, channel, title, body, action_url) values
  ('00000000-0000-0000-0000-000000000001', 'local_log', 'Question from your insurance team', 'Is the basement fully finished? Answer in the app to keep your renewal moving.', '/autopilot');
