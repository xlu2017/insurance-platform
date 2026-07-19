-- Phase 1E-F: consent lifecycle, authorization snapshot, and provider-file cleanup reliability.

-- -----------------------------------------------------------------------------
-- 1. Consent lifecycle: append-only, authority-bound, no direct authenticated writes
-- -----------------------------------------------------------------------------

alter table document_processing_consent
  add column if not exists authority_basis text not null default 'household_owner',
  add column if not exists status text,
  add column if not exists superseded_by uuid references document_processing_consent(id) on delete set null;

-- Backfill existing consent history before enforcing the active-state unique index.
update document_processing_consent
set status = case
  when withdrawn_at is not null then 'withdrawn'
  else 'active'
end
where status is null;

alter table document_processing_consent
  alter column status set default 'active',
  alter column status set not null;

-- Remove all direct authenticated and anonymous access; authenticated customers must use RPCs.
revoke all on document_processing_consent from authenticated, anon;

alter table document_processing_consent disable row level security;

-- Drop previous policies that allowed direct authenticated insert/update/select.
drop policy if exists document_processing_consent_select on document_processing_consent;
drop policy if exists document_processing_consent_insert on document_processing_consent;
drop policy if exists document_processing_consent_update on document_processing_consent;

-- Replace the old uniqueness guard with a status-based partial unique index.
drop index if exists idx_document_processing_consent_household_purpose;
create unique index if not exists idx_document_processing_consent_household_purpose_active
  on document_processing_consent (household_id, purpose)
  where status = 'active';

-- Only service_role may read/write; authenticated customers use RPCs.
grant select, insert, update on document_processing_consent to service_role;

-- -----------------------------------------------------------------------------
-- 2. Authorization snapshot
-- -----------------------------------------------------------------------------

create table if not exists document_processing_authorizations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  actor_profile_id uuid not null references profiles(id),
  consent_id uuid references document_processing_consent(id) on delete set null,
  purpose text not null default 'insurance_policy_extraction',
  privacy_notice_version text not null,
  processor_contract_version text not null,
  foreign_processing_acknowledged boolean not null default false,
  automated_processing_acknowledged boolean not null default false,
  raw_processing_approved boolean not null default false,
  external_processing_enabled boolean not null default false,
  authorization_result text not null default 'denied',
  authorized_at timestamptz not null default now(),
  analysis_request_id uuid,
  created_at timestamptz not null default now()
);

grant select, insert, update on document_processing_authorizations to service_role;

-- -----------------------------------------------------------------------------
-- 3. External-file lifecycle ledger
-- -----------------------------------------------------------------------------

create table if not exists document_analysis_provider_files (
  id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references document_processing_authorizations(id) on delete cascade,
  analysis_request_id uuid,
  policy_document_id uuid not null references policy_documents(id) on delete cascade,
  provider_file_id text not null,
  upload_started_at timestamptz not null default now(),
  upload_completed_at timestamptz,
  upload_status text not null default 'started',
  processing_status text,
  deletion_status text,
  deletion_attempts int not null default 0,
  last_deletion_error_category text,
  next_deletion_attempt_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on document_analysis_provider_files to service_role;

create table if not exists document_analysis_cleanup_attempts (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references document_analysis_provider_files(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  status_code int,
  failure_category text,
  success boolean not null default false,
  next_attempt_at timestamptz
);

grant select, insert, update on document_analysis_cleanup_attempts to service_role;

-- -----------------------------------------------------------------------------
-- 4. Link analysis runs to authorization and consent
-- -----------------------------------------------------------------------------

alter table document_analysis_runs
  add column if not exists authorization_id uuid references document_processing_authorizations(id) on delete set null,
  add column if not exists consent_id uuid references document_processing_consent(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 5. Consent management RPCs
-- -----------------------------------------------------------------------------

create or replace function record_document_processing_consent(
  p_household_id uuid,
  p_profile_id uuid,
  p_purpose text,
  p_privacy_notice_version text,
  p_processor_contract_version text,
  p_foreign_processing_acknowledged boolean,
  p_automated_processing_acknowledged boolean,
  p_raw_processing_approved boolean,
  p_authority_basis text default 'household_owner'
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_existing_id uuid;
  v_can_consent boolean;
  v_new_id uuid;
  v_caller uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if auth.uid() <> p_profile_id then
    raise exception 'consent must be recorded by the authenticated profile';
  end if;

  -- Verify the profile has authority to consent for this household.
  v_can_consent := exists (
    select 1
    from households h
    where h.id = p_household_id and h.owner_profile_id = p_profile_id
  ) or exists (
    select 1
    from household_members hm
    where hm.household_id = p_household_id and hm.profile_id = p_profile_id and hm.member_role in ('admin', 'owner')
  );

  if not v_can_consent then
    raise exception 'profile is not authorized to consent for this household';
  end if;

  -- Serialize concurrent consent changes for this household/purpose.
  perform pg_advisory_xact_lock(hashtext(p_household_id::text || ':' || p_purpose)::bigint);

  -- Supersede any existing active consent before inserting the replacement.
  select id into v_existing_id
  from document_processing_consent
  where household_id = p_household_id and purpose = p_purpose and status = 'active'
  order by consented_at desc
  limit 1
  for update;

  if v_existing_id is not null then
    update document_processing_consent
    set status = 'superseded', superseded_by = null, updated_at = now()
    where id = v_existing_id;
  end if;

  insert into document_processing_consent (
    household_id,
    profile_id,
    purpose,
    privacy_notice_version,
    processor_contract_version,
    foreign_processing_acknowledged,
    automated_processing_acknowledged,
    raw_processing_approved,
    authority_basis,
    status,
    superseded_by
  ) values (
    p_household_id,
    p_profile_id,
    p_purpose,
    p_privacy_notice_version,
    p_processor_contract_version,
    p_foreign_processing_acknowledged,
    p_automated_processing_acknowledged,
    p_raw_processing_approved,
    p_authority_basis,
    'active',
    null
  )
  returning id into v_new_id;

  if v_existing_id is not null then
    update document_processing_consent
    set superseded_by = v_new_id
    where id = v_existing_id;
  end if;

  return v_new_id;
end;
$$;

create or replace function withdraw_document_processing_consent(
  p_household_id uuid,
  p_profile_id uuid,
  p_purpose text
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_existing_id uuid;
  v_can_withdraw boolean;
  v_caller uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if auth.uid() <> p_profile_id then
    raise exception 'consent must be withdrawn by the authenticated profile';
  end if;

  v_can_withdraw := exists (
    select 1
    from document_processing_consent c
    where c.household_id = p_household_id and c.profile_id = p_profile_id and c.purpose = p_purpose and c.status = 'active'
  );

  if not v_can_withdraw then
    raise exception 'no active consent found for this profile and purpose';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_household_id::text || ':' || p_purpose)::bigint);

  select id into v_existing_id
  from document_processing_consent
  where household_id = p_household_id and profile_id = p_profile_id and purpose = p_purpose and status = 'active'
  order by consented_at desc
  limit 1
  for update;

  if v_existing_id is null then
    raise exception 'no active consent found for this profile and purpose';
  end if;

  update document_processing_consent
  set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
  where id = v_existing_id;

  return v_existing_id;
end;
$$;

grant execute on function record_document_processing_consent to authenticated, service_role;
grant execute on function withdraw_document_processing_consent to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Update analysis persistence to record authorization and consent
-- -----------------------------------------------------------------------------

-- Drop the previous overload so the new signature replaces it unambiguously.
drop function if exists persist_document_analysis_v1(uuid, uuid, text, uuid, jsonb, jsonb, jsonb);

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
  v_source_doc_ids uuid[];
  v_identity_fingerprint text;
  v_asset_type candidate_asset_type;
  v_match_classification candidate_match_classification;
  v_result jsonb;
  v_result_documents jsonb := '[]'::jsonb;
  v_result_candidates jsonb := '[]'::jsonb;
  v_doc_map jsonb := '{}'::jsonb;
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
          'source_document_ids', source_document_ids
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

  for v_candidate in select * from jsonb_array_elements(p_candidates_json) loop
    v_candidate_id := nullif(v_candidate->>'id', '')::uuid;
    if v_candidate_id is null then
      raise exception 'candidate id is required';
    end if;

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
        where ed.id = src_id and ed.household_id = p_household_id
      )
    ) then
      raise exception 'candidate references source document id not belonging to this household';
    end if;

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
      source_document_ids,
      selected_facts_json,
      conflicts_json,
      analysis_run_id
    ) values (
      v_candidate_id,
      p_session_id,
      p_household_id,
      v_asset_type,
      v_identity_fingerprint,
      v_candidate->>'display_label',
      nullif(v_candidate->>'occupancy', ''),
      v_match_classification,
      coalesce(v_candidate->>'decision', 'undecided')::candidate_decision,
      coalesce(v_candidate->>'review_status', 'pending'),
      v_source_doc_ids,
      coalesce(v_candidate->'selected_facts_json', '{}'::jsonb),
      coalesce(v_candidate->'conflicts_json', '[]'::jsonb),
      v_run_id
    )
    on conflict (id) do update set
      display_label = coalesce(excluded.display_label, asset_candidates.display_label),
      occupancy = coalesce(excluded.occupancy, asset_candidates.occupancy),
      match_classification = excluded.match_classification,
      source_document_ids = array(
        select distinct unnest(coalesce(asset_candidates.source_document_ids, '{}'::uuid[]) || excluded.source_document_ids)
      ),
      selected_facts_json = excluded.selected_facts_json,
      conflicts_json = excluded.conflicts_json,
      analysis_run_id = excluded.analysis_run_id,
      updated_at = now()
    where asset_candidates.household_id = p_household_id;

    v_result_candidates := v_result_candidates || jsonb_build_object(
      'id', v_candidate_id,
      'identity_fingerprint', v_identity_fingerprint
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
