-- Phase 1E-C: atomic candidate approval RPC.

-- ---------------------------------------------------------------------------
-- 1. Approval idempotency ledger
-- ---------------------------------------------------------------------------

create table if not exists candidate_approvals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  actor_profile_id uuid references profiles(id),
  client_request_id text unique not null,
  status text not null default 'completed' check (status in ('completed','failed')),
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_candidate_approvals_household on candidate_approvals (household_id);

alter table candidate_approvals enable row level security;

create policy candidate_approvals_select on candidate_approvals
  for select using (can_access_household(household_id));

grant select on candidate_approvals to authenticated;
grant select, insert, update, delete on candidate_approvals to service_role;

-- ---------------------------------------------------------------------------
-- 2. Atomic approval RPC
-- ---------------------------------------------------------------------------

create or replace function approve_candidate_assets_v1(
  p_household_id uuid,
  p_actor_profile_id uuid,
  p_client_request_id text,
  p_candidate_ids uuid[],
  p_jurisdiction text default 'AB',
  p_household_auto_defaults jsonb default '{}'::jsonb,
  p_household_property_defaults jsonb default '{}'::jsonb,
  p_switching_preferences jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller_role text;
  v_existing record;
  v_candidate record;
  v_review record;
  v_facts jsonb;
  v_identity jsonb;
  v_current_policy jsonb;
  v_current_coverage jsonb;
  v_mandate_suggestions jsonb;
  v_field_value jsonb;
  v_final_value jsonb;
  v_mandate_rule jsonb;
  v_coverage_key text;
  v_vehicle_id uuid;
  v_property_id uuid;
  v_policy_id uuid;
  v_extracted_id uuid;
  v_extracted record;
  v_policy_doc record;
  v_vehicle_overrides jsonb := '[]'::jsonb;
  v_property_overrides jsonb := '[]'::jsonb;
  v_created_vehicles uuid[] := '{}'::uuid[];
  v_created_properties uuid[] := '{}'::uuid[];
  v_created_policies uuid[] := '{}'::uuid[];
  v_mandate_result jsonb;
  v_result jsonb;
  v_year int;
  v_make text;
  v_model text;
  v_vin text;
  v_address_line1 text;
  v_city text;
  v_province text;
  v_postal_code text;
  v_year_built int;
  v_insurer_name text;
  v_policy_number text;
  v_effective_date date;
  v_expiry_date date;
  v_annual_premium bigint;
  v_current_mandate_version int;
  v_current_switching_version int;
  v_product_line product_line;
begin
  v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  if v_caller_role is null or v_caller_role <> 'service_role' then
    raise exception 'Only service_role may call approve_candidate_assets_v1';
  end if;

  select id, result_json into v_existing
  from candidate_approvals
  where client_request_id = p_client_request_id;
  if found then
    return v_existing.result_json;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_client_request_id, 0));

  -- Lock and validate all candidates belong to the household.
  for v_candidate in
    select *
    from asset_candidates
    where id = any(p_candidate_ids)
      and household_id = p_household_id
    order by id
    for update
  loop
    if not (v_candidate.review_status in ('pending','reviewing')
            and v_candidate.decision in ('undecided','not_sure')) then
      raise exception 'candidate % is not available for approval', v_candidate.id;
    end if;
  end loop;

  -- Apply customer field reviews to selected facts, then create assets.
  for v_candidate in
    select *
    from asset_candidates
    where id = any(p_candidate_ids)
      and household_id = p_household_id
    order by id
  loop
    v_facts := v_candidate.selected_facts_json;
    v_identity := coalesce(v_facts->'identity', '{}'::jsonb);
    v_current_policy := coalesce(v_facts->'currentPolicy', '{}'::jsonb);
    v_current_coverage := coalesce(v_facts->'currentCoverage', '{}'::jsonb);
    v_mandate_suggestions := coalesce(v_facts->'mandateSuggestions', '{}'::jsonb);

    -- Merge candidate_field_reviews into current coverage and mandate suggestions.
    for v_review in
      select *
      from candidate_field_reviews
      where candidate_id = v_candidate.id
      order by field_path
    loop
      if v_review.field_path like 'currentCoverage.%' then
        v_coverage_key := split_part(v_review.field_path, '.', 2);
        v_field_value := v_current_coverage->v_coverage_key;

        if v_review.action = 'unknown' then
          v_current_coverage := v_current_coverage - v_coverage_key;
        elsif v_review.action = 'correct' and v_review.corrected_value is not null then
          if jsonb_typeof(v_field_value) = 'object' then
            v_current_coverage := jsonb_set(
              v_current_coverage,
              array[v_coverage_key, 'value'],
              to_jsonb(v_review.corrected_value)
            );
          else
            v_current_coverage := jsonb_set(
              v_current_coverage,
              array[v_coverage_key],
              to_jsonb(v_review.corrected_value)
            );
          end if;
        end if;

        if v_review.action in ('change_mandate','reset_mandate_to_current')
           and v_review.mandate_rule_json is not null then
          v_mandate_suggestions := jsonb_set(
            v_mandate_suggestions,
            array[v_coverage_key],
            v_review.mandate_rule_json
          );
        elsif v_review.action = 'confirm'
               and v_mandate_suggestions->v_coverage_key is null
               and jsonb_typeof(v_field_value) = 'object'
               and (v_field_value->>'value') is not null then
          -- Derive a sensible default mandate from the confirmed current value.
          v_mandate_suggestions := jsonb_set(
            v_mandate_suggestions,
            array[v_coverage_key],
            jsonb_build_object('rule', 'minimum', 'amountCents', (v_field_value->>'value')::bigint)
          );
        end if;
      elsif v_review.field_path like 'identity.%'
            or v_review.field_path like 'currentPolicy.%' then
        if v_review.action = 'correct'
           and v_review.corrected_value is not null then
          v_facts := jsonb_set(
            v_facts,
            string_to_array(v_review.field_path, '.'),
            to_jsonb(v_review.corrected_value)
          );
        end if;
      end if;
    end loop;

    v_identity := v_facts->'identity';
    v_current_policy := v_facts->'currentPolicy';

    v_product_line := case v_candidate.asset_type
      when 'vehicle' then 'auto'::product_line
      when 'property' then 'property'::product_line
    end;

    -- Create or update the insured asset.
    if v_candidate.asset_type = 'vehicle' then
      v_year := coalesce((v_identity->>'year')::int, 0);
      v_make := coalesce(v_identity->>'make', '');
      v_model := coalesce(v_identity->>'model', '');
      v_vin := upper(coalesce(v_identity->>'vin', ''));

      select id into v_vehicle_id
      from vehicles
      where household_id = p_household_id
        and lower(trim(vin)) = lower(trim(v_vin))
      limit 1;

      if v_vehicle_id is null then
        insert into vehicles (
          household_id, year, make, model, vin, primary_use,
          created_by, updated_by
        ) values (
          p_household_id, v_year, v_make, v_model, v_vin, 'commute',
          p_actor_profile_id, p_actor_profile_id
        ) returning id into v_vehicle_id;
      else
        update vehicles
        set year = v_year,
            make = v_make,
            model = v_model,
            updated_by = p_actor_profile_id,
            updated_at = now()
        where id = v_vehicle_id;
      end if;
      v_created_vehicles := v_created_vehicles || v_vehicle_id;

      -- Build the vehicle mandate override from reviewed mandate suggestions.
      v_vehicle_overrides := v_vehicle_overrides || jsonb_build_object(
        'vehicleId', v_vehicle_id::text,
        'values', v_mandate_suggestions
      );

    elsif v_candidate.asset_type = 'property' then
      v_address_line1 := coalesce(v_identity->>'fullAddress', '');
      v_city := coalesce(v_identity->>'city', '');
      v_province := coalesce(v_identity->>'province', 'AB');
      v_postal_code := coalesce(v_identity->>'postalCode', '');
      v_year_built := nullif(v_identity->>'yearBuilt', '')::int;

      select id into v_property_id
      from properties
      where household_id = p_household_id
        and lower(address_line1) = lower(v_address_line1)
        and lower(postal_code) = lower(v_postal_code)
      limit 1;

      if v_property_id is null then
        insert into properties (
          household_id, address_line1, city, province, postal_code, year_built,
          dwelling_type, owner_occupied, created_by, updated_by
        ) values (
          p_household_id, v_address_line1, v_city, v_province, v_postal_code, v_year_built,
          'detached', true, p_actor_profile_id, p_actor_profile_id
        ) returning id into v_property_id;
      else
        update properties
        set city = v_city,
            province = v_province,
            postal_code = v_postal_code,
            year_built = v_year_built,
            updated_by = p_actor_profile_id,
            updated_at = now()
        where id = v_property_id;
      end if;
      v_created_properties := v_created_properties || v_property_id;

      v_property_overrides := v_property_overrides || jsonb_build_object(
        'propertyId', v_property_id::text,
        'values', v_mandate_suggestions
      );
    end if;

    -- Create policies from each source extracted document.
    for v_extracted_id in select unnest(v_candidate.source_document_ids) loop
      select * into v_extracted
      from extracted_documents
      where id = v_extracted_id and household_id = p_household_id;

      if found then
        select * into v_policy_doc
        from policy_documents
        where id = v_extracted.policy_document_id;

        if found then
          v_insurer_name := coalesce(v_current_policy->>'insurerName', v_policy_doc.file_name, 'Unknown');
          v_policy_number := coalesce(v_current_policy->>'policyNumber', '');
          v_effective_date := nullif(v_current_policy->>'effectiveDate', '')::date;
          v_expiry_date := nullif(v_current_policy->>'expiryDate', '')::date;
          v_annual_premium := coalesce((v_current_policy->>'annualPremiumCents')::bigint, 0);

          insert into policies (
            household_id, insurer_id, insurer_name, product_line, policy_number,
            annual_premium_cents, renewal_date, coverage_details, is_current,
            created_by, updated_by
          ) values (
            p_household_id, null, v_insurer_name, v_product_line,
            v_policy_number, v_annual_premium, v_expiry_date, v_current_coverage, true,
            p_actor_profile_id, p_actor_profile_id
          ) returning id into v_policy_id;

          update policy_documents
          set policy_id = v_policy_id
          where id = v_policy_doc.id;

          v_created_policies := v_created_policies || v_policy_id;
        end if;
      end if;
    end loop;

    -- Mark candidate approved.
    update asset_candidates
    set decision = 'approved',
        review_status = 'approved',
        updated_at = now()
    where id = v_candidate.id;
  end loop;

  -- Build a new mandate version that includes the approved asset overrides.
  select coalesce(max(version), 0) into v_current_mandate_version
  from household_coverage_mandates
  where household_id = p_household_id and is_current = true;

  select coalesce(max(version), 0) into v_current_switching_version
  from switching_preferences
  where household_id = p_household_id and is_current = true;

  select persist_household_mandate_v2(
    p_household_id,
    v_current_mandate_version,
    v_current_switching_version,
    p_household_auto_defaults,
    p_household_property_defaults,
    v_vehicle_overrides,
    v_property_overrides,
    p_switching_preferences,
    p_jurisdiction,
    p_actor_profile_id
  ) into v_mandate_result;

  v_result := jsonb_build_object(
    'success', true,
    'vehicles', v_created_vehicles,
    'properties', v_created_properties,
    'policies', v_created_policies,
    'mandate', v_mandate_result
  );

  insert into candidate_approvals (
    household_id, actor_profile_id, client_request_id, status, result_json
  ) values (
    p_household_id, p_actor_profile_id, p_client_request_id, 'completed', v_result
  );

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------

grant execute on function approve_candidate_assets_v1 to service_role;
