-- Staged batch creation, normalization reuse derivation, and overlap-aware extraction wiring.
begin;

-- =============================================================================
-- 1. Fix batch normalization use_status so reused normalizations are recorded.
-- =============================================================================

-- The two-argument helper is redefined here so service-role callers may omit an
-- explicit actor. The authenticated path still requires a real household member.
create or replace function require_household_member_or_service_role(p_household_id uuid, p_supplied_actor_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
DECLARE
  v_actor uuid;
begin
  if auth.role() = 'service_role' then
    if p_supplied_actor_id is not null then
      if not exists (select 1 from profiles where id = p_supplied_actor_id) then
        raise exception 'Supplied actor profile does not exist' using errcode = 'P0001';
      end if;
      return p_supplied_actor_id;
    end if;
    return auth.uid();
  end if;

  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;
  if not is_household_member(p_household_id) then
    raise exception 'Household access denied' using errcode = 'P0001';
  end if;
  return v_actor;
end;
$$;

create or replace function persist_document_normalization_for_batch_v1(
  p_batch_id uuid,
  p_batch_item_id uuid,
  p_household_id uuid,
  p_policy_document_id uuid,
  p_content_sha256 text,
  p_normalization_schema_version text,
  p_analyzer_version text,
  p_model_provider text,
  p_model_id text,
  p_prompt_version text,
  p_classification text,
  p_normalized_output_json jsonb,
  p_normalized_entities_json jsonb,
  p_conflicts_json jsonb,
  p_evidence_json jsonb,
  p_processing_generation integer
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_norm_result jsonb;
  v_norm_id uuid;
  v_batch_status text;
  v_batch_session uuid;
  v_batch_generation integer;
  v_item_exists boolean;
  v_candidate_derivation_allowed boolean := true;
  v_use_status text := 'created';
  v_reused boolean;
begin
  if p_processing_generation is null or p_batch_id is null then
    raise exception 'Missing batch or generation' using errcode = 'P0001';
  end if;

  select status, session_id, processing_generation
  into v_batch_status, v_batch_session, v_batch_generation
  from document_processing_batches
  where id = p_batch_id
    and household_id = p_household_id
  for update;

  if v_batch_generation is null then
    raise exception 'Batch not found' using errcode = 'P0001';
  end if;

  if v_batch_generation <> p_processing_generation then
    raise exception 'DOCUMENT_BATCH_GENERATION_MISMATCH' using errcode = 'P0001';
  end if;

  if v_batch_status in ('superseded', 'cancellation_requested') then
    v_candidate_derivation_allowed := false;
    v_use_status := 'late_superseded_result';
  elsif v_batch_status = 'waiting_for_predecessor' then
    raise exception 'BATCH_WAITING_FOR_PREDECESSOR' using errcode = 'P0001';
  end if;

  select exists (select 1 from document_processing_batch_items where id = p_batch_item_id and batch_id = p_batch_id)
  into v_item_exists;
  if not v_item_exists then
    raise exception 'BATCH_ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_norm_result := persist_document_normalization_v1(
    p_household_id,
    p_policy_document_id,
    p_content_sha256,
    p_normalization_schema_version,
    p_analyzer_version,
    p_model_provider,
    p_model_id,
    p_prompt_version,
    p_classification,
    p_normalized_output_json,
    p_normalized_entities_json,
    p_conflicts_json,
    p_evidence_json
  );

  v_norm_id := (v_norm_result->>'id')::uuid;
  v_reused := coalesce((v_norm_result->>'reused')::boolean, false);

  if v_reused and v_use_status = 'created' then
    v_use_status := 'reused';
  end if;

  insert into document_processing_batch_normalizations (
    batch_id, batch_item_id, normalization_id, use_status
  ) values (
    p_batch_id, p_batch_item_id, v_norm_id, v_use_status
  )
  on conflict (batch_id, batch_item_id) do update set
    normalization_id = excluded.normalization_id,
    use_status = excluded.use_status,
    updated_at = now()
  returning use_status into v_use_status;

  return jsonb_build_object(
    'normalization_id', v_norm_id,
    'candidate_derivation_allowed', v_candidate_derivation_allowed,
    'use_status', v_use_status,
    'reused', v_reused
  );
end;
$$;

revoke all on function persist_document_normalization_for_batch_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb, integer) from public, anon;
grant execute on function persist_document_normalization_for_batch_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb, integer) to service_role;

-- =============================================================================
-- 2. Transactional creation of a processing batch from staged policy documents.
-- =============================================================================

create or replace function create_document_batch_from_staged_v1(
  p_household_id uuid,
  p_policy_document_ids uuid[] default '{}'::uuid[],
  p_client_request_id text default null,
  p_case_id uuid default null,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_case_id uuid;
  v_case_state case_state;
  v_client_request_id text;
  v_doc record;
  v_sorted_doc_ids uuid[];
  v_seen uuid[] := '{}'::uuid[];
  v_existing_batch document_processing_batches%rowtype;
  v_existing_item document_processing_batch_items%rowtype;
  v_existing_doc_ids uuid[];
  v_session_id uuid;
  v_batch_id uuid;
  v_setting household_document_processing_settings%rowtype;
  v_consent_id uuid;
  v_dangerous boolean;
  v_item_count int;
  v_policy_doc_count int;
  v_i uuid;
begin
  v_actor := require_household_member_or_service_role(p_household_id, p_actor_id);

  if p_household_id is null then
    raise exception 'HOUSEHOLD_REQUIRED' using errcode = 'P0001';
  end if;

  if coalesce(p_client_request_id, '') = '' then
    raise exception 'CLIENT_REQUEST_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if length(p_client_request_id) > 240 then
    raise exception 'Invalid client_request_id' using errcode = 'P0001';
  end if;

  -- Reject null or empty document input before any case, session or batch is created.
  if p_policy_document_ids is null or array_length(p_policy_document_ids, 1) is null or array_length(p_policy_document_ids, 1) = 0 then
    raise exception 'POLICY_DOCUMENT_IDS_REQUIRED' using errcode = 'P0001';
  end if;

  -- Validate and deduplicate document IDs.
  foreach v_i in array p_policy_document_ids loop
    if v_i is null then
      raise exception 'NULL_POLICY_DOCUMENT_ID' using errcode = 'P0001';
    end if;
    if v_i = any(v_seen) then
      raise exception 'DUPLICATE_POLICY_DOCUMENT_ID: %', v_i using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_i;
  end loop;

  select array_agg(id order by id) into v_sorted_doc_ids
  from unnest(v_seen) as id;

  perform pg_advisory_xact_lock(household_advisory_lock_key(p_household_id));

  -- Idempotency: same client request id with same document set returns existing batch
  -- before re-validating document status. The first call already transitioned staged
  -- documents to uploaded, so a replay must not fail on status.
  select * into v_existing_batch
  from document_processing_batches
  where household_id = p_household_id
    and client_request_id = p_client_request_id
  for update;

  if v_existing_batch.id is not null then
    select array_agg(policy_document_id order by policy_document_id) into v_existing_doc_ids
    from document_processing_batch_items
    where batch_id = v_existing_batch.id;

    if v_existing_doc_ids is not distinct from v_sorted_doc_ids then
      return jsonb_build_object(
        'batch', to_jsonb(v_existing_batch),
        'session_id', v_existing_batch.session_id
      );
    else
      raise exception 'CONTINUATION_PAYLOAD_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  -- Validate all documents belong to the household and are still attachable.
  if v_seen <> '{}'::uuid[] then
    for v_doc in
      select id, household_id, status, content_sha256, file_name, category
      from policy_documents
      where id = any(v_seen)
    loop
      if v_doc.household_id is distinct from p_household_id then
        raise exception 'POLICY_DOCUMENT_FOREIGN: %', v_doc.id using errcode = 'P0001';
      end if;
      if v_doc.status <> 'staged' then
        raise exception 'POLICY_DOCUMENT_NOT_STAGED: %', v_doc.id using errcode = 'P0001';
      end if;
    end loop;
  end if;

  select count(*) into v_policy_doc_count
  from policy_documents
  where id = any(v_seen)
    and household_id = p_household_id
    and status = 'staged';

  if v_policy_doc_count <> coalesce(array_length(v_seen, 1), 0) then
    raise exception 'MISSING_OR_FOREIGN_POLICY_DOCUMENT' using errcode = 'P0001';
  end if;

  -- Case validation and creation.
  if p_case_id is not null then
    select id, state into v_case_id, v_case_state
    from optimization_cases
    where id = p_case_id
      and household_id = p_household_id
    for update;

    if v_case_id is null or v_case_state is null then
      raise exception 'CASE_NOT_FOUND_OR_FOREIGN' using errcode = 'P0001';
    end if;

    if v_case_state not in ('draft', 'awaiting_documents', 'extracting_information') then
      raise exception 'CASE_NOT_ACCEPTING_UPLOADS: %', v_case_state using errcode = 'P0001';
    end if;
  else
    insert into optimization_cases (household_id, created_by, state)
    values (p_household_id, v_actor, 'extracting_information')
    returning id into v_case_id;
  end if;

  -- Consent and settings.
  select * into v_setting
  from household_document_processing_settings
  where household_id = p_household_id;

  v_dangerous := coalesce(v_setting.dangerous_mode_enabled, false);

  if v_dangerous then
    select id into v_consent_id
    from document_processing_consent
    where household_id = p_household_id
      and purpose = 'insurance_policy_extraction'
      and status = 'active'
    order by consented_at desc
    limit 1;

    if v_consent_id is null then
      raise exception 'Automatic document processing consent is required' using errcode = 'P0001';
    end if;
  end if;

  v_client_request_id := p_client_request_id;
  v_session_id := gen_random_uuid();

  insert into document_extraction_sessions (id, household_id, created_by, case_id, status)
  values (v_session_id, p_household_id, v_actor, v_case_id, 'open');

  insert into document_processing_batches (
    household_id,
    created_by,
    client_request_id,
    session_id,
    case_id,
    mode_snapshot,
    settings_version,
    disclosure_version,
    configured_provider,
    configured_model_id,
    consent_id,
    status,
    processing_generation,
    document_count,
    unique_document_count,
    deduplicated_count
  ) values (
    p_household_id,
    v_actor,
    v_client_request_id,
    v_session_id,
    v_case_id,
    case when v_dangerous then 'dangerous' else 'safe' end,
    coalesce(v_setting.setting_version, 1),
    v_setting.disclosure_version,
    v_setting.configured_provider,
    v_setting.configured_model_id,
    v_consent_id,
    'queued',
    1,
    0,
    0,
    0
  )
  returning id into v_batch_id;

  -- Create batch items and transition staged documents to attached.
  insert into document_processing_batch_items (
    batch_id,
    household_id,
    client_item_id,
    policy_document_id,
    selected_file_name,
    category,
    content_sha256,
    deduplicated,
    duplicate_of_policy_document_id,
    status
  )
  select
    v_batch_id,
    p_household_id,
    'staged:' || pd.id::text,
    pd.id,
    pd.file_name,
    pd.category,
    pd.content_sha256,
    false,
    null,
    'uploaded'
  from policy_documents pd
  where pd.id = any(v_seen)
    and pd.household_id = p_household_id
    and pd.status = 'staged'
  order by pd.id;

  update policy_documents
  set status = 'uploaded', updated_at = now()
  where id = any(v_seen)
    and household_id = p_household_id
    and status = 'staged';

  select count(*) into v_item_count
  from document_processing_batch_items
  where batch_id = v_batch_id;

  update document_processing_batches
  set document_count = v_item_count,
      unique_document_count = v_item_count,
      deduplicated_count = 0,
      updated_at = now()
  where id = v_batch_id;

  insert into audit_events (
    actor_profile_id, action, entity_type, entity_id, household_id, case_id,
    after_summary
  ) values (
    v_actor,
    'document_processing_batch_created_from_staged',
    'document_processing_batch',
    v_batch_id,
    p_household_id,
    v_case_id,
    jsonb_build_object('document_count', v_item_count, 'staged', true)
  );

  return jsonb_build_object(
    'batch', (select to_jsonb(b) from document_processing_batches b where b.id = v_batch_id),
    'session_id', v_session_id
  );
end;
$$;

revoke all on function create_document_batch_from_staged_v1(uuid, uuid[], text, uuid, uuid) from public, anon;
grant execute on function create_document_batch_from_staged_v1(uuid, uuid[], text, uuid, uuid) to authenticated, service_role;

-- =============================================================================
-- 3. Plan upload enriched with exact-duplicate metadata from normalizations.
-- =============================================================================

create or replace function plan_document_upload_v1(
  p_household_id uuid,
  p_new_policy_document_ids uuid[] default '{}'::uuid[],
  p_case_id uuid default null,
  p_continuation_request_id text default null,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_active_batch document_processing_batches%rowtype;
  v_doc record;
  v_current_doc_id uuid;
  v_unique_docs uuid[];
  v_seen uuid[] := '{}'::uuid[];
  v_total_docs int;
  v_completed int;
  v_unfinished int;
  v_new_upload_count int;
  v_reusable_count int;
  v_new_norm_count int;
  v_lower int;
  v_upper int;
  v_current_lower int;
  v_current_upper int;
  v_queued_lower int;
  v_queued_upper int;
  v_exact_duplicates jsonb := '[]'::jsonb;
  v_metadata jsonb;
  v_policy jsonb;
  v_entities jsonb;
  v_plan_request_id text;
begin
  v_actor := require_household_member_or_service_role(p_household_id, p_actor_id);

  if p_case_id is not null then
    if not exists (
      select 1 from optimization_cases
      where id = p_case_id and household_id = p_household_id
    ) then
      raise exception 'CASE_NOT_FOUND_OR_FOREIGN' using errcode = 'P0001';
    end if;
  end if;

  foreach v_current_doc_id in array p_new_policy_document_ids loop
    if v_current_doc_id is null then
      raise exception 'NULL_POLICY_DOCUMENT_ID' using errcode = 'P0001';
    end if;
    if v_current_doc_id = any(v_seen) then
      raise exception 'DUPLICATE_POLICY_DOCUMENT_ID: %', v_current_doc_id using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_current_doc_id;
  end loop;

  if v_seen <> '{}'::uuid[] then
    for v_doc in
      select id, household_id, content_sha256, file_name
      from policy_documents
      where id = any(v_seen)
    loop
      if v_doc.household_id is distinct from p_household_id then
        raise exception 'POLICY_DOCUMENT_FOREIGN: %', v_doc.id using errcode = 'P0001';
      end if;
    end loop;
  end if;

  v_unique_docs := v_seen;
  v_new_upload_count := coalesce(array_length(v_unique_docs, 1), 0);

  perform pg_advisory_xact_lock(household_advisory_lock_key(p_household_id));

  select * into v_active_batch
  from document_processing_batches
  where household_id = p_household_id
    and (
      p_case_id is null
      or case_id = p_case_id
    )
    and status in (
      'queued',
      'reading_policy_documents',
      'comparing_policies',
      'validating_extracted_details',
      'uploading_files',
      'checking_duplicates'
    )
  order by processing_generation desc, created_at desc
  limit 1;

  v_reusable_count := 0;
  for v_doc in
    select pd.id, pd.content_sha256, pd.file_name,
      n.id as normalization_id,
      n.normalized_entities_json,
      n.normalized_output_json,
      n.model_provider,
      n.model_id,
      n.analyzer_version,
      n.prompt_version
    from policy_documents pd
    left join document_normalizations n
      on n.household_id = p_household_id
      and n.content_sha256 = pd.content_sha256
      and n.normalization_schema_version = '1.0.0'
      and n.analyzer_version = 'default-v1'
      and n.status = 'complete'
    where pd.id = any(v_unique_docs)
      and pd.household_id = p_household_id
  loop
    if v_doc.normalization_id is not null then
      v_reusable_count := v_reusable_count + 1;

      v_policy := coalesce(v_doc.normalized_output_json->'policy', '{}'::jsonb);
      v_entities := coalesce(v_doc.normalized_entities_json, '[]'::jsonb);

      v_metadata := jsonb_build_object(
        'policyDocumentId', v_doc.id,
        'normalizationId', v_doc.normalization_id,
        'originalFilename', v_doc.file_name,
        'insurer', v_policy->>'insurer',
        'policyNumber', v_policy->>'policyNumber',
        'effectiveDate', v_policy->>'effectiveDate',
        'expiryDate', v_policy->>'expiryDate',
        'identifiedAssets', (
          select coalesce(jsonb_agg(distinct e->>'displayLabel'), '[]'::jsonb)
          from jsonb_array_elements(v_entities) as e
          where e->>'displayLabel' is not null
        ),
        'processingVersion', coalesce(v_doc.model_provider, 'unknown') || '/' ||
                             coalesce(v_doc.model_id, 'unknown') || '/' ||
                             coalesce(v_doc.analyzer_version, 'default-v1') || '/' ||
                             coalesce(v_doc.prompt_version, '1.0.0')
      );

      v_exact_duplicates := v_exact_duplicates || v_metadata;
    end if;
  end loop;

  v_new_norm_count := v_new_upload_count - v_reusable_count;

  if v_active_batch.id is null then
    v_lower := 180 + (v_new_norm_count * 120);
    v_upper := 420 + (v_new_norm_count * 240);

    return jsonb_build_object(
      'activeBatchId', null,
      'activeStatus', null,
      'activeBatchGeneration', null,
      'newUploadCount', v_new_upload_count,
      'reusableNormalizationCount', v_reusable_count,
      'newNormalizationCount', v_new_norm_count,
      'completedNormalizationCount', 0,
      'unfinishedCurrentCount', 0,
      'exactDuplicateDocuments', v_exact_duplicates,
      'restartEstimate', jsonb_build_object(
        'lowerSeconds', v_lower,
        'upperSeconds', v_upper,
        'reviewPasses', 1
      ),
      'waitEstimate', null
    );
  end if;

  select count(*) into v_total_docs
  from document_processing_batch_items
  where batch_id = v_active_batch.id;

  select count(*) into v_completed
  from document_processing_batch_normalizations b
  join document_normalizations n on n.id = b.normalization_id
  where b.batch_id = v_active_batch.id
    and n.status = 'complete';

  v_unfinished := v_total_docs - v_completed;

  v_current_lower := 60 + (v_unfinished * 60);
  v_current_upper := 180 + (v_unfinished * 120);
  v_queued_lower := v_current_upper + 60 + (v_new_norm_count * 120);
  v_queued_upper := v_current_upper + 120 + (v_new_norm_count * 240);
  v_lower := 180 + ((v_unfinished + v_new_norm_count) * 120);
  v_upper := 420 + ((v_unfinished + v_new_norm_count) * 240);

  return jsonb_build_object(
    'activeBatchId', v_active_batch.id,
    'activeStatus', v_active_batch.status,
    'activeBatchGeneration', v_active_batch.processing_generation,
    'newUploadCount', v_new_upload_count,
    'reusableNormalizationCount', v_reusable_count,
    'newNormalizationCount', v_new_norm_count,
    'completedNormalizationCount', v_completed,
    'unfinishedCurrentCount', v_unfinished,
    'exactDuplicateDocuments', v_exact_duplicates,
    'restartEstimate', jsonb_build_object(
      'lowerSeconds', v_lower,
      'upperSeconds', v_upper,
      'reviewPasses', 1
    ),
    'waitEstimate', jsonb_build_object(
      'currentLowerSeconds', v_current_lower,
      'currentUpperSeconds', v_current_upper,
      'queuedLowerSeconds', v_queued_lower,
      'queuedUpperSeconds', v_queued_upper,
      'reviewPasses', 2
    )
  );
end;
$$;

revoke all on function plan_document_upload_v1(uuid, uuid[], uuid, text, uuid) from public, anon;
grant execute on function plan_document_upload_v1(uuid, uuid[], uuid, text, uuid) to authenticated, service_role;

commit;
