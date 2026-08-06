-- Stop transferring asset candidates between review sessions and reject candidate-id
-- household conflicts in the persistence RPCs. This migration only replaces the
-- persistence functions; 20260804200013 remains deployed and immutable.
begin;

-- =============================================================================
-- 1. Reject candidate ids belonging to another household before any writes.
-- 2. Only update an existing candidate's session_id/source_document_ids when
--    the existing and new sessions belong to the same optimization case.
-- =============================================================================

create or replace function persist_document_analysis_v1(
  p_household_id uuid,
  p_session_id uuid,
  p_client_request_id text,
  p_analysis_run_id uuid default null,
  p_analysis_json jsonb default '{}'::jsonb,
  p_documents_json jsonb default '[]'::jsonb,
  p_candidates_json jsonb default '[]'::jsonb,
  p_authorization_id uuid default null,
  p_consent_id uuid default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller_role text;
  v_run_id uuid;
  v_existing_run_id uuid;
  v_document jsonb;
  v_extracted_id uuid;
  v_candidate jsonb;
  v_candidate_id uuid;
  v_source_doc_ids uuid[];
  v_identity_fingerprint text;
  v_asset_type candidate_asset_type;
  v_match_classification candidate_match_classification;
  v_draft_decision text;
  v_draft_identity_confirmed boolean;
  v_draft_existing_asset_id uuid;
  v_draft_existing_asset_type text;
  v_result jsonb;
  v_result_documents jsonb := '[]'::jsonb;
  v_result_candidates jsonb := '[]'::jsonb;
  v_doc_map jsonb := '{}'::jsonb;
begin
  v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  if v_caller_role is null or v_caller_role <> 'service_role' then
    raise exception 'Only service_role may call persist_document_analysis_v1';
  end if;

  select id into v_existing_run_id
  from document_analysis_runs
  where client_request_id = p_client_request_id;

  if found then
    return jsonb_build_object(
      'analysis_run_id', v_existing_run_id,
      'duplicate', true,
      'documents', coalesce(
        (select jsonb_agg(jsonb_build_object('id', id, 'policy_document_id', policy_document_id))
         from extracted_documents
         where analysis_run_id = v_existing_run_id),
        '[]'::jsonb
      ),
      'candidates', coalesce(
        (select jsonb_agg(jsonb_build_object(
          'id', id,
          'asset_type', asset_type,
          'identity_fingerprint', identity_fingerprint,
          'display_label', display_label,
          'occupancy', occupancy,
          'match_classification', match_classification,
          'decision', decision,
          'review_status', review_status,
          'source_document_ids', source_document_ids,
          'draft_decision', draft_decision,
          'draft_identity_confirmed', draft_identity_confirmed,
          'draft_existing_asset_id', draft_existing_asset_id,
          'draft_existing_asset_type', draft_existing_asset_type
        ))
         from asset_candidates
         where analysis_run_id = v_existing_run_id),
        '[]'::jsonb
      )
    );
  end if;

  if p_analysis_json is null or p_analysis_json = '{}'::jsonb then
    raise exception 'p_analysis_json is required';
  end if;
  if p_documents_json is null or jsonb_typeof(p_documents_json) <> 'array' then
    raise exception 'p_documents_json must be a JSON array';
  end if;

  -- Reject candidate ids that already belong to a different household before any
  -- run/documents/candidates are written, so the transaction rolls back cleanly.
  if exists (
    select 1
    from asset_candidates ac
    where ac.household_id is distinct from p_household_id
      and ac.id in (
        select nullif(value->>'id', '')::uuid
        from jsonb_array_elements(coalesce(p_candidates_json, '[]'::jsonb)) as value
      )
  ) then
    raise exception 'CANDIDATE_HOUSEHOLD_CONFLICT: a candidate id belongs to another household' using errcode = 'P0001';
  end if;

  v_run_id := coalesce(p_analysis_run_id, gen_random_uuid());

  insert into document_analysis_runs (
    id,
    session_id,
    household_id,
    authorization_id,
    consent_id,
    model_provider,
    model_id,
    attempted_model_provider,
    attempted_model_id,
    fallback_reason,
    prompt_version,
    output_schema_version,
    attempt_count,
    raw_response_json,
    validated_output_json,
    warnings_json,
    provider_metadata_json,
    client_request_id
  ) values (
    v_run_id,
    p_session_id,
    p_household_id,
    p_authorization_id,
    p_consent_id,
    p_analysis_json->>'modelProvider',
    p_analysis_json->>'modelId',
    nullif(p_analysis_json->>'attemptedModelProvider', ''),
    nullif(p_analysis_json->>'attemptedModelId', ''),
    nullif(p_analysis_json->>'fallbackReason', ''),
    coalesce(p_analysis_json->>'promptVersion', '1.0.0'),
    coalesce(p_analysis_json->>'outputSchemaVersion', '1.0.0'),
    coalesce((p_analysis_json->>'attemptCount')::int, 1),
    p_analysis_json->'rawResponse',
    p_analysis_json->'validatedOutput',
    coalesce(p_analysis_json->'warnings', '[]'::jsonb),
    coalesce(p_analysis_json->'providerMetadata', '{}'::jsonb),
    p_client_request_id
  );

  for v_document in select * from jsonb_array_elements(p_documents_json) loop
    v_extracted_id := coalesce(nullif(v_document->>'id', '')::uuid, gen_random_uuid());

    insert into extracted_documents (
      id,
      session_id,
      household_id,
      policy_document_id,
      file_digest,
      page_count,
      classification,
      parser_id,
      parser_version,
      pages_json,
      analysis_run_id
    ) values (
      v_extracted_id,
      p_session_id,
      p_household_id,
      nullif(v_document->>'policy_document_id', '')::uuid,
      v_document->>'file_digest',
      coalesce((v_document->>'page_count')::int, 0),
      v_document->>'classification',
      v_document->>'parser_id',
      v_document->>'parser_version',
      coalesce(v_document->'pages_json', '[]'::jsonb),
      v_run_id
    );

    if v_document->>'policy_document_id' is not null then
      v_doc_map := v_doc_map || jsonb_build_object(v_document->>'policy_document_id', v_extracted_id::text);
    end if;
    v_result_documents := v_result_documents || jsonb_build_object(
      'id', v_extracted_id,
      'policy_document_id', nullif(v_document->>'policy_document_id', '')::uuid
    );
  end loop;

  for v_candidate in select * from jsonb_array_elements(p_candidates_json) loop
    v_candidate_id := nullif(v_candidate->>'id', '')::uuid;
    if v_candidate_id is null then
      raise exception 'candidate id is required';
    end if;

    v_identity_fingerprint := v_candidate->>'identity_fingerprint';
    v_asset_type := (v_candidate->>'asset_type')::candidate_asset_type;
    v_match_classification := (v_candidate->>'match_classification')::candidate_match_classification;
    v_source_doc_ids := coalesce(
      (select array_agg(distinct elem::uuid)
       from jsonb_array_elements_text(v_candidate->'source_document_ids') as elem
       where elem is not null and elem <> 'null' and elem <> ''),
      '{}'::uuid[]
    );

    v_draft_decision := nullif(v_candidate->>'draft_decision', '');
    v_draft_identity_confirmed :=
      case
        when v_candidate->>'draft_identity_confirmed' is null then null
        else (v_candidate->>'draft_identity_confirmed')::boolean
      end;
    v_draft_existing_asset_id := nullif(v_candidate->>'draft_existing_asset_id', '')::uuid;
    v_draft_existing_asset_type := nullif(v_candidate->>'draft_existing_asset_type', '');

    if v_identity_fingerprint is null or v_asset_type is null then
      raise exception 'candidate requires identity_fingerprint and asset_type';
    end if;

    if exists (
      select 1
      from unnest(v_source_doc_ids) as src_id
      where not exists (
        select 1
        from extracted_documents ed
        where ed.id = src_id and ed.household_id = p_household_id
      )
    ) then
      raise exception 'candidate references source document id not belonging to this household';
    end if;

    insert into asset_candidates (
      id,
      session_id,
      household_id,
      asset_type,
      identity_fingerprint,
      display_label,
      occupancy,
      match_classification,
      decision,
      review_status,
      draft_decision,
      draft_identity_confirmed,
      draft_existing_asset_id,
      draft_existing_asset_type,
      source_document_ids,
      selected_facts_json,
      conflicts_json,
      analysis_run_id
    ) values (
      v_candidate_id,
      p_session_id,
      p_household_id,
      v_asset_type,
      v_identity_fingerprint,
      v_candidate->>'display_label',
      nullif(v_candidate->>'occupancy', ''),
      v_match_classification,
      coalesce(v_candidate->>'decision', 'undecided')::candidate_decision,
      coalesce(v_candidate->>'review_status', 'pending'),
      v_draft_decision,
      coalesce(v_draft_identity_confirmed, false),
      v_draft_existing_asset_id,
      case when v_draft_existing_asset_type in ('vehicle','property') then v_draft_existing_asset_type::candidate_asset_type else null end,
      v_source_doc_ids,
      coalesce(v_candidate->'selected_facts_json', '{}'::jsonb),
      coalesce(v_candidate->'conflicts_json', '[]'::jsonb),
      v_run_id
    )
    on conflict (id) do update set
      session_id = excluded.session_id,
      display_label = coalesce(excluded.display_label, asset_candidates.display_label),
      occupancy = coalesce(excluded.occupancy, asset_candidates.occupancy),
      match_classification = excluded.match_classification,
      source_document_ids = excluded.source_document_ids,
      selected_facts_json = excluded.selected_facts_json,
      conflicts_json = excluded.conflicts_json,
      analysis_run_id = excluded.analysis_run_id,
      updated_at = now()
    where asset_candidates.household_id = p_household_id
      and (
        select case_id from document_extraction_sessions where id = asset_candidates.session_id
      ) is not distinct from (
        select case_id from document_extraction_sessions where id = excluded.session_id
      );

    v_result_candidates := v_result_candidates || jsonb_build_object(
      'id', v_candidate_id,
      'identity_fingerprint', v_identity_fingerprint
    );
  end loop;

  v_result := jsonb_build_object(
    'analysis_run_id', v_run_id,
    'duplicate', false,
    'documents', v_result_documents,
    'candidates', v_result_candidates
  );
  return v_result;
end;
$$;

grant execute on function persist_document_analysis_v1 to service_role;

-- =============================================================================
-- 3. persist_document_batch_analysis_v1: do not force candidate session_id
--    to the batch session. persist_document_analysis_v1 already sets the
--    correct session_id on insert and only moves it on same-case conflict.
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

commit;
