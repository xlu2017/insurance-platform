-- Corrective Phase 1C: make HouseholdCoverageMandateV2 the single source of truth
-- for the recommendation lifecycle, unify engine source, secure mandate saves, and
-- enforce asset integrity on quote components.

-- =============================================================================
-- 1. Canonical quote coverage repair (do not strip null keys)
-- =============================================================================

create or replace function canonicalize_quote_auto_coverage(input jsonb)
returns jsonb as $$
select jsonb_build_object(
  'thirdPartyLiabilityCents', coalesce((input->>'thirdPartyLiabilityCents')::bigint, 0),
  'coverageForm', coalesce(input->>'coverageForm', 'liability_only'),
  'collisionIncluded', coalesce((input->>'collisionIncluded')::boolean, false),
  'collisionDeductibleCents', case when input->'collisionDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'collisionDeductibleCents')::bigint, null) end,
  'comprehensiveIncluded', coalesce((input->>'comprehensiveIncluded')::boolean, false),
  'comprehensiveDeductibleCents', case when input->'comprehensiveDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'comprehensiveDeductibleCents')::bigint, null) end,
  'glassDeductibleCents', case when input->'glassDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'glassDeductibleCents')::bigint, null) end,
  'accidentForgivenessIncluded', coalesce((input->>'accidentForgivenessIncluded')::boolean, false),
  'rentalVehicleCoverageIncluded', coalesce((input->>'rentalVehicleCoverageIncluded')::boolean, false),
  'nonOwnedAutomobileIncluded', coalesce((input->>'nonOwnedAutomobileIncluded')::boolean, false),
  'familyProtectionIncluded', coalesce((input->>'familyProtectionIncluded')::boolean, false),
  'depreciationWaiverIncluded', coalesce((input->>'depreciationWaiverIncluded')::boolean, false),
  'oemPartsIncluded', coalesce((input->>'oemPartsIncluded')::boolean, false),
  'roadsideAssistanceIncluded', coalesce((input->>'roadsideAssistanceIncluded')::boolean, false),
  'disappearingDeductibleIncluded', coalesce((input->>'disappearingDeductibleIncluded')::boolean, false),
  'glassCoverageIncluded', coalesce((input->>'glassCoverageIncluded')::boolean, false),
  'telematicsRequired', coalesce((input->>'telematicsRequired')::boolean, false),
  'vehicleClass', coalesce(input->>'vehicleClass', 'personal'),
  'financingStatus', coalesce(input->>'financingStatus', 'owned')
);
$$ language sql immutable;

create or replace function canonicalize_quote_property_coverage(input jsonb)
returns jsonb as $$
select jsonb_build_object(
  'propertyType', coalesce(input->>'propertyType', 'homeowner'),
  'coverageForm', coalesce(input->>'coverageForm', 'comprehensive'),
  'settlementBasis', coalesce(input->>'settlementBasis', 'replacement_cost'),
  'dwellingLimitCents', coalesce((input->>'dwellingLimitCents')::bigint, 0),
  'contentsLimitCents', coalesce((input->>'contentsLimitCents')::bigint, 0),
  'detachedStructuresLimitCents', coalesce((input->>'detachedStructuresLimitCents')::bigint, 0),
  'personalLiabilityLimitCents', coalesce((input->>'personalLiabilityLimitCents')::bigint, 0),
  'additionalLivingExpenseLimitCents', coalesce((input->>'additionalLivingExpenseLimitCents')::bigint, 0),
  'baseDeductibleCents', coalesce((input->>'baseDeductibleCents')::bigint, 0),
  'waterDeductibleCents', case when input->'waterDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'waterDeductibleCents')::bigint, null) end,
  'windHailIncluded', coalesce((input->>'windHailIncluded')::boolean, false),
  'windHailDeductibleCents', case when input->'windHailDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'windHailDeductibleCents')::bigint, null) end,
  'earthquakeIncluded', coalesce((input->>'earthquakeIncluded')::boolean, false),
  'earthquakeDeductibleCents', case when input->'earthquakeDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'earthquakeDeductibleCents')::bigint, null) end,
  'sewerBackupIncluded', coalesce((input->>'sewerBackupIncluded')::boolean, false),
  'sewerBackupLimitCents', case when input->'sewerBackupLimitCents' = 'null'::jsonb then null else coalesce((input->>'sewerBackupLimitCents')::bigint, null) end,
  'sewerBackupDeductibleCents', case when input->'sewerBackupDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'sewerBackupDeductibleCents')::bigint, null) end,
  'overlandWaterIncluded', coalesce((input->>'overlandWaterIncluded')::boolean, false),
  'overlandWaterLimitCents', case when input->'overlandWaterLimitCents' = 'null'::jsonb then null else coalesce((input->>'overlandWaterLimitCents')::bigint, null) end,
  'overlandWaterDeductibleCents', case when input->'overlandWaterDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'overlandWaterDeductibleCents')::bigint, null) end,
  'groundwaterIncluded', coalesce((input->>'groundwaterIncluded')::boolean, false),
  'iceDamIncluded', coalesce((input->>'iceDamIncluded')::boolean, false),
  'equipmentBreakdownIncluded', coalesce((input->>'equipmentBreakdownIncluded')::boolean, false),
  'serviceLineIncluded', coalesce((input->>'serviceLineIncluded')::boolean, false),
  'bylawCoverageIncluded', coalesce((input->>'bylawCoverageIncluded')::boolean, false),
  'homeSystemsIncluded', coalesce((input->>'homeSystemsIncluded')::boolean, false),
  'cyberCoverageIncluded', coalesce((input->>'cyberCoverageIncluded')::boolean, false),
  'scheduledValuablesIncluded', coalesce((input->>'scheduledValuablesIncluded')::boolean, false),
  'homeBusinessIncluded', coalesce((input->>'homeBusinessIncluded')::boolean, false),
  'shortTermRentalPermissionIncluded', coalesce((input->>'shortTermRentalPermissionIncluded')::boolean, false),
  'claimsForgivenessIncluded', coalesce((input->>'claimsForgivenessIncluded')::boolean, false)
);
$$ language sql immutable;

update quote_coverages qc
set coverage = canonicalize_quote_auto_coverage(qc.coverage)
from quote_policy_components qpc
where qc.quote_component_id = qpc.id
  and qpc.product_line = 'auto';

update quote_coverages qc
set coverage = canonicalize_quote_property_coverage(qc.coverage)
from quote_policy_components qpc
where qc.quote_component_id = qpc.id
  and qpc.product_line = 'property';

-- =============================================================================
-- 2. Quote component asset integrity
-- =============================================================================

update quote_policy_components qpc
set asset_id = (
  case qpc.product_line
    when 'auto' then (
      select v.id
      from vehicles v
      join optimization_cases oc on oc.household_id = v.household_id
      join quotes q on q.case_id = oc.id
      where q.id = qpc.quote_id
      order by v.created_at, v.id
      limit 1
    )
    when 'property' then (
      select p.id
      from properties p
      join optimization_cases oc on oc.household_id = p.household_id
      join quotes q on q.case_id = oc.id
      where q.id = qpc.quote_id
      order by p.created_at, p.id
      limit 1
    )
  end
)
where qpc.asset_id is null;

alter table quote_policy_components alter column asset_id set not null;

create or replace function quote_policy_component_asset_integrity()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_household_id uuid;
begin
  if new.asset_id is null then
    raise exception 'asset_id is required for quote_policy_components' using errcode = 'P0001';
  end if;

  select oc.household_id into v_household_id
  from quotes q
  join optimization_cases oc on oc.id = q.case_id
  where q.id = new.quote_id;

  if new.product_line = 'auto' then
    if not exists (
      select 1 from vehicles
      where id = new.asset_id and household_id = v_household_id
    ) then
      raise exception 'auto component asset must be a vehicle in the case household' using errcode = 'P0001';
    end if;
  elsif new.product_line = 'property' then
    if not exists (
      select 1 from properties
      where id = new.asset_id and household_id = v_household_id
    ) then
      raise exception 'property component asset must be a property in the case household' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists quote_policy_component_asset_integrity_trigger on quote_policy_components;
create trigger quote_policy_component_asset_integrity_trigger
  before insert or update on quote_policy_components
  for each row execute function quote_policy_component_asset_integrity();

-- =============================================================================
-- 3. Canonical V2 monetary-rule repair: rename cents -> amountCents and strip
--    amount values from match_current_or_better / any rules.
-- =============================================================================

create or replace function canonicalize_v2_monetary_rules(input jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  result jsonb := input;
  key text;
  val jsonb;
  obj jsonb := '{}'::jsonb;
  arr jsonb := '[]'::jsonb;
begin
  if input is null then
    return null;
  elsif jsonb_typeof(input) = 'object' then
    if input ? 'rule' then
      if (input->>'rule') in ('minimum', 'maximum', 'exact') then
        if input ? 'amountCents' then
          return jsonb_build_object('rule', input->>'rule', 'amountCents', input->'amountCents');
        elsif input ? 'cents' then
          return jsonb_build_object('rule', input->>'rule', 'amountCents', input->'cents');
        else
          return jsonb_build_object('rule', input->>'rule');
        end if;
      else
        return jsonb_build_object('rule', input->>'rule');
      end if;
    end if;
    for key, val in select * from jsonb_each(input) loop
      obj := obj || jsonb_build_object(key, canonicalize_v2_monetary_rules(val));
    end loop;
    return obj;
  elsif jsonb_typeof(input) = 'array' then
    for val in select * from jsonb_array_elements(input) loop
      arr := arr || jsonb_build_array(canonicalize_v2_monetary_rules(val));
    end loop;
    return arr;
  else
    return input;
  end if;
end;
$$;

update household_coverage_mandates
set household_auto_defaults = canonicalize_v2_monetary_rules(household_auto_defaults),
    household_property_defaults = canonicalize_v2_monetary_rules(household_property_defaults)
where household_auto_defaults::text like '%"cents"%'
   or household_property_defaults::text like '%"cents"%';

update vehicle_mandate_overrides
set override_values = canonicalize_v2_monetary_rules(override_values)
where override_values::text like '%"cents"%';

update property_mandate_overrides
set override_values = canonicalize_v2_monetary_rules(override_values)
where override_values::text like '%"cents"%';

-- =============================================================================
-- 4. Replace the public save_household_mandate_v2 RPC with a service-role-only
--    persist_household_mandate_v2 RPC and a per-household idempotent backfill.
-- =============================================================================

drop function if exists save_household_mandate_v2(
  uuid, int, int, jsonb, jsonb, jsonb, jsonb, jsonb, text, timestamptz
);
drop function if exists persist_household_mandate_v2(uuid, int, int, jsonb, jsonb, jsonb, jsonb, jsonb, text);
drop function if exists persist_household_mandate_v2(uuid, int, int, jsonb, jsonb, jsonb, jsonb, jsonb, text, uuid);

create or replace function persist_household_mandate_v2(
  p_household_id uuid,
  p_expected_mandate_version int,
  p_expected_switching_version int,
  p_household_auto_defaults jsonb,
  p_household_property_defaults jsonb,
  p_vehicle_overrides jsonb,
  p_property_overrides jsonb,
  p_switching_preferences jsonb,
  p_jurisdiction text,
  p_created_by uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_current_mandate_version int := 0;
  v_current_switching_version int := 0;
  v_new_mandate_id uuid;
  v_new_mandate_version int;
  v_new_switching_version int;
  v_override jsonb;
  v_vehicle_id uuid;
  v_property_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'only service_role may persist mandates' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_household_id::text, 0));

  select coalesce(max(version), 0) into v_current_mandate_version
  from household_coverage_mandates
  where household_id = p_household_id and is_current = true;

  if v_current_mandate_version is distinct from p_expected_mandate_version then
    return jsonb_build_object(
      'success', false,
      'code', 'STALE_VERSION',
      'message', 'Mandate version mismatch.',
      'currentMandateVersion', v_current_mandate_version
    );
  end if;

  select coalesce(max(version), 0) into v_current_switching_version
  from switching_preferences
  where household_id = p_household_id and is_current = true;

  if v_current_switching_version is distinct from p_expected_switching_version then
    return jsonb_build_object(
      'success', false,
      'code', 'STALE_VERSION',
      'message', 'Switching preferences version mismatch.',
      'currentSwitchingVersion', v_current_switching_version
    );
  end if;

  update household_coverage_mandates
  set is_current = false
  where household_id = p_household_id and is_current = true;

  update switching_preferences
  set is_current = false
  where household_id = p_household_id and is_current = true;

  v_new_mandate_version := v_current_mandate_version + 1;
  insert into household_coverage_mandates (
    household_id, schema_version, version, jurisdiction, effective_from,
    household_auto_defaults, household_property_defaults, is_current, created_by, updated_by
  ) values (
    p_household_id, 2, v_new_mandate_version, p_jurisdiction, now(),
    p_household_auto_defaults, p_household_property_defaults, true, p_created_by, p_created_by
  ) returning id into v_new_mandate_id;

  for v_override in select * from jsonb_array_elements(p_vehicle_overrides) loop
    v_vehicle_id := (v_override->>'vehicleId')::uuid;
    insert into vehicle_mandate_overrides (mandate_id, vehicle_id, override_values)
    values (
      v_new_mandate_id,
      v_vehicle_id,
      coalesce(v_override->'values', '{}'::jsonb)
    );
  end loop;

  for v_override in select * from jsonb_array_elements(p_property_overrides) loop
    v_property_id := (v_override->>'propertyId')::uuid;
    insert into property_mandate_overrides (mandate_id, property_id, override_values)
    values (
      v_new_mandate_id,
      v_property_id,
      coalesce(v_override->'values', '{}'::jsonb)
    );
  end loop;

  v_new_switching_version := v_current_switching_version + 1;
  insert into switching_preferences (
    household_id, version, min_net_annual_savings_cents, max_premium_increase_cents,
    max_deductible_increase_cents, renewal_only_switching, household_optimization_enabled,
    split_insurers_allowed, excluded_insurer_ids, deductible_increases_allowed,
    material_coverage_reductions_allowed, customer_approval_required, switch_only_after_customer_approval,
    allow_bundle_breakup, minimum_insurer_financial_rating, preferred_payment_frequency,
    preferred_billing_method, broker_direct_preference, is_current, created_by, updated_by
  ) values (
    p_household_id,
    v_new_switching_version,
    coalesce((p_switching_preferences->>'minNetAnnualSavingsCents')::bigint, 20000),
    coalesce((p_switching_preferences->>'maxPremiumIncreaseCents')::bigint, 0),
    coalesce((p_switching_preferences->>'maxDeductibleIncreaseCents')::bigint, 0),
    coalesce((p_switching_preferences->>'renewalOnlySwitching')::boolean, true),
    coalesce((p_switching_preferences->>'householdOptimizationEnabled')::boolean, true),
    coalesce((p_switching_preferences->>'splitInsurersAllowed')::boolean, true),
    coalesce(array(select jsonb_array_elements_text(p_switching_preferences->'excludedInsurerIds')::uuid), '{}'::uuid[]),
    coalesce((p_switching_preferences->>'deductibleIncreasesAllowed')::boolean, false),
    false,
    true,
    coalesce((p_switching_preferences->>'switchOnlyAfterCustomerApproval')::boolean, true),
    coalesce((p_switching_preferences->>'allowBundleBreakup')::boolean, false),
    coalesce((p_switching_preferences->>'minimumInsurerFinancialRating')::financial_rating, 'any'),
    coalesce((p_switching_preferences->>'preferredPaymentFrequency')::payment_frequency, 'annual'),
    coalesce((p_switching_preferences->>'preferredBillingMethod')::billing_method, 'automatic_bank'),
    coalesce((p_switching_preferences->>'brokerDirectPreference')::broker_direct_preference, 'indifferent'),
    true,
    p_created_by,
    p_created_by
  );

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, after_summary)
  values (
    coalesce(p_created_by, auth.uid()),
    null,
    'household_mandate_v2_saved',
    'household_coverage_mandate',
    v_new_mandate_id,
    p_household_id,
    jsonb_build_object(
      'mandate_version', v_new_mandate_version,
      'switching_version', v_new_switching_version,
      'household_id', p_household_id
    )
  );

  return jsonb_build_object(
    'success', true,
    'mandateId', v_new_mandate_id,
    'mandateVersion', v_new_mandate_version,
    'switchingVersion', v_new_switching_version
  );
end;
$$;

revoke execute on function persist_household_mandate_v2(uuid, int, int, jsonb, jsonb, jsonb, jsonb, jsonb, text, uuid) from public;
revoke execute on function persist_household_mandate_v2(uuid, int, int, jsonb, jsonb, jsonb, jsonb, jsonb, text, uuid) from anon;
revoke execute on function persist_household_mandate_v2(uuid, int, int, jsonb, jsonb, jsonb, jsonb, jsonb, text, uuid) from authenticated;
grant execute on function persist_household_mandate_v2(uuid, int, int, jsonb, jsonb, jsonb, jsonb, jsonb, text, uuid) to service_role;

-- Per-household idempotent backfill from legacy coverage_requirements.
create or replace function backfill_coverage_mandate_v2()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  v_mandate_id uuid;
  v_key text;
  v_vehicle_id uuid;
  v_property_id uuid;
  v_switching_version int;
begin
  for r in
    select cr.id as coverage_id,
           cr.household_id,
           cr.version,
           cr.auto_requirements,
           cr.property_requirements,
           cr.vehicle_mandates,
           cr.property_mandates
    from coverage_requirements cr
    where cr.is_current = true
      and not exists (
        select 1 from household_coverage_mandates hcm
        where hcm.household_id = cr.household_id and hcm.is_current = true
      )
  loop
    insert into household_coverage_mandates (
      household_id, schema_version, version, jurisdiction, effective_from,
      household_auto_defaults, household_property_defaults, is_current
    ) values (
      r.household_id, 2, r.version, 'AB', now(),
      canonicalize_v2_monetary_rules(r.auto_requirements),
      canonicalize_v2_monetary_rules(r.property_requirements),
      true
    )
    returning id into v_mandate_id;

    for v_key in select jsonb_object_keys(r.vehicle_mandates)
    loop
      v_vehicle_id := v_key::uuid;
      insert into vehicle_mandate_overrides (mandate_id, vehicle_id, override_values)
      values (
        v_mandate_id,
        v_vehicle_id,
        canonicalize_v2_monetary_rules(coalesce(r.vehicle_mandates->v_key, '{}'::jsonb))
      );
    end loop;

    for v_key in select jsonb_object_keys(r.property_mandates)
    loop
      v_property_id := v_key::uuid;
      insert into property_mandate_overrides (mandate_id, property_id, override_values)
      values (
        v_mandate_id,
        v_property_id,
        canonicalize_v2_monetary_rules(coalesce(r.property_mandates->v_key, '{}'::jsonb))
      );
    end loop;

    -- Ensure a current switching preferences row exists for this household.
    select coalesce(max(version), 0) into v_switching_version
    from switching_preferences
    where household_id = r.household_id and is_current = true;

    if v_switching_version = 0 then
      insert into switching_preferences (household_id, version, is_current)
      values (r.household_id, 1, true);
    end if;
  end loop;
end;
$$;

-- =============================================================================
-- 5. Bind recommendations to exact V2 mandate snapshots
-- =============================================================================

alter table recommendations
  add column if not exists mandate_id uuid references household_coverage_mandates (id) on delete set null,
  add column if not exists mandate_schema_version int,
  add column if not exists mandate_jurisdiction text,
  add column if not exists switching_preferences_id uuid references switching_preferences (id) on delete set null;

-- =============================================================================
-- 6. Rewrite recommendation persistence to validate the V2 snapshot
-- =============================================================================

drop function if exists persist_recommendation(
  uuid, int, int, jsonb, text, bigint, bigint, bigint, text[], jsonb, jsonb, jsonb, text
);

create or replace function persist_recommendation(
  p_case_id uuid,
  p_mandate_id uuid,
  p_mandate_version int,
  p_mandate_schema_version int,
  p_mandate_jurisdiction text,
  p_switching_preferences_id uuid,
  p_switching_preferences_version int,
  p_quote_snapshot jsonb,
  p_engine_version text,
  p_current_total_cents bigint,
  p_proposed_total_cents bigint,
  p_net_savings_cents bigint,
  p_reason_codes text[],
  p_comparison jsonb,
  p_recommended jsonb,
  p_options jsonb,
  p_disclosure_version text default 'v1'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_role user_role;
  oc optimization_cases%rowtype;
  current_mandate record;
  current_switching record;
  next_rec_version int;
  new_rec_id uuid;
  opt record;
  snap record;
  quote_record record;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select role into caller_role from profiles where id = caller;
  if caller_role not in ('operations', 'admin') then
    raise exception 'only operations or admins can generate recommendations';
  end if;

  select * into oc from optimization_cases where id = p_case_id;
  if not found then raise exception 'case not found'; end if;
  if oc.state <> 'comparing_quotes' then
    raise exception 'case is not in comparing_quotes state';
  end if;
  if not can_access_case(p_case_id) then
    raise exception 'case not accessible';
  end if;

  select * into current_mandate
  from household_coverage_mandates
  where id = p_mandate_id and household_id = oc.household_id and is_current = true
  for update;
  if not found then
    raise exception 'mandate % is not current for this household', p_mandate_id;
  end if;
  if current_mandate.version is distinct from p_mandate_version then
    raise exception 'mandate version changed between evaluation and persistence';
  end if;
  if current_mandate.schema_version is distinct from p_mandate_schema_version then
    raise exception 'mandate schema version mismatch';
  end if;
  if current_mandate.jurisdiction is distinct from p_mandate_jurisdiction then
    raise exception 'mandate jurisdiction mismatch';
  end if;

  select * into current_switching
  from switching_preferences
  where id = p_switching_preferences_id and household_id = oc.household_id and is_current = true
  for update;
  if not found then
    raise exception 'switching preferences % are not current for this household', p_switching_preferences_id;
  end if;
  if current_switching.version is distinct from p_switching_preferences_version then
    raise exception 'switching preferences version changed between evaluation and persistence';
  end if;

  for snap in (select * from jsonb_array_elements(coalesce(p_quote_snapshot, '[]'::jsonb))) loop
    select id, updated_at into quote_record
    from quotes
    where id = (snap.value->>'id')::uuid and case_id = p_case_id;
    if quote_record.id is null then
      raise exception 'quote % no longer exists in this case', snap.value->>'id';
    end if;
    if quote_record.updated_at is distinct from (snap.value->>'updated_at')::timestamptz then
      raise exception 'quote % changed since evaluation', snap.value->>'id';
    end if;
  end loop;

  select coalesce(max(version), 0) + 1 into next_rec_version
  from recommendations
  where case_id = p_case_id;

  perform supersede_prior_recommendations(p_case_id);

  insert into recommendations (
    case_id, status, version,
    mandate_id, mandate_version, mandate_schema_version, mandate_jurisdiction,
    switching_preferences_id, switching_preferences_version,
    quote_ids, quote_snapshot, current_total_cents, proposed_total_cents, net_savings_cents,
    reason_codes, comparison, engine_version, disclosure_version, created_by
  ) values (
    p_case_id, 'awaiting_review', next_rec_version,
    p_mandate_id, p_mandate_version, p_mandate_schema_version, p_mandate_jurisdiction,
    p_switching_preferences_id, p_switching_preferences_version,
    array[
      (p_recommended->>'auto_quote_id')::uuid,
      (p_recommended->>'property_quote_id')::uuid
    ],
    coalesce(p_quote_snapshot, '[]'::jsonb),
    p_current_total_cents, p_proposed_total_cents, p_net_savings_cents,
    p_reason_codes, p_comparison, p_engine_version, p_disclosure_version, caller
  ) returning id into new_rec_id;

  for opt in select * from jsonb_array_elements(p_options) loop
    insert into recommendation_options (
      recommendation_id, rank, auto_quote_id, property_quote_id, bundled, total_cents,
      net_savings_cents, eligible, reason_codes
    ) values (
      new_rec_id,
      (opt.value->>'rank')::int,
      (opt.value->>'auto_quote_id')::uuid,
      (opt.value->>'property_quote_id')::uuid,
      (opt.value->>'bundled')::boolean,
      (opt.value->>'total_cents')::bigint,
      (opt.value->>'net_savings_cents')::bigint,
      (opt.value->>'eligible')::boolean,
      coalesce(array(select jsonb_array_elements_text(opt.value->'reason_codes')), '{}'::text[])
    );
  end loop;

  update optimization_cases
  set state = 'licensed_review', updated_at = now()
  where id = p_case_id;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    caller, caller_role, 'recommendation_generated', 'recommendation', new_rec_id, oc.household_id, p_case_id,
    jsonb_build_object(
      'recommendation_id', new_rec_id,
      'version', next_rec_version,
      'mandate_id', p_mandate_id,
      'mandate_version', p_mandate_version,
      'switching_preferences_id', p_switching_preferences_id,
      'switching_preferences_version', p_switching_preferences_version,
      'net_savings_cents', p_net_savings_cents,
      'engine_version', p_engine_version
    )
  );

  return jsonb_build_object('success', true, 'recommendation_id', new_rec_id, 'version', next_rec_version);
end;
$$;

grant execute on function persist_recommendation(
  uuid, uuid, int, int, text, uuid, int, jsonb, text, bigint, bigint, bigint, text[], jsonb, jsonb, jsonb, text
) to authenticated;

-- =============================================================================
-- 7. Rewrite licensed review to validate the recorded V2 snapshot
-- =============================================================================

create or replace function review_recommendation(
  p_recommendation_id uuid,
  p_approved boolean,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  rec recommendations%rowtype;
  oc optimization_cases%rowtype;
  caller uuid := auth.uid();
  caller_role user_role;
  approval_id uuid;
  current_mandate record;
  current_switching record;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select role into caller_role from profiles where id = caller;
  if caller_role not in ('reviewer', 'admin') then
    raise exception 'only reviewers or admins can review recommendations';
  end if;

  select * into rec from recommendations where id = p_recommendation_id;
  if not found then raise exception 'recommendation not found'; end if;
  select * into oc from optimization_cases where id = rec.case_id;

  if exists (
    select 1 from recommendation_approvals
    where recommendation_id = p_recommendation_id and approver_role in ('reviewer','admin')
  ) then
    raise exception 'this recommendation has already been reviewed by a licensed reviewer';
  end if;

  if rec.status <> 'awaiting_review' then
    raise exception 'recommendation is not awaiting review';
  end if;
  if oc.state <> 'licensed_review' then
    raise exception 'case is not in licensed_review state';
  end if;
  if not can_access_case(rec.case_id) then
    raise exception 'case not accessible';
  end if;

  select * into current_mandate
  from household_coverage_mandates
  where id = rec.mandate_id and household_id = oc.household_id and is_current = true
  for update;
  if not found then
    raise exception 'mandate used by this recommendation is no longer current';
  end if;
  if current_mandate.version is distinct from rec.mandate_version then
    raise exception 'mandate has changed since this recommendation was generated';
  end if;

  select * into current_switching
  from switching_preferences
  where id = rec.switching_preferences_id and household_id = oc.household_id and is_current = true
  for update;
  if not found then
    raise exception 'switching preferences used by this recommendation are no longer current';
  end if;
  if current_switching.version is distinct from rec.switching_preferences_version then
    raise exception 'switching preferences have changed since this recommendation was generated';
  end if;

  insert into recommendation_approvals (recommendation_id, approver_profile_id, approver_role, approved, notes)
  values (p_recommendation_id, caller, caller_role, p_approved, coalesce(p_notes, ''))
  returning id into approval_id;

  update recommendations
  set status = (case when p_approved then 'published' else 'rejected' end)::recommendation_status,
      updated_at = now()
  where id = p_recommendation_id;

  if p_approved then
    update optimization_cases set state = 'recommendation_ready', updated_at = now() where id = rec.case_id;
    update optimization_cases set state = 'customer_decision', updated_at = now() where id = rec.case_id;
  else
    update optimization_cases set state = 'comparing_quotes', updated_at = now() where id = rec.case_id;
  end if;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, before_summary, after_summary)
  values (
    caller, caller_role, case when p_approved then 'recommendation_published' else 'recommendation_rejected' end,
    'recommendation', p_recommendation_id, oc.household_id, rec.case_id,
    jsonb_build_object('status', 'awaiting_review'),
    jsonb_build_object('status', case when p_approved then 'published' else 'rejected' end, 'approval_id', approval_id)
  );

  return jsonb_build_object('success', true, 'approval_id', approval_id, 'published', p_approved);
end;
$$;

-- =============================================================================
-- 8. Rewrite customer approval/decline to validate the recorded V2 snapshot
-- =============================================================================

drop function if exists approve_customer_recommendation(uuid, int, int, int);
drop function if exists decline_customer_recommendation(uuid, int, int, int);

create or replace function approve_customer_recommendation(
  p_recommendation_id uuid,
  p_expected_rec_version int
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  rec recommendations%rowtype;
  oc optimization_cases%rowtype;
  hid uuid;
  caller uuid := auth.uid();
  caller_role user_role;
  current_mandate record;
  current_switching record;
  q quotes%rowtype;
  approval_id uuid;
  switch_id uuid;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select * into rec from recommendations where id = p_recommendation_id;
  if not found then raise exception 'recommendation not found'; end if;

  if exists (
    select 1 from recommendation_approvals ra
    where ra.recommendation_id = p_recommendation_id and ra.approver_role = 'customer'
  ) then
    raise exception 'customer decision already recorded for this recommendation';
  end if;

  select * into oc from optimization_cases where id = rec.case_id;
  if oc.state <> 'customer_decision' then
    raise exception 'case is not in customer_decision state';
  end if;
  select require_household_member_for_recommendation(p_recommendation_id) into hid;
  if rec.status <> 'published' then
    raise exception 'recommendation is not published';
  end if;

  if rec.version is distinct from p_expected_rec_version then
    raise exception 'stale recommendation version';
  end if;

  select * into current_mandate
  from household_coverage_mandates
  where id = rec.mandate_id and household_id = hid and is_current = true
  for update;
  if not found then
    raise exception 'mandate used by this recommendation is no longer current';
  end if;
  if current_mandate.version is distinct from rec.mandate_version then
    raise exception 'mandate has changed since this recommendation was generated';
  end if;

  select * into current_switching
  from switching_preferences
  where id = rec.switching_preferences_id and household_id = hid and is_current = true
  for update;
  if not found then
    raise exception 'switching preferences used by this recommendation are no longer current';
  end if;
  if current_switching.version is distinct from rec.switching_preferences_version then
    raise exception 'switching preferences have changed since this recommendation was generated';
  end if;

  for q in (select * from quotes where id = any(rec.quote_ids)) loop
    if q.state in ('expired','rejected') then
      raise exception 'referenced quote % is no longer valid', q.id;
    end if;
    if q.expires_at is not null and q.expires_at < now() then
      raise exception 'referenced quote % has expired', q.id;
    end if;
  end loop;

  if exists (
    select 1 from recommendations r2
    where r2.case_id = rec.case_id and r2.version > rec.version and r2.status in ('draft','awaiting_review','published')
  ) then
    raise exception 'a newer recommendation exists';
  end if;

  select role into caller_role from profiles where id = caller;
  insert into recommendation_approvals (recommendation_id, approver_profile_id, approver_role, approved, notes)
  values (p_recommendation_id, caller, 'customer', true, 'Customer approved switch')
  returning id into approval_id;

  update recommendations set status = 'customer_approved'::recommendation_status, updated_at = now() where id = p_recommendation_id;

  select id into switch_id
  from switch_events
  where recommendation_id = p_recommendation_id and state <> 'failed'
  limit 1;

  if switch_id is null then
    insert into switch_events (case_id, recommendation_id, state)
    values (rec.case_id, p_recommendation_id, 'customer_approved')
    returning id into switch_id;
  end if;

  update optimization_cases set state = 'switching'::case_state, updated_at = now() where id = rec.case_id;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    caller, caller_role, 'recommendation_approved_by_customer', 'recommendation', p_recommendation_id, hid, rec.case_id,
    jsonb_build_object('net_savings_cents', rec.net_savings_cents, 'switch_event_id', switch_id, 'mandate_id', rec.mandate_id, 'switching_preferences_id', rec.switching_preferences_id)
  );

  return jsonb_build_object('success', true, 'approval_id', approval_id, 'switch_event_id', switch_id);
end;
$$;

create or replace function decline_customer_recommendation(
  p_recommendation_id uuid,
  p_expected_rec_version int
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  rec recommendations%rowtype;
  oc optimization_cases%rowtype;
  hid uuid;
  caller uuid := auth.uid();
  caller_role user_role;
  current_mandate record;
  current_switching record;
  q quotes%rowtype;
  approval_id uuid;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select * into rec from recommendations where id = p_recommendation_id;
  if not found then raise exception 'recommendation not found'; end if;

  if exists (
    select 1 from recommendation_approvals ra
    where ra.recommendation_id = p_recommendation_id and ra.approver_role = 'customer'
  ) then
    raise exception 'customer decision already recorded for this recommendation';
  end if;

  select * into oc from optimization_cases where id = rec.case_id;
  if oc.state <> 'customer_decision' then
    raise exception 'case is not in customer_decision state';
  end if;
  select require_household_member_for_recommendation(p_recommendation_id) into hid;
  if rec.status <> 'published' then
    raise exception 'recommendation is not published';
  end if;

  if rec.version is distinct from p_expected_rec_version then
    raise exception 'stale recommendation version';
  end if;

  select * into current_mandate
  from household_coverage_mandates
  where id = rec.mandate_id and household_id = hid and is_current = true
  for update;
  if not found then
    raise exception 'mandate used by this recommendation is no longer current';
  end if;
  if current_mandate.version is distinct from rec.mandate_version then
    raise exception 'mandate has changed since this recommendation was generated';
  end if;

  select * into current_switching
  from switching_preferences
  where id = rec.switching_preferences_id and household_id = hid and is_current = true
  for update;
  if not found then
    raise exception 'switching preferences used by this recommendation are no longer current';
  end if;
  if current_switching.version is distinct from rec.switching_preferences_version then
    raise exception 'switching preferences have changed since this recommendation was generated';
  end if;

  for q in (select * from quotes where id = any(rec.quote_ids)) loop
    if q.state in ('expired','rejected') then
      raise exception 'referenced quote % is no longer valid', q.id;
    end if;
    if q.expires_at is not null and q.expires_at < now() then
      raise exception 'referenced quote % has expired', q.id;
    end if;
  end loop;

  if exists (
    select 1 from recommendations r2
    where r2.case_id = rec.case_id and r2.version > rec.version and r2.status in ('draft','awaiting_review','published')
  ) then
    raise exception 'a newer recommendation exists';
  end if;

  select role into caller_role from profiles where id = caller;
  insert into recommendation_approvals (recommendation_id, approver_profile_id, approver_role, approved, notes)
  values (p_recommendation_id, caller, 'customer', false, 'Customer declined switch')
  returning id into approval_id;

  update recommendations set status = 'customer_declined'::recommendation_status, updated_at = now() where id = p_recommendation_id;
  update optimization_cases set state = 'retained_incumbent'::case_state, updated_at = now() where id = rec.case_id;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    caller, caller_role, 'recommendation_declined_by_customer', 'recommendation', p_recommendation_id, hid, rec.case_id,
    jsonb_build_object('net_savings_cents', rec.net_savings_cents)
  );

  return jsonb_build_object('success', true, 'approval_id', approval_id);
end;
$$;

grant execute on function approve_customer_recommendation(uuid, int) to authenticated;
grant execute on function decline_customer_recommendation(uuid, int) to authenticated;

-- =============================================================================
-- 9. Staff read access to override tables
-- =============================================================================

drop policy if exists vehicle_mandate_overrides_staff_select on vehicle_mandate_overrides;
create policy vehicle_mandate_overrides_staff_select
  on vehicle_mandate_overrides
  for select
  to authenticated
  using (
    exists (
      select 1 from household_coverage_mandates hcm
      where hcm.id = vehicle_mandate_overrides.mandate_id
        and can_access_household(hcm.household_id)
    )
  );

drop policy if exists property_mandate_overrides_staff_select on property_mandate_overrides;
create policy property_mandate_overrides_staff_select
  on property_mandate_overrides
  for select
  to authenticated
  using (
    exists (
      select 1 from household_coverage_mandates hcm
      where hcm.id = property_mandate_overrides.mandate_id
        and can_access_household(hcm.household_id)
    )
  );

-- =============================================================================
-- 10. Run the corrected idempotent backfill so legacy households get a V2 mandate.
-- =============================================================================

do $$
begin
  perform backfill_coverage_mandate_v2();
end $$;

-- Backfill V2 identity columns for recommendations created before this migration.
update recommendations r
set mandate_id = hcm.id,
    mandate_schema_version = hcm.schema_version,
    mandate_jurisdiction = hcm.jurisdiction,
    switching_preferences_id = sp.id
from optimization_cases oc
join household_coverage_mandates hcm on hcm.household_id = oc.household_id and hcm.is_current = true
join switching_preferences sp on sp.household_id = oc.household_id and sp.is_current = true
where r.case_id = oc.id
  and r.mandate_id is null;
