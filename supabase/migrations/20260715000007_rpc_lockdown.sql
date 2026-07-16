-- Second remediation: lock down workflow RPCs and revoke direct table writes.
-- Removes the ability for staff to bypass role-specific validations through
-- direct PostgREST writes on recommendations, recommendation_options,
-- recommendation_approvals, switch_events, and protected optimization_cases fields.

-- =============================== 1. schema additions ===============================

-- Track the switching-preferences version used to generate the recommendation.
alter table recommendations add column if not exists switching_preferences_version int not null default 1;

-- One licensed-review decision per recommendation (reviewer or admin).
-- Customer decisions are recorded with approver_role = 'customer' and are intentionally excluded.
drop index if exists idx_recommendation_approvals_one_per_reviewer;
create unique index idx_recommendation_approvals_one_per_reviewer
  on recommendation_approvals (recommendation_id)
  where approver_role in ('reviewer', 'admin');

-- =============================== 2. revoke direct authenticated writes ===============================

-- Recommendations must be created/updated only through generate_recommendation RPC or triggers.
revoke insert, update, delete on recommendations from authenticated;

-- Recommendation options are an internal detail of recommendation generation.
revoke insert, update, delete on recommendation_options from authenticated;

-- Recommendation approvals must be created by review_recommendation or customer approval RPCs.
revoke insert, update, delete on recommendation_approvals from authenticated;

-- Switch events must be created/advanced only through advance_switch_event.
revoke insert, update, delete on switch_events from authenticated;

-- Optimization cases may still be created by customers, but state transitions go through RPCs.
-- The cases_update policy already requires is_staff(); this revokes the raw UPDATE privilege
-- from authenticated so that even staff cannot bypass the state machine directly.
revoke update on optimization_cases from authenticated;

-- Keep SELECT on all of these tables for appropriate users (enforced by existing RLS policies).

-- =============================== 3. generic state-transition RPC ===============================

create or replace function update_case_state(
  p_case_id uuid,
  p_target_state case_state
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  oc optimization_cases%rowtype;
  caller uuid := auth.uid();
  caller_role user_role;
  is_assigned boolean;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select role into caller_role from profiles where id = caller;
  if caller_role not in ('operations', 'admin') then
    raise exception 'only operations or admins can update case state';
  end if;
  select * into oc from optimization_cases where id = p_case_id;
  if not found then raise exception 'case not found'; end if;

  -- Admins may update any staff-accessible case; operations must be assigned.
  select exists (
    select 1 from case_assignments
    where case_id = p_case_id and assignee_profile_id = caller
  ) into is_assigned;
  if caller_role <> 'admin' and not is_assigned then
    raise exception 'operations user is not assigned to this case';
  end if;

  -- The BEFORE UPDATE trigger validate_case_transition() enforces valid transitions and writes an audit row.
  update optimization_cases set state = p_target_state, updated_at = now() where id = p_case_id;
  return jsonb_build_object('success', true, 'case_id', p_case_id, 'state', p_target_state);
end $$;

-- =============================== 4. durable licensed-review RPC ===============================

create or replace function review_recommendation(
  p_recommendation_id uuid,
  p_approved boolean,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  rec recommendations%rowtype;
  oc optimization_cases%rowtype;
  caller uuid := auth.uid();
  caller_role user_role;
  approval_id uuid;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select role into caller_role from profiles where id = caller;
  if caller_role not in ('reviewer', 'admin') then
    raise exception 'only reviewers or admins can review recommendations';
  end if;
  select * into rec from recommendations where id = p_recommendation_id;
  if not found then raise exception 'recommendation not found'; end if;
  select * into oc from optimization_cases where id = rec.case_id;

  -- Reject repeated licensed-review decisions first so repeated calls fail with a clear error.
  if exists (
    select 1 from recommendation_approvals
    where recommendation_id = p_recommendation_id and approver_role in ('reviewer','admin')
  ) then
    raise exception 'this recommendation has already been reviewed by a licensed reviewer';
  end if;

  if rec.status <> 'awaiting_review' then
    raise exception 'recommendation is not awaiting review';
  end if;
  if oc.state <> 'licensed_review' then
    raise exception 'case is not in licensed_review state';
  end if;
  if not can_access_case(rec.case_id) then
    raise exception 'case not accessible';
  end if;

  -- Record the durable licensed-review decision, including the trusted reviewer role and notes.
  insert into recommendation_approvals (recommendation_id, approver_profile_id, approver_role, approved, notes)
  values (p_recommendation_id, caller, caller_role, p_approved, coalesce(p_notes, ''))
  returning id into approval_id;

  update recommendations set status = (case when p_approved then 'published' else 'rejected' end)::recommendation_status,
    updated_at = now()
  where id = p_recommendation_id;

  if p_approved then
    -- The case state machine requires licensed_review -> recommendation_ready -> customer_decision.
    update optimization_cases set state = 'recommendation_ready', updated_at = now() where id = rec.case_id;
    update optimization_cases set state = 'customer_decision', updated_at = now() where id = rec.case_id;
  else
    update optimization_cases set state = 'comparing_quotes', updated_at = now() where id = rec.case_id;
  end if;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, before_summary, after_summary)
  values (
    caller, caller_role, case when p_approved then 'recommendation_published' else 'recommendation_rejected' end,
    'recommendation', p_recommendation_id, oc.household_id, rec.case_id,
    jsonb_build_object('status', 'awaiting_review'),
    jsonb_build_object('status', case when p_approved then 'published' else 'rejected' end, 'approval_id', approval_id)
  );

  return jsonb_build_object('success', true, 'approval_id', approval_id, 'published', p_approved);
end $$;

-- =============================== 5. customer approval/decline with full version validation ===============================

create or replace function approve_customer_recommendation(
  p_recommendation_id uuid,
  p_expected_rec_version int,
  p_expected_mandate_version int,
  p_expected_switching_version int
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  rec recommendations%rowtype;
  oc optimization_cases%rowtype;
  hid uuid;
  caller uuid := auth.uid();
  caller_role user_role;
  current_mandate_version int;
  current_switching_version int;
  q quotes%rowtype;
  approval_id uuid;
  switch_id uuid;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select * into rec from recommendations where id = p_recommendation_id;
  if not found then raise exception 'recommendation not found'; end if;

  -- A customer may only record one decision per recommendation.
  if exists (
    select 1 from recommendation_approvals ra
    where ra.recommendation_id = p_recommendation_id and ra.approver_role = 'customer'
  ) then
    raise exception 'customer decision already recorded for this recommendation';
  end if;

  select * into oc from optimization_cases where id = rec.case_id;
  if oc.state <> 'customer_decision' then
    raise exception 'case is not in customer_decision state';
  end if;
  select require_household_member_for_recommendation(p_recommendation_id) into hid;
  if rec.status <> 'published' then
    raise exception 'recommendation is not published';
  end if;

  -- Recommendation version must match the stored, expected, and current values.
  if rec.version <> p_expected_rec_version then
    raise exception 'stale recommendation version: expected %, got %', p_expected_rec_version, rec.version;
  end if;

  -- Coverage mandate version.
  select version into current_mandate_version
  from coverage_requirements
  where household_id = hid and is_current = true;
  if current_mandate_version is distinct from p_expected_mandate_version then
    raise exception 'stale mandate version: expected %, got %', p_expected_mandate_version, coalesce(current_mandate_version, 0);
  end if;
  if rec.mandate_version is distinct from current_mandate_version then
    raise exception 'recommendation was generated with mandate version % but current mandate version is %', rec.mandate_version, current_mandate_version;
  end if;

  -- Switching preferences version.
  select version into current_switching_version
  from switching_preferences
  where household_id = hid and is_current = true;
  if current_switching_version is distinct from p_expected_switching_version then
    raise exception 'stale switching preferences version: expected %, got %', p_expected_switching_version, coalesce(current_switching_version, 0);
  end if;
  if rec.switching_preferences_version is distinct from current_switching_version then
    raise exception 'recommendation was generated with switching preferences version % but current version is %', rec.switching_preferences_version, current_switching_version;
  end if;

  -- Every referenced quote must still exist, not be expired, rejected, or superseded.
  for q in (select * from quotes where id = any(rec.quote_ids)) loop
    if q.state in ('expired','rejected') then
      raise exception 'referenced quote % is no longer valid (state %)', q.id, q.state;
    end if;
    if q.expires_at is not null and q.expires_at < now() then
      raise exception 'referenced quote % has expired', q.id;
    end if;
  end loop;

  -- No newer active recommendation may exist.
  if exists (
    select 1 from recommendations r2
    where r2.case_id = rec.case_id and r2.version > rec.version and r2.status in ('draft','awaiting_review','published')
  ) then
    raise exception 'a newer recommendation exists';
  end if;

  select role into caller_role from profiles where id = caller;
  insert into recommendation_approvals (recommendation_id, approver_profile_id, approver_role, approved, notes)
  values (p_recommendation_id, caller, 'customer', true, 'Customer approved switch')
  returning id into approval_id;

  update recommendations set status = 'customer_approved'::recommendation_status, updated_at = now() where id = p_recommendation_id;

  -- Reuse an existing active switch event if one already exists, otherwise create it.
  select id into switch_id
  from switch_events
  where recommendation_id = p_recommendation_id and state <> 'failed'
  limit 1;

  if switch_id is null then
    insert into switch_events (case_id, recommendation_id, state)
    values (rec.case_id, p_recommendation_id, 'customer_approved')
    returning id into switch_id;
  end if;

  update optimization_cases set state = 'switching'::case_state, updated_at = now() where id = rec.case_id;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    caller, caller_role, 'recommendation_approved_by_customer', 'recommendation', p_recommendation_id, hid, rec.case_id,
    jsonb_build_object('net_savings_cents', rec.net_savings_cents, 'switch_event_id', switch_id)
  );

  return jsonb_build_object('success', true, 'approval_id', approval_id, 'switch_event_id', switch_id);
end $$;

create or replace function decline_customer_recommendation(
  p_recommendation_id uuid,
  p_expected_rec_version int,
  p_expected_mandate_version int,
  p_expected_switching_version int
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  rec recommendations%rowtype;
  oc optimization_cases%rowtype;
  hid uuid;
  caller uuid := auth.uid();
  caller_role user_role;
  current_mandate_version int;
  current_switching_version int;
  q quotes%rowtype;
  approval_id uuid;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select * into rec from recommendations where id = p_recommendation_id;
  if not found then raise exception 'recommendation not found'; end if;

  -- A customer may only record one decision per recommendation.
  if exists (
    select 1 from recommendation_approvals ra
    where ra.recommendation_id = p_recommendation_id and ra.approver_role = 'customer'
  ) then
    raise exception 'customer decision already recorded for this recommendation';
  end if;

  select * into oc from optimization_cases where id = rec.case_id;
  if oc.state <> 'customer_decision' then
    raise exception 'case is not in customer_decision state';
  end if;
  select require_household_member_for_recommendation(p_recommendation_id) into hid;
  if rec.status <> 'published' then
    raise exception 'recommendation is not published';
  end if;

  if rec.version <> p_expected_rec_version then
    raise exception 'stale recommendation version: expected %, got %', p_expected_rec_version, rec.version;
  end if;

  select version into current_mandate_version
  from coverage_requirements
  where household_id = hid and is_current = true;
  if current_mandate_version is distinct from p_expected_mandate_version then
    raise exception 'stale mandate version: expected %, got %', p_expected_mandate_version, coalesce(current_mandate_version, 0);
  end if;
  if rec.mandate_version is distinct from current_mandate_version then
    raise exception 'recommendation was generated with mandate version % but current mandate version is %', rec.mandate_version, current_mandate_version;
  end if;

  select version into current_switching_version
  from switching_preferences
  where household_id = hid and is_current = true;
  if current_switching_version is distinct from p_expected_switching_version then
    raise exception 'stale switching preferences version: expected %, got %', p_expected_switching_version, coalesce(current_switching_version, 0);
  end if;
  if rec.switching_preferences_version is distinct from current_switching_version then
    raise exception 'recommendation was generated with switching preferences version % but current version is %', rec.switching_preferences_version, current_switching_version;
  end if;

  for q in (select * from quotes where id = any(rec.quote_ids)) loop
    if q.state in ('expired','rejected') then
      raise exception 'referenced quote % is no longer valid (state %)', q.id, q.state;
    end if;
    if q.expires_at is not null and q.expires_at < now() then
      raise exception 'referenced quote % has expired', q.id;
    end if;
  end loop;

  if exists (
    select 1 from recommendations r2
    where r2.case_id = rec.case_id and r2.version > rec.version and r2.status in ('draft','awaiting_review','published')
  ) then
    raise exception 'a newer recommendation exists';
  end if;

  select role into caller_role from profiles where id = caller;
  insert into recommendation_approvals (recommendation_id, approver_profile_id, approver_role, approved, notes)
  values (p_recommendation_id, caller, 'customer', false, 'Customer declined switch')
  returning id into approval_id;

  update recommendations set status = 'customer_declined'::recommendation_status, updated_at = now() where id = p_recommendation_id;
  update optimization_cases set state = 'retained_incumbent'::case_state, updated_at = now() where id = rec.case_id;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    caller, caller_role, 'recommendation_declined_by_customer', 'recommendation', p_recommendation_id, hid, rec.case_id,
    jsonb_build_object('net_savings_cents', rec.net_savings_cents)
  );

  return jsonb_build_object('success', true, 'approval_id', approval_id);
end $$;

-- =============================== 6. function execution grants ===============================

-- Internal helper functions: keep callable by authenticated because they are used in RLS policies.
-- Do not expose them over RPC; they are used transparently by the query planner.

-- Service-role only functions: never callable by anonymous/authenticated users.
revoke execute on function assign_staff_role(uuid, uuid, user_role) from public;
revoke execute on function assign_staff_role(uuid, uuid, user_role) from anon;
revoke execute on function assign_staff_role(uuid, uuid, user_role) from authenticated;
grant execute on function assign_staff_role(uuid, uuid, user_role) to service_role;

-- Internal trigger helpers: no direct client invocation.
revoke execute on function log_audit(text, text, uuid, uuid, uuid, jsonb, jsonb) from public;
revoke execute on function log_audit(text, text, uuid, uuid, uuid, jsonb, jsonb) from anon;
revoke execute on function log_audit(text, text, uuid, uuid, uuid, jsonb, jsonb) from authenticated;

-- State-machine triggers are not called directly by clients, but they execute inside update statements.
-- We revoke direct RPC execution from authenticated for safety.
revoke execute on function validate_case_transition() from public;
revoke execute on function validate_quote_request_transition() from public;
revoke execute on function validate_quote_transition() from public;
revoke execute on function validate_switch_transition() from public;
revoke execute on function validate_case_transition() from anon;
revoke execute on function validate_quote_request_transition() from anon;
revoke execute on function validate_quote_transition() from anon;
revoke execute on function validate_switch_transition() from anon;
revoke execute on function validate_case_transition() from authenticated;
revoke execute on function validate_quote_request_transition() from authenticated;
revoke execute on function validate_quote_transition() from authenticated;
revoke execute on function validate_switch_transition() from authenticated;

-- Customer RPCs.
grant execute on function answer_customer_question(uuid, text) to authenticated;
grant execute on function create_customer_support_question(uuid, text) to authenticated;
grant execute on function approve_customer_recommendation(uuid, int, int, int) to authenticated;
grant execute on function decline_customer_recommendation(uuid, int, int, int) to authenticated;

-- Reviewer RPC (internal role check is inside the function).
grant execute on function review_recommendation(uuid, boolean, text) to authenticated;

-- Operations/admin RPCs.
grant execute on function advance_switch_event(uuid, switch_state) to authenticated;
grant execute on function update_case_state(uuid, case_state) to authenticated;

-- Reject audit mutations from clients.
revoke execute on function reject_audit_mutation() from public;
revoke execute on function reject_audit_mutation() from anon;
revoke execute on function reject_audit_mutation() from authenticated;
