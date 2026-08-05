-- Customer-driven manual entry after a safe-mode document upload, and staff completion of a manual review batch.
begin;

create or replace function save_customer_manual_policy_review_v1(
  p_batch_id uuid,
  p_session_id uuid,
  p_case_id uuid,
  p_household_id uuid,
  p_actor_profile_id uuid,
  p_client_request_id text,
  p_asset_type candidate_asset_type,
  p_identity_fingerprint text,
  p_display_label text,
  p_occupancy text default null,
  p_match_classification candidate_match_classification default 'new',
  p_selected_facts_json jsonb default '{}'::jsonb,
  p_provenance_json jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_batch document_processing_batches%rowtype;
  v_session_household_id uuid;
  v_case_household_id uuid;
  v_source_document_ids uuid[] := '{}'::uuid[];
  v_candidate_id uuid;
  v_facts jsonb;
  v_result jsonb;
  v_existing_candidate_id uuid;
begin
  v_actor := coalesce(nullif(auth.uid()::text, '')::uuid, p_actor_profile_id);
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if not is_household_member(p_household_id) then
    raise exception 'Household not found or access denied' using errcode = 'P0001';
  end if;

  select * into v_batch
  from document_processing_batches
  where id = p_batch_id;
  if not found or v_batch.household_id <> p_household_id then
    raise exception 'Batch not found' using errcode = 'P0001';
  end if;

  if v_batch.session_id <> p_session_id then
    raise exception 'Session does not match batch' using errcode = 'P0001';
  end if;

  select household_id into v_session_household_id
  from document_extraction_sessions
  where id = p_session_id;
  if not found or v_session_household_id <> p_household_id then
    raise exception 'Session not found' using errcode = 'P0001';
  end if;

  select household_id into v_case_household_id
  from optimization_cases
  where id = p_case_id;
  if not found or v_case_household_id <> p_household_id then
    raise exception 'Case not found' using errcode = 'P0001';
  end if;

  if v_batch.case_id is not null and v_batch.case_id <> p_case_id then
    raise exception 'Case does not match batch' using errcode = 'P0001';
  end if;

  select array_agg(policy_document_id) into v_source_document_ids
  from document_processing_batch_items
  where batch_id = p_batch_id;

  -- Idempotency: return the same candidate for the same client request id.
  select a.id into v_existing_candidate_id
  from asset_candidates a
  where a.session_id = p_session_id
    and a.identity_fingerprint = p_identity_fingerprint
    and a.display_label = p_display_label
    and a.source_document_ids = coalesce(v_source_document_ids, '{}'::uuid[])
  limit 1;

  if v_existing_candidate_id is not null then
    select to_jsonb(a.*) into v_result
    from asset_candidates a
    where a.id = v_existing_candidate_id;
    return jsonb_build_object('success', true, 'candidate', v_result);
  end if;

  v_facts := p_selected_facts_json;
  if v_facts is null or v_facts = '{}'::jsonb then
    v_facts := '{}'::jsonb;
  end if;
  v_facts := v_facts
    || jsonb_build_object('_source', 'customer_manual_entry')
    || jsonb_build_object('_provenance', coalesce(p_provenance_json, '{}'::jsonb));

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
    nullif(p_occupancy, ''),
    p_match_classification,
    'undecided',
    'pending',
    coalesce(v_source_document_ids, '{}'::uuid[]),
    v_facts
  ) returning id into v_candidate_id;

  -- Mark the batch as ready for the customer to review the manually entered details.
  update document_processing_batches
  set status = 'ready_for_review',
      case_id = p_case_id,
      manual_case_id = p_case_id,
      updated_at = now()
  where id = p_batch_id;

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
    'customer_manual_candidate_created',
    'asset_candidate',
    v_candidate_id,
    p_household_id,
    p_case_id,
    jsonb_build_object(
      'batch_id', p_batch_id,
      'session_id', p_session_id,
      'asset_type', p_asset_type,
      'source', 'customer_manual_entry'
    )
  );

  select to_jsonb(a.*) into v_result
  from asset_candidates a
  where a.id = v_candidate_id;

  return jsonb_build_object('success', true, 'candidate', v_result);
end;
$$;

revoke all on function public.save_customer_manual_policy_review_v1(
  uuid, uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, text, candidate_match_classification, jsonb, jsonb
) from public, anon;
grant execute on function public.save_customer_manual_policy_review_v1(
  uuid, uuid, uuid, uuid, uuid, text, candidate_asset_type, text, text, text, candidate_match_classification, jsonb, jsonb
) to authenticated, service_role;

comment on function public.save_customer_manual_policy_review_v1 is
  'Customer-facing RPC to enter a single asset manually after a safe-mode document upload. Creates an asset_candidate and advances the batch to ready_for_review.';

-- Staff completion: link existing manual-review candidates to the original batch/session, set the batch ready_for_review, and advance the case.
create or replace function complete_manual_review_v1(
  p_batch_id uuid,
  p_session_id uuid,
  p_case_id uuid,
  p_household_id uuid,
  p_actor_profile_id uuid,
  p_candidate_ids uuid[]
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid;
  v_batch document_processing_batches%rowtype;
  v_case optimization_cases%rowtype;
  v_candidate_id uuid;
  v_linked_count int := 0;
  v_result jsonb;
begin
  v_actor := coalesce(nullif(auth.uid()::text, '')::uuid, p_actor_profile_id);
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'P0001';
  end if;

  if not is_staff() then
    raise exception 'manual review completion requires staff role' using errcode = 'P0001';
  end if;

  if not can_access_household(p_household_id) then
    raise exception 'staff cannot access household' using errcode = 'P0001';
  end if;

  select * into v_batch
  from document_processing_batches
  where id = p_batch_id;
  if not found or v_batch.household_id <> p_household_id then
    raise exception 'Batch not found' using errcode = 'P0001';
  end if;
  if v_batch.session_id <> p_session_id then
    raise exception 'Session does not match batch' using errcode = 'P0001';
  end if;

  select * into v_case
  from optimization_cases
  where id = p_case_id;
  if not found or v_case.household_id <> p_household_id then
    raise exception 'Case not found' using errcode = 'P0001';
  end if;

  if v_batch.case_id is not null and v_batch.case_id <> p_case_id then
    raise exception 'Case does not match batch' using errcode = 'P0001';
  end if;

  foreach v_candidate_id in array p_candidate_ids
  loop
    update asset_candidates
    set session_id = p_session_id,
        updated_at = now()
    where id = v_candidate_id
      and household_id = p_household_id;

    if found then
      v_linked_count := v_linked_count + 1;
    end if;
  end loop;

  update document_processing_batches
  set status = 'ready_for_review',
      case_id = p_case_id,
      manual_case_id = p_case_id,
      updated_at = now()
  where id = p_batch_id;

  update optimization_cases
  set state = 'extracting_information',
      updated_at = now()
  where id = p_case_id
    and state in ('awaiting_documents', 'draft');

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
      'linked_candidates', v_linked_count,
      'candidate_ids', p_candidate_ids,
      'session_id', p_session_id,
      'source', 'staff_manual_completion'
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'linked_candidates', v_linked_count
  );

  return v_result;
end;
$$;

revoke all on function public.complete_manual_review_v1(
  uuid, uuid, uuid, uuid, uuid, uuid[]
) from public, anon;
grant execute on function public.complete_manual_review_v1(
  uuid, uuid, uuid, uuid, uuid, uuid[]
) to authenticated, service_role;

comment on function public.complete_manual_review_v1 is
  'Staff-only RPC to complete a manual review: link candidates to the original batch/session, set the batch to ready_for_review, and advance the case.';

commit;
