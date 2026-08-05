-- Approval isolation, canonical policy-to-asset versioning, and review-state correctness.
-- - Household-scope candidate approval idempotency (composite client_request_id).
-- - Decision-aware manual completion (persisted draft decision).
-- - Authoritative object-valued coverage review-state transitions with immutable provenance.
-- - Canonical policy_asset_links relation with current/historical versioning.
-- This migration replaces functions from 20260804200010 without editing that file.

begin;

-- =============================================================================
-- 1. Household-scoped candidate approval idempotency
-- =============================================================================

-- Replace the global uniqueness on client_request_id with composite uniqueness.
alter table candidate_approvals
  drop constraint if exists candidate_approvals_client_request_id_key;
alter table candidate_approvals
  add constraint candidate_approvals_household_request_key
  unique (household_id, client_request_id);

-- =============================================================================
-- 2. Coverage review action: allow explicit not_applicable corrections.
-- =============================================================================

alter type candidate_field_review_action add value if not exists 'not_applicable';

-- =============================================================================
-- 3. Canonical policy-to-asset relationship
-- =============================================================================

create table if not exists policy_asset_links (
  policy_id uuid primary key references policies (id) on delete cascade,
  household_id uuid not null references households (id) on delete cascade,
  asset_id uuid not null,
  asset_type candidate_asset_type not null,
  product_line product_line not null,
  is_current boolean not null default true,
  effective_from date,
  effective_to date,
  candidate_id uuid references asset_candidates (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_policy_asset_links_household
  on policy_asset_links (household_id);
create index if not exists idx_policy_asset_links_asset
  on policy_asset_links (household_id, asset_type, asset_id);

-- Enforce exactly one current policy per asset and product line.
create unique index if not exists uq_policy_asset_links_current_per_asset
  on policy_asset_links (household_id, asset_type, asset_id, product_line)
  where is_current;

alter table policy_asset_links enable row level security;

drop policy if exists policy_asset_links_select on policy_asset_links;
create policy policy_asset_links_select on policy_asset_links
  for select using (can_access_household(household_id));

revoke all on policy_asset_links from anon;
grant select on policy_asset_links to authenticated;
grant select, insert, update, delete on policy_asset_links to service_role;

drop trigger if exists set_updated_at on policy_asset_links;
create trigger set_updated_at
  before update on policy_asset_links
  for each row execute function set_updated_at();

-- =============================================================================
-- 4. Extracted-value normalization: JSON null must be treated as unknown.
-- =============================================================================

create or replace function extract_extracted_value(input jsonb, out value jsonb, out state text)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_status text;
begin
  -- SQL null and JSON null are both unknown/missing, never known.
  if input is null or jsonb_typeof(input) = 'null' then
    state := 'unknown';
    value := null;
    return;
  end if;

  if jsonb_typeof(input) = 'object' and input ? 'status' then
    v_status := input->>'status';
    state := coalesce(v_status, 'unknown');

    if v_status = 'known' then
      -- A known status with a JSON null value is not actually known.
      if input->'value' is null or jsonb_typeof(input->'value') = 'null' then
        state := 'unknown';
        value := null;
        return;
      end if;
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

  -- Legacy/manual scalar value (number, string, boolean).
  state := 'known';
  value := input;
end;
$$;

-- =============================================================================
-- 5. Decision-aware completion readiness.
--    Requires a persisted draft decision and validates by decision.
-- =============================================================================

create or replace function validate_candidate_completion_ready(
  p_candidate_id uuid,
  p_household_id uuid
) returns void
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_candidate asset_candidates%rowtype;
  v_facts jsonb;
  v_decision text;
  v_existing_asset_id uuid;
  v_existing_asset_type text;
begin
  select * into v_candidate
  from asset_candidates
  where id = p_candidate_id and household_id = p_household_id;
  if not found then
    raise exception 'candidate % not found', p_candidate_id using errcode = 'P0001';
  end if;

  v_facts := coalesce(v_candidate.selected_facts_json, '{}'::jsonb);
  -- The canonical draft decision lives in first-class columns on asset_candidates
  -- (populated from the manual-entry facts, or by save_candidate_review_draft_v1).
  v_decision := lower(coalesce(v_candidate.draft_decision, ''));

  if v_decision in ('', 'undecided', 'not_sure') then
    raise exception 'candidate % has no draft decision and cannot be completed', p_candidate_id using errcode = 'P0001';
  end if;

  if v_decision in ('approve_new', 'approve_new_asset') then
    perform validate_candidate_policy_ready(v_facts, v_candidate.asset_type);
    perform validate_new_asset_identity_ready(v_facts, v_candidate.asset_type);
  elsif v_decision in ('link_existing', 'link_existing_asset') then
    perform validate_candidate_policy_ready(v_facts, v_candidate.asset_type);
    v_existing_asset_id := v_candidate.draft_existing_asset_id;
    v_existing_asset_type := lower(nullif(v_candidate.draft_existing_asset_type::text, ''));
    if v_existing_asset_id is null or v_existing_asset_type is null then
      raise exception 'link_existing draft requires an existing asset for candidate %', p_candidate_id using errcode = 'P0001';
    end if;
    if v_existing_asset_type <> v_candidate.asset_type::text then
      raise exception 'existing asset type % does not match candidate asset type % for candidate %', v_existing_asset_type, v_candidate.asset_type, p_candidate_id using errcode = 'P0001';
    end if;
    if v_candidate.asset_type = 'vehicle' then
      if not exists (select 1 from vehicles where id = v_existing_asset_id and household_id = p_household_id) then
        raise exception 'existing vehicle % does not belong to household', v_existing_asset_id using errcode = 'P0001';
      end if;
    else
      if not exists (select 1 from properties where id = v_existing_asset_id and household_id = p_household_id) then
        raise exception 'existing property % does not belong to household', v_existing_asset_id using errcode = 'P0001';
      end if;
    end if;
  elsif v_decision in ('skip', 'needs_correction') then
    null;
  else
    raise exception 'candidate % has an unsupported draft decision %', p_candidate_id, v_decision using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.validate_candidate_completion_ready(uuid, uuid) from public, anon;
grant execute on function public.validate_candidate_completion_ready(uuid, uuid) to authenticated, service_role;

-- Keep the first-class draft-decision columns in sync with the draft decision the
-- manual-entry UIs embed in selected_facts_json (_draftDecision / _draftExistingAssetId
-- / _draftExistingAssetType). Only runs when selected_facts_json actually changes so
-- direct column writes (save_candidate_review_draft_v1) are never clobbered.
create or replace function sync_candidate_draft_decision()
returns trigger
language plpgsql
as $$
declare
  v_decision text;
  v_existing_id text;
  v_existing_type text;
begin
  if new.selected_facts_json is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.selected_facts_json is not distinct from old.selected_facts_json then
    return new;
  end if;
  if not (new.selected_facts_json ? '_draftDecision') then
    return new;
  end if;

  v_decision := lower(nullif(new.selected_facts_json->>'_draftDecision', ''));
  if v_decision is null or v_decision not in ('approve_new', 'link_existing', 'skip', 'needs_correction') then
    return new;
  end if;

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

  return new;
end;
$$;

drop trigger if exists sync_candidate_draft_decision on asset_candidates;
create trigger sync_candidate_draft_decision
  before insert or update on asset_candidates
  for each row execute function sync_candidate_draft_decision();

commit;

-- =============================================================================
-- 6. Decision-aware customer manual completion.
-- =============================================================================

begin;

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

    -- Validate by the candidate's persisted draft decision (decision-aware completion).
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

commit;

-- =============================================================================
-- 7. Decision-aware staff manual review completion.
-- =============================================================================

begin;

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
  v_client_request_id text;
  v_ledger_id uuid;
  v_existing_result jsonb;
  v_result jsonb;
  v_doc_id uuid;
  v_existing_status text;
  v_doc_status text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if auth.role() = 'authenticated' and p_actor_profile_id is distinct from v_actor then
    raise exception 'approval actor profile id does not match authenticated user' using errcode = 'P0001';
  end if;
  if auth.role() = 'service_role' then
    v_actor := p_actor_profile_id;
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

  perform 1
  from document_processing_batch_items
  where batch_id = p_batch_id
    and household_id = p_household_id
  for update;

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
    if (v_candidate.selected_facts_json->>'_manual_entry_batch_id')::uuid is distinct from p_batch_id
       or (v_candidate.selected_facts_json->>'_manual_entry_session_id')::uuid is distinct from p_session_id
       or (v_candidate.selected_facts_json->>'_manual_entry_case_id')::uuid is distinct from p_case_id then
      raise exception 'Candidate % does not belong to the supplied batch/session/case', v_candidate.id using errcode = 'P0001';
    end if;

    -- Validate by the candidate's persisted draft decision (decision-aware completion).
    perform validate_candidate_completion_ready(v_candidate.id, p_household_id);
  end loop;

  select count(*) into v_count
  from asset_candidates
  where id = any(v_seen)
    and household_id = p_household_id
    and session_id = p_session_id;
  if v_count <> array_length(v_seen, 1) then
    raise exception 'one or more candidates do not belong to the household and session' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(policy_document_id), '{}'::uuid[]) into v_batch_doc_ids
  from document_processing_batch_items
  where batch_id = p_batch_id
    and household_id = p_household_id;

  select coalesce(array_agg(distinct doc_id), '{}'::uuid[]) into v_candidate_doc_ids
  from asset_candidates a,
       unnest(a.source_document_ids) as doc_id
  where a.id = any(v_seen)
    and a.household_id = p_household_id;

  select coalesce(array_agg(doc_id), '{}'::uuid[]) into v_missing
  from unnest(v_candidate_doc_ids) as doc_id
  where not (doc_id = any(v_batch_doc_ids));

  if array_length(v_missing, 1) is not null then
    raise exception 'Candidate source documents do not belong to batch: %', v_missing using errcode = 'P0001';
  end if;

  if p_skipped_document_ids is not null and array_length(p_skipped_document_ids, 1) is not null then
    foreach v_doc_id in array p_skipped_document_ids
    loop
      if v_doc_id = any(v_candidate_doc_ids) then
        raise exception 'Skipped document % is referenced by a selected candidate', v_doc_id using errcode = 'P0001';
      end if;
      if not (v_doc_id = any(v_batch_doc_ids)) then
        raise exception 'Skipped document % does not belong to batch', v_doc_id using errcode = 'P0001';
      end if;

      select review_status into v_existing_status
      from document_processing_batch_items
      where batch_id = p_batch_id
        and household_id = p_household_id
        and policy_document_id = v_doc_id
      for update;
      if not found then
        raise exception 'Skipped document % not found', v_doc_id using errcode = 'P0001';
      end if;
      if v_existing_status in ('reviewed','reviewing') then
        raise exception 'Document % is % and cannot be marked not relevant', v_doc_id, v_existing_status using errcode = 'P0001';
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
    if v_doc_status = 'reviewed' and not (v_doc_id = any(v_candidate_doc_ids)) then
      raise exception 'Document % is reviewed but has no selected candidate', v_doc_id using errcode = 'P0001';
    end if;
    if v_doc_status = 'not_relevant' and (v_doc_id = any(v_candidate_doc_ids)) then
      raise exception 'Document % is marked not relevant but is referenced by a selected candidate', v_doc_id using errcode = 'P0001';
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

revoke all on function public.complete_manual_review_v1(uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid[]) from public, anon;
grant execute on function public.complete_manual_review_v1(uuid, uuid, uuid, uuid, uuid, uuid[], text, uuid[]) to authenticated, service_role;

commit;

-- =============================================================================
-- 8. Corrected approve_candidate_assets_v2 (idempotency isolation, coverage
--    review-state, canonical policy_asset_links versioning).
-- =============================================================================

begin;

CREATE OR REPLACE FUNCTION public.approve_candidate_assets_v2(p_household_id uuid, p_actor_profile_id uuid, p_client_request_id text, p_decisions jsonb, p_jurisdiction text DEFAULT 'AB'::text, p_household_auto_defaults jsonb DEFAULT '{}'::jsonb, p_household_property_defaults jsonb DEFAULT '{}'::jsonb, p_switching_preferences jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_client_request_id text;
  v_product_line product_line;
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

  -- Require, trim, and length-bound the idempotency key.
  if p_client_request_id is null or length(trim(p_client_request_id)) = 0 then
    raise exception 'client_request_id is required' using errcode = 'P0001';
  end if;
  if length(trim(p_client_request_id)) > 240 then
    raise exception 'client_request_id exceeds maximum length' using errcode = 'P0001';
  end if;
  v_client_request_id := trim(p_client_request_id);

  -- Household authorization/isolation is established above; only now may an
  -- idempotent result be returned, and only within the caller's household.
  -- The advisory-lock key and the idempotency lookup are both scoped by household.
  perform pg_advisory_xact_lock(hashtextextended('approve:' || p_household_id::text || ':' || v_client_request_id, 0));

  select id, result_json into v_existing
  from candidate_approvals
  where household_id = p_household_id
    and client_request_id = v_client_request_id;
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

    -- Immutable original extraction evidence, captured before customer reviews.
    v_raw_coverage := v_current_coverage;

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

        -- Customer corrections are authoritative and are stored as explicit
        -- object-valued states so comparison never restores the original value.
        -- Unknown never deletes the key (deletion would let loadCompareAssets fall
        -- back to the original extracted candidate value).
        if v_review.action = 'unknown' then
          v_current_coverage := jsonb_set(
            v_current_coverage,
            array[v_coverage_key],
            jsonb_build_object('status', 'unknown', 'value', 'null'::jsonb)
          );
        elsif v_review.action = 'not_applicable' then
          v_current_coverage := jsonb_set(
            v_current_coverage,
            array[v_coverage_key],
            jsonb_build_object('status', 'not_applicable', 'value', 'null'::jsonb)
          );
        elsif v_review.action = 'correct' and v_review.corrected_value is not null then
          -- A correction always yields a known value, even from an original
          -- conflicting / not_included / unknown state.
          v_current_coverage := jsonb_set(
            v_current_coverage,
            array[v_coverage_key],
            jsonb_build_object('status', 'known', 'value', v_review.corrected_value)
          );
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
    -- v_raw_coverage was captured before customer reviews were merged (immutable provenance).
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
      -- Copy the state metadata (and provenance) alongside the aliased value.
      if v_coverage_state ? 'liabilityLimitCents' then
        v_coverage_state := jsonb_set(
          v_coverage_state,
          array['personalLiabilityLimitCents'],
          v_coverage_state->'liabilityLimitCents'
        );
      end if;
      if v_raw_coverage ? 'liabilityLimitCents' and not (v_raw_coverage ? 'personalLiabilityLimitCents') then
        v_raw_coverage := jsonb_set(
          v_raw_coverage,
          array['personalLiabilityLimitCents'],
          v_raw_coverage->'liabilityLimitCents'
        );
      end if;
    end if;
    v_normalized_coverage := v_normalized_coverage - 'liabilityLimitCents';
    v_coverage_state := v_coverage_state - 'liabilityLimitCents';

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

    -- Canonical policy-to-asset relationship with current/historical versioning.
    v_product_line := case v_candidate.asset_type when 'vehicle' then 'auto'::product_line else 'property'::product_line end;

    -- Lock existing current relations for this asset/product line before retiring them.
    perform 1 from policy_asset_links
    where household_id = p_household_id
      and asset_type = v_candidate.asset_type
      and asset_id = v_asset_id_for_mandate
      and product_line = v_product_line
    for update;

    -- Retire the previously current policy and its relation (kept as history).
    update policies p
    set is_current = false, updated_at = now()
    from policy_asset_links l
    where l.policy_id = p.id
      and l.household_id = p_household_id
      and l.asset_type = v_candidate.asset_type
      and l.asset_id = v_asset_id_for_mandate
      and l.product_line = v_product_line
      and l.is_current;

    update policy_asset_links
    set is_current = false,
        effective_to = coalesce(effective_to, current_date),
        updated_at = now()
    where household_id = p_household_id
      and asset_type = v_candidate.asset_type
      and asset_id = v_asset_id_for_mandate
      and product_line = v_product_line
      and is_current;

    -- Create the new current relation for the freshly created policy.
    insert into policy_asset_links (
      policy_id, household_id, asset_id, asset_type, product_line,
      is_current, effective_from, candidate_id
    ) values (
      v_policy_id, p_household_id, v_asset_id_for_mandate, v_candidate.asset_type, v_product_line,
      true, coalesce(v_effective_date, current_date), v_candidate.id
    );

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
    p_household_id, v_actor, v_client_request_id, 'completed', v_result
  );

  return v_result;
end;
$function$;


revoke all on function public.approve_candidate_assets_v2(uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.approve_candidate_assets_v2(uuid, uuid, text, jsonb, text, jsonb, jsonb, jsonb) to authenticated, service_role;

commit;
