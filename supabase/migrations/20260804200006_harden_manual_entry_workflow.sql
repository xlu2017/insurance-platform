-- Harden the safe-mode manual-entry workflow.
-- Adds idempotency, multi-asset drafts, provenance, and strict validation
-- for customer-driven manual entry after a safe document upload.
begin;

-- Drop prior overloads that would conflict with the hardened signatures.
drop function if exists public.save_customer_manual_policy_review_v1(
  uuid, uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, text, candidate_match_classification, jsonb, jsonb
);
drop function if exists public.complete_manual_review_v1(
  uuid, uuid, uuid, uuid, uuid, uuid[]
);

-- 1. Track which batch documents are assigned to a manual-entry candidate,
--    explicitly skipped, or still unassigned.
alter table document_processing_batch_items
  add column if not exists manual_entry_status text not null default 'unassigned'
  check (manual_entry_status in ('unassigned', 'assigned', 'skipped'));

-- 2. Idempotency ledger for manual-entry operations.
create table if not exists manual_entry_idempotency (
  id uuid primary key default gen_random_uuid(),
  operation_type text not null check (operation_type in ('save_candidate', 'complete_entry')),
  client_request_id text not null,
  household_id uuid not null references households(id) on delete cascade,
  batch_id uuid not null references document_processing_batches(id) on delete cascade,
  result_id uuid,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (household_id, batch_id, operation_type, client_request_id)
);

alter table manual_entry_idempotency enable row level security;

create policy manual_entry_idempotency_select on manual_entry_idempotency
  for select to authenticated using (is_household_member(household_id));

grant select, insert on manual_entry_idempotency to authenticated, service_role;

-- 3. Hardened customer manual-entry candidate draft save.
create or replace function save_customer_manual_policy_review_v1(
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

  -- Serialize per (household, batch, operation, request id).
  perform pg_advisory_xact_lock(hashtextextended('manual-entry:' || p_household_id::text || ':' || p_batch_id::text || ':save_candidate:' || p_client_request_id, 0));

  -- Idempotency: return the previously saved candidate for this request.
  select id, result_json into v_ledger_id, v_result
  from manual_entry_idempotency
  where household_id = p_household_id
    and batch_id = p_batch_id
    and operation_type = 'save_candidate'
    and client_request_id = p_client_request_id;
  if found then
    return v_result;
  end if;

  -- Lock and validate the case, session, and batch rows and their linkage.
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
    raise exception 'Batch must be resolved before manual entry' using errcode = 'P0001';
  end if;
  if v_batch.status not in ('manual_review', 'processing_unavailable') then
    raise exception 'Batch is not in a manual-entry state: %', v_batch.status using errcode = 'P0001';
  end if;

  if v_case.state not in ('awaiting_documents', 'extracting_information') then
    raise exception 'Case is not accepting manual entry: %', v_case.state using errcode = 'P0001';
  end if;

  -- Validate all selected source documents belong to this batch.
  if p_source_document_ids is null or array_length(p_source_document_ids, 1) is null then
    raise exception 'At least one source document is required' using errcode = 'P0001';
  end if;
  foreach v_doc_id in array p_source_document_ids
  loop
    if not exists (
      select 1 from document_processing_batch_items
      where batch_id = p_batch_id
        and household_id = p_household_id
        and policy_document_id = v_doc_id
    ) then
      raise exception 'Source document % does not belong to batch', v_doc_id using errcode = 'P0001';
    end if;
  end loop;

  -- Build facts with provenance; do not coerce missing values.
  v_occupancy := nullif(trim(coalesce(p_occupancy, '')), '');
  v_facts := coalesce(p_selected_facts_json, '{}'::jsonb)
    || jsonb_build_object('_source', 'customer_manual_entry')
    || jsonb_build_object('_manual_entry_batch_id', p_batch_id)
    || jsonb_build_object('_manual_entry_session_id', p_session_id);

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
    selected_facts_json
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
    v_facts
  ) returning id into v_candidate_id;

  -- Mark selected source documents as assigned.
  update document_processing_batch_items
  set manual_entry_status = 'assigned'
  where batch_id = p_batch_id
    and policy_document_id = any(p_source_document_ids);

  -- The batch stays in its manual-entry state until the customer explicitly finishes.

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
    'customer_manual_candidate_saved',
    'asset_candidate',
    v_candidate_id,
    p_household_id,
    p_case_id,
    jsonb_build_object(
      'batch_id', p_batch_id,
      'session_id', p_session_id,
      'asset_type', p_asset_type,
      'source_document_ids', p_source_document_ids,
      'source', 'customer_manual_entry'
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
    'save_candidate',
    p_client_request_id,
    p_household_id,
    p_batch_id,
    v_candidate_id,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.save_customer_manual_policy_review_v1(
  uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, uuid[], jsonb, text, candidate_match_classification
) from public, anon;
grant execute on function public.save_customer_manual_policy_review_v1(
  uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, uuid[], jsonb, text, candidate_match_classification
) to authenticated, service_role;

comment on function public.save_customer_manual_policy_review_v1 is
  'Customer-facing RPC to save a single manual-entry asset candidate draft. The batch is not advanced until the customer explicitly finishes manual entry.';

-- 4. Customer completion of manual entry: validate all documents are assigned or skipped,
--    require at least one candidate, then transition the batch to ready_for_review.
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
    raise exception 'Batch must be resolved before manual entry' using errcode = 'P0001';
  end if;
  if v_batch.status not in ('manual_review', 'processing_unavailable') then
    raise exception 'Batch is not in a manual-entry state: %', v_batch.status using errcode = 'P0001';
  end if;

  if v_case.state not in ('awaiting_documents', 'extracting_information') then
    raise exception 'Case is not accepting manual entry: %', v_case.state using errcode = 'P0001';
  end if;

  -- Validate skipped documents belong to this batch.
  if p_skipped_document_ids is not null and array_length(p_skipped_document_ids, 1) is not null then
    foreach v_doc_id in array p_skipped_document_ids
    loop
      if not exists (
        select 1 from document_processing_batch_items
        where batch_id = p_batch_id
          and household_id = p_household_id
          and policy_document_id = v_doc_id
      ) then
        raise exception 'Skipped document % does not belong to batch', v_doc_id using errcode = 'P0001';
      end if;
    end loop;
  end if;

  -- Require at least one candidate in this session.
  select count(*) into v_candidate_count
  from asset_candidates
  where session_id = p_session_id
    and household_id = p_household_id;
  if v_candidate_count = 0 then
    raise exception 'At least one manual-entry candidate is required' using errcode = 'P0001';
  end if;

  -- Gather the union of source documents claimed by candidates.
  select coalesce(array_agg(distinct doc_id), '{}'::uuid[]) into v_assigned_doc_ids
  from asset_candidates a,
       unnest(a.source_document_ids) as doc_id
  where a.session_id = p_session_id
    and a.household_id = p_household_id;

  -- Gather all documents in the batch.
  select coalesce(array_agg(policy_document_id), '{}'::uuid[]) into v_batch_doc_ids
  from document_processing_batch_items
  where batch_id = p_batch_id
    and household_id = p_household_id;

  -- Find batch documents that are neither assigned to a candidate nor explicitly skipped.
  select coalesce(array_agg(doc_id), '{}'::uuid[]) into v_unassigned
  from unnest(v_batch_doc_ids) as doc_id
  where not (doc_id = any(v_assigned_doc_ids) or doc_id = any(coalesce(p_skipped_document_ids, '{}'::uuid[])));

  if array_length(v_unassigned, 1) is not null then
    raise exception 'Unresolved documents remain in the batch: %', v_unassigned using errcode = 'P0001';
  end if;

  -- Mark skipped documents.
  if p_skipped_document_ids is not null and array_length(p_skipped_document_ids, 1) is not null then
    update document_processing_batch_items
    set manual_entry_status = 'skipped'
    where batch_id = p_batch_id
      and policy_document_id = any(p_skipped_document_ids);
  end if;

  -- Transition the batch to ready_for_review and clear stale retry/error fields.
  update document_processing_batches
  set status = 'ready_for_review',
      error_code = null,
      retryable = false,
      retry_count = 0,
      next_retry_at = null,
      completed_at = now(),
      updated_at = now()
  where id = p_batch_id;

  -- Move the case into extracting_information so the review CTA appears.
  update optimization_cases
  set state = 'extracting_information',
      updated_at = now()
  where id = p_case_id
    and state in ('awaiting_documents', 'extracting_information');

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

revoke all on function public.complete_customer_manual_entry_v1(
  uuid, uuid, uuid, uuid, text, uuid[]
) from public, anon;
grant execute on function public.complete_customer_manual_entry_v1(
  uuid, uuid, uuid, uuid, text, uuid[]
) to authenticated, service_role;

comment on function public.complete_customer_manual_entry_v1 is
  'Customer-facing RPC to finish manual entry. Requires all batch documents to be assigned or skipped, at least one candidate, then transitions the batch to ready_for_review.';

-- 5. Hardened staff completion of a manual review batch.
create or replace function complete_manual_review_v1(
  p_batch_id uuid,
  p_session_id uuid,
  p_case_id uuid,
  p_household_id uuid,
  p_actor_profile_id uuid,
  p_candidate_ids uuid[],
  p_client_request_id text default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_batch document_processing_batches%rowtype;
  v_session document_extraction_sessions%rowtype;
  v_case optimization_cases%rowtype;
  v_candidate_id uuid;
  v_candidate asset_candidates%rowtype;
  v_seen uuid[] := '{}'::uuid[];
  v_count int;
  v_batch_doc_ids uuid[] := '{}'::uuid[];
  v_candidate_doc_ids uuid[] := '{}'::uuid[];
  v_missing uuid[] := '{}'::uuid[];
  v_client_request_id text;
  v_ledger_id uuid;
  v_existing_result jsonb;
  v_result jsonb;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if not is_staff() then
    raise exception 'manual review completion requires staff role' using errcode = 'P0001';
  end if;

  if not can_access_household(p_household_id) then
    raise exception 'staff cannot access household' using errcode = 'P0001';
  end if;

  if p_candidate_ids is null or array_length(p_candidate_ids, 1) is null then
    raise exception 'candidate_ids is required' using errcode = 'P0001';
  end if;

  -- Remove duplicates and validate.
  foreach v_candidate_id in array p_candidate_ids
  loop
    if v_candidate_id is null then
      raise exception 'candidate_ids cannot contain null' using errcode = 'P0001';
    end if;
    if v_candidate_id = any(v_seen) then
      raise exception 'duplicate candidate_id: %', v_candidate_id using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_candidate_id;
  end loop;

  -- Derive an idempotency key if none supplied.
  v_client_request_id := p_client_request_id;
  if v_client_request_id is null or length(trim(v_client_request_id)) = 0 then
    select string_agg(id::text, ':' order by id) into v_client_request_id
    from unnest(v_seen) as id;
    v_client_request_id := 'staff-complete:' || p_batch_id::text || ':' || coalesce(v_client_request_id, '');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('manual-entry:' || p_household_id::text || ':' || p_batch_id::text || ':staff_complete:' || v_client_request_id, 0));

  select id, result_json into v_ledger_id, v_existing_result
  from manual_entry_idempotency
  where household_id = p_household_id
    and batch_id = p_batch_id
    and operation_type = 'complete_entry'
    and client_request_id = v_client_request_id;
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

  if v_batch.status <> 'manual_review' then
    raise exception 'Batch is not in manual_review: %', v_batch.status using errcode = 'P0001';
  end if;

  if v_case.state not in ('awaiting_documents', 'extracting_information') then
    raise exception 'Case is not accepting manual review completion: %', v_case.state using errcode = 'P0001';
  end if;

  -- Lock all requested candidates and verify they belong to this household and session.
  for v_candidate in
    select *
    from asset_candidates
    where id = any(v_seen)
      and household_id = p_household_id
    order by id
    for update
  loop
    if v_candidate.session_id is distinct from p_session_id then
      raise exception 'Candidate % does not belong to the supplied session', v_candidate.id using errcode = 'P0001';
    end if;
  end loop;

  select count(*) into v_count
  from asset_candidates
  where id = any(v_seen)
    and household_id = p_household_id
    and session_id = p_session_id;
  if v_count <> array_length(v_seen, 1) then
    raise exception 'one or more candidates do not belong to the household and session' using errcode = 'P0001';
  end if;

  -- Gather the batch documents and the union of source documents claimed by the selected candidates.
  select coalesce(array_agg(policy_document_id), '{}'::uuid[]) into v_batch_doc_ids
  from document_processing_batch_items
  where batch_id = p_batch_id
    and household_id = p_household_id;

  select coalesce(array_agg(distinct doc_id), '{}'::uuid[]) into v_candidate_doc_ids
  from asset_candidates a,
       unnest(a.source_document_ids) as doc_id
  where a.id = any(v_seen)
    and a.household_id = p_household_id;

  -- Reject if any selected candidate references a source document outside this batch.
  select coalesce(array_agg(doc_id), '{}'::uuid[]) into v_missing
  from unnest(v_candidate_doc_ids) as doc_id
  where not (doc_id = any(v_batch_doc_ids));

  if array_length(v_missing, 1) is not null then
    raise exception 'Candidate source documents do not belong to batch: %', v_missing using errcode = 'P0001';
  end if;

  -- Link candidates to the original session (idempotent update).
  update asset_candidates
  set session_id = p_session_id,
      updated_at = now()
  where id = any(v_seen)
    and household_id = p_household_id;

  -- Transition the batch and clear stale retry/error fields.
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
    and state in ('awaiting_documents', 'extracting_information');

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
    'manual_review_completed',
    'document_processing_batch',
    p_batch_id,
    p_household_id,
    p_case_id,
    jsonb_build_object(
      'linked_candidates', array_length(v_seen, 1),
      'candidate_ids', v_seen,
      'session_id', p_session_id,
      'source', 'staff_manual_completion'
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'linked_candidates', array_length(v_seen, 1)
  );

  insert into manual_entry_idempotency (
    operation_type,
    client_request_id,
    household_id,
    batch_id,
    result_id,
    result_json
  ) values (
    'complete_entry',
    v_client_request_id,
    p_household_id,
    p_batch_id,
    p_batch_id,
    v_result
  );

  return v_result;
end;
$$;

revoke all on function public.complete_manual_review_v1(
  uuid, uuid, uuid, uuid, uuid, uuid[], text
) from public, anon;
grant execute on function public.complete_manual_review_v1(
  uuid, uuid, uuid, uuid, uuid, uuid[], text
) to authenticated, service_role;

comment on function public.complete_manual_review_v1 is
  'Staff-only RPC to complete a manual review: validate all candidate and source document linkage, then transition the batch to ready_for_review and advance the case.';

-- 6. Allow skipping or unskipping a batch document during manual entry.
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
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if not is_household_member(p_household_id) then
    raise exception 'Household not found or access denied' using errcode = 'P0001';
  end if;

  if p_status not in ('unassigned', 'skipped') then
    raise exception 'Invalid manual_entry_status: %', p_status using errcode = 'P0001';
  end if;

  select * into v_batch
  from document_processing_batches
  where id = p_batch_id
    and household_id = p_household_id
  for update;
  if not found then
    raise exception 'Batch not found' using errcode = 'P0001';
  end if;

  if v_batch.status not in ('manual_review', 'processing_unavailable') then
    raise exception 'Batch is not in a manual-entry state' using errcode = 'P0001';
  end if;

  update document_processing_batch_items
  set manual_entry_status = p_status
  where batch_id = p_batch_id
    and household_id = p_household_id
    and policy_document_id = p_policy_document_id;

  if not found then
    raise exception 'Document not found in batch' using errcode = 'P0001';
  end if;

  return jsonb_build_object('success', true, 'policy_document_id', p_policy_document_id, 'status', p_status);
end;
$$;

revoke all on function public.set_manual_entry_document_status_v1(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.set_manual_entry_document_status_v1(uuid, uuid, uuid, text) to authenticated, service_role;

-- 7. Delete a manual-entry candidate draft, releasing its source documents.
create or replace function delete_manual_entry_candidate_v1(
  p_candidate_id uuid,
  p_batch_id uuid,
  p_household_id uuid
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_candidate asset_candidates%rowtype;
  v_batch document_processing_batches%rowtype;
  v_doc_id uuid;
  v_remaining int;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if not is_household_member(p_household_id) then
    raise exception 'Household not found or access denied' using errcode = 'P0001';
  end if;

  select * into v_batch
  from document_processing_batches
  where id = p_batch_id
    and household_id = p_household_id
  for update;
  if not found then
    raise exception 'Batch not found' using errcode = 'P0001';
  end if;

  if v_batch.status not in ('manual_review', 'processing_unavailable') then
    raise exception 'Batch is not in a manual-entry state' using errcode = 'P0001';
  end if;

  select * into v_candidate
  from asset_candidates
  where id = p_candidate_id
    and household_id = p_household_id
  for update;
  if not found then
    raise exception 'Candidate not found' using errcode = 'P0001';
  end if;

  if v_candidate.session_id is distinct from v_batch.session_id then
    raise exception 'Candidate does not belong to batch session' using errcode = 'P0001';
  end if;

  -- Revert source document assignment status only when no other candidate uses the same document.
  if v_candidate.source_document_ids is not null then
    foreach v_doc_id in array v_candidate.source_document_ids
    loop
      select count(*) into v_remaining
      from asset_candidates
      where household_id = p_household_id
        and id <> p_candidate_id
        and v_doc_id = any(source_document_ids);

      if v_remaining = 0 then
        update document_processing_batch_items
        set manual_entry_status = 'unassigned'
        where batch_id = p_batch_id
          and household_id = p_household_id
          and policy_document_id = v_doc_id;
      end if;
    end loop;
  end if;

  delete from asset_candidates
  where id = p_candidate_id
    and household_id = p_household_id;

  insert into audit_events (
    actor_profile_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    household_id,
    after_summary
  ) values (
    v_actor,
    app_role(),
    'customer_manual_candidate_deleted',
    'asset_candidate',
    p_candidate_id,
    p_household_id,
    jsonb_build_object(
      'batch_id', p_batch_id,
      'session_id', v_batch.session_id,
      'source', 'customer_manual_entry'
    )
  );

  return jsonb_build_object('success', true, 'candidate_id', p_candidate_id);
end;
$$;

revoke all on function public.delete_manual_entry_candidate_v1(uuid, uuid, uuid) from public, anon;
grant execute on function public.delete_manual_entry_candidate_v1(uuid, uuid, uuid) to authenticated, service_role;

comment on function public.delete_manual_entry_candidate_v1 is
  'Customer-facing RPC to delete a manual-entry candidate draft and release its source documents.';

commit;
