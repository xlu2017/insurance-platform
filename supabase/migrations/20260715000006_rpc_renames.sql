-- Fix ambiguous parameter/column names in RPCs and make RLS update policies explicit.

drop function if exists answer_customer_question(uuid, text);
drop function if exists create_customer_support_question(uuid, text);
drop function if exists approve_customer_recommendation(uuid, int, int);
drop function if exists decline_customer_recommendation(uuid, int, int);
drop function if exists review_recommendation(uuid, boolean, text);
drop function if exists advance_switch_event(uuid, switch_state);

create or replace function answer_customer_question(p_question_id uuid, p_answer text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  q customer_questions%rowtype;
  caller uuid := auth.uid();
  caller_role user_role;
  hid uuid;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select * into q from customer_questions where id = p_question_id;
  if not found then raise exception 'question not found'; end if;
  select oc.household_id into hid from optimization_cases oc where oc.id = q.case_id;
  if not is_household_member(hid) then
    raise exception 'question does not belong to caller household';
  end if;
  if q.status <> 'pending' then
    raise exception 'question is not pending';
  end if;
  select role into caller_role from profiles where id = caller;
  update customer_questions
  set status = 'answered'::question_status, answer = p_answer, answered_by = caller, answered_at = now(), updated_at = now()
  where id = p_question_id;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, before_summary, after_summary)
  values (
    caller, caller_role, 'question_answered', 'customer_question', p_question_id, hid, q.case_id,
    jsonb_build_object('status', q.status, 'answer', q.answer),
    jsonb_build_object('status', 'answered', 'answer', p_answer)
  );
  return jsonb_build_object('success', true, 'question_id', p_question_id);
end $$;

create or replace function create_customer_support_question(p_case_id uuid, p_prompt text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  hid uuid;
  caller uuid := auth.uid();
  caller_role user_role;
  qid uuid;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  if length(coalesce(p_prompt, '')) < 2 then raise exception 'prompt too short'; end if;
  select household_id into hid from optimization_cases where id = p_case_id;
  if hid is null then raise exception 'case not found'; end if;
  if not is_household_member(hid) then
    raise exception 'case does not belong to caller household';
  end if;
  select role into caller_role from profiles where id = caller;
  insert into customer_questions (case_id, question_type, status, prompt, created_by)
  values (p_case_id, 'short_text', 'pending', p_prompt, caller)
  returning id into qid;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (caller, caller_role, 'support_question_created', 'customer_question', qid, hid, p_case_id, jsonb_build_object('prompt', p_prompt));
  return jsonb_build_object('success', true, 'question_id', qid);
end $$;

create or replace function approve_customer_recommendation(
  p_recommendation_id uuid,
  p_expected_rec_version int,
  p_expected_mandate_version int
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
  approval_id uuid;
  switch_id uuid;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select * into rec from recommendations where id = p_recommendation_id;
  if not found then raise exception 'recommendation not found'; end if;
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
  if exists (
    select 1 from recommendation_approvals ra
    where ra.recommendation_id = p_recommendation_id and ra.approved = true
  ) then
    raise exception 'recommendation already approved';
  end if;
  select role into caller_role from profiles where id = caller;
  insert into recommendation_approvals (recommendation_id, approver_profile_id, approver_role, approved, notes)
  values (p_recommendation_id, caller, 'customer', true, 'Customer approved switch')
  returning id into approval_id;
  update recommendations set status = 'customer_approved'::recommendation_status, updated_at = now() where id = p_recommendation_id;
  insert into switch_events (case_id, recommendation_id, state)
  values (rec.case_id, p_recommendation_id, 'customer_approved')
  returning id into switch_id;
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
  p_expected_mandate_version int
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
  approval_id uuid;
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select * into rec from recommendations where id = p_recommendation_id;
  if not found then raise exception 'recommendation not found'; end if;
  select * into oc from optimization_cases where id = rec.case_id;
  if oc.state <> 'customer_decision' then
    raise exception 'case is not in customer_decision state';
  end if;
  select require_household_member_for_recommendation(p_recommendation_id) into hid;
  if rec.status <> 'published' then
    raise exception 'recommendation is not published';
  end if;
  if rec.version <> p_expected_rec_version then
    raise exception 'stale recommendation version';
  end if;
  select version into current_mandate_version
  from coverage_requirements
  where household_id = hid and is_current = true;
  if current_mandate_version is distinct from p_expected_mandate_version then
    raise exception 'stale mandate version';
  end if;
  if exists (
    select 1 from recommendation_approvals ra
    where ra.recommendation_id = p_recommendation_id and ra.approved = true
  ) then
    raise exception 'recommendation already approved';
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

create or replace function review_recommendation(
  p_recommendation_id uuid,
  p_approved boolean,
  p_notes text
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
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select role into caller_role from profiles where id = caller;
  if caller_role not in ('reviewer', 'admin') then
    raise exception 'only reviewers or admins can review recommendations';
  end if;
  select * into rec from recommendations where id = p_recommendation_id;
  if not found then raise exception 'recommendation not found'; end if;
  select * into oc from optimization_cases where id = rec.case_id;
  if oc.state <> 'licensed_review' then
    raise exception 'case is not in licensed_review state';
  end if;
  if rec.status <> 'awaiting_review' then
    raise exception 'recommendation is not awaiting review';
  end if;
  if not can_access_case(rec.case_id) then
    raise exception 'case not accessible';
  end if;
  update recommendations set status = (case when p_approved then 'published' else 'rejected' end)::recommendation_status, updated_at = now()
  where id = p_recommendation_id;
  if p_approved then
    update optimization_cases set state = 'recommendation_ready'::case_state, updated_at = now() where id = rec.case_id;
    update optimization_cases set state = 'customer_decision'::case_state, updated_at = now() where id = rec.case_id;
  else
    update optimization_cases set state = 'comparing_quotes'::case_state, updated_at = now() where id = rec.case_id;
  end if;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, before_summary, after_summary)
  values (
    caller, caller_role, case when p_approved then 'recommendation_published' else 'recommendation_rejected' end,
    'recommendation', p_recommendation_id, oc.household_id, rec.case_id,
    jsonb_build_object('status', 'awaiting_review'),
    jsonb_build_object('status', case when p_approved then 'published' else 'rejected' end)
  );
  return jsonb_build_object('success', true, 'published', p_approved);
end $$;

create or replace function advance_switch_event(
  p_switch_event_id uuid,
  p_target_state switch_state
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  se switch_events%rowtype;
  oc optimization_cases%rowtype;
  caller uuid := auth.uid();
  caller_role user_role;
  allowed switch_state[];
begin
  if caller is null then raise exception 'not authenticated'; end if;
  select role into caller_role from profiles where id = caller;
  if caller_role not in ('operations', 'admin') then
    raise exception 'only operations or admins can advance switch events';
  end if;
  select * into se from switch_events where id = p_switch_event_id;
  if not found then raise exception 'switch event not found'; end if;
  select * into oc from optimization_cases where id = se.case_id;
  if not can_access_case(se.case_id) then
    raise exception 'case not accessible';
  end if;
  allowed := case se.state
    when 'customer_approved' then array['replacement_pending','failed']::switch_state[]
    when 'replacement_pending' then array['replacement_confirmed','failed']::switch_state[]
    when 'replacement_confirmed' then array['incumbent_cancellation_pending','failed']::switch_state[]
    when 'incumbent_cancellation_pending' then array['incumbent_cancelled','failed']::switch_state[]
    when 'incumbent_cancelled' then array['completed','failed']::switch_state[]
    else array[]::switch_state[]
  end;
  if not (p_target_state = any(allowed)) then
    raise exception 'invalid switch transition: % -> %', se.state, p_target_state;
  end if;
  update switch_events set state = p_target_state, updated_at = now() where id = p_switch_event_id;
  if p_target_state = 'completed' then
    update optimization_cases set state = 'completed'::case_state, updated_at = now() where id = se.case_id;
  end if;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, before_summary, after_summary)
  values (
    caller, caller_role, 'switch_event_advanced', 'switch_event', p_switch_event_id, oc.household_id, se.case_id,
    jsonb_build_object('state', se.state),
    jsonb_build_object('state', p_target_state)
  );
  return jsonb_build_object('success', true);
end $$;

-- State-machine triggers may need to append audit rows even when the caller is unprivileged.
alter function validate_case_transition() security definer;
alter function validate_quote_request_transition() security definer;
alter function validate_quote_transition() security definer;
alter function validate_switch_transition() security definer;

-- Restrict audit events to staff and trigger/RPC paths; clients must never insert audit events directly.
drop policy if exists audit_insert on audit_events;
create policy audit_insert on audit_events for insert with check (is_staff());

-- Make update policies raise an explicit error when non-staff attempt updates they can see.
drop policy if exists cases_update on optimization_cases;
create policy cases_update on optimization_cases
  for update using (can_access_case(id)) with check (is_staff() and can_access_case(id));

drop policy if exists recommendations_update on recommendations;
create policy recommendations_update on recommendations
  for update using (can_access_case(case_id)) with check (is_staff() and can_access_case(case_id));
