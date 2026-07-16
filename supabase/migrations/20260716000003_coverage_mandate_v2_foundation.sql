-- Corrective Phase 1B: versioned, immutable household mandate foundation
-- and asset-specific override tables.

-- =============================================================================
-- Core tables
-- =============================================================================

create table if not exists household_coverage_mandates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  schema_version integer not null check (schema_version = 2),
  version integer not null check (version > 0),
  jurisdiction text not null check (jurisdiction = 'AB'),
  effective_from timestamptz not null,
  household_auto_defaults jsonb not null default '{}'::jsonb,
  household_property_defaults jsonb not null default '{}'::jsonb,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  unique (household_id, version)
);

create unique index if not exists idx_household_coverage_mandates_current
  on household_coverage_mandates (household_id)
  where is_current = true;

create table if not exists vehicle_mandate_overrides (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references household_coverage_mandates (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  override_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mandate_id, vehicle_id)
);

create table if not exists property_mandate_overrides (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references household_coverage_mandates (id) on delete cascade,
  property_id uuid not null references properties (id) on delete cascade,
  override_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mandate_id, property_id)
);

-- Signed-in users receive baseline privileges; RLS policies constrain rows.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on household_coverage_mandates, vehicle_mandate_overrides, property_mandate_overrides to authenticated, service_role;

-- Ensure only one current switching preferences row per household.
create unique index if not exists idx_switching_preferences_current
  on switching_preferences (household_id)
  where is_current = true;

-- =============================================================================
-- Cross-household override guard
-- =============================================================================

create or replace function check_mandate_override_household()
returns trigger as $$
declare
  mandate_household uuid;
  asset_household uuid;
begin
  select household_id into mandate_household
  from household_coverage_mandates
  where id = new.mandate_id;

  if tg_table_name = 'vehicle_mandate_overrides' then
    select household_id into asset_household
    from vehicles
    where id = new.vehicle_id;
  elsif tg_table_name = 'property_mandate_overrides' then
    select household_id into asset_household
    from properties
    where id = new.property_id;
  end if;

  if mandate_household is distinct from asset_household then
    raise exception 'Override asset does not belong to mandate household';
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- Drop and recreate triggers to ensure the correct function is bound.
drop trigger if exists vehicle_mandate_override_household_guard on vehicle_mandate_overrides;
create trigger vehicle_mandate_override_household_guard
  before insert or update on vehicle_mandate_overrides
  for each row execute function check_mandate_override_household();

drop trigger if exists property_mandate_override_household_guard on property_mandate_overrides;
create trigger property_mandate_override_household_guard
  before insert or update on property_mandate_overrides
  for each row execute function check_mandate_override_household();

-- =============================================================================
-- Updated-at triggers for new tables
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'household_coverage_mandates',
    'vehicle_mandate_overrides',
    'property_mandate_overrides'
  ] loop
    execute format(
      'drop trigger if exists set_updated_at on %I; create trigger set_updated_at before update on %I for each row execute function set_updated_at()',
      t, t
    );
  end loop;
end $$;

-- =============================================================================
-- RLS policies
-- =============================================================================

alter table household_coverage_mandates enable row level security;
alter table vehicle_mandate_overrides enable row level security;
alter table property_mandate_overrides enable row level security;

-- Customers can read their own household's mandate history.
drop policy if exists household_coverage_mandates_customer_select on household_coverage_mandates;
create policy household_coverage_mandates_customer_select
  on household_coverage_mandates
  for select
  to authenticated
  using (
    exists (
      select 1 from households h
      join household_members hm on h.id = hm.household_id
      where h.id = household_coverage_mandates.household_id
        and hm.profile_id = auth.uid()
    )
  );

-- Customers cannot directly insert/update/delete V2 mandates; they must use the RPC.
drop policy if exists household_coverage_mandates_customer_no_write on household_coverage_mandates;
create policy household_coverage_mandates_customer_no_write
  on household_coverage_mandates
  for all
  to authenticated
  using (false)
  with check (false);

-- Service role can manage V2 mandates.
drop policy if exists household_coverage_mandates_service_all on household_coverage_mandates;
create policy household_coverage_mandates_service_all
  on household_coverage_mandates
  for all
  to service_role
  using (true)
  with check (true);

-- Admins (operations, reviewer, admin roles) can read V2 mandates.
drop policy if exists household_coverage_mandates_admin_select on household_coverage_mandates;
create policy household_coverage_mandates_admin_select
  on household_coverage_mandates
  for select
  to authenticated
  using (
    exists (
      select 1 from profiles
      where id = auth.uid()
        and role in ('operations', 'reviewer', 'admin')
    )
  );

-- Override read access mirrors the mandate read access.
drop policy if exists vehicle_mandate_overrides_customer_select on vehicle_mandate_overrides;
create policy vehicle_mandate_overrides_customer_select
  on vehicle_mandate_overrides
  for select
  to authenticated
  using (
    exists (
      select 1 from household_coverage_mandates hcm
      join households h on hcm.household_id = h.id
      join household_members hm on h.id = hm.household_id
      where hcm.id = vehicle_mandate_overrides.mandate_id
        and hm.profile_id = auth.uid()
    )
  );

drop policy if exists vehicle_mandate_overrides_customer_no_write on vehicle_mandate_overrides;
create policy vehicle_mandate_overrides_customer_no_write
  on vehicle_mandate_overrides
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists vehicle_mandate_overrides_service_all on vehicle_mandate_overrides;
create policy vehicle_mandate_overrides_service_all
  on vehicle_mandate_overrides
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists property_mandate_overrides_customer_select on property_mandate_overrides;
create policy property_mandate_overrides_customer_select
  on property_mandate_overrides
  for select
  to authenticated
  using (
    exists (
      select 1 from household_coverage_mandates hcm
      join households h on hcm.household_id = h.id
      join household_members hm on h.id = hm.household_id
      where hcm.id = property_mandate_overrides.mandate_id
        and hm.profile_id = auth.uid()
    )
  );

drop policy if exists property_mandate_overrides_customer_no_write on property_mandate_overrides;
create policy property_mandate_overrides_customer_no_write
  on property_mandate_overrides
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists property_mandate_overrides_service_all on property_mandate_overrides;
create policy property_mandate_overrides_service_all
  on property_mandate_overrides
  for all
  to service_role
  using (true)
  with check (true);

-- =============================================================================
-- Atomic versioned save RPC
-- =============================================================================

create or replace function save_household_mandate_v2(
  p_household_id uuid,
  p_expected_mandate_version int,
  p_expected_switching_version int,
  p_household_auto_defaults jsonb,
  p_household_property_defaults jsonb,
  p_vehicle_overrides jsonb,
  p_property_overrides jsonb,
  p_switching_preferences jsonb,
  p_jurisdiction text,
  p_effective_from timestamptz
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text := auth.role();
  v_is_member boolean := false;
  v_current_mandate_version int := 0;
  v_current_switching_version int := 0;
  v_new_mandate_id uuid;
  v_new_mandate_version int;
  v_new_switching_version int;
  v_override jsonb;
  v_vehicle_id uuid;
  v_property_id uuid;
begin
  -- Service role bypasses the membership check.
  if v_user_role = 'service_role' then
    v_is_member := true;
  elsif v_user_id is not null then
    select exists (
      select 1 from household_members
      where household_id = p_household_id and profile_id = v_user_id
    ) into v_is_member;
  end if;

  if not v_is_member and not (
    exists (
      select 1 from profiles
      where id = v_user_id and role in ('operations', 'reviewer', 'admin')
    )
  ) then
    raise exception 'Unauthorized' using errcode = 'P0001';
  end if;

  -- Determine current mandate version.
  select coalesce(max(version), 0) into v_current_mandate_version
  from household_coverage_mandates
  where household_id = p_household_id and is_current = true;

  if v_current_mandate_version != p_expected_mandate_version then
    return jsonb_build_object(
      'success', false,
      'code', 'STALE_VERSION',
      'message', 'Mandate version mismatch.',
      'currentMandateVersion', v_current_mandate_version
    );
  end if;

  -- Determine current switching version.
  select coalesce(max(version), 0) into v_current_switching_version
  from switching_preferences
  where household_id = p_household_id and is_current = true;

  if v_current_switching_version != p_expected_switching_version then
    return jsonb_build_object(
      'success', false,
      'code', 'STALE_VERSION',
      'message', 'Switching preferences version mismatch.',
      'currentSwitchingVersion', v_current_switching_version
    );
  end if;

  -- Mark old V2 mandate non-current.
  update household_coverage_mandates
  set is_current = false
  where household_id = p_household_id and is_current = true;

  -- Mark old switching preferences non-current.
  update switching_preferences
  set is_current = false
  where household_id = p_household_id and is_current = true;

  -- Insert new mandate version.
  insert into household_coverage_mandates (
    household_id, schema_version, version, jurisdiction, effective_from,
    household_auto_defaults, household_property_defaults, is_current, created_by, updated_by
  ) values (
    p_household_id, 2, v_current_mandate_version + 1, p_jurisdiction, p_effective_from,
    p_household_auto_defaults, p_household_property_defaults, true, v_user_id, v_user_id
  )
  returning id, version into v_new_mandate_id, v_new_mandate_version;

  -- Insert vehicle overrides.
  for v_override in select * from jsonb_array_elements(p_vehicle_overrides)
  loop
    v_vehicle_id := (v_override->>'vehicleId')::uuid;
    insert into vehicle_mandate_overrides (mandate_id, vehicle_id, override_values)
    values (
      v_new_mandate_id,
      v_vehicle_id,
      coalesce(v_override->'values', '{}'::jsonb)
    );
  end loop;

  -- Insert property overrides.
  for v_override in select * from jsonb_array_elements(p_property_overrides)
  loop
    v_property_id := (v_override->>'propertyId')::uuid;
    insert into property_mandate_overrides (mandate_id, property_id, override_values)
    values (
      v_new_mandate_id,
      v_property_id,
      coalesce(v_override->'values', '{}'::jsonb)
    );
  end loop;

  -- Insert new switching preferences version.
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
    v_user_id,
    v_user_id
  );

  return jsonb_build_object(
    'success', true,
    'mandateId', v_new_mandate_id,
    'mandateVersion', v_new_mandate_version,
    'switchingVersion', v_new_switching_version
  );
end;
$$;

-- =============================================================================
-- Idempotent backfill from legacy coverage_requirements / switching_preferences
-- =============================================================================

create or replace function backfill_coverage_mandate_v2()
returns void
language plpgsql
security definer
as $$
declare
  r record;
  v_mandate_id uuid;
  v_version int;
  v_auto jsonb;
  v_property jsonb;
  v_overrides jsonb;
  v_key text;
  v_vehicle_id uuid;
  v_property_id uuid;
begin
  for r in
    select cr.id as coverage_id,
           cr.household_id,
           cr.version,
           cr.auto_requirements,
           cr.property_requirements,
           cr.vehicle_mandates,
           cr.property_mandates,
           sp.version as switching_version
    from coverage_requirements cr
    left join switching_preferences sp
      on sp.household_id = cr.household_id and sp.is_current = true
    where cr.is_current = true
      and not exists (
        select 1 from household_coverage_mandates hcm
        where hcm.household_id = cr.household_id
      )
  loop
    -- Build V2 JSONB from the legacy coverage row. The legacy shape is expected
    -- to already be in the expanded rule/cents form from migration 20260716000002.
    v_auto := jsonb_build_object(
      'schemaVersion', 2,
      'jurisdiction', 'AB',
      'version', r.version,
      'effectiveFrom', now(),
      'householdAutoDefaults', r.auto_requirements,
      'householdPropertyDefaults', r.property_requirements,
      'vehicleOverrides', '[]'::jsonb,
      'propertyOverrides', '[]'::jsonb
    );

    insert into household_coverage_mandates (
      household_id, schema_version, version, jurisdiction, effective_from,
      household_auto_defaults, household_property_defaults, is_current
    ) values (
      r.household_id, 2, r.version, 'AB', now(),
      r.auto_requirements, r.property_requirements, true
    )
    returning id into v_mandate_id;

    for v_key in select jsonb_object_keys(r.vehicle_mandates)
    loop
      v_vehicle_id := v_key::uuid;
      insert into vehicle_mandate_overrides (mandate_id, vehicle_id, override_values)
      values (
        v_mandate_id,
        v_vehicle_id,
        coalesce(r.vehicle_mandates->v_key, '{}'::jsonb)
      );
    end loop;

    for v_key in select jsonb_object_keys(r.property_mandates)
    loop
      v_property_id := v_key::uuid;
      insert into property_mandate_overrides (mandate_id, property_id, override_values)
      values (
        v_mandate_id,
        v_property_id,
        coalesce(r.property_mandates->v_key, '{}'::jsonb)
      );
    end loop;
  end loop;
end;
$$;

-- Run the backfill only if the V2 table is empty to avoid repeated work on reset.
do $$
begin
  if not exists (select 1 from household_coverage_mandates limit 1) then
    perform backfill_coverage_mandate_v2();
  end if;
end $$;
