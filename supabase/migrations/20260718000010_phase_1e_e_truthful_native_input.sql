-- Phase 1E-E: truthful native input, privacy authorization gate, provider metadata isolation,
-- and restricted analysis-run visibility.

-- -----------------------------------------------------------------------------
-- 1. Restrict customer access to analysis-run provider metadata
-- -----------------------------------------------------------------------------

-- Analysis runs contain provider identifiers, model ids, raw responses, and operational
-- telemetry. Only service_role and restricted operational roles should read them.
revoke select on document_analysis_runs from authenticated;

-- -----------------------------------------------------------------------------
-- 2. Store provider-level operational metadata on the analysis run
-- -----------------------------------------------------------------------------

alter table document_analysis_runs
  add column if not exists provider_metadata_json jsonb not null default '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- 3. Customer document-processing consent record
-- -----------------------------------------------------------------------------

create table if not exists document_processing_consent (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  purpose text not null default 'insurance_policy_extraction',
  privacy_notice_version text not null,
  foreign_processing_acknowledged boolean not null default false,
  automated_processing_acknowledged boolean not null default false,
  processor_contract_version text not null,
  raw_processing_approved boolean not null default false,
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_document_processing_consent_household_purpose
  on document_processing_consent (household_id, purpose)
  where withdrawn_at is null;

grant select, insert, update, delete on document_processing_consent to service_role;
grant select on document_processing_consent to authenticated;

alter table document_processing_consent enable row level security;

create policy document_processing_consent_select on document_processing_consent
  for select using (can_access_household(household_id));

create policy document_processing_consent_insert on document_processing_consent
  for insert with check (can_access_household(household_id) and profile_id = auth.uid());

create policy document_processing_consent_update on document_processing_consent
  for update using (can_access_household(household_id) and profile_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 4. Update atomic persistence RPC to store provider metadata
-- -----------------------------------------------------------------------------

create or replace function persist_document_analysis_v1(
  p_household_id uuid,
  p_session_id uuid,
  p_client_request_id text,
  p_analysis_run_id uuid default null,
  p_analysis_json jsonb default '{}'::jsonb,
  p_documents_json jsonb default '[]'::jsonb,
  p_candidates_json jsonb default '[]'::jsonb
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

  -- Idempotency: the same client request id always returns the same run.
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
        (select jsonb_agg(to_jsonb(asset_candidates.*))
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

  -- Insert extracted documents, building a map of policy_document_id -> id
  -- so that candidate source_document_ids can be validated and mapped.
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

    v_doc_map := v_doc_map || jsonb_build_object(v_document->>'policy_document_id', v_extracted_id::text);
    v_result_documents := v_result_documents || jsonb_build_object(
      'id', v_extracted_id,
      'policy_document_id', nullif(v_document->>'policy_document_id', '')::uuid
    );
  end loop;

  -- Upsert candidates. Each candidate must provide an id; for new candidates
  -- the Edge Function supplies a freshly generated UUID, while existing candidates
  -- reuse their primary key.
  for v_candidate in select * from jsonb_array_elements(p_candidates_json) loop
    v_candidate_id := nullif(v_candidate->>'id', '')::uuid;
    if v_candidate_id is null then
      raise exception 'candidate id is required';
    end if;

    v_identity_fingerprint := v_candidate->>'identity_fingerprint';
    v_asset_type := (v_candidate->>'asset_type')::candidate_asset_type;
    v_match_classification := (v_candidate->>'match_classification')::candidate_match_classification;
    v_source_doc_ids := coalesce(
      (select array_agg(distinct (elem::text)::uuid)
       from jsonb_array_elements(v_candidate->'source_document_ids') as elem
       where elem::text <> 'null'),
      '{}'::uuid[]
    );

    if v_identity_fingerprint is null or v_asset_type is null then
      raise exception 'candidate requires identity_fingerprint and asset_type';
    end if;

    -- Validate that source document ids reference documents inserted by this run.
    if exists (
      select 1
      from unnest(v_source_doc_ids) as src_id
      where not exists (select 1 from extracted_documents where id = src_id and analysis_run_id = v_run_id)
    ) then
      raise exception 'candidate references source document id not created by this analysis run';
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

-- -----------------------------------------------------------------------------
-- 5. Grants
-- -----------------------------------------------------------------------------

grant execute on function persist_document_analysis_v1 to service_role;
