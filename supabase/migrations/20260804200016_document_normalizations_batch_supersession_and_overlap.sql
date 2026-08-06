-- Document normalizations, batch supersession, upload planning, and overlap assessment.
-- Builds on 20260804200015 without rewriting it.
begin;

-- =============================================================================
-- 1. Status extensions for batch lifecycle.
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
  add column if not exists superseded_by_batch_id uuid references document_processing_batches(id) on delete set null,
  add column if not exists depends_on_batch_id uuid references document_processing_batches(id) on delete set null,
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists superseded_at timestamptz,
  add column if not exists processing_generation integer not null default 1 check (processing_generation > 0),
  add column if not exists estimated_lower_seconds integer check (estimated_lower_seconds >= 0),
  add column if not exists estimated_upper_seconds integer check (estimated_upper_seconds >= 0);

-- A batch cannot supersede itself.
alter table document_processing_batches
  add constraint document_processing_batches_no_self_supersession
  check (superseded_by_batch_id is null or superseded_by_batch_id <> id);



-- A queued successor must belong to the same household.
create or replace function document_processing_batches_successor_household_guard()
returns trigger
language plpgsql
as $$
declare
  v_parent_household uuid;
begin
  if new.depends_on_batch_id is not null then
    select household_id into v_parent_household
    from document_processing_batches
    where id = new.depends_on_batch_id;
    if v_parent_household is distinct from new.household_id then
      raise exception 'BATCH_SUCCESSOR_HOUSEHOLD_MISMATCH' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists document_processing_batches_successor_household_guard on document_processing_batches;
create trigger document_processing_batches_successor_household_guard
  before insert or update on document_processing_batches
  for each row execute function document_processing_batches_successor_household_guard();

-- Supersession chains cannot cycle. This trigger also protects depends_on cycles.
create or replace function document_processing_batches_no_supersession_cycle()
returns trigger
language plpgsql
as $$
declare
  v_current uuid;
  v_visited uuid[];
begin
  if new.superseded_by_batch_id is null and new.depends_on_batch_id is null then
    return new;
  end if;

  v_current := coalesce(new.superseded_by_batch_id, new.depends_on_batch_id);
  v_visited := array[new.id];

  while v_current is not null loop
    if v_current = any(v_visited) then
      raise exception 'BATCH_SUPERSSESSION_CYCLE: batch cycle detected' using errcode = 'P0001';
    end if;
    v_visited := v_visited || v_current;
    select coalesce(superseded_by_batch_id, depends_on_batch_id) into v_current
    from document_processing_batches
    where id = v_current;
  end loop;

  return new;
end;
$$;

drop trigger if exists document_processing_batches_no_supersession_cycle on document_processing_batches;
create trigger document_processing_batches_no_supersession_cycle
  before insert or update on document_processing_batches
  for each row execute function document_processing_batches_no_supersession_cycle();

-- Only the current processing generation may advance a batch.
-- A superseded batch cannot return to an active or ready state.
create or replace function document_processing_batches_generation_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'superseded' and new.status <> 'superseded' then
      raise exception 'SUPERSEDED_BATCH_IMMUTABLE: superseded batch cannot change status' using errcode = 'P0001';
    end if;
    if new.superseded_by_batch_id is not null and new.status not in ('superseded', 'cancellation_requested') then
      raise exception 'SUPERSEDED_BATCH_STATUS_LOCKED' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists document_processing_batches_generation_guard on document_processing_batches;
create trigger document_processing_batches_generation_guard
  before insert or update on document_processing_batches
  for each row execute function document_processing_batches_generation_guard();

-- =============================================================================
-- 2. Immutable reusable document normalizations.
-- =============================================================================

create table if not exists document_normalizations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  policy_document_id uuid not null references policy_documents(id) on delete cascade,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  normalization_schema_version text not null,
  analyzer_version text not null,
  model_provider text,
  model_id text,
  prompt_version text,
  classification text not null,
  normalized_output_json jsonb not null default '{}'::jsonb,
  normalized_entities_json jsonb not null default '[]'::jsonb,
  conflicts_json jsonb not null default '[]'::jsonb,
  evidence_json jsonb not null default '[]'::jsonb,
  status text not null check (status in ('processing', 'complete', 'failed', 'superseded')),
  failure_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (
    household_id,
    content_sha256,
    normalization_schema_version,
    analyzer_version
  )
);

create index if not exists idx_document_normalizations_household_digest
  on document_normalizations (household_id, content_sha256);
create index if not exists idx_document_normalizations_policy_document
  on document_normalizations (policy_document_id);

-- Association between a processing batch item and the reusable normalization it uses.
create table if not exists document_processing_batch_normalizations (
  batch_id uuid not null references document_processing_batches(id) on delete cascade,
  batch_item_id uuid not null references document_processing_batch_items(id) on delete cascade,
  normalization_id uuid not null references document_normalizations(id) on delete restrict,
  use_status text not null check (use_status in ('created', 'reused', 'late_superseded_result')),
  created_at timestamptz not null default now(),
  primary key (batch_id, batch_item_id)
);

create index if not exists idx_batch_normalizations_normalization
  on document_processing_batch_normalizations (normalization_id);

-- =============================================================================
-- 3. Asset- and policy-level overlap assessment.
-- =============================================================================

create type document_asset_overlap_classification as enum (
  'exact_file_duplicate',
  'same_asset_same_policy_term',
  'same_asset_newer_policy_term',
  'same_asset_supporting_document',
  'same_asset_conflicting_information',
  'possible_asset_match',
  'new_asset'
);

create table if not exists document_asset_overlap_assessments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references document_processing_batches(id) on delete cascade,
  normalization_id uuid not null references document_normalizations(id) on delete cascade,
  normalized_entity_key text not null,
  asset_id uuid,
  asset_type candidate_asset_type,
  existing_policy_id uuid references policies(id),
  classification document_asset_overlap_classification not null,
  confidence double precision check (confidence >= 0 and confidence <= 1),
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_overlap_assessments_batch
  on document_asset_overlap_assessments (batch_id);
create index if not exists idx_overlap_assessments_normalization
  on document_asset_overlap_assessments (normalization_id, normalized_entity_key);

-- =============================================================================
-- 4. Helper to compute an advisory lock key for a household/case.
-- =============================================================================

create or replace function household_advisory_lock_key(p_household_id uuid)
returns bigint
language sql
immutable
as $$
  select ('x' || substr(md5(p_household_id::text), 1, 16))::bit(64)::bigint;
$$;

-- =============================================================================
-- 5. Upload planning.
-- =============================================================================

create or replace function plan_document_upload_v1(
  p_household_id uuid,
  p_new_policy_document_ids uuid[] default '{}'::uuid[],
  p_case_id uuid default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_active_batch document_processing_batches%rowtype;
  v_total_docs int;
  v_completed int;
  v_unfinished int;
  v_new_count int;
  v_lower int;
  v_upper int;
  v_current_lower int;
  v_current_upper int;
  v_queued_lower int;
  v_queued_upper int;
begin
  perform pg_advisory_xact_lock(household_advisory_lock_key(p_household_id));

  v_new_count := coalesce(array_length(p_new_policy_document_ids, 1), 0);

  select * into v_active_batch
  from document_processing_batches
  where household_id = p_household_id
    and (
      p_case_id is null
      or case_id = p_case_id
      or case_id is null
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

  if v_active_batch.id is null then
    return jsonb_build_object(
      'activeBatchId', null,
      'activeStatus', null,
      'completedNormalizationCount', 0,
      'unfinishedDocumentCount', 0,
      'newDocumentCount', v_new_count,
      'restartEstimate', jsonb_build_object(
        'lowerSeconds', 180 + (v_new_count * 120),
        'upperSeconds', 420 + (v_new_count * 240),
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

  -- Simple bounded heuristic: 60-120s per unfinished page/document, 120-240s per new.
  v_current_lower := 60 + (v_unfinished * 60);
  v_current_upper := 180 + (v_unfinished * 120);
  v_queued_lower := v_current_upper + 60 + (v_new_count * 120);
  v_queued_upper := v_current_upper + 120 + (v_new_count * 240);
  v_lower := 180 + ((v_unfinished + v_new_count) * 120);
  v_upper := 420 + ((v_unfinished + v_new_count) * 240);

  return jsonb_build_object(
    'activeBatchId', v_active_batch.id,
    'activeStatus', v_active_batch.status,
    'completedNormalizationCount', v_completed,
    'unfinishedDocumentCount', v_unfinished,
    'newDocumentCount', v_new_count,
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

revoke all on function plan_document_upload_v1(uuid, uuid[], uuid) from public, anon;
grant execute on function plan_document_upload_v1(uuid, uuid[], uuid) to authenticated, service_role;

-- =============================================================================
-- 6. Restart/supersede processing batch.
-- =============================================================================

create or replace function supersede_processing_batch_v1(
  p_active_batch_id uuid,
  p_household_id uuid,
  p_actor_id uuid,
  p_new_policy_document_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_old_batch document_processing_batches%rowtype;
  v_new_session_id uuid;
  v_new_batch_id uuid;
  v_old_item document_processing_batch_items%rowtype;
  v_new_item_id uuid;
  v_norm document_processing_batch_normalizations%rowtype;
  v_client_request_id text;
begin
  if p_active_batch_id is null or p_household_id is null or p_actor_id is null then
    raise exception 'Missing required argument' using errcode = 'P0001';
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

  if v_old_batch.status = 'superseded' then
    raise exception 'Batch already superseded' using errcode = 'P0001';
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

  v_client_request_id := coalesce(v_old_batch.client_request_id, 'supersede:') || ':' || gen_random_uuid()::text;

  v_new_session_id := gen_random_uuid();
  insert into document_extraction_sessions (id, household_id, created_by, case_id, status)
  values (v_new_session_id, p_household_id, p_actor_id, v_old_batch.case_id, 'open');

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
    p_actor_id,
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

    -- Reuse any complete normalizations from the old batch for this document.
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
  if p_new_policy_document_ids is not null then
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
    where pd.id = any(p_new_policy_document_ids)
      and pd.household_id = p_household_id
      and pd.id not in (
        select policy_document_id
        from document_processing_batch_items
        where batch_id = v_new_batch_id
      );
  end if;

  -- Mark old batch superseded.
  update document_processing_batches
  set status = 'superseded',
      superseded_by_batch_id = v_new_batch_id,
      superseded_at = now(),
      updated_at = now()
  where id = v_old_batch.id;

  -- Update counts.
  update document_processing_batches
  set document_count = (select count(*) from document_processing_batch_items where batch_id = v_new_batch_id)
  where id = v_new_batch_id;

  insert into audit_events (
    actor_profile_id, action, entity_type, entity_id, household_id, case_id,
    after_summary
  ) values (
    p_actor_id,
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

revoke all on function supersede_processing_batch_v1(uuid, uuid, uuid, uuid[]) from public, anon;
grant execute on function supersede_processing_batch_v1(uuid, uuid, uuid, uuid[]) to authenticated, service_role;

-- =============================================================================
-- 7. Queued successor batch creation.
-- =============================================================================

create or replace function create_successor_document_batch_v1(
  p_predecessor_batch_id uuid,
  p_household_id uuid,
  p_actor_id uuid,
  p_new_policy_document_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_predecessor document_processing_batches%rowtype;
  v_new_session_id uuid;
  v_new_batch_id uuid;
  v_client_request_id text;
  v_doc_id uuid;
  v_existing_items int;
begin
  if p_predecessor_batch_id is null or p_household_id is null or p_actor_id is null then
    raise exception 'Missing required argument' using errcode = 'P0001';
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

  v_client_request_id := coalesce(v_predecessor.client_request_id, 'successor:') || ':' || gen_random_uuid()::text;

  v_new_session_id := gen_random_uuid();
  insert into document_extraction_sessions (id, household_id, created_by, case_id, status)
  values (v_new_session_id, p_household_id, p_actor_id, v_predecessor.case_id, 'open');

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
    p_actor_id,
    v_client_request_id,
    v_new_session_id,
    v_predecessor.case_id,
    v_predecessor.mode_snapshot,
    v_predecessor.settings_version,
    v_predecessor.disclosure_version,
    v_predecessor.configured_provider,
    v_predecessor.configured_model_id,
    v_predecessor.consent_id,
    'queued',
    v_predecessor.processing_generation + 1,
    p_predecessor_batch_id
  returning id into v_new_batch_id;

  -- Only new documents go into a successor batch; completed normalizations are
  -- added during processing when the predecessor finishes.
  select count(*) into v_existing_items
  from document_processing_batch_items
  where batch_id = v_new_batch_id;

  foreach v_doc_id in array p_new_policy_document_ids loop
    if not exists (
      select 1 from document_processing_batch_items
      where batch_id in (
        select id from document_processing_batches
        where household_id = p_household_id
          and case_id = v_predecessor.case_id
          and id <> v_new_batch_id
      )
      and policy_document_id = v_doc_id
    ) then
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
      where pd.id = v_doc_id
        and pd.household_id = p_household_id;
    end if;
  end loop;

  update document_processing_batches
  set document_count = (select count(*) from document_processing_batch_items where batch_id = v_new_batch_id)
  where id = v_new_batch_id;

  insert into audit_events (
    actor_profile_id, action, entity_type, entity_id, household_id, case_id,
    after_summary
  ) values (
    p_actor_id,
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

revoke all on function create_successor_document_batch_v1(uuid, uuid, uuid, uuid[]) from public, anon;
grant execute on function create_successor_document_batch_v1(uuid, uuid, uuid, uuid[]) to authenticated, service_role;

-- =============================================================================
-- 8. Advance a successor when its predecessor reaches a terminal point.
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
  v_norm document_processing_batch_normalizations%rowtype;
begin
  perform pg_advisory_xact_lock(household_advisory_lock_key(p_household_id));

  select * into v_predecessor
  from document_processing_batches
  where id = p_predecessor_batch_id
    and household_id = p_household_id
  for update;

  if v_predecessor.id is null then
    raise exception 'Predecessor batch not found' using errcode = 'P0001';
  end if;

  if v_predecessor.status not in ('ready_for_review', 'additional_information_required', 'manual_review', 'processing_unavailable') then
    raise exception 'Predecessor is not in a terminal state' using errcode = 'P0001';
  end if;

  select * into v_successor
  from document_processing_batches
  where depends_on_batch_id = p_predecessor_batch_id
    and household_id = p_household_id
  order by processing_generation
  for update
  limit 1;

  if v_successor.id is null then
    return jsonb_build_object('success', true, 'advanced', false, 'reason', 'no_successor');
  end if;

  -- Bring forward completed normalizations from predecessor for any overlapping documents.
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
      depends_on_batch_id = null,
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
-- 9. Helper to persist a completed normalization.
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
  v_existing uuid;
begin
  if p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid content_sha256' using errcode = 'P0001';
  end if;

  select id into v_existing
  from document_normalizations
  where household_id = p_household_id
    and content_sha256 = p_content_sha256
    and normalization_schema_version = p_normalization_schema_version
    and analyzer_version = p_analyzer_version;

  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'reused', true);
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
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'reused', false);
end;
$$;

revoke all on function persist_document_normalization_v1(uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function persist_document_normalization_v1(uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;

-- =============================================================================
-- 10. Helpers for overlap classification.
-- =============================================================================

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
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function record_document_asset_overlap_v1(uuid, uuid, text, uuid, candidate_asset_type, uuid, document_asset_overlap_classification, double precision, jsonb) from public, anon;
grant execute on function record_document_asset_overlap_v1(uuid, uuid, text, uuid, candidate_asset_type, uuid, document_asset_overlap_classification, double precision, jsonb) to service_role;

-- =============================================================================
-- 11. RLS and grants.
-- =============================================================================

alter table document_normalizations enable row level security;
alter table document_processing_batch_normalizations enable row level security;
alter table document_asset_overlap_assessments enable row level security;

-- Service role manages normalizations; customers read through batch/session scope.
create policy document_normalizations_select on document_normalizations
  for select to authenticated using (can_access_household(household_id));

create policy document_processing_batch_normalizations_select on document_processing_batch_normalizations
  for select to authenticated using (
    exists (
      select 1 from document_processing_batches b
      where b.id = document_processing_batch_normalizations.batch_id
        and can_access_household(b.household_id)
    )
  );

create policy document_asset_overlap_assessments_select on document_asset_overlap_assessments
  for select to authenticated using (
    exists (
      select 1 from document_processing_batches b
      where b.id = document_asset_overlap_assessments.batch_id
        and can_access_household(b.household_id)
    )
  );

revoke all on document_normalizations from authenticated, anon;
revoke all on document_processing_batch_normalizations from authenticated, anon;
revoke all on document_asset_overlap_assessments from authenticated, anon;

grant select, insert, update on document_normalizations to service_role;
grant select, insert, update, delete on document_processing_batch_normalizations to service_role;
grant select, insert, update on document_asset_overlap_assessments to service_role;

commit;
