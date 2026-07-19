-- Phase 1F-A: manual policy review entry point for operations staff.
-- This RPC lets staff create canonical asset_candidate drafts from manually
-- reviewed source documents without invoking an external LLM.
begin;

-- Track who performed the manual review and when.
alter table asset_candidates
  add column if not exists manual_reviewed_by uuid references profiles(id),
  add column if not exists manual_reviewed_at timestamptz;

-- Idempotency ledger for manual review requests.
create table if not exists manual_policy_reviews (
  id uuid primary key default gen_random_uuid(),
  client_request_id text unique not null,
  household_id uuid not null references households(id) on delete cascade,
  actor_profile_id uuid not null references profiles(id),
  candidate_id uuid not null references asset_candidates(id) on delete cascade,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_manual_policy_reviews_client_request_id
  on manual_policy_reviews (client_request_id);

alter table manual_policy_reviews enable row level security;

create policy manual_policy_reviews_select on manual_policy_reviews
  for select using (can_access_household(household_id));

grant select, insert on manual_policy_reviews to authenticated;
grant select, insert on manual_policy_reviews to service_role;

create or replace function save_manual_policy_review_v1(
  p_household_id uuid,
  p_actor_profile_id uuid,
  p_client_request_id text,
  p_policy_document_id uuid,
  p_asset_type candidate_asset_type,
  p_identity_fingerprint text,
  p_display_label text,
  p_session_id uuid default null,
  p_candidate_id uuid default null,
  p_occupancy text default null,
  p_match_classification candidate_match_classification default 'new',
  p_selected_facts_json jsonb default '{}'::jsonb,
  p_provenance_json jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_existing jsonb;
  v_session_id uuid;
  v_candidate_id uuid;
  v_document_household_id uuid;
  v_facts jsonb;
  v_result jsonb;
begin
  if not is_staff() then
    raise exception 'manual review requires staff role' using errcode = 'P0001';
  end if;

  if not can_access_household(p_household_id) then
    raise exception 'staff cannot access household' using errcode = 'P0001';
  end if;

  -- Idempotency: return the same result for the same client request id.
  select result_json into v_existing
  from manual_policy_reviews
  where client_request_id = p_client_request_id;
  if found then
    return v_existing;
  end if;

  -- Verify the source policy document belongs to the household.
  select household_id into v_document_household_id
  from policy_documents
  where id = p_policy_document_id;
  if not found or v_document_household_id <> p_household_id then
    raise exception 'source policy document does not belong to household' using errcode = 'P0001';
  end if;

  -- Resolve or create the extraction session.
  v_session_id := p_session_id;
  if v_session_id is null then
    insert into document_extraction_sessions (household_id, created_by, status)
    values (p_household_id, p_actor_profile_id, 'open')
    returning id into v_session_id;
  else
    -- Verify the session belongs to the household.
    perform 1 from document_extraction_sessions
    where id = v_session_id and household_id = p_household_id;
    if not found then
      raise exception 'session does not belong to household' using errcode = 'P0001';
    end if;
  end if;

  v_candidate_id := coalesce(p_candidate_id, gen_random_uuid());

  v_facts := p_selected_facts_json;
  if v_facts is null or v_facts = '{}'::jsonb then
    v_facts := '{}'::jsonb;
  end if;
  -- Preserve a provider-neutral source marker and provenance inside the facts.
  v_facts := v_facts
    || jsonb_build_object('_source', 'manual_policy_review')
    || jsonb_build_object('_provenance', coalesce(p_provenance_json, '{}'::jsonb));

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
    manual_reviewed_by,
    manual_reviewed_at
  ) values (
    v_candidate_id,
    v_session_id,
    p_household_id,
    p_asset_type,
    p_identity_fingerprint,
    p_display_label,
    nullif(p_occupancy, ''),
    p_match_classification,
    'undecided',
    'pending',
    array[p_policy_document_id],
    v_facts,
    p_actor_profile_id,
    now()
  )
  on conflict (id) do update set
    session_id = excluded.session_id,
    asset_type = excluded.asset_type,
    identity_fingerprint = excluded.identity_fingerprint,
    display_label = excluded.display_label,
    occupancy = coalesce(excluded.occupancy, asset_candidates.occupancy),
    match_classification = excluded.match_classification,
    source_document_ids = array(
      select distinct unnest(coalesce(asset_candidates.source_document_ids, '{}'::uuid[]) || excluded.source_document_ids)
    ),
    selected_facts_json = excluded.selected_facts_json,
    manual_reviewed_by = excluded.manual_reviewed_by,
    manual_reviewed_at = excluded.manual_reviewed_at,
    updated_at = now()
  where asset_candidates.household_id = p_household_id
  returning id into v_candidate_id;

  insert into manual_policy_reviews (
    client_request_id,
    household_id,
    actor_profile_id,
    candidate_id,
    result_json
  ) values (
    p_client_request_id,
    p_household_id,
    p_actor_profile_id,
    v_candidate_id,
    '{}'::jsonb
  );

  insert into audit_events (
    actor_profile_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    household_id,
    after_summary
  ) values (
    p_actor_profile_id,
    app_role(),
    'manual_policy_review_saved',
    'asset_candidate',
    v_candidate_id,
    p_household_id,
    jsonb_build_object(
      'source', 'manual_policy_review',
      'policy_document_id', p_policy_document_id,
      'session_id', v_session_id,
      'candidate_id', v_candidate_id
    )
  );

  v_result := jsonb_build_object(
    'success', true,
    'candidate_id', v_candidate_id,
    'session_id', v_session_id,
    'household_id', p_household_id
  );

  update manual_policy_reviews
  set result_json = v_result
  where client_request_id = p_client_request_id;

  return v_result;
end;
$$;

revoke all on function public.save_manual_policy_review_v1(
  uuid, uuid, text, uuid, candidate_asset_type, text, text, uuid, uuid, text, candidate_match_classification, jsonb, jsonb
) from public;
revoke all on function public.save_manual_policy_review_v1(
  uuid, uuid, text, uuid, candidate_asset_type, text, text, uuid, uuid, text, candidate_match_classification, jsonb, jsonb
) from anon;
grant execute on function public.save_manual_policy_review_v1(
  uuid, uuid, text, uuid, candidate_asset_type, text, text, uuid, uuid, text, candidate_match_classification, jsonb, jsonb
) to authenticated;
grant execute on function public.save_manual_policy_review_v1(
  uuid, uuid, text, uuid, candidate_asset_type, text, text, uuid, uuid, text, candidate_match_classification, jsonb, jsonb
) to service_role;

comment on function public.save_manual_policy_review_v1 is
  'Staff-only RPC to create or update asset_candidate drafts from a manually reviewed policy document.';

commit;
