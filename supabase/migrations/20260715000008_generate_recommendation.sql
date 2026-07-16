-- Server-side, atomic recommendation persistence.
-- The deterministic insurance engine still runs in the Edge Function (or another trusted compute
-- layer), but all database writes happen through this single RPC inside one transaction.

alter table recommendations
  add column if not exists quote_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists engine_version text not null default '1.0.0';

-- Mark any prior active recommendation for this case as superseded so only one is active.
create or replace function supersede_prior_recommendations(p_case_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update recommendations
  set status = 'superseded'::recommendation_status, updated_at = now()
  where case_id = p_case_id
    and status in ('draft','awaiting_review','published');
$$;

-- Prevent two concurrent generations from claiming the same version.
create unique index if not exists idx_recommendations_case_version
  on recommendations (case_id, version);

-- Atomic recommendation persistence. All validation and writes happen in one transaction.
create or replace function persist_recommendation(
  p_case_id uuid,
  p_mandate_version int,
  p_switching_version int,
  p_quote_snapshot jsonb,
  p_engine_version text,
  p_current_total_cents bigint,
  p_proposed_total_cents bigint,
  p_net_savings_cents bigint,
  p_reason_codes text[],
  p_comparison jsonb,
  p_recommended jsonb,
  p_options jsonb,
  p_disclosure_version text default 'v1'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  caller_role user_role;
  oc optimization_cases%rowtype;
  current_mandate_version int;
  current_switching_version int;
  next_rec_version int;
  new_rec_id uuid;
  opt record;
  quote_record record;
  snap record;
  snapshot_array jsonb := coalesce(p_quote_snapshot, '[]'::jsonb);
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select role into caller_role from profiles where id = caller;
  if caller_role not in ('operations', 'admin') then
    raise exception 'only operations or admins can generate recommendations';
  end if;

  -- Case must be in comparing_quotes and accessible.
  select * into oc from optimization_cases where id = p_case_id;
  if not found then raise exception 'case not found'; end if;
  if oc.state <> 'comparing_quotes' then
    raise exception 'case is not in comparing_quotes state';
  end if;
  if not can_access_case(p_case_id) then
    raise exception 'case not accessible';
  end if;

  -- Validate that coverage mandate has not changed since the engine loaded it.
  select version into current_mandate_version
  from coverage_requirements
  where household_id = oc.household_id and is_current = true;
  if current_mandate_version is distinct from p_mandate_version then
    raise exception 'mandate version changed between evaluation and persistence';
  end if;

  -- Validate that switching preferences have not changed.
  select version into current_switching_version
  from switching_preferences
  where household_id = oc.household_id and is_current = true;
  if current_switching_version is distinct from p_switching_version then
    raise exception 'switching preferences version changed between evaluation and persistence';
  end if;

  -- Validate the quote snapshot: every referenced quote must still exist and have the same updated_at.
  for snap in (select * from jsonb_array_elements(snapshot_array)) loop
    select id, updated_at into quote_record
    from quotes
    where id = (snap.value->>'id')::uuid;
    if quote_record.id is null then
      raise exception 'quote % no longer exists', snap.value->>'id';
    end if;
    if quote_record.updated_at is distinct from (snap.value->>'updated_at')::timestamptz then
      raise exception 'quote % changed since evaluation', snap.value->>'id';
    end if;
  end loop;

  -- Compute the next version for this case.
  select coalesce(max(version), 0) + 1 into next_rec_version
  from recommendations
  where case_id = p_case_id;

  -- Supersede any prior active recommendation. If a concurrent generation commits first,
  -- the unique (case_id, version) index below will make this transaction fail safely.
  perform supersede_prior_recommendations(p_case_id);

  -- Insert the recommendation.
  insert into recommendations (
    case_id,
    status,
    version,
    mandate_version,
    switching_preferences_version,
    quote_ids,
    quote_snapshot,
    current_total_cents,
    proposed_total_cents,
    net_savings_cents,
    reason_codes,
    comparison,
    engine_version,
    disclosure_version,
    created_by
  ) values (
    p_case_id,
    'awaiting_review',
    next_rec_version,
    p_mandate_version,
    p_switching_version,
    array[
      (p_recommended->>'auto_quote_id')::uuid,
      (p_recommended->>'property_quote_id')::uuid
    ],
    snapshot_array,
    p_current_total_cents,
    p_proposed_total_cents,
    p_net_savings_cents,
    p_reason_codes,
    p_comparison,
    p_engine_version,
    p_disclosure_version,
    caller
  ) returning id into new_rec_id;

  -- Insert the ranked options.
  for opt in select * from jsonb_array_elements(p_options) loop
    insert into recommendation_options (
      recommendation_id,
      rank,
      auto_quote_id,
      property_quote_id,
      bundled,
      total_cents,
      net_savings_cents,
      eligible,
      reason_codes
    ) values (
      new_rec_id,
      (opt.value->>'rank')::int,
      (opt.value->>'auto_quote_id')::uuid,
      (opt.value->>'property_quote_id')::uuid,
      (opt.value->>'bundled')::boolean,
      (opt.value->>'total_cents')::bigint,
      (opt.value->>'net_savings_cents')::bigint,
      (opt.value->>'eligible')::boolean,
      coalesce(array(select jsonb_array_elements_text(opt.value->'reason_codes')), '{}'::text[])
    );
  end loop;

  -- Transition the case to licensed_review.
  update optimization_cases
  set state = 'licensed_review', updated_at = now()
  where id = p_case_id;

  -- Audit.
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    caller, caller_role, 'recommendation_generated', 'recommendation', new_rec_id, oc.household_id, p_case_id,
    jsonb_build_object(
      'recommendation_id', new_rec_id,
      'version', next_rec_version,
      'net_savings_cents', p_net_savings_cents,
      'engine_version', p_engine_version
    )
  );

  return jsonb_build_object(
    'success', true,
    'recommendation_id', new_rec_id,
    'version', next_rec_version
  );
end $$;

grant execute on function persist_recommendation(uuid, int, int, jsonb, text, bigint, bigint, bigint, text[], jsonb, jsonb, jsonb, text) to authenticated;
