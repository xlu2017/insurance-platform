-- Document processing generation fencing, normalization reuse, and lifecycle hardening.
-- Builds on 20260804200016 without rewriting it.
begin;

-- Remove overloaded old signatures so the hardened versions are unambiguous.
drop function if exists plan_document_upload_v1(uuid, uuid[], uuid);
drop function if exists plan_document_upload_v1(uuid, uuid[], uuid, text);
drop function if exists supersede_processing_batch_v1(uuid, uuid, uuid, uuid[]);
drop function if exists supersede_processing_batch_v1(uuid, uuid, uuid[], integer, text);
drop function if exists create_successor_document_batch_v1(uuid, uuid, uuid, uuid[]);
drop function if exists create_successor_document_batch_v1(uuid, uuid, uuid[], integer, text);
drop function if exists persist_document_batch_analysis_v1(uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid);

-- =============================================================================
-- 1. Status extensions and continuation decision fields.
-- =============================================================================

alter table document_processing_batches
  drop constraint if exists document_processing_batches_status_check;

alter table document_processing_batches
  add constraint document_processing_batches_status_check
  check (status in (
    'uploading_files',
    'checking_duplicates',
    'queued',
    'cancellation_requested',
    'waiting_for_predecessor',
    'reading_policy_documents',
    'comparing_policies',
    'validating_extracted_details',
    'ready_for_review',
    'additional_information_required',
    'processing_unavailable',
    'manual_review',
    'superseded'
  ));

alter table document_processing_batches
  add column if not exists continuation_choice text check (continuation_choice in ('restart', 'wait')),
  add column if not exists continuation_request_id text,
  add column if not exists continuation_chosen_by uuid references profiles(id),
  add column if not exists continuation_chosen_at timestamptz,
  add column if not exists expected_processing_generation integer;

alter table document_processing_batches
  add constraint document_processing_batches_continuation_request_unique
  unique (continuation_request_id);

-- Add updated_at to normalization association and overlap tables for idempotent upserts.
alter table document_processing_batch_normalizations
  add column if not exists updated_at timestamptz not null default now();
alter table document_asset_overlap_assessments
  add column if not exists updated_at timestamptz not null default now();

-- =============================================================================
-- 2. Shared helper for auth and household membership validation.
-- =============================================================================

create or replace function require_household_member_or_service_role(p_household_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();

  if auth.role() = 'service_role' then
    return v_actor;
  end if;

  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if not is_household_member(p_household_id) then
    raise exception 'Household access denied' using errcode = 'P0001';
  end if;

  return v_actor;
end;
$$;

create or replace function require_household_member_or_service_role(p_household_id uuid, p_supplied_actor_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
begin
  if auth.role() = 'service_role' and p_supplied_actor_id is not null then
    if not exists (select 1 from profiles where id = p_supplied_actor_id) then
      raise exception 'Supplied actor profile does not exist' using errcode = 'P0001';
    end if;
    return p_supplied_actor_id;
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

-- =============================================================================
-- 3. Normalize JSON type helpers.
-- =============================================================================

create or replace function jsonb_is_array(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(coalesce(p, 'null'::jsonb)) = 'array';
$$;

create or replace function jsonb_is_object(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(coalesce(p, 'null'::jsonb)) = 'object';
$$;

-- =============================================================================
-- 4. Batch claim guard: do not claim blocked or unreleased states.
-- =============================================================================

alter table document_processing_batches
  drop constraint if exists document_processing_batches_unreleased_predecessor_check;

-- A batch whose predecessor has not reached a terminal point must stay blocked.
create or replace function document_processing_batches_predecessor_terminal_guard()
returns trigger
language plpgsql
as $$
begin
  if new.depends_on_batch_id is not null
     and new.status not in ('waiting_for_predecessor', 'superseded', 'cancellation_requested') then
    if not exists (
      select 1 from document_processing_batches pred
      where pred.id = new.depends_on_batch_id
        and pred.status in ('ready_for_review', 'additional_information_required', 'manual_review', 'processing_unavailable', 'superseded')
    ) then
      raise exception 'BATCH_PREDECESSOR_NOT_TERMINAL: predecessor has not reached a terminal state' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists document_processing_batches_predecessor_terminal_guard on document_processing_batches;
create trigger document_processing_batches_predecessor_terminal_guard
  before insert or update on document_processing_batches
  for each row execute function document_processing_batches_predecessor_terminal_guard();

-- Update claim to exclude waiting/superceded/cancellation-requested and unreleased predecessors.
create or replace function claim_document_processing_batch_v1(
  p_batch_id uuid,
  p_household_id uuid,
  p_lease_seconds integer default 1200
) returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_claimed uuid;
  v_pred_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only service_role may claim document processing batches';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 3600 then
    raise exception 'Invalid document processing lease duration';
  end if;

  -- A waiting or cancelled/superseded batch cannot be claimed.
  update document_processing_batches
  set status = 'reading_policy_documents',
      retryable = false,
      processing_started_at = coalesce(processing_started_at, now()),
      worker_claimed_at = now(),
      worker_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = p_batch_id
    and household_id = p_household_id
    and status not in ('waiting_for_predecessor', 'cancellation_requested', 'superseded')
    and (
      status = 'queued'
      or (status = 'processing_unavailable' and retryable)
      or (
        status in ('reading_policy_documents', 'comparing_policies', 'validating_extracted_details')
        and worker_lease_expires_at < now()
      )
    )
    and (
      depends_on_batch_id is null
      or exists (
        select 1 from document_processing_batches pred
        where pred.id = depends_on_batch_id
          and pred.status in ('ready_for_review', 'additional_information_required', 'manual_review', 'processing_unavailable', 'superseded')
      )
    )
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;

-- =============================================================================
-- 5. Automatic successor advancement when a predecessor becomes terminal.
-- =============================================================================

create or replace function advance_waiting_successor_on_terminal()
returns trigger
language plpgsql
as $$
declare
  v_successor document_processing_batches%rowtype;
  v_old_item document_processing_batch_items%rowtype;
  v_new_item_id uuid;
  v_norm record;
begin
  if new.status not in ('ready_for_review', 'additional_information_required', 'manual_review', 'processing_unavailable') then
    return new;
  end if;

  for v_successor in
    select *
    from document_processing_batches
    where depends_on_batch_id = new.id
      and status = 'waiting_for_predecessor'
    order by processing_generation
  loop
    -- Bring forward completed normalizations from predecessor for any overlapping documents.
    for v_old_item in
      select *
      from document_processing_batch_items
      where batch_id = new.id
    loop
      for v_norm in
        select b.*, n.status as norm_status
        from document_processing_batch_normalizations b
        join document_normalizations n on n.id = b.normalization_id
        where b.batch_id = new.id
          and b.batch_item_id = v_old_item.id
          and n.status = 'complete'
      loop
        if not exists (
          select 1 from document_processing_batch_items
          where batch_id = v_successor.id
            and policy_document_id = v_old_item.policy_document_id
        ) then
          insert into document_processing_batch_items (
            batch_id, household_id, client_item_id, policy_document_id,
            selected_file_name, category, content_sha256, deduplicated,
            duplicate_of_policy_document_id, status
          )
          select
            v_successor.id,
            v_successor.household_id,
            'successor:' || gen_random_uuid(),
            v_old_item.policy_document_id,
            pd.file_name,
            pd.category,
            pd.content_sha256,
            false,
            null,
            'uploaded'
          from policy_documents pd
          where pd.id = v_old_item.policy_document_id;
        end if;

        select id into v_new_item_id
        from document_processing_batch_items
        where batch_id = v_successor.id
          and policy_document_id = v_old_item.policy_document_id
        limit 1;

        if v_new_item_id is not null then
          insert into document_processing_batch_normalizations (
            batch_id, batch_item_id, normalization_id, use_status
          )
          values (
            v_successor.id,
            v_new_item_id,
            v_norm.normalization_id,
            'reused'
          )
          on conflict (batch_id, batch_item_id) do nothing;
        end if;
      end loop;
    end loop;

    update document_processing_batches
    set status = 'queued',
        updated_at = now()
    where id = v_successor.id;

    update document_processing_batches
    set document_count = (select count(*) from document_processing_batch_items where batch_id = v_successor.id)
    where id = v_successor.id;
  end loop;

  return new;
end;
$$;

drop trigger if exists advance_waiting_successor_on_terminal on document_processing_batches;
create trigger advance_waiting_successor_on_terminal
  after update on document_processing_batches
  for each row when (old.status is distinct from new.status)
  execute function advance_waiting_successor_on_terminal();

-- =============================================================================
-- 6. Generation assertion helper.
-- =============================================================================

create or replace function assert_document_batch_generation_v1(
  p_batch_id uuid,
  p_household_id uuid,
  p_session_id uuid,
  p_processing_generation integer
) returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_ok boolean;
begin
  select true into v_ok
  from document_processing_batches
  where id = p_batch_id
    and household_id = p_household_id
    and session_id = p_session_id
    and processing_generation = p_processing_generation
    and status not in ('superseded', 'cancellation_requested', 'waiting_for_predecessor')
  for update;

  if not v_ok then
    raise exception 'DOCUMENT_BATCH_GENERATION_MISMATCH: batch is not current or not in an actionable state' using errcode = 'P0001';
  end if;

  return true;
end;
$$;

revoke all on function assert_document_batch_generation_v1(uuid, uuid, uuid, integer) from public, anon;
grant execute on function assert_document_batch_generation_v1(uuid, uuid, uuid, integer) to service_role;

-- =============================================================================
-- 7. Normalization immutability after completion.
-- =============================================================================

create or replace function document_normalizations_immutable_after_complete()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'complete' and tg_op = 'UPDATE' then
    if new.household_id is distinct from old.household_id
      or new.content_sha256 is distinct from old.content_sha256
      or new.normalization_schema_version is distinct from old.normalization_schema_version
      or new.analyzer_version is distinct from old.analyzer_version
      or new.model_provider is distinct from old.model_provider
      or new.model_id is distinct from old.model_id
      or new.prompt_version is distinct from old.prompt_version
      or new.classification is distinct from old.classification
      or new.normalized_output_json is distinct from old.normalized_output_json
      or new.normalized_entities_json is distinct from old.normalized_entities_json
      or new.conflicts_json is distinct from old.conflicts_json
      or new.evidence_json is distinct from old.evidence_json
    then
      raise exception 'NORMALIZATION_IMMUTABLE: completed normalization cannot be altered' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists document_normalizations_immutable_after_complete on document_normalizations;
create trigger document_normalizations_immutable_after_complete
  before update on document_normalizations
  for each row execute function document_normalizations_immutable_after_complete();

-- Do not let batch reuse state affect the normalization status.
create or replace function document_normalizations_no_superseded_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'superseded' then
    raise exception 'NORMALIZATION_STATUS_NOT_SUPPERSEDED: use document_processing_batch_normalizations for reuse state' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists document_normalizations_no_superseded_status on document_normalizations;
create trigger document_normalizations_no_superseded_status
  before insert or update on document_normalizations
  for each row execute function document_normalizations_no_superseded_status();

-- =============================================================================
-- 8. Cross-table integrity for batch normalizations.
-- =============================================================================

create or replace function document_processing_batch_normalizations_integrity()
returns trigger
language plpgsql
as $$
declare
  v_batch_household uuid;
  v_item_household uuid;
  v_norm_household uuid;
  v_item_digest text;
  v_norm_digest text;
begin
  select b.household_id into v_batch_household
  from document_processing_batches b
  where b.id = new.batch_id;

  select i.household_id, i.content_sha256 into v_item_household, v_item_digest
  from document_processing_batch_items i
  where i.id = new.batch_item_id;

  select n.household_id, n.content_sha256 into v_norm_household, v_norm_digest
  from document_normalizations n
  where n.id = new.normalization_id;

  if v_batch_household is distinct from v_item_household
    or v_batch_household is distinct from v_norm_household
    or v_item_household is distinct from v_norm_household
  then
    raise exception 'BATCH_NORMALIZATION_HOUSEHOLD_MISMATCH' using errcode = 'P0001';
  end if;

  if v_item_digest is distinct from v_norm_digest then
    raise exception 'BATCH_NORMALIZATION_DIGEST_MISMATCH' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists document_processing_batch_normalizations_integrity on document_processing_batch_normalizations;
create trigger document_processing_batch_normalizations_integrity
  before insert or update on document_processing_batch_normalizations
  for each row execute function document_processing_batch_normalizations_integrity();

-- =============================================================================
-- 9. Cross-table integrity and idempotency for overlap assessments.
-- =============================================================================

create or replace function document_asset_overlap_assessment_integrity()
returns trigger
language plpgsql
as $$
declare
  v_batch_household uuid;
  v_norm_household uuid;
begin
  select b.household_id into v_batch_household
  from document_processing_batches b
  where b.id = new.batch_id;

  select n.household_id into v_norm_household
  from document_normalizations n
  where n.id = new.normalization_id;

  if v_batch_household is distinct from v_norm_household then
    raise exception 'OVERLAP_HOUSEHOLD_MISMATCH' using errcode = 'P0001';
  end if;

  if new.asset_id is not null and new.asset_type = 'vehicle' and not exists (
    select 1 from vehicles v where v.id = new.asset_id and v.household_id = v_batch_household
  ) then
    raise exception 'OVERLAP_VEHICLE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if new.asset_id is not null and new.asset_type = 'property' and not exists (
    select 1 from properties p where p.id = new.asset_id and p.household_id = v_batch_household
  ) then
    raise exception 'OVERLAP_PROPERTY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if new.existing_policy_id is not null and not exists (
    select 1 from policies pol where pol.id = new.existing_policy_id and pol.household_id = v_batch_household
  ) then
    raise exception 'OVERLAP_POLICY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if new.existing_policy_id is not null and new.asset_type is not null then
    if new.asset_type = 'vehicle' and not exists (
      select 1 from policy_asset_links l
      where l.policy_id = new.existing_policy_id
        and l.asset_type = 'vehicle'
        and l.asset_id = new.asset_id
    ) and not exists (
      select 1 from vehicles v where v.id = new.asset_id
    ) then
      raise exception 'OVERLAP_POLICY_ASSET_TYPE_MISMATCH' using errcode = 'P0001';
    end if;
    -- Property check analogous.
    if new.asset_type = 'property' and not exists (
      select 1 from policy_asset_links l
      where l.policy_id = new.existing_policy_id
        and l.asset_type = 'property'
        and l.asset_id = new.asset_id
    ) and not exists (
      select 1 from properties p where p.id = new.asset_id
    ) then
      raise exception 'OVERLAP_POLICY_ASSET_TYPE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists document_asset_overlap_assessment_integrity on document_asset_overlap_assessments;
create trigger document_asset_overlap_assessment_integrity
  before insert or update on document_asset_overlap_assessments
  for each row execute function document_asset_overlap_assessment_integrity();

-- Idempotency: one assessment per (batch, normalization, entity key).
create unique index if not exists idx_overlap_assessments_unique_key
  on document_asset_overlap_assessments (batch_id, normalization_id, normalized_entity_key);

create or replace function record_document_asset_overlap_v1(
  p_batch_id uuid,
  p_normalization_id uuid,
  p_normalized_entity_key text,
  p_asset_id uuid,
  p_asset_type candidate_asset_type,
  p_existing_policy_id uuid,
  p_classification document_asset_overlap_classification,
  p_confidence double precision,
  p_details_json jsonb
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into document_asset_overlap_assessments (
    batch_id,
    normalization_id,
    normalized_entity_key,
    asset_id,
    asset_type,
    existing_policy_id,
    classification,
    confidence,
    details_json
  ) values (
    p_batch_id,
    p_normalization_id,
    p_normalized_entity_key,
    p_asset_id,
    p_asset_type,
    p_existing_policy_id,
    p_classification,
    p_confidence,
    p_details_json
  )
  on conflict (batch_id, normalization_id, normalized_entity_key) do update set
    asset_id = excluded.asset_id,
    asset_type = excluded.asset_type,
    existing_policy_id = excluded.existing_policy_id,
    classification = excluded.classification,
    confidence = excluded.confidence,
    details_json = excluded.details_json,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function record_document_asset_overlap_v1(uuid, uuid, text, uuid, candidate_asset_type, uuid, document_asset_overlap_classification, double precision, jsonb) from public, anon;
grant execute on function record_document_asset_overlap_v1(uuid, uuid, text, uuid, candidate_asset_type, uuid, document_asset_overlap_classification, double precision, jsonb) to service_role;

-- =============================================================================
-- 10. Hardened normalization persistence with atomic conflict.
-- =============================================================================

create or replace function persist_document_normalization_v1(
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
  p_evidence_json jsonb
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_inserted boolean;
  v_doc_household uuid;
  v_doc_digest text;
begin
  if p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid content_sha256' using errcode = 'P0001';
  end if;
  if coalesce(p_normalization_schema_version, '') = '' then
    raise exception 'normalization_schema_version is required' using errcode = 'P0001';
  end if;
  if coalesce(p_analyzer_version, '') = '' then
    raise exception 'analyzer_version is required' using errcode = 'P0001';
  end if;
  if not jsonb_is_object(p_normalized_output_json) then
    raise exception 'normalized_output_json must be an object' using errcode = 'P0001';
  end if;
  if not jsonb_is_array(p_normalized_entities_json) then
    raise exception 'normalized_entities_json must be an array' using errcode = 'P0001';
  end if;
  if not jsonb_is_array(p_conflicts_json) then
    raise exception 'conflicts_json must be an array' using errcode = 'P0001';
  end if;
  if not jsonb_is_array(p_evidence_json) then
    raise exception 'evidence_json must be an array' using errcode = 'P0001';
  end if;

  select household_id, content_sha256 into v_doc_household, v_doc_digest
  from policy_documents
  where id = p_policy_document_id;

  if v_doc_household is null or v_doc_household is distinct from p_household_id then
    raise exception 'POLICY_DOCUMENT_NOT_FOUND_OR_FOREIGN' using errcode = 'P0001';
  end if;

  if v_doc_digest is distinct from p_content_sha256 then
    raise exception 'NORMALIZATION_DIGEST_MISMATCH: supplied digest does not match policy document' using errcode = 'P0001';
  end if;

  insert into document_normalizations (
    household_id,
    policy_document_id,
    content_sha256,
    normalization_schema_version,
    analyzer_version,
    model_provider,
    model_id,
    prompt_version,
    classification,
    normalized_output_json,
    normalized_entities_json,
    conflicts_json,
    evidence_json,
    status,
    completed_at
  ) values (
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
    p_evidence_json,
    'complete',
    now()
  )
  on conflict (
    household_id,
    content_sha256,
    normalization_schema_version,
    analyzer_version
  ) do update set
    status = excluded.status
  returning id, (xmax = 0) as inserted into v_id, v_inserted;

  if v_id is null then
    select id into v_id
    from document_normalizations
    where household_id = p_household_id
      and content_sha256 = p_content_sha256
      and normalization_schema_version = p_normalization_schema_version
      and analyzer_version = p_analyzer_version;
  end if;

  if v_id is null then
    raise exception 'NORMALIZATION_CONFLICT_RACE' using errcode = 'P0001';
  end if;

  return jsonb_build_object('id', v_id, 'reused', (v_inserted is not true));
end;
$$;

revoke all on function persist_document_normalization_v1(uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function persist_document_normalization_v1(uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;

-- =============================================================================
-- 11. Batch-aware normalization persistence.
-- =============================================================================

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
  end if;

  if v_batch_status = 'waiting_for_predecessor' then
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
    'use_status', v_use_status
  );
end;
$$;

revoke all on function persist_document_normalization_for_batch_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb, integer) from public, anon;
grant execute on function persist_document_normalization_for_batch_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb, integer) to service_role;

-- =============================================================================
-- 12. Harden persist_document_batch_analysis_v1 with generation fencing.
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
  p_consent_id uuid default null,
  p_processing_generation integer default null
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
  v_batch_status text;
  v_batch_generation integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only service_role may persist document batch analysis';
  end if;
  if jsonb_typeof(p_reviews_json) <> 'array' then
    raise exception 'p_reviews_json must be a JSON array';
  end if;

  select session_id, case_id, status, processing_generation
  into v_batch_session_id, v_batch_case_id, v_batch_status, v_batch_generation
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

  if v_batch_status in ('superseded', 'cancellation_requested') then
    raise exception 'BATCH_CANNOT_ADVANCE: batch is superseded or cancellation requested' using errcode = 'P0001';
  end if;

  if p_processing_generation is not null and v_batch_generation <> p_processing_generation then
    raise exception 'BATCH_GENERATION_MISMATCH: expected %, got %', p_processing_generation, v_batch_generation using errcode = 'P0001';
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
  uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid, integer
) from public, anon, authenticated;
grant execute on function persist_document_batch_analysis_v1(
  uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid, integer
) to service_role;

-- =============================================================================
-- 13. Hardened upload planning.
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
  v_plan_request_id text;
begin
  v_actor := require_household_member_or_service_role(p_household_id);

  if p_case_id is not null then
    if not exists (
      select 1 from optimization_cases
      where id = p_case_id and household_id = p_household_id
    ) then
      raise exception 'CASE_NOT_FOUND_OR_FOREIGN' using errcode = 'P0001';
    end if;
  end if;

  -- Deduplicate and validate new document IDs.
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

  -- Count reusable normalizations for new uploads and gather exact duplicate metadata.
  v_reusable_count := 0;
  for v_doc in
    select pd.id, pd.content_sha256, pd.file_name,
      n.id as normalization_id,
      n.normalized_entities_json,
      n.normalized_output_json
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
      v_exact_duplicates := v_exact_duplicates || jsonb_build_object(
        'policyDocumentId', v_doc.id,
        'normalizationId', v_doc.normalization_id,
        'originalFilename', v_doc.file_name
      );
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

  -- Estimates count only unfinished current + new normalization work.
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

-- =============================================================================
-- 14. Hardened restart/supersede with idempotent continuation decision.
-- =============================================================================

create or replace function supersede_processing_batch_v1(
  p_active_batch_id uuid,
  p_household_id uuid,
  p_new_policy_document_ids uuid[] default '{}'::uuid[],
  p_expected_generation integer default null,
  p_continuation_request_id text default null,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_old_batch document_processing_batches%rowtype;
  v_new_session_id uuid;
  v_new_batch_id uuid;
  v_old_item document_processing_batch_items%rowtype;
  v_new_item_id uuid;
  v_norm record;
  v_client_request_id text;
  v_existing_batch document_processing_batches%rowtype;
  v_doc_id uuid;
  v_seen uuid[] := '{}'::uuid[];
begin
  v_actor := require_household_member_or_service_role(p_household_id, p_actor_id);

  if p_active_batch_id is null or p_household_id is null then
    raise exception 'Missing required argument' using errcode = 'P0001';
  end if;

  foreach v_doc_id in array p_new_policy_document_ids loop
    if v_doc_id is null then
      raise exception 'NULL_POLICY_DOCUMENT_ID' using errcode = 'P0001';
    end if;
    if v_doc_id = any(v_seen) then
      raise exception 'DUPLICATE_POLICY_DOCUMENT_ID: %', v_doc_id using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_doc_id;
  end loop;

  -- Validate all new documents belong to the household.
  if v_seen <> '{}'::uuid[] then
    for v_doc_id in
      select id from policy_documents
      where id = any(v_seen) and household_id = p_household_id
    loop
      null;
    end loop;
  end if;

  perform pg_advisory_xact_lock(household_advisory_lock_key(p_household_id));

  select * into v_old_batch
  from document_processing_batches
  where id = p_active_batch_id
    and household_id = p_household_id
  for update;

  if v_old_batch.id is null then
    raise exception 'Batch not found' using errcode = 'P0001';
  end if;

  if p_expected_generation is not null and v_old_batch.processing_generation is distinct from p_expected_generation then
    raise exception 'BATCH_GENERATION_MISMATCH' using errcode = 'P0001';
  end if;

  if v_old_batch.status in ('superseded', 'cancellation_requested') then
    raise exception 'Batch already superseded or cancelled' using errcode = 'P0001';
  end if;

  if v_old_batch.status not in (
    'uploading_files',
    'checking_duplicates',
    'queued',
    'reading_policy_documents',
    'comparing_policies',
    'validating_extracted_details'
  ) then
    raise exception 'Batch is not eligible for supersession: %', v_old_batch.status using errcode = 'P0001';
  end if;

  -- Idempotent continuation decision.
  if p_continuation_request_id is not null then
    if v_old_batch.continuation_request_id is not null and v_old_batch.continuation_request_id <> p_continuation_request_id then
      raise exception 'CONTINUATION_CONFLICT: a different continuation was already chosen' using errcode = 'P0001';
    end if;
    if v_old_batch.continuation_request_id is null then
      update document_processing_batches
      set continuation_choice = 'restart',
          continuation_request_id = p_continuation_request_id,
          continuation_chosen_by = v_actor,
          continuation_chosen_at = now()
      where id = v_old_batch.id;
    elsif v_old_batch.continuation_choice <> 'restart' then
      raise exception 'CONTINUATION_TYPE_CONFLICT: expected restart, already chosen wait' using errcode = 'P0001';
    end if;
  end if;

  -- If a superseding batch already exists for this request, return it.
  if v_old_batch.continuation_request_id is not null and v_old_batch.continuation_choice = 'restart' then
    select * into v_existing_batch
    from document_processing_batches
    where superseded_by_batch_id = v_old_batch.id
    limit 1;
    if v_existing_batch.id is not null then
      return jsonb_build_object(
        'new_batch_id', v_existing_batch.id,
        'new_session_id', v_existing_batch.session_id,
        'superseded_batch_id', v_old_batch.id
      );
    end if;
  end if;

  v_client_request_id := coalesce(v_old_batch.client_request_id, 'supersede:') || ':' || gen_random_uuid()::text;

  v_new_session_id := gen_random_uuid();
  insert into document_extraction_sessions (id, household_id, created_by, case_id, status)
  values (v_new_session_id, p_household_id, v_actor, v_old_batch.case_id, 'open');

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
    depends_on_batch_id
  )
  select
    p_household_id,
    v_actor,
    v_client_request_id,
    v_new_session_id,
    v_old_batch.case_id,
    v_old_batch.mode_snapshot,
    v_old_batch.settings_version,
    v_old_batch.disclosure_version,
    v_old_batch.configured_provider,
    v_old_batch.configured_model_id,
    v_old_batch.consent_id,
    'queued',
    v_old_batch.processing_generation + 1,
    null
  returning id into v_new_batch_id;

  -- Copy existing items and reuse completed normalizations.
  for v_old_item in
    select *
    from document_processing_batch_items
    where batch_id = v_old_batch.id
  loop
    insert into document_processing_batch_items (
      batch_id, household_id, client_item_id, policy_document_id,
      selected_file_name, category, content_sha256, deduplicated,
      duplicate_of_policy_document_id, status
    )
    values (
      v_new_batch_id,
      p_household_id,
      v_old_item.client_item_id,
      v_old_item.policy_document_id,
      v_old_item.selected_file_name,
      v_old_item.category,
      v_old_item.content_sha256,
      v_old_item.deduplicated,
      v_old_item.duplicate_of_policy_document_id,
      v_old_item.status
    )
    returning id into v_new_item_id;

    for v_norm in
      select b.*
      from document_processing_batch_normalizations b
      join document_normalizations n on n.id = b.normalization_id
      where b.batch_id = v_old_batch.id
        and b.batch_item_id = v_old_item.id
        and n.status = 'complete'
    loop
      insert into document_processing_batch_normalizations (
        batch_id, batch_item_id, normalization_id, use_status
      )
      values (
        v_new_batch_id,
        v_new_item_id,
        v_norm.normalization_id,
        'reused'
      );
    end loop;
  end loop;

  -- Add any new documents as new batch items.
  if v_seen <> '{}'::uuid[] then
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
      v_new_batch_id,
      p_household_id,
      'new:' || gen_random_uuid(),
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
      and pd.id not in (
        select policy_document_id
        from document_processing_batch_items
        where batch_id = v_new_batch_id
      );
  end if;

  update document_processing_batches
  set status = 'superseded',
      superseded_by_batch_id = v_new_batch_id,
      superseded_at = now(),
      updated_at = now()
  where id = v_old_batch.id;

  update document_processing_batches
  set document_count = (select count(*) from document_processing_batch_items where batch_id = v_new_batch_id)
  where id = v_new_batch_id;

  insert into audit_events (
    actor_profile_id, action, entity_type, entity_id, household_id, case_id,
    after_summary
  ) values (
    v_actor,
    'document_processing_batch_superseded',
    'document_processing_batch',
    v_new_batch_id,
    p_household_id,
    v_old_batch.case_id,
    jsonb_build_object('superseded_batch_id', p_active_batch_id, 'new_batch_id', v_new_batch_id)
  );

  return jsonb_build_object(
    'new_batch_id', v_new_batch_id,
    'new_session_id', v_new_session_id,
    'superseded_batch_id', p_active_batch_id
  );
end;
$$;

revoke all on function supersede_processing_batch_v1(uuid, uuid, uuid[], integer, text, uuid) from public, anon;
grant execute on function supersede_processing_batch_v1(uuid, uuid, uuid[], integer, text, uuid) to authenticated, service_role;

-- =============================================================================
-- 15. Hardened queued successor batch creation.
-- =============================================================================

create or replace function create_successor_document_batch_v1(
  p_predecessor_batch_id uuid,
  p_household_id uuid,
  p_new_policy_document_ids uuid[] default '{}'::uuid[],
  p_expected_generation integer default null,
  p_continuation_request_id text default null,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_predecessor document_processing_batches%rowtype;
  v_new_session_id uuid;
  v_new_batch_id uuid;
  v_client_request_id text;
  v_doc_id uuid;
  v_existing document_processing_batches%rowtype;
  v_seen uuid[] := '{}'::uuid[];
begin
  v_actor := require_household_member_or_service_role(p_household_id, p_actor_id);

  if p_predecessor_batch_id is null or p_household_id is null then
    raise exception 'Missing required argument' using errcode = 'P0001';
  end if;

  foreach v_doc_id in array p_new_policy_document_ids loop
    if v_doc_id is null then
      raise exception 'NULL_POLICY_DOCUMENT_ID' using errcode = 'P0001';
    end if;
    if v_doc_id = any(v_seen) then
      raise exception 'DUPLICATE_POLICY_DOCUMENT_ID: %', v_doc_id using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_doc_id;
  end loop;

  if v_seen <> '{}'::uuid[] then
    for v_doc_id in
      select id from policy_documents
      where id = any(v_seen) and household_id = p_household_id
    loop
      null;
    end loop;
  end if;

  perform pg_advisory_xact_lock(household_advisory_lock_key(p_household_id));

  select * into v_predecessor
  from document_processing_batches
  where id = p_predecessor_batch_id
    and household_id = p_household_id
  for update;

  if v_predecessor.id is null then
    raise exception 'Predecessor batch not found' using errcode = 'P0001';
  end if;

  if p_expected_generation is not null and v_predecessor.processing_generation is distinct from p_expected_generation then
    raise exception 'BATCH_GENERATION_MISMATCH' using errcode = 'P0001';
  end if;

  if v_predecessor.status in ('superseded', 'cancellation_requested') then
    raise exception 'Predecessor batch is already superseded or cancelled' using errcode = 'P0001';
  end if;

  if v_predecessor.status not in (
    'uploading_files',
    'checking_duplicates',
    'queued',
    'reading_policy_documents',
    'comparing_policies',
    'validating_extracted_details',
    'ready_for_review',
    'additional_information_required',
    'manual_review',
    'processing_unavailable'
  ) then
    raise exception 'Predecessor is not eligible for a successor: %', v_predecessor.status using errcode = 'P0001';
  end if;

  -- Idempotent continuation decision.
  if p_continuation_request_id is not null then
    if v_predecessor.continuation_request_id is not null and v_predecessor.continuation_request_id <> p_continuation_request_id then
      raise exception 'CONTINUATION_CONFLICT: a different continuation was already chosen' using errcode = 'P0001';
    end if;
    if v_predecessor.continuation_request_id is null then
      update document_processing_batches
      set continuation_choice = 'wait',
          continuation_request_id = p_continuation_request_id,
          continuation_chosen_by = v_actor,
          continuation_chosen_at = now()
      where id = v_predecessor.id;
    elsif v_predecessor.continuation_choice <> 'wait' then
      raise exception 'CONTINUATION_TYPE_CONFLICT: expected wait, already chosen restart' using errcode = 'P0001';
    end if;
  end if;

  -- At most one nonterminal successor per predecessor.
  select * into v_existing
  from document_processing_batches
  where depends_on_batch_id = v_predecessor.id
    and status not in ('superseded')
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'new_batch_id', v_existing.id,
      'new_session_id', v_existing.session_id,
      'predecessor_batch_id', v_predecessor.id
    );
  end if;

  v_client_request_id := coalesce(v_predecessor.client_request_id, 'successor:') || ':' || gen_random_uuid()::text;

  v_new_session_id := gen_random_uuid();
  insert into document_extraction_sessions (id, household_id, created_by, case_id, status)
  values (v_new_session_id, p_household_id, v_actor, v_predecessor.case_id, 'open');

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
    depends_on_batch_id
  )
  select
    p_household_id,
    v_actor,
    v_client_request_id,
    v_new_session_id,
    v_predecessor.case_id,
    v_predecessor.mode_snapshot,
    v_predecessor.settings_version,
    v_predecessor.disclosure_version,
    v_predecessor.configured_provider,
    v_predecessor.configured_model_id,
    v_predecessor.consent_id,
    'waiting_for_predecessor',
    v_predecessor.processing_generation + 1,
    p_predecessor_batch_id
  returning id into v_new_batch_id;

  if v_seen <> '{}'::uuid[] then
    insert into document_processing_batch_items (
      batch_id, household_id, client_item_id, policy_document_id,
      selected_file_name, category, content_sha256, deduplicated,
      duplicate_of_policy_document_id, status
    )
    select
      v_new_batch_id,
      p_household_id,
      'new:' || gen_random_uuid(),
      pd.id,
      pd.file_name,
      pd.category,
      pd.content_sha256,
      false,
      null,
      'uploaded'
    from policy_documents pd
    where pd.id = any(v_seen)
      and pd.household_id = p_household_id;
  end if;

  update document_processing_batches
  set document_count = (select count(*) from document_processing_batch_items where batch_id = v_new_batch_id)
  where id = v_new_batch_id;

  insert into audit_events (
    actor_profile_id, action, entity_type, entity_id, household_id, case_id,
    after_summary
  ) values (
    v_actor,
    'document_processing_batch_queued_successor',
    'document_processing_batch',
    v_new_batch_id,
    p_household_id,
    v_predecessor.case_id,
    jsonb_build_object('predecessor_batch_id', p_predecessor_batch_id)
  );

  return jsonb_build_object(
    'new_batch_id', v_new_batch_id,
    'new_session_id', v_new_session_id,
    'predecessor_batch_id', p_predecessor_batch_id
  );
end;
$$;

revoke all on function create_successor_document_batch_v1(uuid, uuid, uuid[], integer, text, uuid) from public, anon;
grant execute on function create_successor_document_batch_v1(uuid, uuid, uuid[], integer, text, uuid) to authenticated, service_role;

-- =============================================================================
-- 16. Advance a waiting successor to queued (kept for explicit admin/tool use;
--      the trigger handles normal production advancement).
-- =============================================================================

create or replace function advance_successor_batch_v1(
  p_predecessor_batch_id uuid,
  p_household_id uuid
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_predecessor document_processing_batches%rowtype;
  v_successor document_processing_batches%rowtype;
  v_old_item document_processing_batch_items%rowtype;
  v_new_item_id uuid;
  v_norm record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only service_role may advance successor batches';
  end if;

  perform pg_advisory_xact_lock(household_advisory_lock_key(p_household_id));

  select * into v_predecessor
  from document_processing_batches
  where id = p_predecessor_batch_id
    and household_id = p_household_id
  for update;

  if v_predecessor.id is null then
    raise exception 'Predecessor batch not found' using errcode = 'P0001';
  end if;

  if v_predecessor.status not in ('ready_for_review', 'additional_information_required', 'manual_review', 'processing_unavailable', 'superseded') then
    raise exception 'Predecessor is not in a terminal state' using errcode = 'P0001';
  end if;

  select * into v_successor
  from document_processing_batches
  where depends_on_batch_id = p_predecessor_batch_id
    and household_id = p_household_id
    and status = 'waiting_for_predecessor'
  order by processing_generation
  for update
  limit 1;

  if v_successor.id is null then
    return jsonb_build_object('success', true, 'advanced', false, 'reason', 'no_successor');
  end if;

  -- Bring forward completed normalizations from predecessor.
  for v_old_item in
    select *
    from document_processing_batch_items
    where batch_id = p_predecessor_batch_id
  loop
    for v_norm in
      select b.*
      from document_processing_batch_normalizations b
      join document_normalizations n on n.id = b.normalization_id
      where b.batch_id = p_predecessor_batch_id
        and b.batch_item_id = v_old_item.id
        and n.status = 'complete'
    loop
      if not exists (
        select 1 from document_processing_batch_items
        where batch_id = v_successor.id
          and policy_document_id = v_old_item.policy_document_id
      ) then
        insert into document_processing_batch_items (
          batch_id, household_id, client_item_id, policy_document_id,
          selected_file_name, category, content_sha256, deduplicated,
          duplicate_of_policy_document_id, status
        )
        select
          v_successor.id,
          p_household_id,
          'successor:' || gen_random_uuid(),
          v_old_item.policy_document_id,
          pd.file_name,
          pd.category,
          pd.content_sha256,
          false,
          null,
          'uploaded'
        from policy_documents pd
        where pd.id = v_old_item.policy_document_id;
      end if;

      select id into v_new_item_id
      from document_processing_batch_items
      where batch_id = v_successor.id
        and policy_document_id = v_old_item.policy_document_id
      limit 1;

      if v_new_item_id is not null then
        insert into document_processing_batch_normalizations (
          batch_id, batch_item_id, normalization_id, use_status
        )
        values (
          v_successor.id,
          v_new_item_id,
          v_norm.normalization_id,
          'reused'
        )
        on conflict (batch_id, batch_item_id) do nothing;
      end if;
    end loop;
  end loop;

  update document_processing_batches
  set status = 'queued',
      updated_at = now()
  where id = v_successor.id;

  update document_processing_batches
  set document_count = (select count(*) from document_processing_batch_items where batch_id = v_successor.id)
  where id = v_successor.id;

  return jsonb_build_object(
    'success', true,
    'advanced', true,
    'successor_batch_id', v_successor.id
  );
end;
$$;

revoke all on function advance_successor_batch_v1(uuid, uuid) from public, anon;
grant execute on function advance_successor_batch_v1(uuid, uuid) to service_role;

-- =============================================================================
-- 17. Move candidate derivation forward from normalization output.
-- =============================================================================

create or replace function derive_candidates_from_normalization_v1(
  p_batch_id uuid,
  p_session_id uuid,
  p_household_id uuid,
  p_analysis_run_id uuid,
  p_processing_generation integer,
  p_normalization_id uuid
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
 declare
   v_batch_status text;
   v_batch_session uuid;
   v_batch_generation integer;
   v_allowed boolean := true;
 begin
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
     raise exception 'BATCH_GENERATION_MISMATCH' using errcode = 'P0001';
   end if;

   if v_batch_session is distinct from p_session_id then
     raise exception 'BATCH_SESSION_CONFLICT' using errcode = 'P0001';
   end if;

   if v_batch_status in ('superseded', 'cancellation_requested') then
     v_allowed := false;
   end if;

   if v_batch_status = 'waiting_for_predecessor' then
     raise exception 'BATCH_WAITING_FOR_PREDECESSOR' using errcode = 'P0001';
   end if;

   -- Placeholder: in a future step the existing persist flow will generate candidates
   -- from normalized_entities_json.  Returning allowance is enough to fence generation.
   return jsonb_build_object('candidate_derivation_allowed', v_allowed);
 end;
$$;

revoke all on function derive_candidates_from_normalization_v1(uuid, uuid, uuid, uuid, integer, uuid) from public, anon;
grant execute on function derive_candidates_from_normalization_v1(uuid, uuid, uuid, uuid, integer, uuid) to service_role;

commit;
