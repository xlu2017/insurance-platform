-- Automatic existing-asset match persistence, policy_asset_links integrity,
-- and staff-review freeze. This migration builds on 20260804200011 and earlier
-- migrations without rewriting them.
begin;

-- =============================================================================
-- 1. Derive authoritative first-class draft decisions from analyzer output.
-- =============================================================================

create or replace function sync_candidate_draft_decision()
returns trigger
language plpgsql
as $$
declare
  v_resolution jsonb;
  v_status text;
  v_existing_id text;
  v_identity_strength text;
  v_existing_asset jsonb;
  v_decision text;
  v_existing_type text;
begin
  if new.selected_facts_json is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.selected_facts_json is not distinct from old.selected_facts_json then
    return new;
  end if;

  -- Manual UIs may pass an explicit draft decision; trust it and preserve the
  -- first-class columns it describes.
  if new.selected_facts_json ? '_draftDecision' then
    v_decision := lower(nullif(new.selected_facts_json->>'_draftDecision', ''));
    if v_decision in ('approve_new', 'link_existing', 'skip', 'needs_correction') then
      new.draft_decision := v_decision;

      if v_decision = 'link_existing' then
        v_existing_id := nullif(new.selected_facts_json->>'_draftExistingAssetId', '');
        v_existing_type := lower(nullif(new.selected_facts_json->>'_draftExistingAssetType', ''));
        new.draft_existing_asset_id := v_existing_id::uuid;
        new.draft_existing_asset_type :=
          case when v_existing_type in ('vehicle', 'property') then v_existing_type::candidate_asset_type else null end;
      else
        new.draft_existing_asset_id := null;
        new.draft_existing_asset_type := null;
      end if;

      if v_decision in ('approve_new', 'link_existing') then
        new.draft_identity_confirmed := true;
      else
        new.draft_identity_confirmed := false;
      end if;

      return new;
    end if;
  end if;

  -- Without an analyzer resolution there is nothing to derive automatically;
  -- leave first-class columns as they are (e.g. staff manual-entry inserts).
  if not (new.selected_facts_json ? 'resolution') then
    return new;
  end if;

  v_resolution := new.selected_facts_json->'resolution';
  v_status := lower(nullif(v_resolution->>'status', ''));
  v_existing_id := nullif(v_resolution->>'matchedExistingEntityId', '');
  v_identity_strength := lower(nullif(new.selected_facts_json->'candidateIdentity'->>'identityStrength', ''));
  v_existing_asset := coalesce(new.selected_facts_json->'existingAsset', '{}'::jsonb);

  if v_status = 'matches_existing' and v_existing_id is not null then
    new.draft_decision := 'link_existing';
    new.draft_identity_confirmed := true;
    new.draft_existing_asset_id := v_existing_id::uuid;
    new.draft_existing_asset_type :=
      coalesce(
        case when lower(nullif(v_existing_asset->>'asset_type', '')) in ('vehicle','property')
          then lower(nullif(v_existing_asset->>'asset_type', ''))::candidate_asset_type
          else null end,
        new.asset_type
      );
  elsif v_status = 'matches_pending_candidate' then
    new.draft_decision := 'approve_new';
    new.draft_identity_confirmed := (v_identity_strength = 'exact');
    new.draft_existing_asset_id := null;
    new.draft_existing_asset_type := null;
  elsif v_status = 'possible_match_requires_confirmation' and v_existing_id is not null then
    -- The customer must explicitly confirm linking to the suggested existing asset.
    new.draft_decision := 'link_existing';
    new.draft_identity_confirmed := false;
    new.draft_existing_asset_id := v_existing_id::uuid;
    new.draft_existing_asset_type :=
      coalesce(
        case when lower(nullif(v_existing_asset->>'asset_type', '')) in ('vehicle','property')
          then lower(nullif(v_existing_asset->>'asset_type', ''))::candidate_asset_type
          else null end,
        new.asset_type
      );
  elsif v_status = 'possible_match_requires_confirmation' then
    -- A partial/redacted identity with no clear existing match needs correction.
    new.draft_decision := 'needs_correction';
    new.draft_identity_confirmed := false;
    new.draft_existing_asset_id := null;
    new.draft_existing_asset_type := null;
  else
    -- 'new' or any unrecognized status defaults to add-as-new.
    new.draft_decision := 'approve_new';
    new.draft_identity_confirmed := (v_identity_strength = 'exact');
    new.draft_existing_asset_id := null;
    new.draft_existing_asset_type := null;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_candidate_draft_decision on asset_candidates;
create trigger sync_candidate_draft_decision
  before insert or update on asset_candidates
  for each row
  execute function sync_candidate_draft_decision();

-- =============================================================================
-- 2. Persist analyzer candidates without resetting trigger-derived draft columns.
-- =============================================================================

create or replace function persist_document_batch_analysis_v1(
  p_batch_id uuid,
  p_household_id uuid,
  p_session_id uuid,
  p_client_request_id text,
  p_analysis_run_id uuid default null,
  p_analysis_json jsonb default '{}'::jsonb,
  p_documents_json jsonb default '[]'::jsonb,
  p_candidates_json jsonb default '[]'::jsonb,
  p_reviews_json jsonb default '[]'::jsonb,
  p_authorization_id uuid default null,
  p_consent_id uuid default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_result jsonb;
  v_review jsonb;
  v_candidate_id uuid;
  v_source_document_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only service_role may persist document batch analysis';
  end if;
  if jsonb_typeof(p_reviews_json) <> 'array' then
    raise exception 'p_reviews_json must be a JSON array';
  end if;
  if not exists (
    select 1
    from document_processing_batches
    where id = p_batch_id
      and household_id = p_household_id
      and session_id = p_session_id
      and mode_snapshot = 'dangerous'
  ) then
    raise exception 'Document processing batch does not match the household and session';
  end if;

  v_result := persist_document_analysis_v1(
    p_household_id,
    p_session_id,
    p_client_request_id,
    p_analysis_run_id,
    p_analysis_json,
    p_documents_json,
    p_candidates_json,
    p_authorization_id,
    p_consent_id
  );

  if coalesce((v_result->>'duplicate')::boolean, false) then
    return v_result;
  end if;

  -- Associate canonical candidates with the latest extraction session. Do NOT
  -- overwrite draft_* columns here; the sync_candidate_draft_decision trigger
  -- already populated them during persist_document_analysis_v1.
  update asset_candidates candidate
  set session_id = p_session_id,
      updated_at = now()
  where candidate.household_id = p_household_id
    and candidate.id in (
      select nullif(value->>'id', '')::uuid
      from jsonb_array_elements(p_candidates_json)
    );

  for v_review in select value from jsonb_array_elements(p_reviews_json)
  loop
    v_candidate_id := nullif(v_review->>'candidate_id', '')::uuid;
    v_source_document_id := nullif(v_review->>'source_document_id', '')::uuid;

    if v_candidate_id is null
       or not exists (
         select 1
         from asset_candidates
         where id = v_candidate_id
           and household_id = p_household_id
           and session_id = p_session_id
       ) then
      raise exception 'Mandate review references an invalid candidate';
    end if;
    if v_source_document_id is not null
       and not exists (
         select 1
         from document_processing_batch_items
         where batch_id = p_batch_id
           and household_id = p_household_id
           and policy_document_id = v_source_document_id
       ) then
      raise exception 'Mandate review references an invalid source document';
    end if;

    insert into candidate_field_reviews (
      candidate_id,
      household_id,
      batch_id,
      field_path,
      action,
      value_state,
      specification_title,
      mandate_path,
      original_extracted_value,
      document_implied_value,
      document_implied_mandate_value,
      source_document_id,
      source_page_number,
      source_section,
      confidence,
      conflict_values_json,
      material_conflict,
      is_complete
    ) values (
      v_candidate_id,
      p_household_id,
      p_batch_id,
      v_review->>'field_path',
      'pending'::candidate_field_review_action,
      v_review->>'value_state',
      v_review->>'specification_title',
      v_review->>'mandate_path',
      v_review->'original_extracted_value',
      v_review->'document_implied_value',
      v_review->'document_implied_mandate_value',
      v_source_document_id,
      nullif(v_review->>'source_page_number', '')::integer,
      nullif(v_review->>'source_section', ''),
      nullif(v_review->>'confidence', '')::double precision,
      coalesce(v_review->'conflict_values_json', '[]'::jsonb),
      coalesce((v_review->>'material_conflict')::boolean, false),
      false
    )
    on conflict (candidate_id, field_path) do update set
      batch_id = excluded.batch_id,
      action = excluded.action,
      value_state = excluded.value_state,
      specification_title = excluded.specification_title,
      mandate_path = excluded.mandate_path,
      original_extracted_value = excluded.original_extracted_value,
      document_implied_value = excluded.document_implied_value,
      document_implied_mandate_value = excluded.document_implied_mandate_value,
      current_mandate_value = null,
      prior_mandate_value = null,
      corrected_value = null,
      correction_reason = null,
      source_document_id = excluded.source_document_id,
      source_page_number = excluded.source_page_number,
      source_section = excluded.source_section,
      confidence = excluded.confidence,
      conflict_values_json = excluded.conflict_values_json,
      material_conflict = excluded.material_conflict,
      reviewed_by = null,
      is_complete = false,
      completed_at = null,
      updated_at = now();
  end loop;

  return v_result;
end;
$$;

revoke all on function persist_document_batch_analysis_v1(
  uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid
) from public, anon, authenticated;
grant execute on function persist_document_batch_analysis_v1(
  uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid
) to service_role;

-- =============================================================================
-- 3. Freeze completed staff-review state on relevant mutation paths.
-- =============================================================================

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

  -- Once staff review is complete, no further customer completion is allowed.
  if exists (
    select 1 from manual_entry_idempotency
    where household_id = p_household_id
      and batch_id = p_batch_id
      and operation_type = 'staff_complete_entry'
  ) then
    raise exception 'Manual review has already been completed for this batch' using errcode = 'P0001';
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

    perform validate_candidate_completion_ready(v_candidate.id, p_household_id);

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

  select coalesce(array_agg(distinct doc_id), '{}'::uuid[]) into v_assigned_doc_ids
  from asset_candidates a,
       unnest(a.source_document_ids) as doc_id
  where a.session_id = p_session_id
    and a.household_id = p_household_id;

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

revoke all on function public.complete_customer_manual_entry_v1(uuid, uuid, uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.complete_customer_manual_entry_v1(uuid, uuid, uuid, uuid, text, uuid[]) to authenticated, service_role;

create or replace function set_manual_entry_document_status_v1(
  p_batch_id uuid,
  p_policy_document_id uuid,
  p_household_id uuid,
  p_status text
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_batch document_processing_batches%rowtype;
  v_referenced boolean;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if not can_access_household(p_household_id) then
    raise exception 'Household not found or access denied' using errcode = 'P0001';
  end if;

  if p_status not in ('unreviewed','not_relevant','reviewed') then
    raise exception 'Invalid review status: %', p_status using errcode = 'P0001';
  end if;

  select * into v_batch
  from document_processing_batches
  where id = p_batch_id
    and household_id = p_household_id
  for update;
  if not found then
    raise exception 'Batch not found' using errcode = 'P0001';
  end if;

  -- Once staff review is complete, document status must not change.
  if exists (
    select 1 from manual_entry_idempotency
    where household_id = p_household_id
      and batch_id = p_batch_id
      and operation_type = 'staff_complete_entry'
  ) then
    raise exception 'Manual review has already been completed for this batch' using errcode = 'P0001';
  end if;

  if v_batch.mode_snapshot <> 'safe' then
    raise exception 'Document status changes are only permitted for safe-mode batches' using errcode = 'P0001';
  end if;
  if v_batch.status not in ('manual_review','ready_for_review','processing_unavailable') then
    raise exception 'Batch is not in a reviewable state: %', v_batch.status using errcode = 'P0001';
  end if;
  if v_batch.status = 'processing_unavailable' and coalesce(v_batch.retryable, false) then
    raise exception 'Batch must be resolved before changing document status' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from document_processing_batch_items
    where batch_id = p_batch_id
      and household_id = p_household_id
      and policy_document_id = p_policy_document_id
  ) then
    raise exception 'Document not found in batch' using errcode = 'P0001';
  end if;

  select exists (
    select 1
    from asset_candidates
    where household_id = p_household_id
      and session_id = v_batch.session_id
      and p_policy_document_id = any(source_document_ids)
  ) into v_referenced;

  if p_status = 'reviewed' then
    if not v_referenced then
      raise exception 'Document has no candidate and cannot be marked reviewed' using errcode = 'P0001';
    end if;
  else
    if v_referenced then
      raise exception 'Document is referenced by a candidate and cannot be marked %', p_status using errcode = 'P0001';
    end if;
  end if;

  update document_processing_batch_items
  set review_status = p_status
  where batch_id = p_batch_id
    and household_id = p_household_id
    and policy_document_id = p_policy_document_id;

  return jsonb_build_object('success', true, 'policy_document_id', p_policy_document_id, 'status', p_status);
end;
$$;

revoke all on function public.set_manual_entry_document_status_v1(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.set_manual_entry_document_status_v1(uuid, uuid, uuid, text) to authenticated, service_role;

create or replace function save_candidate_review_draft_v1(
  p_household_id uuid,
  p_candidate_id uuid,
  p_decision text,
  p_identity_confirmed boolean default false,
  p_existing_asset_id uuid default null,
  p_existing_asset_type candidate_asset_type default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  if auth.uid() is null or not is_household_member(p_household_id) then
    raise exception 'Unauthorized';
  end if;
  if p_decision not in ('approve_new', 'link_existing', 'skip', 'needs_correction') then
    raise exception 'Invalid candidate draft decision';
  end if;

  select nullif(coalesce(c.selected_facts_json, '{}'::jsonb)->>'_manual_entry_batch_id', '')::uuid
    into v_batch_id
  from asset_candidates c
  where c.id = p_candidate_id and c.household_id = p_household_id;

  if v_batch_id is not null and exists (
    select 1 from manual_entry_idempotency
    where household_id = p_household_id
      and batch_id = v_batch_id
      and operation_type = 'staff_complete_entry'
  ) then
    raise exception 'Candidate belongs to a batch whose manual review is complete' using errcode = 'P0001';
  end if;

  update asset_candidates
  set draft_decision = p_decision,
      draft_identity_confirmed = coalesce(p_identity_confirmed, false),
      draft_existing_asset_id = p_existing_asset_id,
      draft_existing_asset_type = p_existing_asset_type,
      draft_updated_by = auth.uid(),
      draft_updated_at = now()
  where id = p_candidate_id
    and household_id = p_household_id
    and review_status in ('pending', 'reviewing');

  if not found then
    raise exception 'Candidate is not available for review';
  end if;

  return jsonb_build_object('success', true, 'candidate_id', p_candidate_id);
end;
$$;

revoke all on function save_candidate_review_draft_v1(uuid, uuid, text, boolean, uuid, candidate_asset_type) from public, anon;
grant execute on function save_candidate_review_draft_v1(uuid, uuid, text, boolean, uuid, candidate_asset_type) to authenticated, service_role;

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
  v_batch_id uuid;
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

  v_batch_id := nullif(coalesce(v_candidate.selected_facts_json, '{}'::jsonb)->>'_manual_entry_batch_id', '')::uuid;
  if v_batch_id is not null and exists (
    select 1 from manual_entry_idempotency
    where household_id = p_household_id
      and batch_id = v_batch_id
      and operation_type = 'staff_complete_entry'
  ) then
    raise exception 'Candidate belongs to a batch whose manual review is complete' using errcode = 'P0001';
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

-- =============================================================================
-- 4. Enforce policy_asset_links integrity in the database.
-- =============================================================================

create or replace function validate_policy_asset_link_integrity()
returns trigger
language plpgsql
as $$
declare
  v_policy_household_id uuid;
  v_policy_product_line product_line;
  v_asset_exists boolean;
  v_candidate_household_id uuid;
  v_candidate_approved_asset_id uuid;
  v_candidate_approved_asset_type candidate_asset_type;
begin
  -- policy_id must exist and its household/product_line must match.
  select household_id, product_line into v_policy_household_id, v_policy_product_line
  from policies
  where id = NEW.policy_id;

  if not found then
    raise exception 'policy % does not exist', NEW.policy_id using errcode = 'P0001';
  end if;
  if v_policy_household_id <> NEW.household_id then
    raise exception 'policy household does not match link household' using errcode = 'P0001';
  end if;
  if v_policy_product_line <> NEW.product_line then
    raise exception 'policy product line does not match link product line' using errcode = 'P0001';
  end if;

  -- asset_type/product_line consistency and asset existence in the household.
  if NEW.asset_type = 'vehicle' then
    if NEW.product_line <> 'auto' then
      raise exception 'vehicle links must use product_line auto' using errcode = 'P0001';
    end if;
    select exists(
      select 1 from vehicles where id = NEW.asset_id and household_id = NEW.household_id
    ) into v_asset_exists;
  elsif NEW.asset_type = 'property' then
    if NEW.product_line <> 'property' then
      raise exception 'property links must use product_line property' using errcode = 'P0001';
    end if;
    select exists(
      select 1 from properties where id = NEW.asset_id and household_id = NEW.household_id
    ) into v_asset_exists;
  else
    raise exception 'invalid asset_type %', NEW.asset_type using errcode = 'P0001';
  end if;

  if not v_asset_exists then
    raise exception 'asset % of type % does not exist in household', NEW.asset_id, NEW.asset_type using errcode = 'P0001';
  end if;

  -- candidate_id, when present, must belong to the household and agree with the link.
  if NEW.candidate_id is not null then
    select household_id, approved_asset_id, approved_asset_type
      into v_candidate_household_id, v_candidate_approved_asset_id, v_candidate_approved_asset_type
    from asset_candidates
    where id = NEW.candidate_id;

    if not found then
      raise exception 'candidate % does not exist', NEW.candidate_id using errcode = 'P0001';
    end if;
    if v_candidate_household_id <> NEW.household_id then
      raise exception 'candidate household does not match link household' using errcode = 'P0001';
    end if;
    if v_candidate_approved_asset_id is not null
       and (v_candidate_approved_asset_id <> NEW.asset_id or v_candidate_approved_asset_type <> NEW.asset_type) then
      raise exception 'candidate approved asset does not match link asset' using errcode = 'P0001';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists policy_asset_links_integrity on policy_asset_links;
create trigger policy_asset_links_integrity
  before insert or update on policy_asset_links
  for each row
  execute function validate_policy_asset_link_integrity();

commit;
