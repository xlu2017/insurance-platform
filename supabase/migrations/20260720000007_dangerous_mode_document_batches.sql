-- Durable, deduplicated document batches and household-scoped Dangerous mode.
-- Provider identity remains service-role-only; customers read provider-neutral status.
begin;

-- Canonical content identity for household policy documents. Existing rows remain
-- nullable until they are encountered by the server-side upload path.
alter table policy_documents
  add column if not exists content_sha256 text;

alter table policy_documents
  drop constraint if exists policy_documents_content_sha256_format;
alter table policy_documents
  add constraint policy_documents_content_sha256_format
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

create unique index if not exists idx_policy_documents_household_content_sha256
  on policy_documents (household_id, content_sha256)
  where content_sha256 is not null;

create or replace function protect_policy_document_server_digest()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.role() is not null and auth.role() <> 'service_role' and (
    (tg_op = 'INSERT' and new.content_sha256 is not null)
    or (tg_op = 'UPDATE' and new.content_sha256 is distinct from old.content_sha256)
  ) then
    raise exception 'Document content digest is server-managed';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_policy_document_server_digest on policy_documents;
create trigger protect_policy_document_server_digest
  before insert or update on policy_documents
  for each row execute function protect_policy_document_server_digest();

-- The current setting is a compact snapshot. Every change is also appended to
-- household_document_processing_setting_events below.
create table if not exists household_document_processing_settings (
  household_id uuid primary key references households(id) on delete cascade,
  dangerous_mode_enabled boolean not null default false,
  setting_version integer not null default 1 check (setting_version > 0),
  enabled_by uuid references profiles(id),
  enabled_at timestamptz,
  disabled_at timestamptz,
  disclosure_version text,
  configured_provider text,
  configured_model_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists household_document_processing_setting_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  actor_profile_id uuid not null references profiles(id),
  event_type text not null check (event_type in ('enabled', 'disabled')),
  enabled_state boolean not null,
  disclosure_version text,
  configured_provider text,
  configured_model_id text,
  reauthenticated_at timestamptz,
  foreign_processing_acknowledged boolean not null default false,
  automated_processing_acknowledged boolean not null default false,
  raw_processing_approved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_document_processing_setting_events_household
  on household_document_processing_setting_events (household_id, created_at desc);

-- One extraction session and one immutable settings snapshot per upload batch.
create table if not exists document_processing_batches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  created_by uuid not null references profiles(id),
  client_request_id text not null,
  session_id uuid not null references document_extraction_sessions(id) on delete restrict,
  mode_snapshot text not null check (mode_snapshot in ('safe', 'dangerous')),
  settings_version integer not null check (settings_version > 0),
  disclosure_version text,
  configured_provider text,
  configured_model_id text,
  consent_id uuid references document_processing_consent(id) on delete set null,
  authorization_id uuid references document_processing_authorizations(id) on delete set null,
  manual_case_id uuid references optimization_cases(id) on delete set null,
  status text not null default 'uploading_files' check (status in (
    'uploading_files',
    'checking_duplicates',
    'queued',
    'reading_policy_documents',
    'comparing_policies',
    'validating_extracted_details',
    'ready_for_review',
    'additional_information_required',
    'processing_unavailable',
    'manual_review'
  )),
  document_count integer not null default 0 check (document_count >= 0),
  unique_document_count integer not null default 0 check (unique_document_count >= 0),
  deduplicated_count integer not null default 0 check (deduplicated_count >= 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  retryable boolean not null default false,
  next_retry_at timestamptz,
  error_code text,
  submitted_at timestamptz,
  processing_started_at timestamptz,
  completed_at timestamptz,
  worker_claimed_at timestamptz,
  worker_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, client_request_id)
);

create index if not exists idx_document_processing_batches_household
  on document_processing_batches (household_id, created_at desc);
create index if not exists idx_document_processing_batches_retry
  on document_processing_batches (next_retry_at, created_at)
  where status in ('queued', 'processing_unavailable') and retryable = true;

-- A row represents a user's selection, not a second physical document. Duplicate
-- selections point to the same canonical policy_documents row.
create table if not exists document_processing_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references document_processing_batches(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  client_item_id text not null,
  policy_document_id uuid not null references policy_documents(id) on delete cascade,
  selected_file_name text not null,
  category document_category not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  deduplicated boolean not null default false,
  duplicate_of_policy_document_id uuid references policy_documents(id) on delete restrict,
  status text not null check (status in ('uploaded', 'deduplicated', 'failed')),
  created_at timestamptz not null default now(),
  unique (batch_id, client_item_id)
);

create index if not exists idx_document_processing_batch_items_batch
  on document_processing_batch_items (batch_id, created_at);
create index if not exists idx_document_processing_batch_items_canonical_document
  on document_processing_batch_items (policy_document_id);

-- A canonical physical policy document can acquire at most one external
-- transmission claim. The claim is written before the provider upload begins.
create unique index if not exists idx_provider_files_policy_document_once
  on document_analysis_provider_files (policy_document_id);

-- Extend the canonical candidate review record for sequential mandate review.
-- Existing extraction values stay immutable; customer corrections live beside
-- them with an append-only version history.
alter type candidate_field_review_action add value if not exists 'pending';
alter type candidate_field_review_action add value if not exists 'keep_current';
alter type candidate_field_review_action add value if not exists 'use_document_value';
alter type candidate_field_review_action add value if not exists 'use_corrected_document_value';
alter type candidate_field_review_action add value if not exists 'unresolved';

alter table candidate_field_reviews
  add column if not exists batch_id uuid references document_processing_batches(id) on delete set null,
  add column if not exists value_state text check (value_state in ('known', 'absent', 'unknown', 'not_applicable', 'conflicting')),
  add column if not exists specification_title text,
  add column if not exists mandate_path text,
  add column if not exists original_extracted_value jsonb,
  add column if not exists document_implied_value jsonb,
  add column if not exists document_implied_mandate_value jsonb,
  add column if not exists current_mandate_value jsonb,
  add column if not exists prior_mandate_value jsonb,
  add column if not exists correction_reason text check (correction_reason is null or correction_reason in (
    'document_was_read_incorrectly',
    'policy_wording_is_unclear',
    'value_changed_after_document_issue',
    'wrong_source_document',
    'other'
  )),
  add column if not exists source_document_id uuid references policy_documents(id) on delete set null,
  add column if not exists source_page_number integer check (source_page_number is null or source_page_number > 0),
  add column if not exists source_section text,
  add column if not exists confidence double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add column if not exists conflict_values_json jsonb not null default '[]'::jsonb,
  add column if not exists material_conflict boolean not null default false,
  add column if not exists is_complete boolean not null default false,
  add column if not exists completed_at timestamptz;

create index if not exists idx_candidate_field_reviews_batch_progress
  on candidate_field_reviews (batch_id, is_complete, created_at)
  where batch_id is not null;

create table if not exists candidate_field_review_versions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references candidate_field_reviews(id) on delete cascade,
  candidate_id uuid not null references asset_candidates(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  actor_profile_id uuid references profiles(id),
  action candidate_field_review_action not null,
  current_mandate_value jsonb,
  corrected_value jsonb,
  correction_reason text,
  snapshot_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_candidate_field_review_versions_review
  on candidate_field_review_versions (review_id, created_at desc);

create or replace function snapshot_candidate_field_review_version()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if to_jsonb(old) is distinct from to_jsonb(new) then
    insert into candidate_field_review_versions (
      review_id, candidate_id, household_id, actor_profile_id, action,
      current_mandate_value, corrected_value, correction_reason, snapshot_json
    ) values (
      old.id, old.candidate_id, old.household_id, auth.uid(), old.action,
      old.current_mandate_value, old.corrected_value, old.correction_reason, to_jsonb(old)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists snapshot_candidate_field_review_version on candidate_field_reviews;
create trigger snapshot_candidate_field_review_version
  before update on candidate_field_reviews
  for each row execute function snapshot_candidate_field_review_version();

create or replace function protect_document_mandate_review_evidence()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and old.batch_id is not null and (
    new.batch_id is distinct from old.batch_id or
    new.candidate_id is distinct from old.candidate_id or
    new.household_id is distinct from old.household_id or
    new.field_path is distinct from old.field_path or
    new.value_state is distinct from old.value_state or
    new.specification_title is distinct from old.specification_title or
    new.mandate_path is distinct from old.mandate_path or
    new.original_extracted_value is distinct from old.original_extracted_value or
    new.document_implied_value is distinct from old.document_implied_value or
    new.document_implied_mandate_value is distinct from old.document_implied_mandate_value or
    new.source_document_id is distinct from old.source_document_id or
    new.source_page_number is distinct from old.source_page_number or
    new.source_section is distinct from old.source_section or
    new.confidence is distinct from old.confidence or
    new.conflict_values_json is distinct from old.conflict_values_json or
    new.material_conflict is distinct from old.material_conflict
  ) then
    raise exception 'Document-derived review evidence is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_document_mandate_review_evidence on candidate_field_reviews;
create trigger protect_document_mandate_review_evidence
  before update on candidate_field_reviews
  for each row execute function protect_document_mandate_review_evidence();

alter table asset_candidates
  add column if not exists draft_decision text check (draft_decision in ('approve_new', 'link_existing', 'skip', 'needs_correction')),
  add column if not exists draft_identity_confirmed boolean not null default false,
  add column if not exists draft_existing_asset_id uuid,
  add column if not exists draft_existing_asset_type candidate_asset_type,
  add column if not exists draft_updated_by uuid references profiles(id),
  add column if not exists draft_updated_at timestamptz;

-- Keep filenames out of audit summaries. The customer can still see the
-- non-authoritative filename on policy_documents and batch items.
create or replace function audit_policy_document_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform log_audit(
    'policy_document_uploaded',
    'policy_document',
    new.id,
    new.household_id,
    null,
    null,
    jsonb_build_object('category', new.category, 'status', new.status)
  );
  return new;
end $$;

-- Customer-safe RLS. Provider/model configuration and setting-event telemetry
-- remain service-role-only and are exposed through a sanitized Edge response.
alter table household_document_processing_settings enable row level security;
alter table household_document_processing_setting_events enable row level security;
alter table document_processing_batches enable row level security;
alter table document_processing_batch_items enable row level security;
alter table candidate_field_review_versions enable row level security;

create policy document_processing_batches_select on document_processing_batches
  for select to authenticated using (can_access_household(household_id));
create policy document_processing_batch_items_select on document_processing_batch_items
  for select to authenticated using (can_access_household(household_id));
create policy candidate_field_review_versions_select on candidate_field_review_versions
  for select to authenticated using (can_access_household(household_id));

revoke all on household_document_processing_settings from authenticated, anon;
revoke all on household_document_processing_setting_events from authenticated, anon;
revoke all on document_processing_batches from authenticated, anon;
revoke all on document_processing_batch_items from authenticated, anon;

grant select, insert, update, delete on household_document_processing_settings to service_role;
grant select, insert on household_document_processing_setting_events to service_role;
grant select, insert, update, delete on document_processing_batches to service_role;
grant select, insert, update, delete on document_processing_batch_items to service_role;
grant select, insert on candidate_field_review_versions to service_role;
grant select on candidate_field_review_versions to authenticated;

-- Acquire one durable processing lease. This makes duplicate submits and retry
-- races no-ops while allowing a crashed worker to be reclaimed after expiry.
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
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only service_role may claim document processing batches';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 3600 then
    raise exception 'Invalid document processing lease duration';
  end if;

  update document_processing_batches
  set status = 'reading_policy_documents',
      retryable = false,
      processing_started_at = coalesce(processing_started_at, now()),
      worker_claimed_at = now(),
      worker_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = p_batch_id
    and household_id = p_household_id
    and (
      status = 'queued'
      or (status = 'processing_unavailable' and retryable)
      or (
        status in ('reading_policy_documents', 'comparing_policies', 'validating_extracted_details')
        and worker_lease_expires_at < now()
      )
    )
  returning id into v_claimed;

  return v_claimed is not null;
end;
$$;

revoke all on function claim_document_processing_batch_v1(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function claim_document_processing_batch_v1(uuid, uuid, integer) to service_role;

-- Persist candidate-level asset decisions before the final trusted V2 approval.
create or replace function save_candidate_review_draft_v1(
  p_household_id uuid,
  p_candidate_id uuid,
  p_decision text,
  p_identity_confirmed boolean default false,
  p_existing_asset_id uuid default null,
  p_existing_asset_type candidate_asset_type default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null or not is_household_member(p_household_id) then
    raise exception 'Unauthorized';
  end if;
  if p_decision not in ('approve_new', 'link_existing', 'skip', 'needs_correction') then
    raise exception 'Invalid candidate draft decision';
  end if;

  update asset_candidates
  set draft_decision = p_decision,
      draft_identity_confirmed = coalesce(p_identity_confirmed, false),
      draft_existing_asset_id = p_existing_asset_id,
      draft_existing_asset_type = p_existing_asset_type,
      draft_updated_by = auth.uid(),
      draft_updated_at = now()
  where id = p_candidate_id
    and household_id = p_household_id
    and review_status in ('pending', 'reviewing');

  if not found then
    raise exception 'Candidate is not available for review';
  end if;

  return jsonb_build_object('success', true, 'candidate_id', p_candidate_id);
end;
$$;

revoke all on function save_candidate_review_draft_v1(uuid, uuid, text, boolean, uuid, candidate_asset_type) from public, anon;
grant execute on function save_candidate_review_draft_v1(uuid, uuid, text, boolean, uuid, candidate_asset_type) to authenticated, service_role;

-- Autosave one reconciliation item without changing the immutable extraction.
create or replace function save_mandate_review_item_v1(
  p_household_id uuid,
  p_review_id uuid,
  p_action candidate_field_review_action,
  p_current_mandate_value jsonb,
  p_corrected_value jsonb default null,
  p_correction_reason text default null,
  p_is_complete boolean default false
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_review candidate_field_reviews%rowtype;
begin
  if auth.uid() is null or not is_household_member(p_household_id) then
    raise exception 'Unauthorized';
  end if;

  select * into v_review
  from candidate_field_reviews
  where id = p_review_id and household_id = p_household_id
  for update;
  if not found then
    raise exception 'Mandate review item not found';
  end if;

  if p_is_complete and p_corrected_value is not null and p_correction_reason is null then
    raise exception 'A correction reason is required';
  end if;
  if p_is_complete and p_action = 'pending' then
    raise exception 'A review action is required';
  end if;
  if p_action = 'use_corrected_document_value' and p_corrected_value is null then
    raise exception 'A corrected document value is required';
  end if;
  if v_review.material_conflict and p_action = 'unresolved' and p_is_complete then
    raise exception 'A material conflict cannot be completed while unresolved';
  end if;

  update candidate_field_reviews
  set action = p_action,
      current_mandate_value = p_current_mandate_value,
      prior_mandate_value = coalesce(prior_mandate_value, p_current_mandate_value),
      corrected_value = coalesce(p_corrected_value, corrected_value),
      correction_reason = coalesce(p_correction_reason, correction_reason),
      reviewed_by = auth.uid(),
      is_complete = p_is_complete,
      completed_at = case when p_is_complete then now() else null end,
      updated_at = now()
  where id = p_review_id;

  return jsonb_build_object('success', true, 'review_id', p_review_id, 'complete', p_is_complete);
end;
$$;

revoke all on function save_mandate_review_item_v1(uuid, uuid, candidate_field_review_action, jsonb, jsonb, text, boolean) from public, anon;
grant execute on function save_mandate_review_item_v1(uuid, uuid, candidate_field_review_action, jsonb, jsonb, text, boolean) to authenticated, service_role;

commit;
