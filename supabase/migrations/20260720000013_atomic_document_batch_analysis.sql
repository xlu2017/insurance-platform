-- Keep canonical analysis persistence and document-informed review seeding in
-- one database transaction. The wrapper delegates candidate/document writes to
-- the existing persist_document_analysis_v1 boundary.
begin;

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
  p_consent_id uuid default null
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_result jsonb;
  v_review jsonb;
  v_candidate_id uuid;
  v_source_document_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only service_role may persist document batch analysis';
  end if;
  if jsonb_typeof(p_reviews_json) <> 'array' then
    raise exception 'p_reviews_json must be a JSON array';
  end if;
  if not exists (
    select 1
    from document_processing_batches
    where id = p_batch_id
      and household_id = p_household_id
      and session_id = p_session_id
      and mode_snapshot = 'dangerous'
  ) then
    raise exception 'Document processing batch does not match the household and session';
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

  -- A replay of an already-committed analysis must not reset completed review
  -- drafts. The canonical persistence boundary has already returned its result.
  if coalesce((v_result->>'duplicate')::boolean, false) then
    return v_result;
  end if;

  -- Canonical pending candidates may be enriched by a later batch. Associate
  -- them with the latest extraction session without creating a parallel
  -- candidate model; source-document provenance remains merged by the canonical
  -- persistence function above.
  update asset_candidates candidate
  set session_id = p_session_id,
      draft_decision = null,
      draft_identity_confirmed = false,
      draft_existing_asset_id = null,
      draft_existing_asset_type = null,
      draft_updated_by = null,
      draft_updated_at = null,
      updated_at = now()
  where candidate.household_id = p_household_id
    and candidate.id in (
      select nullif(value->>'id', '')::uuid
      from jsonb_array_elements(p_candidates_json)
    );

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
  uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid
) from public, anon, authenticated;
grant execute on function persist_document_batch_analysis_v1(
  uuid, uuid, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, uuid, uuid
) to service_role;

commit;
