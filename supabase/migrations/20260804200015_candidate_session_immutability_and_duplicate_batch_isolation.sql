-- Make candidate session ownership immutable, add durable parent/child lineage,
-- reject candidate ownership conflicts explicitly, and enforce batch/session case
-- alignment. This migration builds on 20260804200014 without rewriting it.
begin;

-- =============================================================================
-- 1. Durable candidate lineage.
-- =============================================================================

alter table asset_candidates
  add column if not exists parent_candidate_id uuid references asset_candidates(id) on delete set null;

create or replace function asset_candidates_ownership_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.session_id is distinct from old.session_id then
      raise exception 'CANDIDATE_SESSION_IMMUTABLE: candidate session_id cannot be changed' using errcode = 'P0001';
    end if;
    if new.household_id is distinct from old.household_id then
      raise exception 'CANDIDATE_HOUSEHOLD_IMMUTABLE: candidate household_id cannot be changed' using errcode = 'P0001';
    end if;
    if old.parent_candidate_id is not null and new.parent_candidate_id is distinct from old.parent_candidate_id then
      raise exception 'CANDIDATE_LINEAGE_IMMUTABLE: parent_candidate_id cannot be reassigned' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists asset_candidates_ownership_immutable on asset_candidates;
create trigger asset_candidates_ownership_immutable
  before insert or update on asset_candidates
  for each row execute function asset_candidates_ownership_immutable();

create or replace function asset_candidates_parent_integrity()
returns trigger
language plpgsql
as $$
begin
  if new.parent_candidate_id is null then
    return new;
  end if;
  if new.parent_candidate_id = new.id then
    raise exception 'CANDIDATE_LINEAGE_SELF: a candidate cannot be its own parent' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from asset_candidates parent
    where parent.id = new.parent_candidate_id
      and (parent.household_id is distinct from new.household_id or parent.asset_type is distinct from new.asset_type)
  ) then
    raise exception 'CANDIDATE_LINEAGE_PARENT_MISMATCH: parent candidate has different household or asset type' using errcode = 'P0001';
  end if;
  if exists (
    with recursive ancestors(id, parent_candidate_id) as (
      select id, parent_candidate_id
      from asset_candidates
      where id = new.parent_candidate_id
      union all
      select ac.id, ac.parent_candidate_id
      from asset_candidates ac
      inner join ancestors a on ac.id = a.parent_candidate_id
      where ac.parent_candidate_id is not null
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'CANDIDATE_LINEAGE_CYCLE: candidate lineage would create a cycle' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists asset_candidates_parent_integrity on asset_candidates;
create trigger asset_candidates_parent_integrity
  before insert or update on asset_candidates
  for each row execute function asset_candidates_parent_integrity();

-- =============================================================================
-- 2. Batch/session household and case alignment.
-- =============================================================================

create or replace function validate_document_processing_batch_session()
returns trigger
language plpgsql
as $$
declare
  v_session_household uuid;
  v_session_case uuid;
begin
  if new.session_id is null then
    return new;
  end if;
  select household_id, case_id into v_session_household, v_session_case
  from document_extraction_sessions
  where id = new.session_id;
  if not found then
    raise exception 'BATCH_SESSION_NOT_FOUND: session % does not exist', new.session_id using errcode = 'P0001';
  end if;
  if v_session_household is distinct from new.household_id then
    raise exception 'BATCH_SESSION_HOUSEHOLD_MISMATCH: batch household does not match session household' using errcode = 'P0001';
  end if;
  if v_session_case is distinct from new.case_id then
    raise exception 'BATCH_SESSION_CASE_MISMATCH: batch case does not match session case' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_document_processing_batch_session on document_processing_batches;
create trigger validate_document_processing_batch_session
  before insert or update on document_processing_batches
  for each row execute function validate_document_processing_batch_session();

-- =============================================================================
-- 2b. Allow the same physical document to be extracted in multiple sessions so
--     a duplicate-document fast path can create session-local copies without
--     deleting the prior extraction.
-- =============================================================================

alter table extracted_documents
  drop constraint if exists extracted_documents_household_digest_unique;

alter table extracted_documents
  add constraint extracted_documents_household_session_digest_unique
  unique (household_id, session_id, file_digest);

-- =============================================================================
-- 3. Replace persist_document_analysis_v1 to enforce immutable ownership and
--    explicit ownership-conflict errors.
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
  v_parent_candidate_id uuid;
  v_source_doc_ids uuid[];
  v_identity_fingerprint text;
  v_asset_type candidate_asset_type;
  v_match_classification candidate_match_classification;
  v_selected_facts_json jsonb;
  v_conflicts_json jsonb;
  v_display_label text;
  v_occupancy text;
  v_result jsonb;
  v_result_documents jsonb := '[]'::jsonb;
  v_result_candidates jsonb := '[]'::jsonb;
  v_doc_map jsonb := '{}'::jsonb;
  v_existing_session_id uuid;
  v_existing_household_id uuid;
  v_existing_analysis_run_id uuid;
  v_candidate_ids uuid[];
  v_existing_candidate record;
  v_invariant_ok boolean;
  v_new_source_doc_ids uuid[];
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
          'draft_existing_asset_type', draft_existing_asset_type,
          'parent_candidate_id', parent_candidate_id
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

  -- Lock any existing candidate rows referenced by the submitted ids and collect
  -- their ownership for explicit conflict checks.
  select array_agg(nullif(value->>'id', '')::uuid) into v_candidate_ids
  from jsonb_array_elements(coalesce(p_candidates_json, '[]'::jsonb)) as value;

  if v_candidate_ids is not null and array_length(v_candidate_ids, 1) > 0 then
    for v_existing_candidate in
      select id, session_id, household_id, analysis_run_id
      from asset_candidates
      where id = any(v_candidate_ids)
      for update
    loop
      if v_existing_candidate.household_id is distinct from p_household_id then
        raise exception 'CANDIDATE_HOUSEHOLD_CONFLICT: candidate % belongs to another household', v_existing_candidate.id using errcode = 'P0001';
      end if;
      if v_existing_candidate.session_id is distinct from p_session_id then
        raise exception 'CANDIDATE_SESSION_CONFLICT: candidate % belongs to a different session', v_existing_candidate.id using errcode = 'P0001';
      end if;
    end loop;
  end if;

  for v_candidate in select * from jsonb_array_elements(p_candidates_json) loop
    v_candidate_id := nullif(v_candidate->>'id', '')::uuid;
    if v_candidate_id is null then
      raise exception 'candidate id is required';
    end if;

    v_parent_candidate_id := nullif(v_candidate->>'parent_candidate_id', '')::uuid;
    v_identity_fingerprint := v_candidate->>'identity_fingerprint';
    v_asset_type := (v_candidate->>'asset_type')::candidate_asset_type;
    v_match_classification := (v_candidate->>'match_classification')::candidate_match_classification;
    v_source_doc_ids := coalesce(
      (select array_agg(distinct elem::uuid)
       from jsonb_array_elements_text(v_candidate->'source_document_ids') as elem
       where elem is not null and elem <> 'null' and elem <> ''),
      '{}'::uuid[]
    );

    if v_identity_fingerprint is null or v_asset_type is null then
      raise exception 'candidate requires identity_fingerprint and asset_type';
    end if;

    if exists (
      select 1
      from unnest(v_source_doc_ids) as src_id
      where not exists (
        select 1
        from extracted_documents ed
        where ed.id = src_id and ed.household_id = p_household_id and ed.session_id = p_session_id
      )
    ) then
      raise exception 'candidate references source document id not belonging to this household';
    end if;

    v_display_label := coalesce(v_candidate->>'display_label', '');
    v_occupancy := nullif(v_candidate->>'occupancy', '');
    v_selected_facts_json := coalesce(v_candidate->'selected_facts_json', '{}'::jsonb);
    v_conflicts_json := coalesce(v_candidate->'conflicts_json', '[]'::jsonb);

    -- Look up the locked row again. The for-update loop above already verified
    -- ownership; this branch handles actual insert vs update.
    select session_id, household_id, analysis_run_id
    into v_existing_session_id, v_existing_household_id, v_existing_analysis_run_id
    from asset_candidates
    where id = v_candidate_id;

    if found then
      -- Same-session update: merge source documents, refresh mutable fields, and
      -- point analysis provenance at the current run. Ownership fields are not
      -- listed and are guarded by the ownership-immutable trigger.
      v_new_source_doc_ids := (
        select array_agg(distinct elem)
        from unnest(coalesce(v_source_doc_ids, '{}'::uuid[]) || (
          select coalesce(source_document_ids, '{}'::uuid[]) from asset_candidates where id = v_candidate_id
        )) as elem
        where elem is not null
      );

      update asset_candidates
      set
        display_label = coalesce(v_display_label, display_label),
        occupancy = coalesce(v_occupancy, occupancy),
        match_classification = v_match_classification,
        source_document_ids = v_new_source_doc_ids,
        selected_facts_json = v_selected_facts_json,
        conflicts_json = v_conflicts_json,
        analysis_run_id = v_run_id,
        updated_at = now()
      where id = v_candidate_id
        and session_id = p_session_id
        and household_id = p_household_id
      returning analysis_run_id into v_existing_analysis_run_id;

      if not found then
        raise exception 'CANDIDATE_SESSION_CONFLICT: candidate % could not be updated in session %', v_candidate_id, p_session_id using errcode = 'P0001';
      end if;
    else
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
        analysis_run_id,
        parent_candidate_id
      ) values (
        v_candidate_id,
        p_session_id,
        p_household_id,
        v_asset_type,
        v_identity_fingerprint,
        v_display_label,
        v_occupancy,
        v_match_classification,
        coalesce(v_candidate->>'decision', 'undecided')::candidate_decision,
        coalesce(v_candidate->>'review_status', 'pending'),
        nullif(v_candidate->>'draft_decision', ''),
        coalesce((v_candidate->>'draft_identity_confirmed')::boolean, false),
        nullif(v_candidate->>'draft_existing_asset_id', '')::uuid,
        case when nullif(v_candidate->>'draft_existing_asset_type', '') in ('vehicle','property')
          then nullif(v_candidate->>'draft_existing_asset_type', '')::candidate_asset_type
          else null end,
        v_source_doc_ids,
        v_selected_facts_json,
        v_conflicts_json,
        v_run_id,
        v_parent_candidate_id
      )
      on conflict (id) do update set
        display_label = coalesce(excluded.display_label, asset_candidates.display_label),
        occupancy = coalesce(excluded.occupancy, asset_candidates.occupancy),
        match_classification = excluded.match_classification,
        source_document_ids = (
          select array_agg(distinct elem)
          from unnest(coalesce(excluded.source_document_ids, '{}'::uuid[]) || coalesce(asset_candidates.source_document_ids, '{}'::uuid[])) as elem
          where elem is not null
        ),
        selected_facts_json = excluded.selected_facts_json,
        conflicts_json = excluded.conflicts_json,
        analysis_run_id = excluded.analysis_run_id,
        updated_at = now()
      where asset_candidates.session_id = excluded.session_id
        and asset_candidates.household_id = excluded.household_id
      returning analysis_run_id into v_existing_analysis_run_id;

      -- The conflict path above should only be reachable if another transaction
      -- inserted the same id after the for-update lock. Verify ownership below.
    end if;

    -- Prove the invariant before returning the candidate id.
    select true into v_invariant_ok
    from asset_candidates
    where id = v_candidate_id
      and household_id = p_household_id
      and session_id = p_session_id
      and analysis_run_id = v_run_id;

    if not v_invariant_ok then
      raise exception 'CANDIDATE_OWNERSHIP_INVARIANT: candidate % was not persisted in the expected session/run', v_candidate_id using errcode = 'P0001';
    end if;

    v_result_candidates := v_result_candidates || jsonb_build_object(
      'id', v_candidate_id,
      'identity_fingerprint', v_identity_fingerprint,
      'parent_candidate_id', v_parent_candidate_id
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
-- 4. Replace persist_document_batch_analysis_v1 to keep the batch/session
--    association immutable and validate each review candidate belongs to the
--    batch session.
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
  v_batch_session_id uuid;
  v_batch_case_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only service_role may persist document batch analysis';
  end if;
  if jsonb_typeof(p_reviews_json) <> 'array' then
    raise exception 'p_reviews_json must be a JSON array';
  end if;

  select session_id, case_id into v_batch_session_id, v_batch_case_id
  from document_processing_batches
  where id = p_batch_id
    and household_id = p_household_id
    and mode_snapshot = 'dangerous';

  if not found then
    raise exception 'Document processing batch does not match the household and session';
  end if;

  if v_batch_session_id is distinct from p_session_id then
    raise exception 'BATCH_SESSION_CONFLICT: batch session does not match persistence session';
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
           and analysis_run_id = (v_result->>'analysis_run_id')::uuid
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
