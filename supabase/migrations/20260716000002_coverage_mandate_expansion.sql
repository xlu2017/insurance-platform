-- Coverage mandate expansion: richer requirement semantics, asset-specific overrides,
-- expanded auto/property coverage models, and extended switching rules.

-- Enums used by the expanded mandate and quote schemas.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'coverage_preference') then
    create type coverage_preference as enum ('required', 'preferred', 'indifferent', 'prohibited');
  end if;
  if not exists (select 1 from pg_type where typname = 'limit_rule') then
    create type limit_rule as enum ('minimum', 'maximum', 'exact', 'match_current_or_better', 'any');
  end if;
  if not exists (select 1 from pg_type where typname = 'deductible_rule') then
    create type deductible_rule as enum ('minimum', 'maximum', 'exact', 'match_current_or_better', 'any');
  end if;
  if not exists (select 1 from pg_type where typname = 'auto_coverage_form') then
    create type auto_coverage_form as enum ('liability_only', 'collision', 'comprehensive', 'specified_perils', 'all_perils');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_type') then
    create type property_type as enum ('homeowner', 'condo', 'tenant', 'landlord', 'seasonal', 'secondary_residence');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_coverage_form') then
    create type property_coverage_form as enum ('comprehensive', 'broad', 'named_perils', 'basic');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_settlement') then
    create type property_settlement as enum ('replacement_cost', 'guaranteed_replacement_cost', 'extended_replacement_cost', 'actual_cash_value');
  end if;
  if not exists (select 1 from pg_type where typname = 'vehicle_use_class') then
    create type vehicle_use_class as enum ('personal', 'commercial', 'classic', 'modified');
  end if;
  if not exists (select 1 from pg_type where typname = 'financing_status') then
    create type financing_status as enum ('owned', 'financed', 'leased');
  end if;
  if not exists (select 1 from pg_type where typname = 'payment_frequency') then
    create type payment_frequency as enum ('monthly', 'quarterly', 'semi_annual', 'annual');
  end if;
  if not exists (select 1 from pg_type where typname = 'billing_method') then
    create type billing_method as enum ('automatic_bank', 'credit_card', 'mail');
  end if;
  if not exists (select 1 from pg_type where typname = 'broker_direct_preference') then
    create type broker_direct_preference as enum ('broker', 'direct', 'indifferent');
  end if;
  if not exists (select 1 from pg_type where typname = 'financial_rating') then
    create type financial_rating as enum ('A_plus', 'A', 'A_minus', 'B_plus', 'B_or_lower', 'any');
  end if;
end $$;

-- Vehicle and property metadata used for eligibility checks and asset-level overrides.
alter table vehicles
  add column if not exists financing_status financing_status not null default 'owned',
  add column if not exists vehicle_use_class vehicle_use_class not null default 'personal',
  add column if not exists is_classic boolean not null default false,
  add column if not exists is_modified boolean not null default false;

alter table properties
  add column if not exists property_type property_type not null default 'homeowner';

-- Expanded switching preferences.
alter table switching_preferences
  add column if not exists max_premium_increase_cents bigint not null default 0 check (max_premium_increase_cents >= 0),
  add column if not exists max_deductible_increase_cents bigint not null default 0 check (max_deductible_increase_cents >= 0),
  add column if not exists allow_bundle_breakup boolean not null default false,
  add column if not exists minimum_insurer_financial_rating financial_rating not null default 'any',
  add column if not exists preferred_payment_frequency payment_frequency not null default 'annual',
  add column if not exists preferred_billing_method billing_method not null default 'automatic_bank',
  add column if not exists broker_direct_preference broker_direct_preference not null default 'indifferent',
  add column if not exists switch_only_after_customer_approval boolean not null default true;

-- Asset-specific mandate overrides.
alter table coverage_requirements
  add column if not exists vehicle_mandates jsonb not null default '{}'::jsonb,
  add column if not exists property_mandates jsonb not null default '{}'::jsonb;

-- Optional insurer metadata consumed by recommendation logic.
alter table insurers
  add column if not exists financial_strength_rating financial_rating not null default 'any',
  add column if not exists payment_frequencies payment_frequency[] not null default '{}',
  add column if not exists billing_methods billing_method[] not null default '{}';

-- Helper: migrate an old auto requirements JSONB document to the expanded shape.
create or replace function migrate_auto_requirements(old jsonb)
returns jsonb as $$
declare
  form auto_coverage_form;
  accident_pref coverage_preference := 'indifferent';
  rental_pref coverage_preference := 'indifferent';
  telematics_pref coverage_preference := 'indifferent';
  min_liability bigint := 0;
  max_collision_ded bigint := 0;
  max_comprehensive_ded bigint := 0;
begin
  min_liability := coalesce((old->>'minThirdPartyLiabilityCents')::bigint, 200000000);
  max_collision_ded := coalesce((old->>'maxCollisionDeductibleCents')::bigint, 100000);
  max_comprehensive_ded := coalesce((old->>'maxComprehensiveDeductibleCents')::bigint, 100000);

  if coalesce((old->>'comprehensiveRequired')::boolean, false) then
    form := 'comprehensive';
  elsif coalesce((old->>'collisionRequired')::boolean, false) then
    form := 'collision';
  else
    form := 'liability_only';
  end if;

  if coalesce((old->>'accidentForgivenessRequired')::boolean, false) then
    accident_pref := 'required';
  end if;
  if coalesce((old->>'rentalVehicleCoverageRequired')::boolean, false) then
    rental_pref := 'required';
  end if;
  if coalesce((old->>'telematicsAllowed')::boolean, true) then
    telematics_pref := 'indifferent';
  else
    telematics_pref := 'prohibited';
  end if;

  return jsonb_build_object(
    'coverageForm', jsonb_build_object('preference', 'required', 'value', form),
    'liability', jsonb_build_object('rule', 'minimum', 'cents', min_liability),
    'collisionDeductible', jsonb_build_object('rule', 'maximum', 'cents', max_collision_ded),
    'comprehensiveDeductible', jsonb_build_object('rule', 'maximum', 'cents', max_comprehensive_ded),
    'glassDeductible', jsonb_build_object('rule', 'any', 'cents', 0),
    'endorsements', jsonb_build_object(
      'accident_forgiveness', accident_pref,
      'rental_vehicle_coverage', rental_pref,
      'non_owned_automobile', 'indifferent',
      'family_protection', 'indifferent',
      'depreciation_waiver', 'indifferent',
      'oem_parts', 'indifferent',
      'roadside_assistance', 'indifferent',
      'disappearing_deductible', 'indifferent',
      'glass_coverage', 'indifferent',
      'telematics', telematics_pref
    )
  );
end;
$$ language plpgsql;

-- Helper: migrate an old property requirements JSONB document to the expanded shape.
create or replace function migrate_property_requirements(old jsonb)
returns jsonb as $$
declare
  settlement_pref coverage_preference := 'indifferent';
  sewer_pref coverage_preference := 'indifferent';
  overland_pref coverage_preference := 'indifferent';
  equipment_pref coverage_preference := 'indifferent';
  dwelling bigint := 0;
  base_ded bigint := 0;
  water_ded bigint := 0;
  ale_cents bigint := 0;
begin
  dwelling := coalesce((old->>'minDwellingLimitCents')::bigint, 45000000);
  base_ded := coalesce((old->>'maxBaseDeductibleCents')::bigint, 250000);
  water_ded := coalesce((old->>'maxWaterDeductibleCents')::bigint, 500000);

  if coalesce((old->>'replacementCostRequired')::boolean, false) then
    settlement_pref := 'required';
  end if;
  if coalesce((old->>'sewerBackupRequired')::boolean, false) then
    sewer_pref := 'required';
  end if;
  if coalesce((old->>'overlandWaterRequired')::boolean, false) then
    overland_pref := 'required';
  end if;
  if coalesce((old->>'equipmentBreakdownRequired')::boolean, false) then
    equipment_pref := 'required';
  end if;
  if coalesce((old->>'additionalLivingExpensesRequired')::boolean, false) then
    ale_cents := 1;
  end if;

  return jsonb_build_object(
    'coverageForm', jsonb_build_object('preference', 'required', 'value', 'comprehensive'),
    'settlementBasis', jsonb_build_object('preference', settlement_pref, 'value', 'replacement_cost'),
    'dwellingLimit', jsonb_build_object('rule', 'minimum', 'cents', dwelling),
    'contentsLimit', jsonb_build_object('rule', 'any', 'cents', 0),
    'detachedStructuresLimit', jsonb_build_object('rule', 'any', 'cents', 0),
    'personalLiabilityLimit', jsonb_build_object('rule', 'any', 'cents', 0),
    'additionalLivingExpenseLimit', jsonb_build_object('rule', case when ale_cents > 0 then 'minimum' else 'any' end, 'cents', ale_cents),
    'baseDeductible', jsonb_build_object('rule', 'maximum', 'cents', base_ded),
    'waterDeductible', jsonb_build_object('rule', 'maximum', 'cents', water_ded),
    'windHailDeductible', jsonb_build_object('rule', 'any', 'cents', 0),
    'earthquakeDeductible', jsonb_build_object('rule', 'any', 'cents', 0),
    'sewerBackup', jsonb_build_object(
      'preference', sewer_pref,
      'limit', jsonb_build_object('rule', 'any', 'cents', 0),
      'deductible', jsonb_build_object('rule', 'any', 'cents', 0)
    ),
    'overlandWater', jsonb_build_object(
      'preference', overland_pref,
      'limit', jsonb_build_object('rule', 'any', 'cents', 0),
      'deductible', jsonb_build_object('rule', 'any', 'cents', 0)
    ),
    'optionalCoverages', jsonb_build_object(
      'equipment_breakdown', equipment_pref,
      'service_line', 'indifferent',
      'bylaw_coverage', 'indifferent',
      'home_systems', 'indifferent',
      'cyber', 'indifferent',
      'scheduled_valuables', 'indifferent',
      'home_business', 'indifferent',
      'short_term_rental_permission', 'indifferent',
      'claims_forgiveness', 'indifferent',
      'groundwater_seepage', 'indifferent',
      'ice_dam', 'indifferent',
      'earthquake', 'indifferent'
    )
  );
end;
$$ language plpgsql;

-- Migrate existing coverage requirements to the expanded JSONB shape.
update coverage_requirements
set auto_requirements = migrate_auto_requirements(auto_requirements),
    property_requirements = migrate_property_requirements(property_requirements)
where auto_requirements ? 'minThirdPartyLiabilityCents'
   or property_requirements ? 'minDwellingLimitCents';

-- Migrate existing policies coverage_details to the expanded quote coverage shape.
create or replace function migrate_policy_coverage(old jsonb, line text)
returns jsonb as $$
declare
  result jsonb := old;
begin
  if line = 'auto' then
    result := result || jsonb_build_object(
      'coverageForm', case
        when coalesce((old->>'comprehensiveIncluded')::boolean, false) then 'comprehensive'
        when coalesce((old->>'collisionIncluded')::boolean, false) then 'collision'
        else 'liability_only'
      end,
      'vehicleClass', 'personal',
      'financingStatus', 'owned'
    );
  elsif line = 'property' then
    result := result || jsonb_build_object(
      'propertyType', 'homeowner',
      'coverageForm', 'comprehensive',
      'settlementBasis', case
        when coalesce((old->>'replacementCostIncluded')::boolean, false) then 'replacement_cost'
        else 'actual_cash_value'
      end,
      'contentsLimitCents', 0,
      'detachedStructuresLimitCents', 0,
      'personalLiabilityLimitCents', 0,
      'additionalLivingExpenseLimitCents', case
        when coalesce((old->>'additionalLivingExpensesIncluded')::boolean, false) then 1
        else 0
      end,
      'windHailIncluded', false,
      'windHailDeductibleCents', null,
      'earthquakeIncluded', false,
      'earthquakeDeductibleCents', null,
      'sewerBackupLimitCents', null,
      'sewerBackupDeductibleCents', null,
      'overlandWaterLimitCents', null,
      'overlandWaterDeductibleCents', null,
      'groundwaterIncluded', false,
      'iceDamIncluded', false,
      'nonOwnedAutomobileIncluded', false,
      'familyProtectionIncluded', false,
      'depreciationWaiverIncluded', false,
      'oemPartsIncluded', false,
      'roadsideAssistanceIncluded', false,
      'disappearingDeductibleIncluded', false,
      'glassCoverageIncluded', false,
      'serviceLineIncluded', false,
      'bylawCoverageIncluded', false,
      'homeSystemsIncluded', false,
      'cyberCoverageIncluded', false,
      'scheduledValuablesIncluded', false,
      'homeBusinessIncluded', false,
      'shortTermRentalPermissionIncluded', false,
      'claimsForgivenessIncluded', false
    );
  end if;
  return result;
end;
$$ language plpgsql;

update policies
set coverage_details = migrate_policy_coverage(coverage_details, product_line::text)
where coverage_details is not null;

-- Migrate existing quote coverage JSONB to the expanded shape.
update quote_coverages
set coverage = migrate_policy_coverage(coverage, 'auto')
where coverage ? 'thirdPartyLiabilityCents';

update quote_coverages
set coverage = migrate_policy_coverage(coverage, 'property')
where coverage ? 'dwellingLimitCents';

-- Clean up helpers.
drop function if exists migrate_auto_requirements(jsonb);
drop function if exists migrate_property_requirements(jsonb);
drop function if exists migrate_policy_coverage(jsonb, text);
