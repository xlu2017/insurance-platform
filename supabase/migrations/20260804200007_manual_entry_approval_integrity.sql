-- Harden the manual-entry to candidate-approval boundary.
-- - One policy per approved candidate, with many-to-many document/policy provenance.
-- - Explicit document-review completion state (unreviewed/reviewing/reviewed/not_relevant).
-- - Staff-only candidate save RPC.
-- - Stricter completion and validation, rejecting fabricated zero values.

begin;

-- =============================================================================
-- 1. Policy/document many-to-many provenance
-- =============================================================================

create table if not exists policy_document_policy_links (
  id uuid primary key default gen_random_uuid(),
  policy_document_id uuid not null references policy_documents(id) on delete cascade,
  policy_id uuid not null references policies(id) on delete cascade,
  candidate_id uuid references asset_candidates(id) on delete set null,
  relationship_type text not null default 'candidate_source' check (relationship_type in ('candidate_source','supporting_document','other')),
  created_at timestamptz not null default now(),
  unique (policy_document_id, policy_id, candidate_id)
);

create index if not exists idx_policy_document_policy_links_policy
  on policy_document_policy_links(policy_id);
create index if not exists idx_policy_document_policy_links_document
  on policy_document_policy_links(policy_document_id);

alter table policy_document_policy_links enable row level security;

create policy policy_document_policy_links_select on policy_document_policy_links
  for select using (
    exists (
      select 1 from policies p
      where p.id = policy_document_policy_links.policy_id
        and can_access_household(p.household_id)
    )
  );

grant select on policy_document_policy_links to authenticated;
grant select, insert, update, delete on policy_document_policy_links to service_role;

-- =============================================================================
-- 2. Document-review completion state
-- =============================================================================

alter table document_processing_batch_items
  drop constraint if exists document_processing_batch_items_manual_entry_status_check;

alter table document_processing_batch_items
  rename column manual_entry_status to review_status;

update document_processing_batch_items
set review_status = case review_status
  when 'unassigned' then 'unreviewed'
  when 'assigned' then 'reviewed'
  when 'skipped' then 'not_relevant'
  else review_status
end
where review_status in ('unassigned','assigned','skipped');

alter table document_processing_batch_items
  alter column review_status set default 'unreviewed';

alter table document_processing_batch_items
  add constraint document_processing_batch_items_review_status_check
  check (review_status in ('unreviewed','reviewing','reviewed','not_relevant'));

-- =============================================================================
-- 3. Idempotency operation type expansion
-- =============================================================================

alter table manual_entry_idempotency
  drop constraint if exists manual_entry_idempotency_operation_type_check;

alter table manual_entry_idempotency
  add constraint manual_entry_idempotency_operation_type_check
  check (operation_type in ('save_candidate','complete_entry','staff_save_candidate','staff_complete_entry','update_candidate'));

-- =============================================================================
-- 4. Customer manual-entry candidate save
-- =============================================================================

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
  v_existing_status text;
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

  perform pg_advisory_xact_lock(hashtextextended('manual-entry:' || p_household_id::text || ':' || p_batch_id::text || ':save_candidate:' || p_client_request_id, 0));

  select id, result_json into v_ledger_id, v_result
  from manual_entry_idempotency
  where household_id = p_household_id
    and batch_id = p_batch_id
    and operation_type = 'save_candidate'
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

  if v_batch.mode_snapshot <> 'safe' then
    raise exception 'Manual entry is only permitted for safe-mode batches' using errcode = 'P0001';
  end if;

  if v_batch.status = 'processing_unavailable' and coalesce(v_batch.retryable, false) then
    raise exception 'Batch must be resolved before manual entry' using errcode = 'P0001';
  end if;
  if v_batch.status not in ('manual_review','processing_unavailable') then
    raise exception 'Batch is not in a manual-entry state: %', v_batch.status using errcode = 'P0001';
  end if;

  if v_case.state not in ('awaiting_documents','extracting_information') then
    raise exception 'Case is not accepting manual entry: %', v_case.state using errcode = 'P0001';
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
    || jsonb_build_object('_source', 'customer_manual_entry')
    || jsonb_build_object('_manual_entry_batch_id', p_batch_id)
    || jsonb_build_object('_manual_entry_session_id', p_session_id)
    || jsonb_build_object('_manual_entry_case_id', p_case_id);

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

  update document_processing_batch_items
  set review_status = 'reviewed'
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

-- =============================================================================
-- 5. Update an existing manual-entry candidate draft
-- =============================================================================

create or replace function update_manual_entry_candidate_v1(
  p_candidate_id uuid,
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
  v_candidate asset_candidates%rowtype;
  v_batch document_processing_batches%rowtype;
  v_session document_extraction_sessions%rowtype;
  v_case optimization_cases%rowtype;
  v_doc_id uuid;
  v_old_doc_ids uuid[];
  v_new_doc_ids uuid[];
  v_facts jsonb;
  v_occupancy text;
  v_existing_status text;
  v_ledger_id uuid;
  v_result jsonb;
  v_remaining int;
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

  perform pg_advisory_xact_lock(hashtextextended('manual-entry:' || p_household_id::text || ':' || p_batch_id::text || ':update_candidate:' || p_client_request_id, 0));

  select id, result_json into v_ledger_id, v_result
  from manual_entry_idempotency
  where household_id = p_household_id
    and batch_id = p_batch_id
    and operation_type = 'update_candidate'
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

  if v_batch.mode_snapshot <> 'safe' then
    raise exception 'Manual entry is only permitted for safe-mode batches' using errcode = 'P0001';
  end if;
  if v_batch.status not in ('manual_review','processing_unavailable') then
    raise exception 'Batch is not in a manual-entry state: %', v_batch.status using errcode = 'P0001';
  end if;
  if v_batch.status = 'processing_unavailable' and coalesce(v_batch.retryable, false) then
    raise exception 'Batch must be resolved before manual entry' using errcode = 'P0001';
  end if;

  if v_case.state not in ('awaiting_documents','extracting_information') then
    raise exception 'Case is not accepting manual entry: %', v_case.state using errcode = 'P0001';
  end if;

  select * into v_candidate
  from asset_candidates
  where id = p_candidate_id
    and household_id = p_household_id
    and session_id = p_session_id
  for update;
  if not found then
    raise exception 'Candidate not found' using errcode = 'P0001';
  end if;

  if coalesce(v_candidate.selected_facts_json->>'_source','') <> 'customer_manual_entry'
     or (v_candidate.selected_facts_json->>'_manual_entry_batch_id')::uuid is distinct from p_batch_id then
    raise exception 'Candidate does not have verified manual-entry provenance' using errcode = 'P0001';
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

  v_old_doc_ids := coalesce(v_candidate.source_document_ids, '{}'::uuid[]);
  v_new_doc_ids := p_source_document_ids;

  v_occupancy := nullif(trim(coalesce(p_occupancy, '')), '');
  v_facts := coalesce(p_selected_facts_json, '{}'::jsonb)
    || jsonb_build_object('_source', 'customer_manual_entry')
    || jsonb_build_object('_manual_entry_batch_id', p_batch_id)
    || jsonb_build_object('_manual_entry_session_id', p_session_id)
    || jsonb_build_object('_manual_entry_case_id', p_case_id);

  update asset_candidates
  set asset_type = p_asset_type,
      identity_fingerprint = p_identity_fingerprint,
      display_label = p_display_label,
      occupancy = v_occupancy,
      match_classification = p_match_classification,
      source_document_ids = v_new_doc_ids,
      selected_facts_json = v_facts,
      updated_at = now()
  where id = p_candidate_id
    and household_id = p_household_id;

  update document_processing_batch_items
  set review_status = 'reviewed'
  where batch_id = p_batch_id
    and policy_document_id = any(v_new_doc_ids);

  foreach v_doc_id in array v_old_doc_ids
  loop
    if not (v_doc_id = any(v_new_doc_ids)) then
      select count(*) into v_remaining
      from asset_candidates
      where household_id = p_household_id
        and id <> p_candidate_id
        and v_doc_id = any(source_document_ids);
      if v_remaining = 0 then
        update document_processing_batch_items
        set review_status = 'unreviewed'
        where batch_id = p_batch_id
          and policy_document_id = v_doc_id;
      end if;
    end if;
  end loop;

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
    'customer_manual_candidate_updated',
    'asset_candidate',
    p_candidate_id,
    p_household_id,
    p_case_id,
    jsonb_build_object(
      'batch_id', p_batch_id,
      'session_id', p_session_id,
      'asset_type', p_asset_type,
      'source_document_ids', v_new_doc_ids,
      'source', 'customer_manual_entry'
    )
  );

  v_result := jsonb_build_object('success', true, 'candidate_id', p_candidate_id);

  insert into manual_entry_idempotency (
    operation_type,
    client_request_id,
    household_id,
    batch_id,
    result_id,
    result_json
  ) values (
    'update_candidate',
    p_client_request_id,
    p_household_id,
    p_batch_id,
    p_candidate_id,
    v_result
  );

  return v_result;
end;
$$;

-- =============================================================================
-- 6. Staff-only manual candidate save
-- =============================================================================

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

  update document_processing_batch_items
  set review_status = 'reviewed'
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

-- =============================================================================
-- 7. Set document review status during manual entry
-- =============================================================================

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
  v_reviewed_by_others boolean;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if not (is_household_member(p_household_id) or is_staff()) then
    raise exception 'Household not found or access denied' using errcode = 'P0001';
  end if;

  if p_status not in ('unreviewed','not_relevant') then
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

  if v_batch.mode_snapshot <> 'safe' then
    raise exception 'Document status changes are only permitted for safe-mode batches' using errcode = 'P0001';
  end if;
  if v_batch.status not in ('manual_review','processing_unavailable') then
    raise exception 'Batch is not in a manual-entry state' using errcode = 'P0001';
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
    select 1 from asset_candidates
    where household_id = p_household_id
      and p_policy_document_id = any(source_document_ids)
  ) into v_reviewed_by_others;

  if v_reviewed_by_others then
    raise exception 'Document is referenced by a candidate and cannot be marked %', p_status using errcode = 'P0001';
  end if;

  update document_processing_batch_items
  set review_status = p_status
  where batch_id = p_batch_id
    and household_id = p_household_id
    and policy_document_id = p_policy_document_id;

  return jsonb_build_object('success', true, 'policy_document_id', p_policy_document_id, 'status', p_status);
end;
$$;

-- =============================================================================
-- 8. Delete a manual-entry candidate draft
-- =============================================================================

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

  if not (is_household_member(p_household_id) or is_staff()) then
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

  if v_batch.mode_snapshot <> 'safe' then
    raise exception 'Candidate deletion is only permitted for safe-mode batches' using errcode = 'P0001';
  end if;
  if v_batch.status not in ('manual_review','processing_unavailable') then
    raise exception 'Batch is not in a manual-entry state' using errcode = 'P0001';
  end if;
  if v_batch.status = 'processing_unavailable' and coalesce(v_batch.retryable, false) then
    raise exception 'Batch must be resolved before deleting candidates' using errcode = 'P0001';
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

  if coalesce(v_candidate.selected_facts_json->>'_source','') not in ('customer_manual_entry','staff_manual_entry')
     or (v_candidate.selected_facts_json->>'_manual_entry_batch_id')::uuid is distinct from p_batch_id then
    raise exception 'Candidate does not have verified manual-entry provenance' using errcode = 'P0001';
  end if;

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
        set review_status = 'unreviewed'
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
    'manual_candidate_deleted',
    'asset_candidate',
    p_candidate_id,
    p_household_id,
    jsonb_build_object(
      'batch_id', p_batch_id,
      'session_id', v_batch.session_id,
      'source', v_candidate.selected_facts_json->>'_source'
    )
  );

  return jsonb_build_object('success', true, 'candidate_id', p_candidate_id);
end;
$$;

-- =============================================================================
-- 9. Customer completion of manual entry
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
    raise exception 'Batch must be resolved before manual entry completion' using errcode = 'P0001';
  end if;
  if v_batch.status not in ('manual_review','processing_unavailable') then
    raise exception 'Batch is not in a manual-entry state: %', v_batch.status using errcode = 'P0001';
  end if;

  if v_case.state not in ('awaiting_documents','extracting_information') then
    raise exception 'Case is not accepting manual entry completion: %', v_case.state using errcode = 'P0001';
  end if;

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

  select count(*) into v_candidate_count
  from asset_candidates
  where session_id = p_session_id
    and household_id = p_household_id;
  if v_candidate_count = 0 then
    raise exception 'At least one manual-entry candidate is required' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct doc_id), '{}'::uuid[]) into v_assigned_doc_ids
  from asset_candidates a,
       unnest(a.source_document_ids) as doc_id
  where a.session_id = p_session_id
    and a.household_id = p_household_id;

  select coalesce(array_agg(policy_document_id), '{}'::uuid[]) into v_batch_doc_ids
  from document_processing_batch_items
  where batch_id = p_batch_id
    and household_id = p_household_id;

  select coalesce(array_agg(doc_id), '{}'::uuid[]) into v_unassigned
  from unnest(v_batch_doc_ids) as doc_id
  where not (doc_id = any(v_assigned_doc_ids) or doc_id = any(coalesce(p_skipped_document_ids, '{}'::uuid[])));

  if array_length(v_unassigned, 1) is not null then
    raise exception 'Unresolved documents remain in the batch: %', v_unassigned using errcode = 'P0001';
  end if;

  if p_skipped_document_ids is not null and array_length(p_skipped_document_ids, 1) is not null then
    update document_processing_batch_items
    set review_status = 'not_relevant'
    where batch_id = p_batch_id
      and policy_document_id = any(p_skipped_document_ids);
  end if;

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

-- =============================================================================
-- 10. Staff completion of a manual review batch
-- =============================================================================

drop function if exists complete_manual_review_v1(uuid, uuid, uuid, uuid, uuid, uuid[], text);

create or replace function complete_manual_review_v1(
  p_batch_id uuid,
  p_session_id uuid,
  p_case_id uuid,
  p_household_id uuid,
  p_actor_profile_id uuid,
  p_candidate_ids uuid[],
  p_client_request_id text default null,
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
  v_candidate_id uuid;
  v_candidate asset_candidates%rowtype;
  v_seen uuid[] := '{}'::uuid[];
  v_count int;
  v_batch_doc_ids uuid[] := '{}'::uuid[];
  v_candidate_doc_ids uuid[] := '{}'::uuid[];
  v_missing uuid[] := '{}'::uuid[];
  v_unassigned uuid[] := '{}'::uuid[];
  v_client_request_id text;
  v_ledger_id uuid;
  v_existing_result jsonb;
  v_result jsonb;
  v_doc_id uuid;
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
    and operation_type = 'staff_complete_entry'
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

  if v_case.state not in ('awaiting_documents','extracting_information') then
    raise exception 'Case is not accepting manual review completion: %', v_case.state using errcode = 'P0001';
  end if;

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

  -- Lock every batch item.
  perform 1
  from document_processing_batch_items
  where batch_id = p_batch_id
    and household_id = p_household_id
  for update;

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
    if coalesce(v_candidate.source_document_ids, '{}'::uuid[]) = '{}'::uuid[] then
      raise exception 'Candidate % has no source documents', v_candidate.id using errcode = 'P0001';
    end if;
    if coalesce(v_candidate.selected_facts_json->>'_source','') not in ('customer_manual_entry','staff_manual_entry') then
      raise exception 'Candidate % does not have verified manual-entry provenance', v_candidate.id using errcode = 'P0001';
    end if;
    if (v_candidate.selected_facts_json->>'_manual_entry_batch_id')::uuid is distinct from p_batch_id then
      raise exception 'Candidate % does not belong to the supplied batch', v_candidate.id using errcode = 'P0001';
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

  -- Require every batch document to be represented by a selected candidate or explicitly skipped.
  select coalesce(array_agg(doc_id), '{}'::uuid[]) into v_unassigned
  from unnest(v_batch_doc_ids) as doc_id
  where not (doc_id = any(v_candidate_doc_ids) or doc_id = any(coalesce(p_skipped_document_ids, '{}'::uuid[])));

  if array_length(v_unassigned, 1) is not null then
    raise exception 'Unresolved batch documents remain: %', v_unassigned using errcode = 'P0001';
  end if;

  -- Mark skipped documents.
  if p_skipped_document_ids is not null and array_length(p_skipped_document_ids, 1) is not null then
    update document_processing_batch_items
    set review_status = 'not_relevant'
    where batch_id = p_batch_id
      and policy_document_id = any(p_skipped_document_ids);
  end if;

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
    'staff_manual_review_completed',
    'document_processing_batch',
    p_batch_id,
    p_household_id,
    p_case_id,
    jsonb_build_object(
      'linked_candidates', array_length(v_seen, 1),
      'candidate_ids', v_seen,
      'skipped_document_ids', coalesce(p_skipped_document_ids, '{}'::uuid[]),
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
    'staff_complete_entry',
    v_client_request_id,
    p_household_id,
    p_batch_id,
    p_batch_id,
    v_result
  );

  return v_result;
end;
$$;

-- =============================================================================
-- 11. Approve candidate assets v2 — one policy per candidate, no fabricated zeros
-- =============================================================================

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
  v_liability_limit_cents bigint;
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
  v_seen_policy_doc_ids uuid[] := '{}'::uuid[];
begin
  v_caller_role := coalesce(auth.role(), current_setting('request.jwt.claims', true)::jsonb->>'role');
  if v_caller_role is null or (v_caller_role <> 'service_role' and not is_household_member(p_household_id)) then
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

      if v_existing_asset_type = 'vehicle' then
        v_vehicle_overrides := v_vehicle_overrides || jsonb_build_object('vehicleId', v_existing_asset_id::text, 'values', v_mandate_suggestions);
      elsif v_existing_asset_type = 'property' then
        v_property_overrides := v_property_overrides || jsonb_build_object('propertyId', v_existing_asset_id::text, 'values', v_mandate_suggestions);
      end if;

      continue;
    end if;

    -- Validate required identity and policy facts before creating canonical records.
    if v_candidate.asset_type = 'vehicle' then
      v_year := (nullif(v_identity->>'year', ''))::int;
      v_make := nullif(v_identity->>'make', '');
      v_model := nullif(v_identity->>'model', '');
      v_vin := nullif(v_identity->>'vin', '');

      if v_year is null or v_year < 1900 or v_year > 2100 then
        raise exception 'candidate % requires a valid year before approval', v_candidate.id using errcode = 'P0001';
      end if;
      if v_make is null or v_model is null then
        raise exception 'candidate % requires make and model before approval', v_candidate.id using errcode = 'P0001';
      end if;
      if v_vin is not null and length(v_vin) <> 17 then
        raise exception 'candidate % VIN must be 17 characters when provided', v_candidate.id using errcode = 'P0001';
      end if;

      insert into vehicles (
        household_id, year, make, model, vin, primary_use,
        created_by, updated_by
      ) values (
        p_household_id, v_year, v_make, v_model, nullif(upper(coalesce(v_vin, '')), ''), 'commute',
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
      v_address_line1 := nullif(v_identity->>'fullAddress', '');
      v_city := nullif(v_identity->>'city', '');
      v_province := nullif(v_identity->>'province', '');
      v_postal_code := nullif(v_identity->>'postalCode', '');
      v_year_built := nullif(v_identity->>'yearBuilt', '')::int;

      if v_address_line1 is null or v_city is null or v_province is null or v_postal_code is null then
        raise exception 'candidate % requires address, city, province and postal code before approval', v_candidate.id using errcode = 'P0001';
      end if;

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

    -- Validate and prepare policy fields.
    v_insurer_name := nullif(v_current_policy->>'insurerName', '');
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

    -- Normalize canonical coverage keys.
    if v_current_coverage ? 'liabilityLimitCents' and not (v_current_coverage ? 'personalLiabilityLimitCents') then
      v_current_coverage := jsonb_set(
        v_current_coverage,
        array['personalLiabilityLimitCents'],
        v_current_coverage->'liabilityLimitCents'
      );
    end if;
    v_current_coverage := v_current_coverage - 'liabilityLimitCents';

    v_liability_limit_cents := (v_current_coverage->>'personalLiabilityLimitCents')::bigint;

    -- Create exactly one policy per approved candidate.
    insert into policies (
      household_id, insurer_id, insurer_name, product_line, policy_number,
      annual_premium_cents, renewal_date, coverage_details, liability_limit_cents, is_current,
      created_by, updated_by
    ) values (
      p_household_id, null, v_insurer_name,
      case v_candidate.asset_type when 'vehicle' then 'auto'::product_line else 'property'::product_line end,
      v_policy_number, v_annual_premium, v_expiry_date, v_current_coverage, v_liability_limit_cents, true,
      p_actor_profile_id, p_actor_profile_id
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

-- Grants for all (re)created functions
revoke all on function public.save_customer_manual_policy_review_v1(
  uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, uuid[], jsonb, text, candidate_match_classification
) from public, anon;
grant execute on function public.save_customer_manual_policy_review_v1(
  uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, uuid[], jsonb, text, candidate_match_classification
) to authenticated, service_role;

revoke all on function public.update_manual_entry_candidate_v1(
  uuid, uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, uuid[], jsonb, text, candidate_match_classification
) from public, anon;
grant execute on function public.update_manual_entry_candidate_v1(
  uuid, uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, uuid[], jsonb, text, candidate_match_classification
) to authenticated, service_role;

revoke all on function public.save_staff_manual_policy_candidate_v1(
  uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, uuid[], jsonb, text, candidate_match_classification
) from public, anon;
grant execute on function public.save_staff_manual_policy_candidate_v1(
  uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, uuid[], jsonb, text, candidate_match_classification
) to authenticated, service_role;

revoke all on function public.set_manual_entry_document_status_v1(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.set_manual_entry_document_status_v1(uuid, uuid, uuid, text) to authenticated, service_role;

revoke all on function public.delete_manual_entry_candidate_v1(uuid, uuid, uuid) from public, anon;
grant execute on function public.delete_manual_entry_candidate_v1(uuid, uuid, uuid) to authenticated, service_role;

revoke all on function public.complete_customer_manual_entry_v1(
  uuid, uuid, uuid, uuid, text, uuid[]
) from public, anon;
grant execute on function public.complete_customer_manual_entry_v1(
  uuid, uuid, uuid, uuid, text, uuid[]
) to authenticated, service_role;

revoke all on function public.complete_manual_review_v1(
  uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid[]
) from public, anon;
grant execute on function public.complete_manual_review_v1(
  uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid[]
) to authenticated, service_role;

revoke all on function public.approve_candidate_assets_v2(
  uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.approve_candidate_assets_v2(
  uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb
) to authenticated, service_role;

commit;
