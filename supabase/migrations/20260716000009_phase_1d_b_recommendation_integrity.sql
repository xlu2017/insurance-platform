-- Corrective Phase 1D-B: durable generation attempts, component-level option
-- identities, deterministic digest verification, and obsolete RPC removal.

-- =============================================================================
-- 1. Cryptographic helpers for in-database digest verification
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- 2. Recommendation option component identities
-- =============================================================================

alter table recommendation_options
  add column if not exists auto_component_id uuid,
  add column if not exists property_component_id uuid,
  add column if not exists auto_asset_id uuid,
  add column if not exists property_asset_id uuid;

-- =============================================================================
-- 3. Digest format validation
-- =============================================================================

alter table recommendations
  drop constraint if exists recommendations_input_snapshot_digest_check,
  add constraint recommendations_input_snapshot_digest_check
    check (input_snapshot_digest is null or input_snapshot_digest ~ '^[0-9a-f]{64}$');

alter table recommendations
  drop constraint if exists recommendations_engine_output_digest_check,
  add constraint recommendations_engine_output_digest_check
    check (engine_output_digest is null or engine_output_digest ~ '^[0-9a-f]{64}$');

-- =============================================================================
-- 4. Durable attempt status constraint
-- =============================================================================

alter table recommendation_generation_attempts
  drop constraint if exists recommendation_generation_attempts_status_check;

alter table recommendation_generation_attempts
  add constraint recommendation_generation_attempts_status_check
    check (status in ('started', 'input_rejected', 'no_eligible_option', 'persistence_conflict', 'completed', 'failed'));

-- =============================================================================
-- 5. Remove obsolete recommendation persistence function and all overloads
-- =============================================================================

do $$
declare
  fn record;
begin
  for fn in
    select oid::regprocedure::text as proc
    from pg_proc
    where proname = 'persist_recommendation'
  loop
    execute format('drop function if exists %s cascade', fn.proc);
  end loop;
end $$;

-- =============================================================================
-- 6. Durable attempt lifecycle functions (outside persistence transaction)
-- =============================================================================

create or replace function start_recommendation_generation_attempt(
  p_case_id uuid,
  p_actor_profile_id uuid,
  p_mandate_id uuid,
  p_mandate_version int,
  p_switching_preferences_id uuid,
  p_switching_preferences_version int,
  p_engine_version text,
  p_engine_source_hash text,
  p_input_snapshot_digest text
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_attempt_id uuid := gen_random_uuid();
  v_actor_role user_role;
begin
  if current_setting('request.jwt.claims', true)::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Only service_role may start recommendation generation attempts';
  end if;

  select role into v_actor_role from profiles where id = p_actor_profile_id;
  if v_actor_role is null or v_actor_role not in ('operations', 'admin') then
    raise exception 'actor must be operations or admin';
  end if;

  if not can_access_case_for_profile(p_case_id, p_actor_profile_id) then
    raise exception 'actor cannot access case';
  end if;

  insert into recommendation_generation_attempts (
    id, case_id, actor_profile_id, started_at, status,
    mandate_id, mandate_version, switching_preferences_id, switching_preferences_version,
    engine_version, engine_source_hash, input_snapshot_digest
  ) values (
    v_attempt_id, p_case_id, p_actor_profile_id, now(), 'started',
    p_mandate_id, p_mandate_version, p_switching_preferences_id, p_switching_preferences_version,
    p_engine_version, p_engine_source_hash, p_input_snapshot_digest
  );

  return v_attempt_id;
end;
$$;

create or replace function complete_recommendation_generation_attempt(
  p_attempt_id uuid,
  p_status text,
  p_recommendation_id uuid default null,
  p_engine_output_digest text default null,
  p_error_code text default null,
  p_safe_error_message text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_valid_statuses text[] := array['input_rejected', 'no_eligible_option', 'persistence_conflict', 'completed'];
begin
  if current_setting('request.jwt.claims', true)::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Only service_role may complete recommendation generation attempts';
  end if;

  if not (p_status = any(v_valid_statuses)) then
    raise exception 'invalid completion status: %', p_status;
  end if;

  update recommendation_generation_attempts
  set
    status = p_status,
    completed_at = now(),
    recommendation_id = p_recommendation_id,
    engine_output_digest = p_engine_output_digest,
    error_code = p_error_code,
    safe_error_message = left(p_safe_error_message, 4000)
  where id = p_attempt_id;
end;
$$;

create or replace function fail_recommendation_generation_attempt(
  p_attempt_id uuid,
  p_error_code text default 'INTERNAL_ERROR',
  p_safe_error_message text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if current_setting('request.jwt.claims', true)::jsonb->>'role' is distinct from 'service_role' then
    raise exception 'Only service_role may fail recommendation generation attempts';
  end if;

  update recommendation_generation_attempts
  set
    status = 'failed',
    completed_at = now(),
    error_code = p_error_code,
    safe_error_message = left(p_safe_error_message, 4000)
  where id = p_attempt_id;
end;
$$;

-- =============================================================================
-- 7. Re-create internal recommendation persistence with digest verification
--    and component-level snapshot integrity.
-- =============================================================================

drop function if exists persist_engine_recommendation_v2;

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
  p_input_snapshot_canonical text,
  p_input_snapshot_digest text,
  p_engine_version text,
  p_engine_source_hash text,
  p_engine_output_json jsonb,
  p_engine_output_canonical text,
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
  v_caller_role text;
  v_actor_role user_role;
  oc optimization_cases%rowtype;
  current_mandate record;
  current_switching record;
  next_rec_version int;
  new_rec_id uuid;
  v_snap record;
  v_quote_record record;
  v_opt record;
  v_top_option jsonb;
  v_auto_quote_id uuid;
  v_property_quote_id uuid;
  v_snapshot_quote_ids uuid[];
  v_input_digest_computed text;
  v_output_digest_computed text;
  v_incumbent_count int;
begin
  -- Only service_role should be able to call this function; the grant enforces that.
  -- We still reject a non-service-role JWT if one somehow reaches here.
  v_caller_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  if v_caller_role is not null and v_caller_role <> 'service_role' then
    raise exception 'Only service_role may call persist_engine_recommendation_v2';
  end if;

  -- Verify actor exists and is operations or admin.
  select role into v_actor_role from profiles where id = p_actor_profile_id;
  if v_actor_role is null or v_actor_role not in ('operations', 'admin') then
    raise exception 'actor must be operations or admin';
  end if;

  -- Verify case exists, is in the right state, and actor can access it.
  select * into oc from optimization_cases where id = p_case_id;
  if not found then
    raise exception 'case not found';
  end if;

  if oc.state not in ('comparing_quotes', 'customer_decision') then
    raise exception 'case is not in comparing_quotes or customer_decision';
  end if;

  if not can_access_case_for_profile(p_case_id, p_actor_profile_id) then
    raise exception 'actor cannot access case';
  end if;

  -- Verify current mandate and switching preferences.
  select * into current_mandate
  from household_coverage_mandates
  where id = p_mandate_id and household_id = oc.household_id and is_current = true
  for update;
  if not found then
    raise exception 'mandate % is not current for this household', p_mandate_id;
  end if;
  if current_mandate.version is distinct from p_mandate_version then
    raise exception 'mandate version changed between evaluation and persistence';
  end if;
  if current_mandate.schema_version is distinct from p_mandate_schema_version then
    raise exception 'mandate schema version mismatch';
  end if;
  if current_mandate.jurisdiction is distinct from p_mandate_jurisdiction then
    raise exception 'mandate jurisdiction mismatch';
  end if;

  select * into current_switching
  from switching_preferences
  where id = p_switching_preferences_id and household_id = oc.household_id and is_current = true
  for update;
  if not found then
    raise exception 'switching preferences % are not current for this household', p_switching_preferences_id;
  end if;
  if current_switching.version is distinct from p_switching_preferences_version then
    raise exception 'switching preferences version changed between evaluation and persistence';
  end if;

  -- Snapshot presence and emptiness.
  if p_input_snapshot_json is null or p_input_snapshot_json->'quoteSnapshot' is null then
    raise exception 'input snapshot is missing quote snapshot';
  end if;

  if jsonb_array_length(coalesce(p_input_snapshot_json->'quoteSnapshot', '[]'::jsonb)) = 0 then
    raise exception 'quote snapshot is empty';
  end if;

  -- Verify recomputed digests match the supplied digests.
  v_input_digest_computed := encode(digest(p_input_snapshot_canonical::bytea, 'sha256'), 'hex');
  if v_input_digest_computed is distinct from p_input_snapshot_digest then
    raise exception 'input snapshot digest mismatch';
  end if;

  v_output_digest_computed := encode(digest(p_engine_output_canonical::bytea, 'sha256'), 'hex');
  if v_output_digest_computed is distinct from p_engine_output_digest then
    raise exception 'engine output digest mismatch';
  end if;

  -- Build sorted list of snapshot quote ids and reject duplicates.
  select array_agg((value->>'id')::uuid order by value->>'id')
  into v_snapshot_quote_ids
  from jsonb_array_elements(p_input_snapshot_json->'quoteSnapshot');

  if exists (
    select 1
    from unnest(v_snapshot_quote_ids) qid
    group by qid
    having count(*) > 1
  ) then
    raise exception 'duplicate quote id in snapshot';
  end if;

  -- Snapshot quotes must belong to the case and be unchanged.
  for v_snap in select * from jsonb_array_elements(p_input_snapshot_json->'quoteSnapshot') loop
    select id, updated_at into v_quote_record
    from quotes
    where id = (v_snap.value->>'id')::uuid and case_id = p_case_id;
    if v_quote_record.id is null then
      raise exception 'quote % in snapshot does not belong to this case or no longer exists', v_snap.value->>'id';
    end if;
    if v_quote_record.updated_at::text is distinct from (v_snap.value->>'updated_at') then
      raise exception 'quote % changed since evaluation', v_snap.value->>'id';
    end if;
  end loop;

  -- Exactly one incumbent in the snapshot.
  select count(*) into v_incumbent_count
  from jsonb_array_elements(p_input_snapshot_json->'quoteSnapshot')
  where (value->>'is_incumbent')::boolean = true;

  if v_incumbent_count is distinct from 1 then
    raise exception 'snapshot must contain exactly one incumbent quote';
  end if;

  -- Validate ranked options.
  if p_ranked_options_json is null or jsonb_array_length(p_ranked_options_json) = 0 then
    raise exception 'ranked options are empty';
  end if;

  if p_recommended_option_json is null then
    raise exception 'recommended option is missing';
  end if;

  if (p_recommended_option_json->>'rank')::int is distinct from 1 then
    raise exception 'recommended option must be rank 1';
  end if;

  v_top_option := p_ranked_options_json->0;
  if (v_top_option->>'auto_quote_id') is distinct from (p_recommended_option_json->>'auto_quote_id')
     or (v_top_option->>'property_quote_id') is distinct from (p_recommended_option_json->>'property_quote_id')
     or (v_top_option->>'total_cents')::bigint is distinct from (p_recommended_option_json->>'total_cents')::bigint then
    raise exception 'top ranked option does not match recommended option';
  end if;

  -- Ranks must be contiguous, unique, and start at 1.
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
      raise exception 'ranked option ranks are not contiguous starting at 1';
    end if;
  end;

  -- Validate each option.
  for v_opt in select * from jsonb_array_elements(p_ranked_options_json) loop
    if (v_opt.value->>'eligible')::boolean = false and (v_opt.value->>'rank')::int = 1 then
      raise exception 'recommended option is ineligible';
    end if;

    if (v_opt.value->>'total_cents')::bigint < 0 then
      raise exception 'option total cannot be negative';
    end if;

    if (v_opt.value->>'net_savings_cents')::bigint is distinct from (p_current_total_cents - (v_opt.value->>'total_cents')::bigint) then
      raise exception 'net savings mismatch for option rank %', v_opt.value->>'rank';
    end if;

    v_auto_quote_id := (v_opt.value->>'auto_quote_id')::uuid;
    v_property_quote_id := (v_opt.value->>'property_quote_id')::uuid;

    if not (v_auto_quote_id = any(v_snapshot_quote_ids)) then
      raise exception 'option rank % auto quote not in snapshot', v_opt.value->>'rank';
    end if;
    if not (v_property_quote_id = any(v_snapshot_quote_ids)) then
      raise exception 'option rank % property quote not in snapshot', v_opt.value->>'rank';
    end if;

    if v_opt.value->>'auto_component_id' is null or v_opt.value->>'property_component_id' is null then
      raise exception 'option rank % is missing component ids', v_opt.value->>'rank';
    end if;
  end loop;

  if (p_recommended_option_json->>'total_cents')::bigint is distinct from p_proposed_total_cents then
    raise exception 'recommended option total does not match proposed total';
  end if;
  if (p_recommended_option_json->>'net_savings_cents')::bigint is distinct from p_net_savings_cents then
    raise exception 'recommended option savings do not match net savings';
  end if;
  if p_net_savings_cents is distinct from (p_current_total_cents - p_proposed_total_cents) then
    raise exception 'net savings does not equal current total minus proposed total';
  end if;

  select coalesce(max(version), 0) + 1 into next_rec_version
  from recommendations
  where case_id = p_case_id;

  perform supersede_prior_recommendations(p_case_id);

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
    array[
      (p_recommended_option_json->>'auto_quote_id')::uuid,
      (p_recommended_option_json->>'property_quote_id')::uuid
    ],
    coalesce(p_input_snapshot_json->'quoteSnapshot', '[]'::jsonb),
    p_current_total_cents, p_proposed_total_cents, p_net_savings_cents,
    p_reason_codes, p_comparison_json, p_engine_version, p_disclosure_version,
    p_actor_profile_id, p_input_snapshot_json, p_input_snapshot_digest,
    p_engine_output_json, p_engine_output_digest, p_rejected_options_json
  ) returning id into new_rec_id;

  for v_opt in select * from jsonb_array_elements(p_ranked_options_json) loop
    insert into recommendation_options (
      recommendation_id, rank,
      auto_quote_id, property_quote_id,
      auto_component_id, property_component_id,
      auto_asset_id, property_asset_id,
      bundled, total_cents, net_savings_cents, eligible, reason_codes,
      ranking_factors, preference_alignment, deductible_total_cents, underwriting_condition_count
    ) values (
      new_rec_id,
      (v_opt.value->>'rank')::int,
      (v_opt.value->>'auto_quote_id')::uuid,
      (v_opt.value->>'property_quote_id')::uuid,
      (v_opt.value->>'auto_component_id')::uuid,
      (v_opt.value->>'property_component_id')::uuid,
      (v_opt.value->>'auto_asset_id')::uuid,
      (v_opt.value->>'property_asset_id')::uuid,
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

  return jsonb_build_object('success', true, 'recommendationId', new_rec_id, 'version', next_rec_version);
end;
$$;

-- =============================================================================
-- 8. Function grants
-- =============================================================================

revoke all on function start_recommendation_generation_attempt from public;
revoke all on function start_recommendation_generation_attempt from anon;
revoke all on function start_recommendation_generation_attempt from authenticated;
grant execute on function start_recommendation_generation_attempt to service_role;

revoke all on function complete_recommendation_generation_attempt from public;
revoke all on function complete_recommendation_generation_attempt from anon;
revoke all on function complete_recommendation_generation_attempt from authenticated;
grant execute on function complete_recommendation_generation_attempt to service_role;

revoke all on function fail_recommendation_generation_attempt from public;
revoke all on function fail_recommendation_generation_attempt from anon;
revoke all on function fail_recommendation_generation_attempt from authenticated;
grant execute on function fail_recommendation_generation_attempt to service_role;

revoke all on function persist_engine_recommendation_v2 from public;
revoke all on function persist_engine_recommendation_v2 from anon;
revoke all on function persist_engine_recommendation_v2 from authenticated;
grant execute on function persist_engine_recommendation_v2 to service_role;
