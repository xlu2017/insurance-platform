-- Corrective migration for null-case idempotency conflicts.
-- 20260804200003_corrective_rpc_idempotency.sql is already deployed; this migration
-- hardens the conflict check so it does not rely on nullable case_id and returns
-- IDEMPOTENCY_KEY_CONFLICT even when the existing batch's case was deleted.

begin;

create or replace function create_document_processing_batch(
  p_case_id uuid default null,
  p_household_id uuid default null,
  p_client_request_id text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := coalesce(nullif(auth.uid()::text, '')::uuid, p_actor_id);
  v_household_id uuid;
  v_case_id uuid;
  v_case_state case_state;
  v_client_request_id text;
  v_setting household_document_processing_settings%rowtype;
  v_consent_id uuid;
  v_dangerous boolean;
  v_session_id uuid;
  v_batch document_processing_batches%rowtype;
  v_existing_batch document_processing_batches%rowtype;
  v_conflict_batch_id uuid;
  v_conflict_case_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if (p_case_id is null and p_household_id is null) or
     (p_case_id is not null and p_household_id is not null) then
    raise exception 'Provide exactly one of p_case_id or p_household_id';
  end if;

  if p_case_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('case-batch-create:' || p_case_id::text, 0));

    select id, household_id, state into v_case_id, v_household_id, v_case_state
    from optimization_cases
    where id = p_case_id
    for update;

    if v_case_id is null then
      raise exception 'Case not found';
    end if;

    if v_case_state not in ('draft', 'awaiting_documents') then
      raise exception 'Case is not accepting document uploads: %', v_case_state;
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended('household-batch-create:' || p_household_id::text, 0));

    select id into v_household_id
    from households
    where id = p_household_id;

    if v_household_id is null then
      raise exception 'Household not found';
    end if;

    if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
      raise exception 'client_request_id is required for a new household review';
    end if;
  end if;

  if not exists (
    select 1 from households
    where id = v_household_id
      and owner_profile_id = v_actor
  ) and not exists (
    select 1 from household_members
    where household_id = v_household_id
      and profile_id = v_actor
  ) then
    raise exception 'Household not found or access denied';
  end if;

  if p_case_id is not null then
    v_client_request_id := coalesce(nullif(trim(p_client_request_id), ''), 'case-upload:' || p_case_id::text);
  else
    v_client_request_id := trim(p_client_request_id);
  end if;

  if length(v_client_request_id) = 0 or length(v_client_request_id) > 240 then
    raise exception 'Invalid client_request_id';
  end if;

  if p_case_id is not null then
    select * into v_existing_batch
    from document_processing_batches
    where household_id = v_household_id
      and case_id = v_case_id
      and client_request_id = v_client_request_id
    limit 1;

    if v_existing_batch.id is not null then
      return jsonb_build_object(
        'batch', to_jsonb(v_existing_batch),
        'session_id', v_existing_batch.session_id
      );
    end if;

    -- Select the conflicting batch and its case_id explicitly. Use EXISTS semantics
    -- so a null case_id (e.g. the original case was deleted) still triggers the
    -- conflict rather than being misread as "no conflict".
    select id, case_id into v_conflict_batch_id, v_conflict_case_id
    from document_processing_batches
    where household_id = v_household_id
      and client_request_id = v_client_request_id
      and (case_id is null or case_id <> v_case_id)
    limit 1;

    if v_conflict_batch_id is not null then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT: client_request_id % is already used by %', v_client_request_id, coalesce(v_conflict_case_id::text, 'a deleted case')
        using errcode = 'P0001';
    end if;

    select * into v_existing_batch
    from document_processing_batches
    where case_id = v_case_id
      and status = 'uploading_files'
    limit 1;

    if v_existing_batch.id is not null then
      return jsonb_build_object(
        'batch', to_jsonb(v_existing_batch),
        'session_id', v_existing_batch.session_id
      );
    end if;
  else
    select * into v_existing_batch
    from document_processing_batches
    where household_id = v_household_id
      and client_request_id = v_client_request_id
    limit 1;

    if v_existing_batch.id is not null then
      return jsonb_build_object(
        'batch', to_jsonb(v_existing_batch),
        'session_id', v_existing_batch.session_id
      );
    end if;

    insert into optimization_cases (household_id, created_by, state)
    values (v_household_id, v_actor, 'awaiting_documents')
    returning id into v_case_id;

    v_case_state := 'awaiting_documents';
  end if;

  select * into v_setting
  from household_document_processing_settings
  where household_id = v_household_id;

  v_dangerous := coalesce(v_setting.dangerous_mode_enabled, false);

  if v_dangerous then
    select id into v_consent_id
    from document_processing_consent
    where household_id = v_household_id
      and purpose = 'insurance_policy_extraction'
      and status = 'active'
    order by consented_at desc
    limit 1;

    if v_consent_id is null then
      raise exception 'Automatic document processing consent is required'
        using errcode = 'P0001';
    end if;
  end if;

  v_session_id := gen_random_uuid();

  insert into document_extraction_sessions (id, household_id, created_by, case_id, status)
  values (v_session_id, v_household_id, v_actor, v_case_id, 'open');

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
    status
  ) values (
    v_household_id,
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
    'uploading_files'
  )
  returning * into v_batch;

  insert into audit_events (
    actor_profile_id, action, entity_type, entity_id, household_id, case_id,
    after_summary
  ) values (
    v_actor,
    'document_processing_batch_created',
    'document_processing_batch',
    v_batch.id,
    v_household_id,
    v_case_id,
    jsonb_build_object('mode', case when v_dangerous then 'automatic' else 'manual' end)
  );

  return jsonb_build_object(
    'batch', to_jsonb(v_batch),
    'session_id', v_session_id
  );
end;
$$;

create unique index if not exists document_processing_batches_household_id_client_request_id_key
  on document_processing_batches (household_id, client_request_id);

revoke all on function create_document_processing_batch(uuid, uuid, text, uuid) from public, anon;
grant execute on function create_document_processing_batch(uuid, uuid, text, uuid) to authenticated, service_role;

commit;
