begin;

-- Capture the workflow state a case was in before it became terminal.
-- This lets the timeline render completed stages accurately instead of
-- assuming all terminal cases ended at customer_decision.
alter table optimization_cases
  add column if not exists closed_from_state case_state;

create or replace function set_optimization_case_closed_from_state()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.closed_from_state is null
    and new.state in ('completed', 'retained_incumbent', 'cancelled')
    and old.state not in ('completed', 'retained_incumbent', 'cancelled')
  then
    new.closed_from_state := old.state;
  end if;
  return new;
end;
$$;

drop trigger if exists optimization_cases_closed_from_state on optimization_cases;
create trigger optimization_cases_closed_from_state
  before update on optimization_cases
  for each row execute function set_optimization_case_closed_from_state();

-- Ensure at most one open upload batch exists per case. The Edge Function
-- also enforces this transactionally; this index provides a hard guard.
create unique index if not exists idx_one_open_batch_per_case
  on document_processing_batches (case_id)
  where status = 'uploading_files' and case_id is not null;

-- Serialize concurrent per-case batch creation in the Edge Function.
create or replace function lock_case_batch(p_case_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('case-batch-create:' || p_case_id::text, 0));
end;
$$;

revoke all on function lock_case_batch(uuid) from public, anon;
grant execute on function lock_case_batch(uuid) to authenticated, service_role;

-- Authorised server-side boundary for a customer confirming extracted details.
create or replace function confirm_customer_case_details(
  p_case_id uuid,
  p_expected_state case_state default 'awaiting_customer_confirmation'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_case optimization_cases%rowtype;
  v_expected case_state := coalesce(p_expected_state, 'awaiting_customer_confirmation');
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_case
  from optimization_cases
  where id = p_case_id
  for update;

  if v_case.id is null then
    raise exception 'Case not found';
  end if;

  if not exists (
    select 1 from households
    where id = v_case.household_id
      and owner_profile_id = v_actor
  ) and not exists (
    select 1 from household_members
    where household_id = v_case.household_id
      and profile_id = v_actor
  ) then
    raise exception 'Case does not belong to this household';
  end if;

  if v_case.state = 'ready_for_market_search' then
    return jsonb_build_object('already_confirmed', true, 'case_id', v_case.id);
  end if;

  if v_case.state <> v_expected then
    raise exception 'Case is not ready for confirmation: %', v_case.state;
  end if;

  update optimization_cases
  set state = 'ready_for_market_search',
      updated_at = now()
  where id = v_case.id;

  insert into audit_events (
    actor_profile_id, action, entity_type, entity_id, household_id, case_id,
    before_summary, after_summary
  ) values (
    v_actor,
    'customer_confirmed_extracted_information',
    'optimization_case',
    v_case.id,
    v_case.household_id,
    v_case.id,
    jsonb_build_object('state', v_case.state),
    jsonb_build_object('state', 'ready_for_market_search')
  );

  return jsonb_build_object('success', true, 'case_id', v_case.id);
end;
$$;

revoke all on function confirm_customer_case_details(uuid, case_state) from public, anon;
grant execute on function confirm_customer_case_details(uuid, case_state) to authenticated;

commit;
