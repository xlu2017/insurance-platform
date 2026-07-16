-- Corrective Phase 1D: trusted recommendation persistence, canonical snapshot/digest
-- storage, quote validation states, and internal-only RPC boundary.

-- =============================================================================
-- 1. Recommendation snapshot + digest storage
-- =============================================================================

alter table recommendations
  add column if not exists input_snapshot_json jsonb,
  add column if not exists input_snapshot_digest text,
  add column if not exists engine_output_json jsonb,
  add column if not exists engine_output_digest text,
  add column if not exists rejected_options_json jsonb;

alter table recommendation_options
  add column if not exists ranking_factors jsonb,
  add column if not exists preference_alignment jsonb,
  add column if not exists deductible_total_cents bigint,
  add column if not exists underwriting_condition_count int;

-- =============================================================================
-- 2. Recommendation generation attempts audit table
-- =============================================================================

create table if not exists recommendation_generation_attempts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references optimization_cases (id) on delete cascade,
  actor_profile_id uuid references profiles (id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'started',
  mandate_id uuid,
  mandate_version int,
  switching_preferences_id uuid,
  switching_preferences_version int,
  engine_version text,
  engine_source_hash text,
  input_snapshot_digest text,
  engine_output_digest text,
  error_code text,
  safe_error_message text,
  recommendation_id uuid references recommendations (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Attempt status must be one of the documented values.
alter table recommendation_generation_attempts
  add constraint recommendation_generation_attempts_status_check
  check (status in ('started', 'input_rejected', 'no_eligible_option', 'persistence_conflict', 'completed', 'failed'));

-- =============================================================================
-- 3. Case access helper parameterized by profile id
-- =============================================================================

create or replace function can_access_case_for_profile(p_case_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from optimization_cases oc
    where oc.id = p_case_id
      and (
        exists (select 1 from household_members hm where hm.household_id = oc.household_id and hm.profile_id = p_profile_id)
        or exists (select 1 from households h where h.id = oc.household_id and h.owner_profile_id = p_profile_id)
        or exists (select 1 from profiles p where p.id = p_profile_id and p.role = 'admin')
        or exists (
          select 1 from profiles p
          join case_assignments ca on ca.assignee_profile_id = p_profile_id
          where p.id = p_profile_id and p.role = 'operations' and ca.case_id = p_case_id
        )
        or exists (
          select 1 from profiles p
          where p.id = p_profile_id and p.role = 'reviewer'
            and oc.state in ('licensed_review', 'recommendation_ready', 'customer_decision', 'switching', 'completed')
        )
      )
  );
$$;

-- =============================================================================
-- 4. Internal recommendation persistence function
-- =============================================================================

create or replace function persist_engine_recommendation_v2(
  p_case_id uuid,
  p_actor_profile_id uuid,
  p_mandate_id uuid,
  p_mandate_version int,
  p_mandate_schema_version int,
  p_mandate_jurisdiction text,
  p_switching_preferences_id uuid,
  p_switching_preferences_version int,
  p_input_snapshot_json jsonb,
  p_input_snapshot_digest text,
  p_engine_version text,
  p_engine_source_hash text,
  p_engine_output_json jsonb,
  p_engine_output_digest text,
  p_current_total_cents bigint,
  p_proposed_total_cents bigint,
  p_net_savings_cents bigint,
  p_reason_codes text[],
  p_recommended_option_json jsonb,
  p_ranked_options_json jsonb,
  p_rejected_options_json jsonb default '[]'::jsonb,
  p_comparison_json jsonb default '{}'::jsonb,
  p_disclosure_version text default 'v1'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_attempt_id uuid := gen_random_uuid();
  v_caller_role text;
  v_actor_role user_role;
  oc optimization_cases%rowtype;
  current_mandate record;
  current_switching record;
  next_rec_version int;
  new_rec_id uuid;
  v_snap record;
  v_quote_record record;
  v_recommended jsonb;
  v_opt record;
  v_rank int;
  v_top_option jsonb;
  v_quote_ids uuid[];
  v_auto_quote_id uuid;
  v_property_quote_id uuid;
begin
  -- Start attempt record.
  insert into recommendation_generation_attempts (
    id, case_id, actor_profile_id, started_at, status,
    mandate_id, mandate_version, switching_preferences_id, switching_preferences_version,
    engine_version, engine_source_hash, input_snapshot_digest
  ) values (
    v_attempt_id, p_case_id, p_actor_profile_id, now(), 'started',
    p_mandate_id, p_mandate_version, p_switching_preferences_id, p_switching_preferences_version,
    p_engine_version, p_engine_source_hash, p_input_snapshot_digest
  );

  -- Only service_role should be able to call this function; the grant enforces that.
  -- We still reject a non-service-role JWT if one somehow reaches here.
  v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  if v_caller_role is not null and v_caller_role <> 'service_role' then
    update recommendation_generation_attempts
    set status = 'persistence_conflict', completed_at = now(), error_code = 'UNAUTHORIZED_CALLER', safe_error_message = 'Only service role may persist engine recommendations'
    where id = v_attempt_id;
    raise exception 'Only service_role may call persist_engine_recommendation_v2';
  end if;

  -- Verify actor exists and is operations or admin.
  select role into v_actor_role from profiles where id = p_actor_profile_id;
  if v_actor_role is null or v_actor_role not in ('operations', 'admin') then
    update recommendation_generation_attempts
    set status = 'persistence_conflict', completed_at = now(), error_code = 'INVALID_ACTOR', safe_error_message = 'Actor must be operations or admin'
    where id = v_attempt_id;
    raise exception 'actor must be operations or admin';
  end if;

  -- Verify case exists, is in the right state, and actor can access it.
  select * into oc from optimization_cases where id = p_case_id;
  if not found then
    update recommendation_generation_attempts
    set status = 'persistence_conflict', completed_at = now(), error_code = 'CASE_NOT_FOUND', safe_error_message = 'Case not found'
    where id = v_attempt_id;
    raise exception 'case not found';
  end if;

  if oc.state not in ('comparing_quotes', 'customer_decision') then
    update recommendation_generation_attempts
    set status = 'persistence_conflict', completed_at = now(), error_code = 'INVALID_CASE_STATE', safe_error_message = 'Case is not in a generation-allowed state'
    where id = v_attempt_id;
    raise exception 'case is not in comparing_quotes or customer_decision';
  end if;

  if not can_access_case_for_profile(p_case_id, p_actor_profile_id) then
    update recommendation_generation_attempts
    set status = 'persistence_conflict', completed_at = now(), error_code = 'CASE_ACCESS_DENIED', safe_error_message = 'Actor cannot access this case'
    where id = v_attempt_id;
    raise exception 'actor cannot access case';
  end if;

  -- Verify current mandate and switching preferences.
  select * into current_mandate
  from household_coverage_mandates
  where id = p_mandate_id and household_id = oc.household_id and is_current = true
  for update;
  if not found then
    update recommendation_generation_attempts
    set status = 'persistence_conflict', completed_at = now(), error_code = 'STALE_MANDATE', safe_error_message = 'Mandate is not current for this household'
    where id = v_attempt_id;
    raise exception 'mandate % is not current for this household', p_mandate_id;
  end if;
  if current_mandate.version is distinct from p_mandate_version then
    update recommendation_generation_attempts
    set status = 'persistence_conflict', completed_at = now(), error_code = 'STALE_MANDATE', safe_error_message = 'Mandate version changed between evaluation and persistence'
    where id = v_attempt_id;
    raise exception 'mandate version changed between evaluation and persistence';
  end if;
  if current_mandate.schema_version is distinct from p_mandate_schema_version then
    update recommendation_generation_attempts
    set status = 'persistence_conflict', completed_at = now(), error_code = 'MANDATE_SCHEMA_MISMATCH', safe_error_message = 'Mandate schema version mismatch'
    where id = v_attempt_id;
    raise exception 'mandate schema version mismatch';
  end if;
  if current_mandate.jurisdiction is distinct from p_mandate_jurisdiction then
    update recommendation_generation_attempts
    set status = 'persistence_conflict', completed_at = now(), error_code = 'MANDATE_JURISDICTION_MISMATCH', safe_error_message = 'Mandate jurisdiction mismatch'
    where id = v_attempt_id;
    raise exception 'mandate jurisdiction mismatch';
  end if;

  select * into current_switching
  from switching_preferences
  where id = p_switching_preferences_id and household_id = oc.household_id and is_current = true
  for update;
  if not found then
    update recommendation_generation_attempts
    set status = 'persistence_conflict', completed_at = now(), error_code = 'STALE_SWITCHING', safe_error_message = 'Switching preferences are not current for this household'
    where id = v_attempt_id;
    raise exception 'switching preferences % are not current for this household', p_switching_preferences_id;
  end if;
  if current_switching.version is distinct from p_switching_preferences_version then
    update recommendation_generation_attempts
    set status = 'persistence_conflict', completed_at = now(), error_code = 'STALE_SWITCHING', safe_error_message = 'Switching preferences version changed between evaluation and persistence'
    where id = v_attempt_id;
    raise exception 'switching preferences version changed between evaluation and persistence';
  end if;

  -- Verify snapshot is complete and not stale.
  if p_input_snapshot_json is null or p_input_snapshot_json->'quoteSnapshot' is null then
    update recommendation_generation_attempts
    set status = 'input_rejected', completed_at = now(), error_code = 'INCOMPLETE_SNAPSHOT', safe_error_message = 'Input snapshot is missing quote snapshot'
    where id = v_attempt_id;
    raise exception 'input snapshot is missing quote snapshot';
  end if;

  if jsonb_array_length(coalesce(p_input_snapshot_json->'quoteSnapshot', '[]'::jsonb)) = 0 then
    update recommendation_generation_attempts
    set status = 'input_rejected', completed_at = now(), error_code = 'EMPTY_QUOTE_SNAPSHOT', safe_error_message = 'Quote snapshot is empty'
    where id = v_attempt_id;
    raise exception 'quote snapshot is empty';
  end if;

  -- Check every quoted id in the snapshot belongs to the case and is unchanged.
  for v_snap in select * from jsonb_array_elements(p_input_snapshot_json->'quoteSnapshot') loop
    select id, updated_at into v_quote_record
    from quotes
    where id = (v_snap.value->>'id')::uuid and case_id = p_case_id;
    if v_quote_record.id is null then
      update recommendation_generation_attempts
      set status = 'input_rejected', completed_at = now(), error_code = 'SNAPSHOT_QUOTE_MISSING', safe_error_message = 'Snapshot quote does not belong to this case or no longer exists'
      where id = v_attempt_id;
      raise exception 'quote % in snapshot does not belong to this case or no longer exists', v_snap.value->>'id';
    end if;
    if v_quote_record.updated_at is distinct from (v_snap.value->>'updated_at')::timestamptz then
      update recommendation_generation_attempts
      set status = 'input_rejected', completed_at = now(), error_code = 'STALE_QUOTE_SNAPSHOT', safe_error_message = 'Quote in snapshot changed since evaluation'
      where id = v_attempt_id;
      raise exception 'quote % changed since evaluation', v_snap.value->>'id';
    end if;
  end loop;

  -- Validate ranked options JSON shape and content.
  if p_ranked_options_json is null or jsonb_array_length(p_ranked_options_json) = 0 then
    update recommendation_generation_attempts
    set status = 'input_rejected', completed_at = now(), error_code = 'EMPTY_RANKED_OPTIONS', safe_error_message = 'Ranked options are empty'
    where id = v_attempt_id;
    raise exception 'ranked options are empty';
  end if;

  if p_recommended_option_json is null then
    update recommendation_generation_attempts
    set status = 'input_rejected', completed_at = now(), error_code = 'MISSING_RECOMMENDED_OPTION', safe_error_message = 'Recommended option is missing'
    where id = v_attempt_id;
    raise exception 'recommended option is missing';
  end if;

  -- Recommended option must be rank 1.
  if (p_recommended_option_json->>'rank')::int is distinct from 1 then
    update recommendation_generation_attempts
    set status = 'input_rejected', completed_at = now(), error_code = 'RECOMMENDED_NOT_RANK_ONE', safe_error_message = 'Recommended option must be rank 1'
    where id = v_attempt_id;
    raise exception 'recommended option must be rank 1';
  end if;

  -- Verify top ranked option matches the recommended option.
  v_top_option := p_ranked_options_json->0;
  if (v_top_option->>'auto_quote_id') is distinct from (p_recommended_option_json->>'auto_quote_id')
     or (v_top_option->>'property_quote_id') is distinct from (p_recommended_option_json->>'property_quote_id')
     or (v_top_option->>'total_cents')::bigint is distinct from (p_recommended_option_json->>'total_cents')::bigint then
    update recommendation_generation_attempts
    set status = 'input_rejected', completed_at = now(), error_code = 'RANK_RECOMMENDED_MISMATCH', safe_error_message = 'Top ranked option does not match recommended option'
    where id = v_attempt_id;
    raise exception 'top ranked option does not match recommended option';
  end if;

  -- Ranks must be contiguous and start at 1.
  declare
    v_rank_count int;
    v_rank_distinct int;
    v_min_rank int;
    v_max_rank int;
  begin
    select count(*), count(distinct (opt.value->>'rank')::int), min((opt.value->>'rank')::int), max((opt.value->>'rank')::int)
    into v_rank_count, v_rank_distinct, v_min_rank, v_max_rank
    from jsonb_array_elements(p_ranked_options_json) as opt;
    if v_rank_count is null or v_rank_count <> v_rank_distinct or v_min_rank <> 1 or v_max_rank <> jsonb_array_length(p_ranked_options_json) then
      update recommendation_generation_attempts
      set status = 'input_rejected', completed_at = now(), error_code = 'NON_CONTIGUOUS_RANKS', safe_error_message = 'Ranked option ranks are not contiguous starting at 1'
      where id = v_attempt_id;
      raise exception 'ranked option ranks are not contiguous starting at 1';
    end if;
  end;

  -- Verify option totals and savings are internally consistent.
  for v_opt in select * from jsonb_array_elements(p_ranked_options_json) loop
    if (v_opt.value->>'eligible')::boolean = false and (v_opt.value->>'rank')::int = 1 then
      update recommendation_generation_attempts
      set status = 'input_rejected', completed_at = now(), error_code = 'INELIGIBLE_RECOMMENDATION', safe_error_message = 'The recommended option (rank 1) is ineligible'
      where id = v_attempt_id;
      raise exception 'recommended option is ineligible';
    end if;

    if (v_opt.value->>'total_cents')::bigint < 0 then
      update recommendation_generation_attempts
      set status = 'input_rejected', completed_at = now(), error_code = 'NEGATIVE_TOTAL', safe_error_message = 'Option total cannot be negative'
      where id = v_attempt_id;
      raise exception 'option total cannot be negative';
    end if;

    if (v_opt.value->>'net_savings_cents')::bigint is distinct from (p_current_total_cents - (v_opt.value->>'total_cents')::bigint) then
      update recommendation_generation_attempts
      set status = 'input_rejected', completed_at = now(), error_code = 'NET_SAVINGS_MISMATCH', safe_error_message = 'Option net savings does not equal incumbent total minus proposed total'
      where id = v_attempt_id;
      raise exception 'net savings mismatch for option rank %', v_opt.value->>'rank';
    end if;
  end loop;

  -- Recommended option totals/savings must match recommendation top-level values.
  if (p_recommended_option_json->>'total_cents')::bigint is distinct from p_proposed_total_cents then
    update recommendation_generation_attempts
    set status = 'input_rejected', completed_at = now(), error_code = 'PROPOSED_TOTAL_MISMATCH', safe_error_message = 'Recommended option total does not match proposed total'
    where id = v_attempt_id;
    raise exception 'recommended option total does not match proposed total';
  end if;
  if (p_recommended_option_json->>'net_savings_cents')::bigint is distinct from p_net_savings_cents then
    update recommendation_generation_attempts
    set status = 'input_rejected', completed_at = now(), error_code = 'NET_SAVINGS_MISMATCH', safe_error_message = 'Recommended option savings do not match net savings'
    where id = v_attempt_id;
    raise exception 'recommended option savings do not match net savings';
  end if;
  if p_net_savings_cents is distinct from (p_current_total_cents - p_proposed_total_cents) then
    update recommendation_generation_attempts
    set status = 'input_rejected', completed_at = now(), error_code = 'NET_SAVINGS_MISMATCH', safe_error_message = 'Net savings does not equal current total minus proposed total'
    where id = v_attempt_id;
    raise exception 'net savings does not equal current total minus proposed total';
  end if;

  -- All option quote IDs must be present in the quote snapshot.
  for v_opt in select * from jsonb_array_elements(p_ranked_options_json) loop
    v_auto_quote_id := (v_opt.value->>'auto_quote_id')::uuid;
    v_property_quote_id := (v_opt.value->>'property_quote_id')::uuid;
    if not exists (
      select 1 from jsonb_array_elements(p_input_snapshot_json->'quoteSnapshot')
      where (value->>'id')::uuid in (v_auto_quote_id, v_property_quote_id)
    ) then
      update recommendation_generation_attempts
      set status = 'input_rejected', completed_at = now(), error_code = 'OPTION_QUOTE_NOT_IN_SNAPSHOT', safe_error_message = 'Option references a quote not in the snapshot'
      where id = v_attempt_id;
      raise exception 'option rank % references a quote not in snapshot', v_opt.value->>'rank';
    end if;
  end loop;

  -- Validate engine source hash if present in snapshot.
  if p_input_snapshot_json->'engineSourceHash' is not null
     and p_input_snapshot_json->>'engineSourceHash' is distinct from p_engine_source_hash then
    update recommendation_generation_attempts
    set status = 'input_rejected', completed_at = now(), error_code = 'ENGINE_SOURCE_HASH_MISMATCH', safe_error_message = 'Engine source hash does not match the snapshot'
    where id = v_attempt_id;
    raise exception 'engine source hash mismatch';
  end if;

  select coalesce(max(version), 0) + 1 into next_rec_version
  from recommendations
  where case_id = p_case_id;

  perform supersede_prior_recommendations(p_case_id);

  v_quote_ids := array[
    (p_recommended_option_json->>'auto_quote_id')::uuid,
    (p_recommended_option_json->>'property_quote_id')::uuid
  ];

  insert into recommendations (
    case_id, status, version,
    mandate_id, mandate_version, mandate_schema_version, mandate_jurisdiction,
    switching_preferences_id, switching_preferences_version,
    quote_ids, quote_snapshot,
    current_total_cents, proposed_total_cents, net_savings_cents,
    reason_codes, comparison, engine_version, disclosure_version,
    created_by, input_snapshot_json, input_snapshot_digest,
    engine_output_json, engine_output_digest, rejected_options_json
  ) values (
    p_case_id, 'awaiting_review', next_rec_version,
    p_mandate_id, p_mandate_version, p_mandate_schema_version, p_mandate_jurisdiction,
    p_switching_preferences_id, p_switching_preferences_version,
    v_quote_ids, coalesce(p_input_snapshot_json->'quoteSnapshot', '[]'::jsonb),
    p_current_total_cents, p_proposed_total_cents, p_net_savings_cents,
    p_reason_codes, p_comparison_json, p_engine_version, p_disclosure_version,
    p_actor_profile_id, p_input_snapshot_json, p_input_snapshot_digest,
    p_engine_output_json, p_engine_output_digest, p_rejected_options_json
  ) returning id into new_rec_id;

  v_rank := 1;
  for v_opt in select * from jsonb_array_elements(p_ranked_options_json) loop
    insert into recommendation_options (
      recommendation_id, rank, auto_quote_id, property_quote_id, bundled, total_cents,
      net_savings_cents, eligible, reason_codes,
      ranking_factors, preference_alignment, deductible_total_cents, underwriting_condition_count
    ) values (
      new_rec_id,
      (v_opt.value->>'rank')::int,
      (v_opt.value->>'auto_quote_id')::uuid,
      (v_opt.value->>'property_quote_id')::uuid,
      (v_opt.value->>'bundled')::boolean,
      (v_opt.value->>'total_cents')::bigint,
      (v_opt.value->>'net_savings_cents')::bigint,
      (v_opt.value->>'eligible')::boolean,
      coalesce(array(select jsonb_array_elements_text(v_opt.value->'reason_codes')), '{}'::text[]),
      v_opt.value->'ranking_factors',
      v_opt.value->'preference_alignment',
      (v_opt.value->>'deductible_total_cents')::bigint,
      (v_opt.value->>'underwriting_condition_count')::int
    );
    v_rank := v_rank + 1;
  end loop;

  update optimization_cases
  set state = 'licensed_review', updated_at = now()
  where id = p_case_id;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    p_actor_profile_id, v_actor_role, 'recommendation_generated', 'recommendation', new_rec_id, oc.household_id, p_case_id,
    jsonb_build_object(
      'recommendation_id', new_rec_id,
      'version', next_rec_version,
      'mandate_id', p_mandate_id,
      'mandate_version', p_mandate_version,
      'switching_preferences_id', p_switching_preferences_id,
      'switching_preferences_version', p_switching_preferences_version,
      'net_savings_cents', p_net_savings_cents,
      'engine_version', p_engine_version,
      'engine_source_hash', p_engine_source_hash,
      'input_snapshot_digest', p_input_snapshot_digest,
      'engine_output_digest', p_engine_output_digest,
      'actor_profile_id', p_actor_profile_id
    )
  );

  update recommendation_generation_attempts
  set status = 'completed', completed_at = now(), recommendation_id = new_rec_id, engine_output_digest = p_engine_output_digest
  where id = v_attempt_id;

  return jsonb_build_object('success', true, 'recommendationId', new_rec_id, 'version', next_rec_version, 'attemptId', v_attempt_id);
exception
  when others then
    -- Do not swallow the exception; attempt record already updated above for known errors.
    -- For unexpected errors, mark failed and re-raise.
    update recommendation_generation_attempts
    set status = 'failed', completed_at = now(), error_code = 'INTERNAL_ERROR', safe_error_message = sqlerrm
    where id = v_attempt_id;
    raise;
end;
$$;

-- Only service role may execute the internal persistence function.
revoke all on function persist_engine_recommendation_v2 from public;
revoke all on function persist_engine_recommendation_v2 from anon;
revoke all on function persist_engine_recommendation_v2 from authenticated;
grant execute on function persist_engine_recommendation_v2 to service_role;

-- Revoke direct authenticated access to the old persist_recommendation.
revoke all on function persist_recommendation(
  uuid, uuid, int, int, text, uuid, int, jsonb, text, bigint, bigint, bigint, text[], jsonb, jsonb, jsonb, text
) from public;
revoke all on function persist_recommendation(
  uuid, uuid, int, int, text, uuid, int, jsonb, text, bigint, bigint, bigint, text[], jsonb, jsonb, jsonb, text
) from anon;
revoke all on function persist_recommendation(
  uuid, uuid, int, int, text, uuid, int, jsonb, text, bigint, bigint, bigint, text[], jsonb, jsonb, jsonb, text
) from authenticated;
