-- Corrective migration for the autopilot workflow resolver.
-- 20260804200001_autopilot_workflow_resolver.sql has already been applied remotely,
-- so this migration drops the overly-permissive confirmation RPC and replaces it
-- with a hardened single-argument version, and replaces the split advisory-lock
-- implementation with a single transactional batch-creation RPC.

begin;

-- Drop the old confirmation RPC that accepted a caller-supplied expected state.
drop function if exists confirm_customer_case_details(uuid, case_state);

-- Hardened confirmation RPC.
-- Enforces the literal source state 'awaiting_customer_confirmation'.
-- Idempotency: if the case has already advanced beyond the source state, only
-- returns already_confirmed when the confirmation audit event exists.
create or replace function confirm_customer_case_details(p_case_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_case optimization_cases%rowtype;
  v_has_audit boolean;
  v_audit_count integer;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_case
  from optimization_cases
  where id = p_case_id
  for update;

  if v_case.id is null then
    raise exception 'Case not found';
  end if;

  if not exists (
    select 1 from households
    where id = v_case.household_id
      and owner_profile_id = v_actor
  ) and not exists (
    select 1 from household_members
    where household_id = v_case.household_id
      and profile_id = v_actor
  ) then
    raise exception 'Case does not belong to this household';
  end if;

  -- Idempotent path: the case has already advanced past confirmation.
  -- Only acknowledge as already confirmed if the audit event actually exists.
  if v_case.state <> 'awaiting_customer_confirmation' then
    select count(*) into v_audit_count
    from audit_events
    where action = 'customer_confirmed_extracted_information'
      and case_id = v_case.id;

    if v_audit_count > 0 then
      return jsonb_build_object('already_confirmed', true, 'case_id', v_case.id);
    end if;

    raise exception 'Case is not ready for confirmation: %', v_case.state;
  end if;

  -- Perform the transition.
  update optimization_cases
  set state = 'ready_for_market_search',
      updated_at = now()
  where id = v_case.id;

  insert into audit_events (
    actor_profile_id, action, entity_type, entity_id, household_id, case_id,
    before_summary, after_summary
  ) values (
    v_actor,
    'customer_confirmed_extracted_information',
    'optimization_case',
    v_case.id,
    v_case.household_id,
    v_case.id,
    jsonb_build_object('state', v_case.state),
    jsonb_build_object('state', 'ready_for_market_search')
  );

  return jsonb_build_object('success', true, 'case_id', v_case.id);
end;
$$;

revoke all on function confirm_customer_case_details(uuid) from public, anon;
grant execute on function confirm_customer_case_details(uuid) to authenticated;

-- Transactional batch creation RPC.
-- Replaces the advisory-lock RPC and the split Edge Function logic.
-- Performs auth, household authorization, case validation, advisory transaction lock,
-- idempotency lookup, open-batch lookup, session/batch creation, audit-event
-- insertion, and returns the created or reused batch in one transaction.
--
-- Callers must supply either p_case_id or p_household_id, not both.
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
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if (p_case_id is null and p_household_id is null) or
     (p_case_id is not null and p_household_id is not null) then
    raise exception 'Provide exactly one of p_case_id or p_household_id';
  end if;

  if p_case_id is not null then
    -- Serialize concurrent per-case batch creation.
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
    -- Generic household upload path: lock household to avoid duplicate cases.
    perform pg_advisory_xact_lock(hashtextextended('household-batch-create:' || p_household_id::text, 0));

    v_household_id := p_household_id;

    insert into optimization_cases (household_id, created_by, state)
    values (v_household_id, v_actor, 'awaiting_documents')
    returning id into v_case_id;

    v_case_state := 'awaiting_documents';
  end if;

  -- Household authorization (applies to both branches).
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

  -- Consent and settings are the only authority for automatic processing.
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

  -- Client request id with a stable default for case uploads.
  v_client_request_id := coalesce(
    p_client_request_id,
    'case-upload:' || v_case_id::text
  );

  if length(v_client_request_id) = 0 or length(v_client_request_id) > 240 then
    raise exception 'Invalid client_request_id';
  end if;

  -- Idempotency by client request id.
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

  -- Reuse an existing open batch for this case.
  select * into v_existing_batch
  from document_processing_batches
  where household_id = v_household_id
    and case_id = v_case_id
    and status = 'uploading_files'
  order by created_at desc
  limit 1;

  if v_existing_batch.id is not null then
    return jsonb_build_object(
      'batch', to_jsonb(v_existing_batch),
      'session_id', v_existing_batch.session_id
    );
  end if;

  -- Create extraction session and batch atomically.
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

revoke all on function create_document_processing_batch(uuid, uuid, text, uuid) from public, anon;
grant execute on function create_document_processing_batch(uuid, uuid, text, uuid) to authenticated, service_role;

-- Drop the now-unused lock_case_batch helper.
drop function if exists lock_case_batch(uuid);

commit;
