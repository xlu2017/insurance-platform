-- Corrective Phase 1D-C: atomic quote persistence, versioning, provenance, and validation invariants.

-- =============================================================================
-- 1. Data-source provenance
-- =============================================================================

create type quote_data_source as enum (
  'manual_entry',
  'insurer_document',
  'insurer_portal',
  'api',
  'customer_confirmed',
  'migration_unknown'
);

-- Backfill any unrecognised or null data sources before casting the column.
update quote_coverages
set data_source = 'migration_unknown'
where data_source is null
   or data_source not in ('manual_entry', 'insurer_document', 'insurer_portal', 'api', 'customer_confirmed', 'migration_unknown', 'seed');

-- Treat legacy seeded rows as explicitly entered demo data.
update quote_coverages
set data_source = 'manual_entry'
where data_source = 'seed';

alter table quote_coverages
  alter column data_source type quote_data_source using data_source::quote_data_source;

-- =============================================================================
-- 2. Quote aggregate versioning and raw/normalized coverage separation
-- =============================================================================

alter table quotes
  add column if not exists version int not null default 1;

alter table quote_coverages
  add column if not exists raw_coverage jsonb,
  add column if not exists normalized_coverage jsonb,
  add column if not exists field_provenance jsonb default '{}'::jsonb;

-- =============================================================================
-- 3. One active coverage row per component
-- =============================================================================

drop index if exists idx_quote_coverages_one_active;
create unique index idx_quote_coverages_one_active
  on quote_coverages (quote_component_id)
  where validation_status is distinct from 'superseded';

-- =============================================================================
-- 4. Reclassify legacy quote coverage rows before enforcing the valid-state constraint
-- =============================================================================

-- Rows promoted to valid by earlier migrations without trusted provenance must not
-- satisfy the valid-state constraint. Preserve the existing coverage JSON as the
-- raw operator input and downgrade them to incomplete with a structured issue.
update quote_coverages
set validation_status = 'incomplete',
    data_source = 'migration_unknown',
    raw_coverage = coverage,
    normalized_coverage = null,
    validation_errors = jsonb_build_array(
      jsonb_build_object(
        'path', '[]'::jsonb,
        'code', 'legacy_unverified',
        'message', 'This quote predates trusted validation and must be reviewed.'
      )
    ),
    validated_at = null,
    validated_by = null
where validation_status = 'valid'
  and (validated_by is null or data_source is null or data_source = 'migration_unknown');

-- =============================================================================
-- 5. Validation metadata invariants
-- =============================================================================

alter table quote_coverages
  drop constraint if exists quote_coverages_validation_status_metadata_check,
  add constraint quote_coverages_validation_status_metadata_check
    check (
      case validation_status
        when 'valid' then
          validated_at is not null
          and validated_by is not null
          and coverage_schema_version is not null
          and data_source is not null
          and validation_errors = '[]'::jsonb
          and normalized_coverage is not null
          and raw_coverage is not null
          and field_provenance is not null
        when 'incomplete' then
          validation_errors is not null and jsonb_array_length(validation_errors) > 0
        when 'invalid' then
          validation_errors is not null and jsonb_array_length(validation_errors) > 0
        when 'draft' then true
        when 'superseded' then true
      end
    );

-- =============================================================================
-- 5. Coverage-validation invalidation triggers
-- =============================================================================

create or replace function invalidate_quote_coverages_for_component()
returns trigger as $$
begin
  update quote_coverages
  set validation_status = 'draft',
      validated_at = null,
      validated_by = null
  where quote_component_id = new.id;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists quote_policy_components_invalidate_coverage on quote_policy_components;
create trigger quote_policy_components_invalidate_coverage
  after update on quote_policy_components
  for each row
  when (
    old.annual_premium_cents is distinct from new.annual_premium_cents
    or old.asset_id is distinct from new.asset_id
    or old.product_line is distinct from new.product_line
    or old.quote_id is distinct from new.quote_id
  )
  execute function invalidate_quote_coverages_for_component();

create or replace function invalidate_quote_coverages_for_quote()
returns trigger as $$
begin
  update quote_coverages qc
  set validation_status = 'draft',
      validated_at = null,
      validated_by = null
  from quote_policy_components qpc
  where qc.quote_component_id = qpc.id
    and qpc.quote_id = new.id;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists quotes_invalidate_coverage on quotes;
create trigger quotes_invalidate_coverage
  after update on quotes
  for each row
  when (
    old.insurer_id is distinct from new.insurer_id
    or old.state is distinct from new.state
    or old.policy_fees_cents is distinct from new.policy_fees_cents
    or old.payment_fees_cents is distinct from new.payment_fees_cents
    or old.bundle_discount_cents is distinct from new.bundle_discount_cents
    or old.cancellation_charge_cents is distinct from new.cancellation_charge_cents
    or old.expires_at is distinct from new.expires_at
    or old.underwriting_conditions is distinct from new.underwriting_conditions
  )
  execute function invalidate_quote_coverages_for_quote();

-- =============================================================================
-- 6. Revoke direct authenticated writes to quote-composition tables
-- =============================================================================

drop policy if exists quotes_insert on quotes;
drop policy if exists quotes_update on quotes;
drop policy if exists quote_components_insert on quote_policy_components;
drop policy if exists quote_components_update on quote_policy_components;
drop policy if exists quote_components_delete on quote_policy_components;
drop policy if exists quote_coverages_insert on quote_coverages;
drop policy if exists quote_coverages_update on quote_coverages;
drop policy if exists quote_coverages_delete on quote_coverages;

-- Explicitly revoke direct authenticated DML on quote-composition tables.
-- The public Edge Function is the only authenticated write path.
revoke insert, update, delete on quotes from anon, authenticated;
revoke insert, update, delete on quote_policy_components from anon, authenticated;
revoke insert, update, delete on quote_coverages from anon, authenticated;

-- Retain select access for authenticated users.

-- =============================================================================
-- 7. Atomic quote persistence RPC (service_role only)
-- =============================================================================

create or replace function persist_case_quote_v2(
  p_case_id uuid,
  p_actor_profile_id uuid,
  p_insurer_id uuid,
  p_state quote_state,
  p_is_incumbent boolean,
  p_data_source quote_data_source,
  p_components jsonb,
  p_quote_id uuid default null,
  p_expected_version int default null,
  p_expires_at timestamptz default null,
  p_policy_fees_cents bigint default 0,
  p_payment_fees_cents bigint default 0,
  p_bundle_discount_cents bigint default 0,
  p_cancellation_charge_cents bigint default 0,
  p_underwriting_conditions text[] default '{}'
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller_role text;
  v_actor_role user_role;
  v_case record;
  v_quote_id uuid;
  v_version int;
  v_component jsonb;
  v_component_id uuid;
  v_component_uuid uuid;
  v_product_line text;
  v_asset_id uuid;
  v_premium bigint;
  v_raw_coverage jsonb;
  v_normalized_coverage jsonb;
  v_validation_status quote_validation_status;
  v_validation_errors jsonb;
  v_schema_version int;
  v_field_provenance jsonb;
  v_field_key text;
  v_asset_exists boolean;
  v_existing_component_ids uuid[];
  v_payload_component_ids uuid[];
  v_result_components jsonb := '[]'::jsonb;
  v_coverage_id uuid;
  v_result jsonb;
begin
  v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  if v_caller_role is not null and v_caller_role <> 'service_role' then
    raise exception 'Only service_role may call persist_case_quote_v2';
  end if;

  select role into v_actor_role from profiles where id = p_actor_profile_id;
  if v_actor_role is null or v_actor_role not in ('operations', 'admin') then
    raise exception 'actor must be operations or admin';
  end if;

  select * into v_case from optimization_cases where id = p_case_id;
  if not found then
    raise exception 'case not found';
  end if;

  if not can_access_case_for_profile(p_case_id, p_actor_profile_id) then
    raise exception 'actor cannot access case';
  end if;

  if not exists (select 1 from insurers where id = p_insurer_id) then
    raise exception 'insurer not found';
  end if;

  if p_components is null or jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then
    raise exception 'components must be a non-empty array';
  end if;

  -- Reject duplicate component identities.
  if exists (
    select 1
    from (
      select value->>'component_id' as cid
      from jsonb_array_elements(p_components)
      where value->>'component_id' is not null
    ) sub
    group by cid
    having count(*) > 1
  ) then
    raise exception 'duplicate component_id in components payload';
  end if;

  if exists (
    select 1
    from (
      select value->>'product_line' as pl, nullif(value->>'asset_id', '')::uuid as aid
      from jsonb_array_elements(p_components)
    ) sub
    group by pl, aid
    having count(*) > 1
  ) then
    raise exception 'duplicate product_line and asset_id in components payload';
  end if;

  -- Prevent service role from trusting a stale public request.
  if p_quote_id is not null then
    select id, version into v_quote_id, v_version
    from quotes
    where id = p_quote_id and case_id = p_case_id
    for update;
    if not found then
      raise exception 'quote % not found for case %', p_quote_id, p_case_id;
    end if;
    if v_version is distinct from p_expected_version then
      raise exception 'stale quote version: expected %, current %', p_expected_version, v_version;
    end if;

    update quotes
    set insurer_id = p_insurer_id,
        state = p_state,
        is_incumbent = p_is_incumbent,
        expires_at = p_expires_at,
        policy_fees_cents = p_policy_fees_cents,
        payment_fees_cents = p_payment_fees_cents,
        bundle_discount_cents = p_bundle_discount_cents,
        cancellation_charge_cents = p_cancellation_charge_cents,
        underwriting_conditions = p_underwriting_conditions,
        version = v_version + 1,
        updated_at = now(),
        updated_by = p_actor_profile_id
    where id = v_quote_id;
    v_version := v_version + 1;
  else
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'new quote expected version must be null or zero';
    end if;
    v_quote_id := gen_random_uuid();
    v_version := 1;
    insert into quotes (
      id, case_id, insurer_id, state, is_incumbent, expires_at,
      policy_fees_cents, payment_fees_cents, bundle_discount_cents, cancellation_charge_cents,
      underwriting_conditions, version, created_by, updated_by
    ) values (
      v_quote_id, p_case_id, p_insurer_id, p_state, p_is_incumbent, p_expires_at,
      p_policy_fees_cents, p_payment_fees_cents, p_bundle_discount_cents, p_cancellation_charge_cents,
      p_underwriting_conditions, v_version, p_actor_profile_id, p_actor_profile_id
    );
  end if;

  -- Lock all existing components to detect stale component IDs and delete missing ones.
  select array_agg(id) into v_existing_component_ids
  from quote_policy_components
  where quote_id = v_quote_id;

  -- Track provided component IDs for cleanup.
  select array_agg(cid)
  into v_payload_component_ids
  from (
    select nullif(value->>'component_id', '')::uuid as cid
    from jsonb_array_elements(p_components)
    where value->>'component_id' is not null
  ) sub;

  for v_component in select * from jsonb_array_elements(p_components) loop
    v_component_uuid := nullif(v_component->>'component_id', '')::uuid;
    v_product_line := v_component->>'product_line';
    v_asset_id := nullif(v_component->>'asset_id', '')::uuid;
    v_premium := (v_component->>'annual_premium_cents')::bigint;
    v_raw_coverage := nullif(v_component->'raw_coverage', 'null'::jsonb);
    v_normalized_coverage := nullif(v_component->'normalized_coverage', 'null'::jsonb);
    v_validation_status := v_component->>'validation_status';
    v_validation_errors := coalesce(nullif(v_component->'validation_errors', 'null'::jsonb), '[]'::jsonb);
    v_schema_version := coalesce((v_component->>'coverage_schema_version')::int, 2);

    v_field_provenance := '{}'::jsonb;
    for v_field_key in select jsonb_object_keys(v_raw_coverage)
    loop
      v_field_provenance := v_field_provenance || jsonb_build_object(
        v_field_key,
        jsonb_build_object(
          'dataSource', p_data_source,
          'validatedAt', case when v_validation_status = 'valid' then to_jsonb(now())#>>'{}' else null end,
          'validatedBy', case when v_validation_status = 'valid' then p_actor_profile_id::text else null end,
          'coverageSchemaVersion', v_schema_version
        )
      );
    end loop;

    if v_product_line not in ('auto', 'property') then
      raise exception 'invalid product line: %', v_product_line;
    end if;
    if v_asset_id is null then
      raise exception 'asset_id is required for every component';
    end if;
    if v_premium is null or v_premium < 0 then
      raise exception 'annual_premium_cents must be a non-negative integer';
    end if;
    if v_raw_coverage is null or v_raw_coverage = '{}'::jsonb then
      raise exception 'raw_coverage is required for every component';
    end if;
    if v_validation_status = 'valid' and (v_normalized_coverage is null or v_normalized_coverage = '{}'::jsonb) then
      raise exception 'valid components must include normalized coverage';
    end if;
    if v_validation_status not in ('draft', 'incomplete', 'invalid', 'valid') then
      raise exception 'invalid validation_status: %', v_validation_status;
    end if;
    if v_validation_status in ('incomplete', 'invalid') and jsonb_array_length(v_validation_errors) = 0 then
      raise exception 'incomplete/invalid components must have structured validation errors';
    end if;

    -- Verify the asset belongs to the case household and matches the product line.
    if v_product_line = 'auto' then
      select exists(select 1 from vehicles where id = v_asset_id and household_id = v_case.household_id)
      into v_asset_exists;
    else
      select exists(select 1 from properties where id = v_asset_id and household_id = v_case.household_id)
      into v_asset_exists;
    end if;
    if not v_asset_exists then
      raise exception 'asset % does not belong to case household or wrong product line', v_asset_id;
    end if;

    if v_component_uuid is not null then
      select id into v_component_id
      from quote_policy_components
      where id = v_component_uuid and quote_id = v_quote_id
      for update;
      if not found then
        raise exception 'component % does not belong to quote %', v_component_uuid, v_quote_id;
      end if;
      update quote_policy_components
      set product_line = v_product_line::product_line,
          asset_id = v_asset_id,
          annual_premium_cents = v_premium,
          updated_at = now()
      where id = v_component_id;
    else
      v_component_id := gen_random_uuid();
      insert into quote_policy_components (id, quote_id, product_line, asset_id, annual_premium_cents)
      values (v_component_id, v_quote_id, v_product_line::product_line, v_asset_id, v_premium);
    end if;

    -- Upsert coverage payload. The quote_coverages_coverage_changed trigger will reset validation to draft.
    insert into quote_coverages (quote_component_id, coverage, raw_coverage, normalized_coverage)
    values (v_component_id, v_raw_coverage, v_raw_coverage, v_normalized_coverage)
    on conflict (quote_component_id) where validation_status is distinct from 'superseded' do update
    set coverage = nullif(excluded.coverage, 'null'::jsonb),
        raw_coverage = nullif(excluded.raw_coverage, 'null'::jsonb),
        normalized_coverage = nullif(excluded.normalized_coverage, 'null'::jsonb),
        updated_at = now();

    -- Now record the classification, provenance and validator. This second update does not touch coverage,
    -- so the coverage-changed trigger does not overwrite the classification.
    update quote_coverages
    set validation_status = v_validation_status::quote_validation_status,
        validation_errors = v_validation_errors,
        validated_at = case when v_validation_status = 'valid' then now() else null end,
        validated_by = case when v_validation_status = 'valid' then p_actor_profile_id else null end,
        coverage_schema_version = v_schema_version,
        data_source = p_data_source,
        field_provenance = v_field_provenance
    where quote_component_id = v_component_id
    returning id into v_coverage_id;

    v_result_components := v_result_components || jsonb_build_object(
      'id', v_component_id,
      'product_line', v_product_line,
      'asset_id', v_asset_id,
      'annual_premium_cents', v_premium,
      'coverage_id', v_coverage_id,
      'validation_status', v_validation_status
    );
  end loop;

  -- Supersede/delete components not present in the payload.
  if v_existing_component_ids is not null and v_payload_component_ids is not null then
    for v_component_id in
      select unnest(v_existing_component_ids)
      except
      select unnest(v_payload_component_ids)
    loop
      delete from quote_coverages where quote_component_id = v_component_id;
      delete from quote_policy_components where id = v_component_id;
    end loop;
  elsif v_existing_component_ids is not null then
    for v_component_id in select unnest(v_existing_component_ids) loop
      delete from quote_coverages where quote_component_id = v_component_id;
      delete from quote_policy_components where id = v_component_id;
    end loop;
  end if;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    p_actor_profile_id,
    v_actor_role,
    'quote_saved',
    'quote',
    v_quote_id,
    v_case.household_id,
    p_case_id,
    jsonb_build_object(
      'version', v_version,
      'insurer_id', p_insurer_id,
      'state', p_state,
      'is_incumbent', p_is_incumbent,
      'data_source', p_data_source,
      'component_count', jsonb_array_length(p_components),
      'validation_statuses', coalesce(
        (select jsonb_agg(validation_status order by validation_status)
         from quote_coverages
         where quote_component_id in (select id from quote_policy_components where quote_id = v_quote_id)),
        '[]'::jsonb
      )
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'quoteId', v_quote_id,
    'version', v_version,
    'components', v_result_components
  );

  return v_result;
end;
$$;

revoke all on function persist_case_quote_v2 from public;
revoke all on function persist_case_quote_v2 from anon;
revoke all on function persist_case_quote_v2 from authenticated;
grant execute on function persist_case_quote_v2 to service_role;

-- Replace the coverage-changed validation reset to watch the raw operator input
-- (and the legacy coverage column for backward compatibility). It only resets
-- when raw coverage changes and a new normalized value has not been supplied,
-- which lets the validated quote boundary supply both in one write cycle without
-- losing the normalized engine input.
create or replace function reset_quote_coverage_validation()
returns trigger as $$
begin
  if (
    new.raw_coverage is not null
    and old.raw_coverage is distinct from new.raw_coverage
    and new.normalized_coverage is null
  ) or (
    new.coverage is not null
    and old.coverage is distinct from new.coverage
    and new.normalized_coverage is null
  ) then
    new.validation_status := 'draft';
    new.validated_at := null;
    new.validated_by := null;
    new.normalized_coverage := null;
  end if;
  return new;
end;
$$ language plpgsql;
