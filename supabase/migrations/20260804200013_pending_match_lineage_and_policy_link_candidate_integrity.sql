-- Preserve matches_pending_candidate draft lineage and strengthen policy_asset_links
-- candidate integrity. This migration builds on 20260804200012 without rewriting it.
begin;

-- Allow 'undecided' as an explicit draft_decision so a matched pending candidate
-- can remain unselected instead of being silently converted to approve_new.
alter table asset_candidates
  drop constraint if exists asset_candidates_draft_decision_check,
  add constraint asset_candidates_draft_decision_check
    check (draft_decision is null or draft_decision in (
      'approve_new', 'link_existing', 'skip', 'needs_correction', 'undecided'
    ));

-- =============================================================================
-- 1. Derive authoritative first-class draft decisions from analyzer output,
--    preserving matched pending-candidate lineage and never downgrading a
--    previous link_existing decision into approve_new.
-- =============================================================================

create or replace function sync_candidate_draft_decision()
returns trigger
language plpgsql
as $$
declare
  v_resolution jsonb;
  v_status text;
  v_existing_id text;
  v_existing_type text;
  v_existing_asset jsonb;
  v_identity_strength text;
  v_old_decision text;
  v_old_existing_id uuid;
  v_old_existing_type candidate_asset_type;
  v_old_identity_confirmed boolean;
  v_decision text;
begin
  if new.selected_facts_json is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.selected_facts_json is not distinct from old.selected_facts_json then
    return new;
  end if;

  -- Manual UIs may pass an explicit draft decision via _draftDecision metadata.
  -- Honor it, including an optional _draftIdentityConfirmed override, and fall
  -- back to existing draft columns when the metadata omits an asset id.
  if new.selected_facts_json ? '_draftDecision' then
    v_decision := lower(nullif(new.selected_facts_json->>'_draftDecision', ''));
    if v_decision in ('approve_new', 'link_existing', 'skip', 'needs_correction', 'undecided') then
      new.draft_decision := v_decision;

      if v_decision = 'link_existing' then
        v_existing_id := nullif(new.selected_facts_json->>'_draftExistingAssetId', '');
        if v_existing_id is null and new.selected_facts_json ? 'existingAsset' then
          v_existing_id := nullif(new.selected_facts_json->'existingAsset'->>'id', '');
        end if;
        if v_existing_id is null and tg_op = 'UPDATE' and old.draft_existing_asset_id is not null then
          v_existing_id := old.draft_existing_asset_id::text;
        end if;

        v_existing_type := lower(nullif(new.selected_facts_json->>'_draftExistingAssetType', ''));
        if (v_existing_type is null or v_existing_type = '') and new.selected_facts_json ? 'existingAsset' then
          v_existing_type := lower(nullif(new.selected_facts_json->'existingAsset'->>'asset_type', ''));
        end if;
        if (v_existing_type is null or v_existing_type = '') and tg_op = 'UPDATE' and old.draft_existing_asset_type is not null then
          v_existing_type := old.draft_existing_asset_type::text;
        end if;

        new.draft_existing_asset_id := v_existing_id::uuid;
        new.draft_existing_asset_type :=
          case when v_existing_type in ('vehicle','property') then v_existing_type::candidate_asset_type else null end;
      else
        new.draft_existing_asset_id := null;
        new.draft_existing_asset_type := null;
      end if;

      if new.selected_facts_json ? '_draftIdentityConfirmed' then
        new.draft_identity_confirmed := coalesce((new.selected_facts_json->>'_draftIdentityConfirmed')::boolean, false);
      elsif v_decision in ('approve_new', 'link_existing') then
        new.draft_identity_confirmed := true;
      else
        new.draft_identity_confirmed := false;
      end if;

      return new;
    end if;
  end if;

  if not (new.selected_facts_json ? 'resolution') then
    return new;
  end if;

  v_resolution := new.selected_facts_json->'resolution';
  v_status := lower(nullif(v_resolution->>'status', ''));
  v_existing_id := nullif(v_resolution->>'matchedExistingEntityId', '');
  if (v_existing_id is null or v_existing_id = '') and new.selected_facts_json ? 'existingAsset' then
    v_existing_id := nullif(new.selected_facts_json->'existingAsset'->>'id', '');
  end if;
  v_identity_strength := lower(nullif(new.selected_facts_json->'candidateIdentity'->>'identityStrength', ''));
  v_existing_asset := coalesce(new.selected_facts_json->'existingAsset', '{}'::jsonb);

  if tg_op = 'UPDATE' then
    v_old_decision := old.draft_decision;
    if v_old_decision = 'undecided' then
      v_old_decision := null;
    end if;
    v_old_existing_id := old.draft_existing_asset_id;
    v_old_existing_type := old.draft_existing_asset_type;
    v_old_identity_confirmed := old.draft_identity_confirmed;
  end if;

  if v_status = 'matches_existing' and v_existing_id is not null then
    new.draft_decision := 'link_existing';
    new.draft_identity_confirmed := true;
    new.draft_existing_asset_id := v_existing_id::uuid;
    new.draft_existing_asset_type :=
      coalesce(
        case when lower(nullif(v_existing_asset->>'asset_type', '')) in ('vehicle','property')
          then lower(nullif(v_existing_asset->>'asset_type', ''))::candidate_asset_type
          else null end,
        new.asset_type
      );
  elsif v_status = 'matches_pending_candidate' and v_old_decision is not null then
    -- Preserve the matched pending candidate's draft lineage; do not downgrade a
    -- previous link_existing decision into approve_new.
    new.draft_decision := v_old_decision;
    new.draft_identity_confirmed := v_old_identity_confirmed;
    new.draft_existing_asset_id := v_old_existing_id;
    new.draft_existing_asset_type := v_old_existing_type;
  elsif v_status = 'matches_pending_candidate' then
    -- Do not silently convert an undecided pending match into approve_new.
    new.draft_decision := 'undecided';
    new.draft_identity_confirmed := false;
    new.draft_existing_asset_id := null;
    new.draft_existing_asset_type := null;
  elsif v_status = 'possible_match_requires_confirmation' and v_existing_id is not null then
    -- The customer must explicitly confirm linking to the suggested existing asset.
    new.draft_decision := 'link_existing';
    new.draft_identity_confirmed := false;
    new.draft_existing_asset_id := v_existing_id::uuid;
    new.draft_existing_asset_type :=
      coalesce(
        case when lower(nullif(v_existing_asset->>'asset_type', '')) in ('vehicle','property')
          then lower(nullif(v_existing_asset->>'asset_type', ''))::candidate_asset_type
          else null end,
        new.asset_type
      );
  elsif v_status = 'possible_match_requires_confirmation' and v_old_existing_id is not null then
    -- Preserve the suggested existing asset from a matched pending candidate,
    -- but require explicit customer confirmation.
    new.draft_decision := 'link_existing';
    new.draft_identity_confirmed := false;
    new.draft_existing_asset_id := v_old_existing_id;
    new.draft_existing_asset_type := v_old_existing_type;
  elsif v_status = 'possible_match_requires_confirmation' and v_old_decision in ('needs_correction','skip','approve_new','undecided') then
    -- Preserve an explicit pending-candidate draft decision while requiring confirmation.
    new.draft_decision := v_old_decision;
    new.draft_identity_confirmed := false;
    new.draft_existing_asset_id := null;
    new.draft_existing_asset_type := null;
  elsif v_status = 'possible_match_requires_confirmation' then
    -- A partial/redacted identity with no clear existing match needs correction.
    new.draft_decision := 'needs_correction';
    new.draft_identity_confirmed := false;
    new.draft_existing_asset_id := null;
    new.draft_existing_asset_type := null;
  else
    -- 'new' or any unrecognized status defaults to add-as-new.
    new.draft_decision := 'approve_new';
    new.draft_identity_confirmed := (v_identity_strength = 'exact');
    new.draft_existing_asset_id := null;
    new.draft_existing_asset_type := null;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_candidate_draft_decision on asset_candidates;
create trigger sync_candidate_draft_decision
  before insert or update on asset_candidates
  for each row
  execute function sync_candidate_draft_decision();

-- =============================================================================
-- 2. Persist analyzer candidates with explicit first-class draft lineage columns.
-- =============================================================================

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
  v_draft_decision text;
  v_draft_identity_confirmed boolean;
  v_draft_existing_asset_id uuid;
  v_draft_existing_asset_type text;
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
          'source_document_ids', source_document_ids,
          'draft_decision', draft_decision,
          'draft_identity_confirmed', draft_identity_confirmed,
          'draft_existing_asset_id', draft_existing_asset_id,
          'draft_existing_asset_type', draft_existing_asset_type
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

    v_draft_decision := nullif(v_candidate->>'draft_decision', '');
    v_draft_identity_confirmed :=
      case
        when v_candidate->>'draft_identity_confirmed' is null then null
        else (v_candidate->>'draft_identity_confirmed')::boolean
      end;
    v_draft_existing_asset_id := nullif(v_candidate->>'draft_existing_asset_id', '')::uuid;
    v_draft_existing_asset_type := nullif(v_candidate->>'draft_existing_asset_type', '');

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
      draft_decision,
      draft_identity_confirmed,
      draft_existing_asset_id,
      draft_existing_asset_type,
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
      v_draft_decision,
      coalesce(v_draft_identity_confirmed, false),
      v_draft_existing_asset_id,
      case when v_draft_existing_asset_type in ('vehicle','property') then v_draft_existing_asset_type::candidate_asset_type else null end,
      v_source_doc_ids,
      coalesce(v_candidate->'selected_facts_json', '{}'::jsonb),
      coalesce(v_candidate->'conflicts_json', '[]'::jsonb),
      v_run_id
    )
    on conflict (id) do update set
      session_id = excluded.session_id,
      display_label = coalesce(excluded.display_label, asset_candidates.display_label),
      occupancy = coalesce(excluded.occupancy, asset_candidates.occupancy),
      match_classification = excluded.match_classification,
      source_document_ids = excluded.source_document_ids,
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

-- =============================================================================
-- 3. Strengthen policy_asset_links integrity for candidate-linked writes and
--    keep policies.is_current synchronized with link is_current.
-- =============================================================================

create or replace function validate_policy_asset_link_integrity()
returns trigger
language plpgsql
as $$
declare
  v_policy_household_id uuid;
  v_policy_product_line product_line;
  v_policy_is_current boolean;
  v_asset_exists boolean;
  v_candidate_household_id uuid;
  v_candidate_approved_asset_id uuid;
  v_candidate_approved_asset_type candidate_asset_type;
  v_candidate_approved_policy_id uuid;
begin
  -- policy_id must exist and its household/product_line/current-state must match.
  select household_id, product_line, is_current into v_policy_household_id, v_policy_product_line, v_policy_is_current
  from policies
  where id = NEW.policy_id;

  if not found then
    raise exception 'policy % does not exist', NEW.policy_id using errcode = 'P0001';
  end if;
  if v_policy_household_id <> NEW.household_id then
    raise exception 'policy household does not match link household' using errcode = 'P0001';
  end if;
  if v_policy_product_line <> NEW.product_line then
    raise exception 'policy product line does not match link product line' using errcode = 'P0001';
  end if;
  if v_policy_is_current is distinct from NEW.is_current then
    raise exception 'policy is_current must match link is_current' using errcode = 'P0001';
  end if;

  -- asset_type/product_line consistency and asset existence in the household.
  if NEW.asset_type = 'vehicle' then
    if NEW.product_line <> 'auto' then
      raise exception 'vehicle links must use product_line auto' using errcode = 'P0001';
    end if;
    select exists(
      select 1 from vehicles where id = NEW.asset_id and household_id = NEW.household_id
    ) into v_asset_exists;
  elsif NEW.asset_type = 'property' then
    if NEW.product_line <> 'property' then
      raise exception 'property links must use product_line property' using errcode = 'P0001';
    end if;
    select exists(
      select 1 from properties where id = NEW.asset_id and household_id = NEW.household_id
    ) into v_asset_exists;
  else
    raise exception 'invalid asset_type %', NEW.asset_type using errcode = 'P0001';
  end if;

  if not v_asset_exists then
    raise exception 'asset % of type % does not exist in household', NEW.asset_id, NEW.asset_type using errcode = 'P0001';
  end if;

  -- candidate_id, when present, must be approved and fully agree with the link.
  if NEW.candidate_id is not null then
    select household_id, approved_asset_id, approved_asset_type, approved_policy_id
      into v_candidate_household_id, v_candidate_approved_asset_id, v_candidate_approved_asset_type, v_candidate_approved_policy_id
    from asset_candidates
    where id = NEW.candidate_id;

    if not found then
      raise exception 'candidate % does not exist', NEW.candidate_id using errcode = 'P0001';
    end if;
    if v_candidate_household_id <> NEW.household_id then
      raise exception 'candidate household does not match link household' using errcode = 'P0001';
    end if;
    if v_candidate_approved_asset_id is null then
      raise exception 'candidate is not approved' using errcode = 'P0001';
    end if;
    if v_candidate_approved_asset_id <> NEW.asset_id or v_candidate_approved_asset_type <> NEW.asset_type then
      raise exception 'candidate approved asset does not match link asset' using errcode = 'P0001';
    end if;
    if v_candidate_approved_policy_id is distinct from NEW.policy_id then
      raise exception 'candidate approved policy does not match link policy' using errcode = 'P0001';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists policy_asset_links_integrity on policy_asset_links;
create trigger policy_asset_links_integrity
  before insert or update on policy_asset_links
  for each row
  execute function validate_policy_asset_link_integrity();

commit;
