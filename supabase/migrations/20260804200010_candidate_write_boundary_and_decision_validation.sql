-- Candidate write boundary and decision validation.
-- - Make approval validation decision-specific.
-- - Close direct authenticated writes on asset_candidates.
-- - Harden manual candidate approval provenance.
-- - Preserve coverage value state.
-- - Validate customer drafts before completion and staff candidates at save time.

begin;

-- Allow candidates to record needs_correction decisions.
alter type candidate_decision add value if not exists 'needs_correction';
alter table asset_candidates drop constraint if exists asset_candidates_review_status_check;
alter table asset_candidates add constraint asset_candidates_review_status_check
  check (review_status in ('pending', 'reviewing', 'confirmed', 'skipped', 'approved', 'needs_correction'));

-- Close direct authenticated writes to asset_candidates.
revoke insert, update, delete on asset_candidates from authenticated;
revoke all on asset_candidates from anon;
drop policy if exists asset_candidates_insert on asset_candidates;
drop policy if exists asset_candidates_update on asset_candidates;

create or replace function extract_extracted_value(input jsonb, out value jsonb, out state text)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_status text;
begin
  if input is null then
    state := 'unknown';
    value := null;
    return;
  end if;

  if jsonb_typeof(input) = 'object' and input ? 'status' then
    v_status := input->>'status';
    state := coalesce(v_status, 'unknown');

    if v_status = 'known' then
      value := input->'value';
      return;
    elsif v_status = 'not_included' then
      state := 'not_included';
      value := null;
      return;
    elsif v_status in ('unknown', 'not_applicable', 'missing') then
      value := null;
      return;
    elsif v_status = 'conflicting' then
      value := null;
      return;
    else
      state := 'unknown';
      value := null;
      return;
    end if;
  end if;

  -- Legacy/manual scalar value (number, string, boolean, null).
  state := 'known';
  value := input;
end;
$$;

-- Validate policy fields required for approval or link_existing.
create or replace function validate_candidate_policy_ready(
  p_selected_facts_json jsonb,
  p_asset_type candidate_asset_type
) returns void
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_current_policy jsonb;
  v_insurer text;
  v_premium bigint;
begin
  v_current_policy := coalesce(p_selected_facts_json->'currentPolicy', '{}'::jsonb);

  v_insurer := coalesce(
    nullif(v_current_policy->>'insurerName', ''),
    nullif(v_current_policy->>'insurer', '')
  );
  if v_insurer is null or length(trim(v_insurer)) = 0 then
    raise exception 'Insurer name is required' using errcode = 'P0001';
  end if;

  v_premium := nullif(v_current_policy->>'annualPremiumCents', '')::bigint;
  if v_premium is null or v_premium <= 0 then
    raise exception 'A positive annual premium is required' using errcode = 'P0001';
  end if;
end;
$$;

-- Validate full asset identity for approve_new.
create or replace function validate_new_asset_identity_ready(
  p_selected_facts_json jsonb,
  p_asset_type candidate_asset_type
) returns void
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_identity jsonb;
  v_year int;
  v_postal text;
begin
  v_identity := coalesce(p_selected_facts_json->'identity', '{}'::jsonb);

  if p_asset_type = 'property' then
    if nullif(v_identity->>'fullAddress', '') is null
       or nullif(v_identity->>'city', '') is null
       or nullif(v_identity->>'province', '') is null
       or nullif(v_identity->>'postalCode', '') is null then
      raise exception 'Property address, city, province and postal code are required' using errcode = 'P0001';
    end if;
    v_postal := upper(regexp_replace(v_identity->>'postalCode', '\s', '', 'g'));
    if v_postal !~ '^[A-Z][0-9][A-Z][0-9][A-Z][0-9]$' then
      raise exception 'Property postal code is invalid' using errcode = 'P0001';
    end if;
  elsif p_asset_type = 'vehicle' then
    if nullif(v_identity->>'year', '') is null then
      raise exception 'Vehicle year is required' using errcode = 'P0001';
    end if;
    v_year := (nullif(v_identity->>'year', ''))::int;
    if v_year < 1900 or v_year > 2100 then
      raise exception 'Vehicle year must be between 1900 and 2100' using errcode = 'P0001';
    end if;
    if nullif(v_identity->>'make', '') is null or nullif(v_identity->>'model', '') is null then
      raise exception 'Vehicle make and model are required' using errcode = 'P0001';
    end if;
    if nullif(v_identity->>'vin', '') is not null then
      if length(regexp_replace(nullif(v_identity->>'vin', ''), '\s', '', 'g')) not in (17)
         or regexp_replace(nullif(v_identity->>'vin', ''), '[A-HJ-NPR-Z0-9]', '', 'gi') <> '' then
        raise exception 'Vehicle VIN must be 17 alphanumeric characters (I, O and Q are not allowed)' using errcode = 'P0001';
      end if;
    end if;
  end if;
end;
$$;

-- Validate full new-asset approval readiness.
create or replace function validate_candidate_approval_ready(
  p_selected_facts_json jsonb,
  p_asset_type candidate_asset_type
) returns void
language plpgsql
stable
security definer set search_path = public
as $$
begin
  perform validate_candidate_policy_ready(p_selected_facts_json, p_asset_type);
  perform validate_new_asset_identity_ready(p_selected_facts_json, p_asset_type);
end;
$$;

create or replace function complete_customer_manual_entry_v1(
  p_batch_id uuid,
  p_session_id uuid,
  p_case_id uuid,
  p_household_id uuid,
  p_client_request_id text,
  p_skipped_document_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_batch document_processing_batches%rowtype;
  v_session document_extraction_sessions%rowtype;
  v_case optimization_cases%rowtype;
  v_doc_id uuid;
  v_candidate_count int;
  v_assigned_doc_ids uuid[] := '{}'::uuid[];
  v_batch_doc_ids uuid[] := '{}'::uuid[];
  v_unassigned uuid[] := '{}'::uuid[];
  v_result jsonb;
  v_ledger_id uuid;
  v_existing_result jsonb;
  v_candidate asset_candidates%rowtype;
  v_existing_status text;
  v_doc_status text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if not is_household_member(p_household_id) then
    raise exception 'Household not found or access denied' using errcode = 'P0001';
  end if;

  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'client_request_id is required' using errcode = 'P0001';
  end if;
  if length(p_client_request_id) > 240 then
    raise exception 'Invalid client_request_id' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('manual-entry:' || p_household_id::text || ':' || p_batch_id::text || ':complete_entry:' || p_client_request_id, 0));

  select id, result_json into v_ledger_id, v_existing_result
  from manual_entry_idempotency
  where household_id = p_household_id
    and batch_id = p_batch_id
    and operation_type = 'complete_entry'
    and client_request_id = p_client_request_id;
  if found then
    return v_existing_result;
  end if;

  select * into v_case
  from optimization_cases
  where id = p_case_id
    and household_id = p_household_id
  for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0001';
  end if;

  select * into v_session
  from document_extraction_sessions
  where id = p_session_id
    and household_id = p_household_id
    and case_id = p_case_id
  for update;
  if not found then
    raise exception 'Session not found or does not match case' using errcode = 'P0001';
  end if;

  select * into v_batch
  from document_processing_batches
  where id = p_batch_id
    and household_id = p_household_id
    and session_id = p_session_id
  for update;
  if not found then
    raise exception 'Batch not found or does not match session' using errcode = 'P0001';
  end if;

  if v_batch.case_id is distinct from p_case_id then
    raise exception 'Batch does not match case' using errcode = 'P0001';
  end if;
  if v_session.case_id is distinct from p_case_id then
    raise exception 'Session does not match case' using errcode = 'P0001';
  end if;

  if v_batch.mode_snapshot <> 'safe' then
    raise exception 'Manual entry is only permitted for safe-mode batches' using errcode = 'P0001';
  end if;

  if v_batch.status = 'processing_unavailable' and coalesce(v_batch.retryable, false) then
    raise exception 'Batch must be resolved before manual entry completion' using errcode = 'P0001';
  end if;
  if v_batch.status not in ('manual_review','processing_unavailable') then
    raise exception 'Batch is not in a manual-entry state: %', v_batch.status using errcode = 'P0001';
  end if;

  if v_case.state not in ('awaiting_documents','extracting_information') then
    raise exception 'Case is not accepting manual entry completion: %', v_case.state using errcode = 'P0001';
  end if;

  -- Validate and lock every candidate in the session.
  select count(*) into v_candidate_count
  from asset_candidates
  where session_id = p_session_id
    and household_id = p_household_id;
  if v_candidate_count = 0 then
    raise exception 'At least one manual-entry candidate is required' using errcode = 'P0001';
  end if;

  for v_candidate in
    select *
    from asset_candidates
    where session_id = p_session_id
      and household_id = p_household_id
    for update
  loop
    if coalesce(v_candidate.source_document_ids, '{}'::uuid[]) = '{}'::uuid[] then
      raise exception 'Candidate % has empty source documents', v_candidate.id using errcode = 'P0001';
    end if;
    if coalesce(v_candidate.selected_facts_json->>'_source','') <> 'customer_manual_entry'
       or (v_candidate.selected_facts_json->>'_manual_entry_batch_id')::uuid is distinct from p_batch_id
       or (v_candidate.selected_facts_json->>'_manual_entry_session_id')::uuid is distinct from p_session_id
       or (v_candidate.selected_facts_json->>'_manual_entry_case_id')::uuid is distinct from p_case_id then
      raise exception 'Candidate % does not have trusted customer manual-entry provenance', v_candidate.id using errcode = 'P0001';
    end if;

    -- The candidate must be complete enough to proceed to approval.
    perform validate_candidate_approval_ready(v_candidate.selected_facts_json, v_candidate.asset_type);

    foreach v_doc_id in array v_candidate.source_document_ids
    loop
      select review_status into v_existing_status
      from document_processing_batch_items
      where batch_id = p_batch_id
        and household_id = p_household_id
        and policy_document_id = v_doc_id;
      if not found then
        raise exception 'Candidate source document % does not belong to batch', v_doc_id using errcode = 'P0001';
      end if;
      if v_existing_status = 'not_relevant' then
        raise exception 'Source document % was marked not relevant', v_doc_id using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  -- Build authoritative assigned-document set from locked candidates.
  select coalesce(array_agg(distinct doc_id), '{}'::uuid[]) into v_assigned_doc_ids
  from asset_candidates a,
       unnest(a.source_document_ids) as doc_id
  where a.session_id = p_session_id
    and a.household_id = p_household_id;

  -- Validate and apply the caller-supplied skipped list, then derive authoritative resolved state.
  if p_skipped_document_ids is not null and array_length(p_skipped_document_ids, 1) is not null then
    foreach v_doc_id in array p_skipped_document_ids
    loop
      if v_doc_id = any(v_assigned_doc_ids) then
        raise exception 'Document % is referenced by a candidate and cannot be marked not relevant', v_doc_id using errcode = 'P0001';
      end if;

      select review_status into v_existing_status
      from document_processing_batch_items
      where batch_id = p_batch_id
        and household_id = p_household_id
        and policy_document_id = v_doc_id
      for update;
      if not found then
        raise exception 'Skipped document % does not belong to batch', v_doc_id using errcode = 'P0001';
      end if;
      if v_existing_status in ('reviewed','reviewing') then
        raise exception 'Document % is already % and cannot be marked not relevant', v_doc_id, v_existing_status using errcode = 'P0001';
      end if;
      if v_existing_status = 'not_relevant' then
        continue;
      end if;

      update document_processing_batch_items
      set review_status = 'not_relevant'
      where batch_id = p_batch_id
        and household_id = p_household_id
        and policy_document_id = v_doc_id;
    end loop;
  end if;

  -- Every batch document must be explicitly reviewed or not_relevant.
  for v_doc_id, v_doc_status in
    select policy_document_id, review_status
    from document_processing_batch_items
    where batch_id = p_batch_id
      and household_id = p_household_id
    for update
  loop
    if v_doc_status not in ('reviewed','not_relevant') then
      raise exception 'Document % is % and must be reviewed or marked not relevant', v_doc_id, v_doc_status using errcode = 'P0001';
    end if;
    if v_doc_status = 'reviewed' and not (v_doc_id = any(v_assigned_doc_ids)) then
      raise exception 'Document % is reviewed but has no candidate', v_doc_id using errcode = 'P0001';
    end if;
    if v_doc_status = 'not_relevant' and (v_doc_id = any(v_assigned_doc_ids)) then
      raise exception 'Document % is marked not relevant but is referenced by a candidate', v_doc_id using errcode = 'P0001';
    end if;
  end loop;

  update document_processing_batches
  set status = 'ready_for_review',
      error_code = null,
      retryable = false,
      retry_count = 0,
      next_retry_at = null,
      completed_at = now(),
      updated_at = now()
  where id = p_batch_id;

  update optimization_cases
  set state = 'extracting_information',
      updated_at = now()
  where id = p_case_id
    and state in ('awaiting_documents','extracting_information');

  insert into audit_events (
    actor_profile_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    household_id,
    case_id,
    after_summary
  ) values (
    v_actor,
    app_role(),
    'customer_manual_entry_completed',
    'document_processing_batch',
    p_batch_id,
    p_household_id,
    p_case_id,
    jsonb_build_object(
      'batch_id', p_batch_id,
      'session_id', p_session_id,
      'candidate_count', v_candidate_count,
      'skipped_document_ids', coalesce(p_skipped_document_ids, '{}'::uuid[]),
      'source', 'customer_manual_entry'
    )
  );

  v_result := jsonb_build_object('success', true, 'batch_id', p_batch_id, 'candidate_count', v_candidate_count);

  insert into manual_entry_idempotency (
    operation_type,
    client_request_id,
    household_id,
    batch_id,
    result_id,
    result_json
  ) values (
    'complete_entry',
    p_client_request_id,
    p_household_id,
    p_batch_id,
    p_batch_id,
    v_result
  );

  return v_result;
end;
$$;

create or replace function save_staff_manual_policy_candidate_v1(
  p_batch_id uuid,
  p_session_id uuid,
  p_case_id uuid,
  p_household_id uuid,
  p_client_request_id text,
  p_asset_type candidate_asset_type,
  p_identity_fingerprint text,
  p_display_label text,
  p_source_document_ids uuid[],
  p_selected_facts_json jsonb default '{}'::jsonb,
  p_occupancy text default null,
  p_match_classification candidate_match_classification default 'new'
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_batch document_processing_batches%rowtype;
  v_session document_extraction_sessions%rowtype;
  v_case optimization_cases%rowtype;
  v_doc_id uuid;
  v_candidate_id uuid;
  v_ledger_id uuid;
  v_result jsonb;
  v_facts jsonb;
  v_occupancy text;
  v_existing_status text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if not is_staff() then
    raise exception 'Staff role required' using errcode = 'P0001';
  end if;

  if not can_access_household(p_household_id) then
    raise exception 'Staff cannot access household' using errcode = 'P0001';
  end if;

  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'client_request_id is required' using errcode = 'P0001';
  end if;
  if length(p_client_request_id) > 240 then
    raise exception 'Invalid client_request_id' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('manual-entry:' || p_household_id::text || ':' || p_batch_id::text || ':staff_save_candidate:' || p_client_request_id, 0));

  select id, result_json into v_ledger_id, v_result
  from manual_entry_idempotency
  where household_id = p_household_id
    and batch_id = p_batch_id
    and operation_type = 'staff_save_candidate'
    and client_request_id = p_client_request_id;
  if found then
    return v_result;
  end if;

  select * into v_case
  from optimization_cases
  where id = p_case_id
    and household_id = p_household_id
  for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0001';
  end if;

  select * into v_session
  from document_extraction_sessions
  where id = p_session_id
    and household_id = p_household_id
    and case_id = p_case_id
  for update;
  if not found then
    raise exception 'Session not found or does not match case' using errcode = 'P0001';
  end if;

  select * into v_batch
  from document_processing_batches
  where id = p_batch_id
    and household_id = p_household_id
    and session_id = p_session_id
  for update;
  if not found then
    raise exception 'Batch not found or does not match session' using errcode = 'P0001';
  end if;

  if v_batch.case_id is distinct from p_case_id then
    raise exception 'Batch does not match case' using errcode = 'P0001';
  end if;
  if v_session.case_id is distinct from p_case_id then
    raise exception 'Session does not match case' using errcode = 'P0001';
  end if;

  if v_batch.status <> 'manual_review' then
    raise exception 'Batch is not in manual_review: %', v_batch.status using errcode = 'P0001';
  end if;

  if p_source_document_ids is null or array_length(p_source_document_ids, 1) is null then
    raise exception 'At least one source document is required' using errcode = 'P0001';
  end if;

  foreach v_doc_id in array p_source_document_ids
  loop
    select review_status into v_existing_status
    from document_processing_batch_items
    where batch_id = p_batch_id
      and household_id = p_household_id
      and policy_document_id = v_doc_id;
    if not found then
      raise exception 'Source document % does not belong to batch', v_doc_id using errcode = 'P0001';
    end if;
    if v_existing_status = 'not_relevant' then
      raise exception 'Source document % has been marked not relevant and must be unskipped first', v_doc_id using errcode = 'P0001';
    end if;
  end loop;

  v_occupancy := nullif(trim(coalesce(p_occupancy, '')), '');
  v_facts := coalesce(p_selected_facts_json, '{}'::jsonb)
    || jsonb_build_object('_source', 'staff_manual_entry')
    || jsonb_build_object('_manual_entry_batch_id', p_batch_id)
    || jsonb_build_object('_manual_entry_session_id', p_session_id)
    || jsonb_build_object('_manual_entry_case_id', p_case_id);

  -- Approval-readiness is validated at completion/approval time, not at draft save.
  insert into asset_candidates (
    session_id,
    household_id,
    asset_type,
    identity_fingerprint,
    display_label,
    occupancy,
    match_classification,
    decision,
    review_status,
    source_document_ids,
    selected_facts_json,
    manual_reviewed_by,
    manual_reviewed_at
  ) values (
    p_session_id,
    p_household_id,
    p_asset_type,
    p_identity_fingerprint,
    p_display_label,
    v_occupancy,
    p_match_classification,
    'undecided',
    'pending',
    p_source_document_ids,
    v_facts,
    v_actor,
    now()
  ) returning id into v_candidate_id;

  -- A candidate reference starts review; it does not complete it.
  update document_processing_batch_items
  set review_status = 'reviewing'
  where batch_id = p_batch_id
    and policy_document_id = any(p_source_document_ids);

  insert into audit_events (
    actor_profile_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    household_id,
    case_id,
    after_summary
  ) values (
    v_actor,
    app_role(),
    'staff_manual_candidate_saved',
    'asset_candidate',
    v_candidate_id,
    p_household_id,
    p_case_id,
    jsonb_build_object(
      'batch_id', p_batch_id,
      'session_id', p_session_id,
      'asset_type', p_asset_type,
      'source_document_ids', p_source_document_ids,
      'source', 'staff_manual_entry'
    )
  );

  v_result := jsonb_build_object('success', true, 'candidate_id', v_candidate_id);

  insert into manual_entry_idempotency (
    operation_type,
    client_request_id,
    household_id,
    batch_id,
    result_id,
    result_json
  ) values (
    'staff_save_candidate',
    p_client_request_id,
    p_household_id,
    p_batch_id,
    v_candidate_id,
    v_result
  );

  return v_result;
end;
$$;

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
  v_actor uuid;
  v_existing record;
  v_decision jsonb;
  v_candidate_id uuid;
  v_candidate_ids uuid[] := '{}'::uuid[];
  v_candidate record;
  v_facts jsonb;
  v_identity jsonb;
  v_current_policy jsonb;
  v_current_coverage jsonb;
  v_raw_coverage jsonb;
  v_normalized_coverage jsonb;
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
  v_liability_limit_cents bigint;
  v_dwelling_limit_cents bigint;
  v_base_deductible_cents bigint;
  v_collision_deductible_cents bigint;
  v_comprehensive_deductible_cents bigint;
  v_vehicle_id uuid;
  v_property_id uuid;
  v_policy_id uuid;
  v_source_id uuid;
  v_extracted record;
  v_policy_doc record;
  v_source_policy_document_id uuid;
  v_asset_id_for_mandate uuid;
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
  v_seen_policy_doc_ids uuid[] := '{}'::uuid[];
  v_extracted_value jsonb;
  v_extracted_state text;
  v_provenance_source text;
  v_coverage_state jsonb;
begin
  v_caller_role := coalesce(auth.role(), current_setting('request.jwt.claims', true)::jsonb->>'role');

  -- Authenticated callers must use their own profile id; service-role may delegate.
  if v_caller_role = 'authenticated' then
    if auth.uid() is null then
      raise exception 'not authenticated' using errcode = 'P0001';
    end if;
    if p_actor_profile_id is distinct from auth.uid() then
      raise exception 'approval actor profile id does not match authenticated user' using errcode = 'P0001';
    end if;
    if not is_household_member(p_household_id) then
      raise exception 'only a household member or service_role may approve candidates' using errcode = 'P0001';
    end if;
    v_actor := auth.uid();
  elsif v_caller_role = 'service_role' then
    v_actor := p_actor_profile_id;
  else
    raise exception 'only a household member or service_role may approve candidates' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) = 0 then
    raise exception 'decisions must be a non-empty array' using errcode = 'P0001';
  end if;

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
    if v_candidate.review_status not in ('pending', 'reviewing') or v_candidate.decision not in ('undecided','not_sure') then
      raise exception 'candidate % is not available for approval (status %)', v_candidate.id, v_candidate.review_status using errcode = 'P0001';
    end if;

    -- Validate trusted provenance and non-empty source documents.
    if coalesce(v_candidate.source_document_ids, '{}'::uuid[]) = '{}'::uuid[] then
      raise exception 'candidate % has no source documents and cannot be approved', v_candidate.id using errcode = 'P0001';
    end if;

    if v_candidate.analysis_run_id is not null and exists (
      select 1 from document_analysis_runs
      where id = v_candidate.analysis_run_id
        and household_id = p_household_id
        and session_id = v_candidate.session_id
    ) then
      -- trusted extraction session/run; source documents must be extracted_documents from this run/session
      if exists (
        select 1
        from unnest(v_candidate.source_document_ids) as src_id
        where not exists (
          select 1 from extracted_documents
          where id = src_id and household_id = p_household_id and session_id = v_candidate.session_id
        )
      ) then
        raise exception 'candidate % has source documents outside its extraction session', v_candidate.id using errcode = 'P0001';
      end if;
    elsif coalesce(v_candidate.selected_facts_json->>'_source','') in ('customer_manual_entry','staff_manual_entry') then
      declare
        v_manual_batch_id uuid := (v_candidate.selected_facts_json->>'_manual_entry_batch_id')::uuid;
        v_manual_session_id uuid := (v_candidate.selected_facts_json->>'_manual_entry_session_id')::uuid;
        v_manual_case_id uuid := (v_candidate.selected_facts_json->>'_manual_entry_case_id')::uuid;
        v_manual_batch document_processing_batches%rowtype;
        v_manual_doc_count int;
      begin
        if v_manual_batch_id is null or v_manual_session_id is null or v_manual_case_id is null then
          raise exception 'candidate % has incomplete manual-entry provenance', v_candidate.id using errcode = 'P0001';
        end if;
        if v_manual_session_id is distinct from v_candidate.session_id then
          raise exception 'candidate % manual-entry session does not match', v_candidate.id using errcode = 'P0001';
        end if;
        select * into v_manual_batch
        from document_processing_batches
        where id = v_manual_batch_id
          and household_id = p_household_id
          and session_id = v_manual_session_id
          and case_id = v_manual_case_id
        for update;
        if not found then
          raise exception 'candidate % manual-entry batch not found', v_candidate.id using errcode = 'P0001';
        end if;
        if v_manual_batch.status <> 'ready_for_review' then
          raise exception 'candidate % manual-entry batch is not ready for review', v_candidate.id using errcode = 'P0001';
        end if;
        select count(*) into v_manual_doc_count
        from document_processing_batch_items
        where batch_id = v_manual_batch_id
          and household_id = p_household_id
          and policy_document_id = any(v_candidate.source_document_ids);
        if v_manual_doc_count <> array_length(v_candidate.source_document_ids, 1) then
          raise exception 'candidate % source documents do not match manual-entry batch', v_candidate.id using errcode = 'P0001';
        end if;
      end;
    elsif coalesce(v_candidate.selected_facts_json->>'_source','') = 'manual_policy_review' and v_candidate.manual_reviewed_by is not null then
      -- trusted legacy staff review workflow
      null;
    else
      raise exception 'candidate % has unrecognized provenance and cannot be approved', v_candidate.id using errcode = 'P0001';
    end if;
  end loop;

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

    -- Ensure the facts contain the fields approval requires before any canonical writes.
    if v_decision_text in ('skip', 'needs_correction') then
      -- No approval-readiness validation required for skip or needs_correction.
      null;
    elsif v_decision_text in ('link_existing', 'link_existing_asset') then
      perform validate_candidate_policy_ready(v_facts, v_candidate.asset_type);
    else
      perform validate_candidate_approval_ready(v_facts, v_candidate.asset_type);
    end if;

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

    -- Prepare identity fields common to both new and linked assets.
    if v_candidate.asset_type = 'vehicle' then
      v_year := (nullif(v_identity->>'year', ''))::int;
      v_make := nullif(v_identity->>'make', '');
      v_model := nullif(v_identity->>'model', '');
      v_vin := nullif(v_identity->>'vin', '');
    elsif v_candidate.asset_type = 'property' then
      v_address_line1 := nullif(v_identity->>'fullAddress', '');
      v_city := nullif(v_identity->>'city', '');
      v_province := nullif(v_identity->>'province', '');
      v_postal_code := nullif(v_identity->>'postalCode', '');
      v_year_built := nullif(v_identity->>'yearBuilt', '')::int;
    end if;

    if v_decision_text in ('approve_new', 'approve_new_asset') then
      if v_candidate.asset_type = 'vehicle' then
        insert into vehicles (
          household_id, year, make, model, vin, primary_use,
          created_by, updated_by
        ) values (
          p_household_id, v_year, v_make, v_model, nullif(upper(coalesce(v_vin, '')), ''), 'commute',
          v_actor, v_actor
        ) returning id into v_vehicle_id;

        v_created_vehicles := v_created_vehicles || v_vehicle_id;
        v_asset_id_for_mandate := v_vehicle_id;
      elsif v_candidate.asset_type = 'property' then
        insert into properties (
          household_id, address_line1, city, province, postal_code, year_built,
          dwelling_type, owner_occupied, created_by, updated_by
        ) values (
          p_household_id, v_address_line1, v_city, v_province, v_postal_code, v_year_built,
          'detached', true, v_actor, v_actor
        ) returning id into v_property_id;

        v_created_properties := v_created_properties || v_property_id;
        v_asset_id_for_mandate := v_property_id;
      end if;
    elsif v_decision_text in ('link_existing', 'link_existing_asset') then
      v_existing_asset_id := (v_decision->>'existing_asset_id')::uuid;
      v_existing_asset_type := lower(coalesce(v_decision->>'existing_asset_type', ''));

      if v_existing_asset_type <> v_candidate.asset_type::text then
        raise exception 'existing asset type % does not match candidate asset type %', v_existing_asset_type, v_candidate.asset_type using errcode = 'P0001';
      end if;

      if v_candidate.asset_type = 'vehicle' then
        if not exists (select 1 from vehicles where id = v_existing_asset_id and household_id = p_household_id) then
          raise exception 'existing vehicle % does not belong to household', v_existing_asset_id using errcode = 'P0001';
        end if;
      elsif v_candidate.asset_type = 'property' then
        if not exists (select 1 from properties where id = v_existing_asset_id and household_id = p_household_id) then
          raise exception 'existing property % does not belong to household', v_existing_asset_id using errcode = 'P0001';
        end if;
      end if;

      v_asset_id_for_mandate := v_existing_asset_id;
      v_linked_ids := v_linked_ids || v_candidate.id;
    end if;

    -- Mark the candidate approved and attach the canonical asset (new or existing).
    update asset_candidates
    set decision = case when v_decision_text in ('link_existing','link_existing_asset') then 'link_existing' else 'approve_new' end::candidate_decision,
        review_status = 'approved',
        approved_asset_id = v_asset_id_for_mandate,
        approved_asset_type = v_candidate.asset_type,
        updated_at = now()
    where id = v_candidate.id;

    -- Normalize insurer name from both manual (insurerName) and automatic (insurer) shapes.
    v_insurer_name := coalesce(
      nullif(v_current_policy->>'insurerName', ''),
      nullif(v_current_policy->>'insurer', '')
    );
    v_policy_number := coalesce(v_current_policy->>'policyNumber', '');
    v_effective_date := nullif(v_current_policy->>'effectiveDate', '')::date;
    v_expiry_date := nullif(v_current_policy->>'expiryDate', '')::date;
    v_annual_premium := (nullif(v_current_policy->>'annualPremiumCents', ''))::bigint;

    if v_insurer_name is null then
      raise exception 'candidate % requires an insurer name before approval', v_candidate.id using errcode = 'P0001';
    end if;
    if v_annual_premium is null or v_annual_premium <= 0 then
      raise exception 'candidate % requires a positive annual premium before approval', v_candidate.id using errcode = 'P0001';
    end if;

    -- Normalize ExtractedCurrentValue coverage into a scalar map while preserving raw provenance and value state.
    v_raw_coverage := v_current_coverage;
    v_normalized_coverage := '{}'::jsonb;
    v_coverage_state := '{}'::jsonb;

    for v_coverage_key in select jsonb_object_keys(v_current_coverage)
    loop
      select value, state into v_extracted_value, v_extracted_state
      from extract_extracted_value(v_current_coverage->v_coverage_key);

      v_coverage_state := jsonb_set(v_coverage_state, array[v_coverage_key], to_jsonb(v_extracted_state));

      if v_extracted_state = 'known' and v_extracted_value is not null then
        v_normalized_coverage := jsonb_set(v_normalized_coverage, array[v_coverage_key], v_extracted_value);
      else
        v_normalized_coverage := jsonb_set(v_normalized_coverage, array[v_coverage_key], 'null'::jsonb);
      end if;
    end loop;

    -- Alias legacy liabilityLimitCents to canonical personalLiabilityLimitCents.
    if v_normalized_coverage ? 'liabilityLimitCents' and not (v_normalized_coverage ? 'personalLiabilityLimitCents') then
      v_normalized_coverage := jsonb_set(
        v_normalized_coverage,
        array['personalLiabilityLimitCents'],
        v_normalized_coverage->'liabilityLimitCents'
      );
    end if;
    v_normalized_coverage := v_normalized_coverage - 'liabilityLimitCents';

    v_liability_limit_cents := coalesce(
      nullif(v_normalized_coverage->>'personalLiabilityLimitCents', '')::bigint,
      nullif(v_normalized_coverage->>'thirdPartyLiabilityCents', '')::bigint
    );
    v_dwelling_limit_cents := nullif(v_normalized_coverage->>'dwellingLimitCents', '')::bigint;
    v_base_deductible_cents := nullif(v_normalized_coverage->>'baseDeductibleCents', '')::bigint;
    v_collision_deductible_cents := nullif(v_normalized_coverage->>'collisionDeductibleCents', '')::bigint;
    v_comprehensive_deductible_cents := nullif(v_normalized_coverage->>'comprehensiveDeductibleCents', '')::bigint;

    -- Create exactly one current policy per approved candidate.
    insert into policies (
      household_id, insurer_id, insurer_name, product_line, policy_number,
      annual_premium_cents, renewal_date, coverage_details, liability_limit_cents,
      dwelling_limit_cents, base_deductible_cents, collision_deductible_cents,
      comprehensive_deductible_cents, is_current, created_by, updated_by
    ) values (
      p_household_id, null, v_insurer_name,
      case v_candidate.asset_type when 'vehicle' then 'auto'::product_line else 'property'::product_line end,
      v_policy_number, v_annual_premium, v_expiry_date,
      v_normalized_coverage || jsonb_build_object('_rawCoverage', v_raw_coverage, '_coverageState', v_coverage_state),
      v_liability_limit_cents, v_dwelling_limit_cents, v_base_deductible_cents,
      v_collision_deductible_cents, v_comprehensive_deductible_cents, true,
      v_actor, v_actor
    ) returning id into v_policy_id;

    v_created_policies := v_created_policies || v_policy_id;

    update asset_candidates
    set approved_policy_id = v_policy_id
    where id = v_candidate.id;

    -- Link every source document to the single policy.
    v_seen_policy_doc_ids := '{}'::uuid[];
    foreach v_source_id in array coalesce(v_candidate.source_document_ids, '{}'::uuid[])
    loop
      select * into v_extracted
      from extracted_documents
      where id = v_source_id and household_id = p_household_id;

      if found then
        v_source_policy_document_id := v_extracted.policy_document_id;
      else
        v_source_policy_document_id := v_source_id;
      end if;

      if v_source_policy_document_id is not null
         and not (v_source_policy_document_id = any(v_seen_policy_doc_ids)) then
        select * into v_policy_doc
        from policy_documents
        where id = v_source_policy_document_id and household_id = p_household_id;

        if found then
          insert into policy_document_policy_links (
            policy_document_id, policy_id, candidate_id, relationship_type
          ) values (
            v_source_policy_document_id, v_policy_id, v_candidate.id, 'candidate_source'
          )
          on conflict do nothing;
          v_seen_policy_doc_ids := v_seen_policy_doc_ids || v_source_policy_document_id;
        end if;
      end if;
    end loop;

    -- Collect mandate overrides for the approved (or linked) asset.
    if v_candidate.asset_type = 'vehicle' then
      v_vehicle_overrides := v_vehicle_overrides || jsonb_build_object('vehicleId', v_asset_id_for_mandate::text, 'values', v_mandate_suggestions);
    elsif v_candidate.asset_type = 'property' then
      v_property_overrides := v_property_overrides || jsonb_build_object('propertyId', v_asset_id_for_mandate::text, 'values', v_mandate_suggestions);
    end if;
  end loop;

  -- Persist the resulting mandate version.
  select coalesce(max(version), 0) into v_current_mandate_version
  from household_coverage_mandates
  where household_id = p_household_id and is_current = true;

  select coalesce(max(version), 0) into v_current_switching_version
  from switching_preferences
  where household_id = p_household_id and is_current = true;

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
    v_actor
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
    p_household_id, v_actor, p_client_request_id, 'completed', v_result
  );

  return v_result;
end;
$$;

-- Allow authenticated callers to update only the display label of their candidate.
create or replace function update_candidate_display_label_v1(
  p_candidate_id uuid,
  p_household_id uuid,
  p_display_label text
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_candidate asset_candidates%rowtype;
  v_result jsonb;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if not can_access_household(p_household_id) then
    raise exception 'Household not found or access denied' using errcode = 'P0001';
  end if;

  select * into v_candidate
  from asset_candidates
  where id = p_candidate_id and household_id = p_household_id
  for update;
  if not found then
    raise exception 'Candidate not found' using errcode = 'P0001';
  end if;

  if length(trim(coalesce(p_display_label, ''))) = 0 then
    raise exception 'Display label is required' using errcode = 'P0001';
  end if;

  update asset_candidates
  set display_label = p_display_label, updated_at = now()
  where id = p_candidate_id and household_id = p_household_id;

  v_result := jsonb_build_object('success', true, 'candidate_id', p_candidate_id);

  insert into audit_events (
    actor_profile_id, actor_role, action, entity_type, entity_id, household_id, after_summary
  ) values (
    v_actor, app_role(), 'candidate_display_label_updated', 'asset_candidate', p_candidate_id, p_household_id,
    jsonb_build_object('display_label', p_display_label)
  );

  return v_result;
end;
$$;

-- Grants for new/recreated functions.
revoke all on function public.extract_extracted_value(jsonb) from public, anon;
grant execute on function public.extract_extracted_value(jsonb) to authenticated, service_role;

revoke all on function public.validate_candidate_policy_ready(jsonb, candidate_asset_type) from public, anon;
grant execute on function public.validate_candidate_policy_ready(jsonb, candidate_asset_type) to authenticated, service_role;

revoke all on function public.validate_new_asset_identity_ready(jsonb, candidate_asset_type) from public, anon;
grant execute on function public.validate_new_asset_identity_ready(jsonb, candidate_asset_type) to authenticated, service_role;

revoke all on function public.validate_candidate_approval_ready(jsonb, candidate_asset_type) from public, anon;
grant execute on function public.validate_candidate_approval_ready(jsonb, candidate_asset_type) to authenticated, service_role;

revoke all on function public.complete_customer_manual_entry_v1(uuid, uuid, uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.complete_customer_manual_entry_v1(uuid, uuid, uuid, uuid, text, uuid[]) to authenticated, service_role;

revoke all on function public.save_staff_manual_policy_candidate_v1(
  uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, uuid[], jsonb, text, candidate_match_classification
) from public, anon;
grant execute on function public.save_staff_manual_policy_candidate_v1(
  uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, uuid[], jsonb, text, candidate_match_classification
) to authenticated, service_role;

revoke all on function public.approve_candidate_assets_v2(
  uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.approve_candidate_assets_v2(
  uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb
) to authenticated, service_role;

revoke all on function public.update_candidate_display_label_v1(uuid, uuid, text) from public, anon;
grant execute on function public.update_candidate_display_label_v1(uuid, uuid, text) to authenticated, service_role;

commit;
