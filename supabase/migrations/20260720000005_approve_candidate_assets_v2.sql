-- Phase 1F-A: trusted manual candidate approval.
-- Supports approve_new, link_existing, skip and needs_correction decisions with
-- idempotency, household validation and atomic asset/mandate persistence.
begin;

-- Allow candidates to be marked as needing customer correction.
alter type candidate_decision add value if not exists 'needs_correction';

-- Allow review_status to reflect a candidate sent back for correction.
alter table asset_candidates
  drop constraint if exists asset_candidates_review_status_check;
alter table asset_candidates
  add constraint asset_candidates_review_status_check
  check (review_status in ('pending','reviewing','confirmed','skipped','approved','needs_correction'));

-- Allow field reviews to explicitly record not-applicable coverage facts.
alter type candidate_field_review_action add value if not exists 'not_applicable';

-- Link approved candidates to the assets and policies they produced.
alter table asset_candidates
  add column if not exists approved_asset_id uuid,
  add column if not exists approved_asset_type candidate_asset_type,
  add column if not exists approved_policy_id uuid references policies(id);

create or replace function approve_candidate_assets_v2(
  p_household_id uuid,
  p_actor_profile_id uuid,
  p_client_request_id text,
  p_decisions jsonb,
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
  v_decision jsonb;
  v_candidate_id uuid;
  v_candidate_ids uuid[] := '{}'::uuid[];
  v_candidate record;
  v_facts jsonb;
  v_identity jsonb;
  v_current_policy jsonb;
  v_current_coverage jsonb;
  v_mandate_suggestions jsonb;
  v_review record;
  v_coverage_key text;
  v_field_value jsonb;
  v_decision_text text;
  v_existing_asset_id uuid;
  v_existing_asset_type text;
  v_identity_confirmed boolean;
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
  v_vehicle_id uuid;
  v_property_id uuid;
  v_policy_id uuid;
  v_source_id uuid;
  v_extracted record;
  v_policy_doc record;
  v_source_policy_document_id uuid;
  v_vehicle_overrides jsonb := '[]'::jsonb;
  v_property_overrides jsonb := '[]'::jsonb;
  v_created_vehicles uuid[] := '{}'::uuid[];
  v_created_properties uuid[] := '{}'::uuid[];
  v_created_policies uuid[] := '{}'::uuid[];
  v_skipped_ids uuid[] := '{}'::uuid[];
  v_linked_ids uuid[] := '{}'::uuid[];
  v_correction_ids uuid[] := '{}'::uuid[];
  v_current_mandate_version int;
  v_current_switching_version int;
  v_mandate_result jsonb;
  v_result jsonb;
  v_original_jwt text;
begin
  -- Caller must be a household member or service_role acting on its behalf.
  v_caller_role := coalesce(auth.role(), current_setting('request.jwt.claims', true)::jsonb->>'role');
  if v_caller_role is null or (v_caller_role <> 'service_role' and not is_household_member(p_household_id)) then
    raise exception 'only a household member or service_role may approve candidates' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
    raise exception 'decisions must be a non-empty array' using errcode = 'P0001';
  end if;

  -- Idempotency: acquire the advisory lock first, then re-check the ledger.
  -- This prevents concurrent requests with the same client_request_id from
  -- both proceeding past the initial check.
  perform pg_advisory_xact_lock(hashtextextended(p_client_request_id, 0));

  select id, result_json into v_existing
  from candidate_approvals
  where client_request_id = p_client_request_id;
  if found then
    return v_existing.result_json;
  end if;

  -- Collect and validate candidate ids and decisions.
  for v_decision in select jsonb_array_elements(p_decisions)
  loop
    v_candidate_id := (v_decision->>'candidate_id')::uuid;
    if v_candidate_id is null then
      raise exception 'each decision must include a candidate_id' using errcode = 'P0001';
    end if;

    if v_candidate_id = any(v_candidate_ids) then
      raise exception 'duplicate candidate_id in decisions: %', v_candidate_id using errcode = 'P0001';
    end if;
    v_candidate_ids := v_candidate_ids || v_candidate_id;

    v_decision_text := lower(coalesce(v_decision->>'decision', ''));
    if v_decision_text not in ('approve_new', 'approve_new_asset', 'link_existing', 'link_existing_asset', 'skip', 'needs_correction') then
      raise exception 'invalid decision % for candidate %', v_decision_text, v_candidate_id using errcode = 'P0001';
    end if;

    if v_decision_text in ('link_existing', 'link_existing_asset') then
      v_existing_asset_id := (v_decision->>'existing_asset_id')::uuid;
      v_existing_asset_type := lower(coalesce(v_decision->>'existing_asset_type', ''));
      if v_existing_asset_id is null or v_existing_asset_type is null then
        raise exception 'link_existing decision requires existing_asset_id and existing_asset_type' using errcode = 'P0001';
      end if;
      if v_existing_asset_type not in ('vehicle', 'property') then
        raise exception 'existing_asset_type must be vehicle or property' using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- Lock all candidates and verify they belong to the household and are pending.
  for v_candidate in
    select *
    from asset_candidates
    where id = any(v_candidate_ids)
      and household_id = p_household_id
    order by id
    for update
  loop
    if v_candidate.review_status not in ('pending', 'reviewing') then
      raise exception 'candidate % is not available for approval (status %)', v_candidate.id, v_candidate.review_status using errcode = 'P0001';
    end if;
  end loop;

  -- Ensure every requested candidate exists in this household.
  if (select count(*) from asset_candidates where id = any(v_candidate_ids) and household_id = p_household_id) <> array_length(v_candidate_ids, 1) then
    raise exception 'one or more candidates do not belong to the household' using errcode = 'P0001';
  end if;

  -- Process each decision.
  for v_decision in select jsonb_array_elements(p_decisions)
  loop
    v_candidate_id := (v_decision->>'candidate_id')::uuid;
    v_decision_text := lower(coalesce(v_decision->>'decision', ''));
    v_identity_confirmed := coalesce((v_decision->>'identity_confirmed')::boolean, false);

    select * into v_candidate
    from asset_candidates
    where id = v_candidate_id and household_id = p_household_id;

    if v_candidate.match_classification = 'new_identity_confirmation_required'
       and v_decision_text in ('approve_new', 'approve_new_asset')
       and not v_identity_confirmed then
      raise exception 'identity must be confirmed before approving candidate %', v_candidate_id using errcode = 'P0001';
    end if;

    v_facts := coalesce(v_candidate.selected_facts_json, '{}'::jsonb);
    v_identity := coalesce(v_facts->'identity', '{}'::jsonb);
    v_current_policy := coalesce(v_facts->'currentPolicy', '{}'::jsonb);
    v_current_coverage := coalesce(v_facts->'currentCoverage', '{}'::jsonb);
    v_mandate_suggestions := coalesce(v_facts->'mandateSuggestions', '{}'::jsonb);

    -- Merge candidate_field_reviews into current coverage, identity and mandate suggestions.
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
        elsif v_review.action = 'not_applicable' then
          v_current_coverage := jsonb_set(
            v_current_coverage,
            array[v_coverage_key],
            jsonb_build_object('status', 'not_applicable')
          );
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
          v_mandate_suggestions := jsonb_set(
            v_mandate_suggestions,
            array[v_coverage_key],
            jsonb_build_object('rule', 'minimum', 'amountCents', (v_field_value->>'value')::bigint)
          );
        end if;
      elsif v_review.field_path like 'identity.%' or v_review.field_path like 'currentPolicy.%' then
        if v_review.action = 'correct' and v_review.corrected_value is not null then
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

    if v_decision_text in ('skip', 'needs_correction') then
      update asset_candidates
      set decision = (case when v_decision_text = 'skip' then 'skip' else 'needs_correction' end)::candidate_decision,
          review_status = case when v_decision_text = 'skip' then 'skipped' else 'needs_correction' end,
          updated_at = now()
      where id = v_candidate.id;

      if v_decision_text = 'skip' then
        v_skipped_ids := v_skipped_ids || v_candidate.id;
      else
        v_correction_ids := v_correction_ids || v_candidate.id;
      end if;
      continue;
    end if;

    if v_decision_text in ('link_existing', 'link_existing_asset') then
      v_existing_asset_id := (v_decision->>'existing_asset_id')::uuid;
      v_existing_asset_type := lower(coalesce(v_decision->>'existing_asset_type', ''));

      if v_existing_asset_type = 'vehicle' then
        if not exists (select 1 from vehicles where id = v_existing_asset_id and household_id = p_household_id) then
          raise exception 'existing vehicle % does not belong to household', v_existing_asset_id using errcode = 'P0001';
        end if;
      elsif v_existing_asset_type = 'property' then
        if not exists (select 1 from properties where id = v_existing_asset_id and household_id = p_household_id) then
          raise exception 'existing property % does not belong to household', v_existing_asset_id using errcode = 'P0001';
        end if;
      end if;

      update asset_candidates
      set decision = 'link_existing',
          review_status = 'approved',
          approved_asset_id = v_existing_asset_id,
          approved_asset_type = v_existing_asset_type::candidate_asset_type,
          updated_at = now()
      where id = v_candidate.id;

      v_linked_ids := v_linked_ids || v_candidate.id;

      -- Use the linked asset's id for mandate overrides.
      if v_existing_asset_type = 'vehicle' then
        v_vehicle_overrides := v_vehicle_overrides || jsonb_build_object('vehicleId', v_existing_asset_id::text, 'values', v_mandate_suggestions);
      elsif v_existing_asset_type = 'property' then
        v_property_overrides := v_property_overrides || jsonb_build_object('propertyId', v_existing_asset_id::text, 'values', v_mandate_suggestions);
      end if;

      continue;
    end if;

    -- approve_new or approve_new_asset
    if v_candidate.asset_type = 'vehicle' then
      v_year := coalesce((v_identity->>'year')::int, 0);
      v_make := coalesce(v_identity->>'make', '');
      v_model := coalesce(v_identity->>'model', '');
      v_vin := upper(coalesce(v_identity->>'vin', ''));

      insert into vehicles (
        household_id, year, make, model, vin, primary_use,
        created_by, updated_by
      ) values (
        p_household_id, v_year, v_make, v_model, nullif(v_vin, ''), 'commute',
        p_actor_profile_id, p_actor_profile_id
      ) returning id into v_vehicle_id;

      v_created_vehicles := v_created_vehicles || v_vehicle_id;

      v_vehicle_overrides := v_vehicle_overrides || jsonb_build_object('vehicleId', v_vehicle_id::text, 'values', v_mandate_suggestions);

      update asset_candidates
      set decision = 'approve_new',
          review_status = 'approved',
          approved_asset_id = v_vehicle_id,
          approved_asset_type = 'vehicle'::candidate_asset_type,
          updated_at = now()
      where id = v_candidate.id;

    elsif v_candidate.asset_type = 'property' then
      v_address_line1 := coalesce(v_identity->>'fullAddress', '');
      v_city := coalesce(v_identity->>'city', '');
      v_province := coalesce(v_identity->>'province', 'AB');
      v_postal_code := coalesce(v_identity->>'postalCode', '');
      v_year_built := nullif(v_identity->>'yearBuilt', '')::int;

      insert into properties (
        household_id, address_line1, city, province, postal_code, year_built,
        dwelling_type, owner_occupied, created_by, updated_by
      ) values (
        p_household_id, v_address_line1, v_city, v_province, v_postal_code, v_year_built,
        'detached', true, p_actor_profile_id, p_actor_profile_id
      ) returning id into v_property_id;

      v_created_properties := v_created_properties || v_property_id;

      v_property_overrides := v_property_overrides || jsonb_build_object('propertyId', v_property_id::text, 'values', v_mandate_suggestions);

      update asset_candidates
      set decision = 'approve_new',
          review_status = 'approved',
          approved_asset_id = v_property_id,
          approved_asset_type = 'property'::candidate_asset_type,
          updated_at = now()
      where id = v_candidate.id;
    end if;

    -- Create a policy record from the current policy facts and each source document.
    v_insurer_name := coalesce(v_current_policy->>'insurerName', 'Unknown');
    v_policy_number := coalesce(v_current_policy->>'policyNumber', '');
    v_effective_date := nullif(v_current_policy->>'effectiveDate', '')::date;
    v_expiry_date := nullif(v_current_policy->>'expiryDate', '')::date;
    v_annual_premium := coalesce((v_current_policy->>'annualPremiumCents')::bigint, 0);

    foreach v_source_id in array coalesce(v_candidate.source_document_ids, '{}'::uuid[])
    loop
      -- Manual reviews store policy_document ids directly; LLM extraction stores
      -- extracted_document ids. Resolve the underlying policy_document id.
      select * into v_extracted
      from extracted_documents
      where id = v_source_id and household_id = p_household_id;

      if found then
        v_source_policy_document_id := v_extracted.policy_document_id;
      else
        v_source_policy_document_id := v_source_id;
      end if;

      if v_source_policy_document_id is not null then
        select * into v_policy_doc
        from policy_documents
        where id = v_source_policy_document_id and household_id = p_household_id;

        if found then
          insert into policies (
            household_id, insurer_id, insurer_name, product_line, policy_number,
            annual_premium_cents, renewal_date, coverage_details, is_current,
            created_by, updated_by
          ) values (
            p_household_id, null, v_insurer_name,
            case v_candidate.asset_type when 'vehicle' then 'auto'::product_line else 'property'::product_line end,
            v_policy_number, v_annual_premium, v_expiry_date, v_current_coverage, true,
            p_actor_profile_id, p_actor_profile_id
          ) returning id into v_policy_id;

          update policy_documents
          set policy_id = v_policy_id
          where id = v_policy_doc.id;

          update asset_candidates
          set approved_policy_id = v_policy_id
          where id = v_candidate.id;

          v_created_policies := v_created_policies || v_policy_id;
        end if;
      end if;
    end loop;
  end loop;

  -- Persist the resulting mandate version.
  select coalesce(max(version), 0) into v_current_mandate_version
  from household_coverage_mandates
  where household_id = p_household_id and is_current = true;

  select coalesce(max(version), 0) into v_current_switching_version
  from switching_preferences
  where household_id = p_household_id and is_current = true;

  -- persist_household_mandate_v2 is service_role only. We are already a
  -- security definer function that has authorized the caller, so call it
  -- under a transient service_role claim and restore the original claim.
  v_original_jwt := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

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

  perform set_config('request.jwt.claims', v_original_jwt, true);

  v_result := jsonb_build_object(
    'success', true,
    'vehicles', v_created_vehicles,
    'properties', v_created_properties,
    'policies', v_created_policies,
    'skipped', v_skipped_ids,
    'linked', v_linked_ids,
    'needsCorrection', v_correction_ids,
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

revoke all on function public.approve_candidate_assets_v2(
  uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb
) from public;
revoke all on function public.approve_candidate_assets_v2(
  uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb
) from anon;
grant execute on function public.approve_candidate_assets_v2(
  uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb
) to authenticated;
grant execute on function public.approve_candidate_assets_v2(
  uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb
) to service_role;

comment on function public.approve_candidate_assets_v2 is
  'Customer-facing idempotent RPC to approve, link, skip or return asset candidates for correction.';

commit;
