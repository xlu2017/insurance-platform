-- Allow a new recommendation to be generated when the customer has changed the
-- mandate after a previous recommendation was already published. This keeps
-- the V2 mandate as the source of truth without requiring the customer to
-- remain locked to a stale recommendation.

create or replace function validate_case_transition()
returns trigger language plpgsql as $$
declare allowed case_state[];
begin
  if old.state = new.state then return new; end if;
  allowed := case old.state
    when 'draft' then array['awaiting_documents','cancelled']::case_state[]
    when 'awaiting_documents' then array['extracting_information','cancelled']::case_state[]
    when 'extracting_information' then array['awaiting_customer_confirmation','awaiting_documents','cancelled']::case_state[]
    when 'awaiting_customer_confirmation' then array['ready_for_market_search','extracting_information','cancelled']::case_state[]
    when 'ready_for_market_search' then array['requesting_quotes','cancelled']::case_state[]
    when 'requesting_quotes' then array['awaiting_quotes','cancelled']::case_state[]
    when 'awaiting_quotes' then array['comparing_quotes','requesting_quotes','cancelled']::case_state[]
    when 'comparing_quotes' then array['licensed_review','awaiting_quotes','retained_incumbent','cancelled']::case_state[]
    when 'licensed_review' then array['recommendation_ready','comparing_quotes','cancelled']::case_state[]
    when 'recommendation_ready' then array['customer_decision','cancelled']::case_state[]
    when 'customer_decision' then array['switching','retained_incumbent','licensed_review','cancelled']::case_state[]
    when 'switching' then array['completed','cancelled']::case_state[]
    else array[]::case_state[]
  end;
  if not (new.state = any(allowed)) then
    raise exception 'Invalid case transition: % -> %', old.state, new.state;
  end if;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, before_summary, after_summary)
  values (auth.uid(), (select role from profiles where id = auth.uid()), 'case_state_transition', 'optimization_case', new.id, new.household_id, new.id,
          jsonb_build_object('state', old.state), jsonb_build_object('state', new.state));
  return new;
end $$;

create or replace function persist_recommendation(
  p_case_id uuid,
  p_mandate_id uuid,
  p_mandate_version int,
  p_mandate_schema_version int,
  p_mandate_jurisdiction text,
  p_switching_preferences_id uuid,
  p_switching_preferences_version int,
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
  current_mandate record;
  current_switching record;
  next_rec_version int;
  new_rec_id uuid;
  opt record;
  snap record;
  quote_record record;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select role into caller_role from profiles where id = caller;
  if caller_role not in ('operations', 'admin') then
    raise exception 'only operations or admins can generate recommendations';
  end if;

  select * into oc from optimization_cases where id = p_case_id;
  if not found then raise exception 'case not found'; end if;
  if oc.state not in ('comparing_quotes', 'customer_decision') then
    raise exception 'case is not in a state that allows recommendation generation';
  end if;
  if not can_access_case(p_case_id) then
    raise exception 'case not accessible';
  end if;

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

  for snap in (select * from jsonb_array_elements(coalesce(p_quote_snapshot, '[]'::jsonb))) loop
    select id, updated_at into quote_record
    from quotes
    where id = (snap.value->>'id')::uuid and case_id = p_case_id;
    if quote_record.id is null then
      raise exception 'quote % no longer exists in this case', snap.value->>'id';
    end if;
    if quote_record.updated_at is distinct from (snap.value->>'updated_at')::timestamptz then
      raise exception 'quote % changed since evaluation', snap.value->>'id';
    end if;
  end loop;

  select coalesce(max(version), 0) + 1 into next_rec_version
  from recommendations
  where case_id = p_case_id;

  perform supersede_prior_recommendations(p_case_id);

  insert into recommendations (
    case_id, status, version,
    mandate_id, mandate_version, mandate_schema_version, mandate_jurisdiction,
    switching_preferences_id, switching_preferences_version,
    quote_ids, quote_snapshot, current_total_cents, proposed_total_cents, net_savings_cents,
    reason_codes, comparison, engine_version, disclosure_version, created_by
  ) values (
    p_case_id, 'awaiting_review', next_rec_version,
    p_mandate_id, p_mandate_version, p_mandate_schema_version, p_mandate_jurisdiction,
    p_switching_preferences_id, p_switching_preferences_version,
    array[
      (p_recommended->>'auto_quote_id')::uuid,
      (p_recommended->>'property_quote_id')::uuid
    ],
    coalesce(p_quote_snapshot, '[]'::jsonb),
    p_current_total_cents, p_proposed_total_cents, p_net_savings_cents,
    p_reason_codes, p_comparison, p_engine_version, p_disclosure_version, caller
  ) returning id into new_rec_id;

  for opt in select * from jsonb_array_elements(p_options) loop
    insert into recommendation_options (
      recommendation_id, rank, auto_quote_id, property_quote_id, bundled, total_cents,
      net_savings_cents, eligible, reason_codes
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

  update optimization_cases
  set state = 'licensed_review', updated_at = now()
  where id = p_case_id;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    caller, caller_role, 'recommendation_generated', 'recommendation', new_rec_id, oc.household_id, p_case_id,
    jsonb_build_object(
      'recommendation_id', new_rec_id,
      'version', next_rec_version,
      'mandate_id', p_mandate_id,
      'mandate_version', p_mandate_version,
      'mandate_schema_version', p_mandate_schema_version,
      'mandate_jurisdiction', p_mandate_jurisdiction,
      'switching_preferences_id', p_switching_preferences_id,
      'switching_preferences_version', p_switching_preferences_version
    )
  );

  return jsonb_build_object(
    'recommendationId', new_rec_id,
    'version', next_rec_version,
    'status', 'awaiting_review'
  );
end;
$$;
