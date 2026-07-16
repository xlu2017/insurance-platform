-- Remediation migration: security, workflow RPCs, constraints, audit hardening.
-- Run after 20260715000001_schema.sql and 20260715000002_rls.sql.

-- =============================== 1. signup role escalation ===============================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'customer'::user_role
  )
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function assign_staff_role(
  assigner_profile_id uuid,
  target_profile_id uuid,
  target_role user_role
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  assigner_role user_role;
  old_role user_role;
begin
  if current_user <> 'service_role' then
    raise exception 'assign_staff_role can only be invoked by the service role';
  end if;
  if target_role not in ('operations', 'reviewer', 'admin') then
    raise exception 'invalid staff role: %', target_role;
  end if;
  select role into assigner_role from profiles where id = assigner_profile_id;
  if assigner_role is null then
    raise exception 'assigner profile not found';
  end if;
  if assigner_role <> 'admin' then
    raise exception 'only admins can assign staff roles';
  end if;
  select role into old_role from profiles where id = target_profile_id;
  if old_role is null then
    raise exception 'target profile not found';
  end if;
  update profiles set role = target_role where id = target_profile_id;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, before_summary, after_summary)
  values (
    assigner_profile_id,
    'admin',
    'staff_role_assigned',
    'profile',
    target_profile_id,
    jsonb_build_object('old_role', old_role),
    jsonb_build_object('new_role', target_role)
  );
end $$;

-- =============================== 2. workflow RPCs ===============================

-- Helper: raise if caller is not a member of the recommendation's household.
create or replace function require_household_member_for_recommendation(rec_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  hid uuid;
begin
  select oc.household_id into hid
  from recommendations r
  join optimization_cases oc on oc.id = r.case_id
  where r.id = rec_id;
  if hid is null then
    raise exception 'recommendation not found';
  end if;
  if not is_household_member(hid) then
    raise exception 'recommendation does not belong to caller household';
  end if;
  return hid;
end $$;

create or replace function answer_customer_question(question_id uuid, answer text)
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
  select * into q from customer_questions where id = question_id;
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
  set status = 'answered', answer = answer, answered_by = caller, answered_at = now(), updated_at = now()
  where id = question_id;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, before_summary, after_summary)
  values (
    caller, caller_role, 'question_answered', 'customer_question', question_id, hid, q.case_id,
    jsonb_build_object('status', q.status, 'answer', q.answer),
    jsonb_build_object('status', 'answered', 'answer', answer)
  );
  return jsonb_build_object('success', true, 'question_id', question_id);
end $$;

create or replace function create_customer_support_question(case_id uuid, prompt text)
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
  if length(coalesce(prompt, '')) < 2 then raise exception 'prompt too short'; end if;
  select household_id into hid from optimization_cases where id = case_id;
  if hid is null then raise exception 'case not found'; end if;
  if not is_household_member(hid) then
    raise exception 'case does not belong to caller household';
  end if;
  select role into caller_role from profiles where id = caller;
  insert into customer_questions (case_id, question_type, status, prompt, created_by)
  values (case_id, 'short_text', 'pending', prompt, caller)
  returning id into qid;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (caller, caller_role, 'support_question_created', 'customer_question', qid, hid, case_id, jsonb_build_object('prompt', prompt));
  return jsonb_build_object('success', true, 'question_id', qid);
end $$;

create or replace function approve_customer_recommendation(
  recommendation_id uuid,
  expected_rec_version int,
  expected_mandate_version int
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
  select * into rec from recommendations where id = recommendation_id;
  if not found then raise exception 'recommendation not found'; end if;
  select * into oc from optimization_cases where id = rec.case_id;
  if oc.state <> 'customer_decision' then
    raise exception 'case is not in customer_decision state';
  end if;
  select require_household_member_for_recommendation(recommendation_id) into hid;
  if rec.status <> 'published' then
    raise exception 'recommendation is not published';
  end if;
  if rec.version <> expected_rec_version then
    raise exception 'stale recommendation version: expected %, got %', expected_rec_version, rec.version;
  end if;
  select version into current_mandate_version
  from coverage_requirements
  where household_id = hid and is_current = true;
  if current_mandate_version is distinct from expected_mandate_version then
    raise exception 'stale mandate version: expected %, got %', expected_mandate_version, coalesce(current_mandate_version, 0);
  end if;
  if exists (
    select 1 from recommendations r2
    where r2.case_id = rec.case_id and r2.version > rec.version and r2.status in ('draft','awaiting_review','published')
  ) then
    raise exception 'recommendation has been superseded';
  end if;
  if exists (
    select 1 from recommendation_approvals ra where ra.recommendation_id = recommendation_id and ra.approved = true
  ) then
    raise exception 'recommendation already approved';
  end if;
  select role into caller_role from profiles where id = caller;
  insert into recommendation_approvals (recommendation_id, approver_profile_id, approver_role, approved, notes)
  values (recommendation_id, caller, 'customer', true, 'Customer approved switch')
  returning id into approval_id;
  update recommendations set status = 'customer_approved', updated_at = now() where id = recommendation_id;
  insert into switch_events (case_id, recommendation_id, state)
  values (rec.case_id, recommendation_id, 'customer_approved')
  returning id into switch_id;
  update optimization_cases set state = 'switching', updated_at = now() where id = rec.case_id;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    caller, caller_role, 'recommendation_approved_by_customer', 'recommendation', recommendation_id, hid, rec.case_id,
    jsonb_build_object('net_savings_cents', rec.net_savings_cents, 'switch_event_id', switch_id)
  );
  return jsonb_build_object('success', true, 'approval_id', approval_id, 'switch_event_id', switch_id);
end $$;

create or replace function decline_customer_recommendation(
  recommendation_id uuid,
  expected_rec_version int,
  expected_mandate_version int
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
  select * into rec from recommendations where id = recommendation_id;
  if not found then raise exception 'recommendation not found'; end if;
  select * into oc from optimization_cases where id = rec.case_id;
  if oc.state <> 'customer_decision' then
    raise exception 'case is not in customer_decision state';
  end if;
  select require_household_member_for_recommendation(recommendation_id) into hid;
  if rec.status <> 'published' then
    raise exception 'recommendation is not published';
  end if;
  if rec.version <> expected_rec_version then
    raise exception 'stale recommendation version';
  end if;
  select version into current_mandate_version
  from coverage_requirements
  where household_id = hid and is_current = true;
  if current_mandate_version is distinct from expected_mandate_version then
    raise exception 'stale mandate version';
  end if;
  if exists (
    select 1 from recommendation_approvals ra where ra.recommendation_id = recommendation_id and ra.approved = true
  ) then
    raise exception 'recommendation already approved';
  end if;
  select role into caller_role from profiles where id = caller;
  insert into recommendation_approvals (recommendation_id, approver_profile_id, approver_role, approved, notes)
  values (recommendation_id, caller, 'customer', false, 'Customer declined switch')
  returning id into approval_id;
  update recommendations set status = 'customer_declined', updated_at = now() where id = recommendation_id;
  update optimization_cases set state = 'retained_incumbent', updated_at = now() where id = rec.case_id;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, after_summary)
  values (
    caller, caller_role, 'recommendation_declined_by_customer', 'recommendation', recommendation_id, hid, rec.case_id,
    jsonb_build_object('net_savings_cents', rec.net_savings_cents)
  );
  return jsonb_build_object('success', true, 'approval_id', approval_id);
end $$;

create or replace function review_recommendation(
  recommendation_id uuid,
  approved boolean,
  notes text
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
  select * into rec from recommendations where id = recommendation_id;
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
  insert into recommendation_approvals (recommendation_id, approver_profile_id, approver_role, approved, notes)
  values (recommendation_id, caller, caller_role, approved, coalesce(notes, ''))
  returning id into approval_id;
  update recommendations set status = case when approved then 'published' else 'rejected' end, updated_at = now()
  where id = recommendation_id;
  if approved then
    update optimization_cases set state = 'recommendation_ready', updated_at = now() where id = rec.case_id;
    update optimization_cases set state = 'customer_decision', updated_at = now() where id = rec.case_id;
  else
    update optimization_cases set state = 'comparing_quotes', updated_at = now() where id = rec.case_id;
  end if;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, before_summary, after_summary)
  values (
    caller, caller_role, case when approved then 'recommendation_published' else 'recommendation_rejected' end,
    'recommendation', recommendation_id, oc.household_id, rec.case_id,
    jsonb_build_object('status', 'awaiting_review'),
    jsonb_build_object('status', case when approved then 'published' else 'rejected' end)
  );
  return jsonb_build_object('success', true, 'approval_id', approval_id, 'published', approved);
end $$;

create or replace function advance_switch_event(
  switch_event_id uuid,
  target_state switch_state
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
  select * into se from switch_events where id = switch_event_id;
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
  if not (target_state = any(allowed)) then
    raise exception 'invalid switch transition: % -> %', se.state, target_state;
  end if;
  update switch_events set state = target_state, updated_at = now() where id = switch_event_id;
  if target_state = 'completed' then
    update optimization_cases set state = 'completed', updated_at = now() where id = se.case_id;
  end if;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, before_summary, after_summary)
  values (
    caller, caller_role, 'switch_event_advanced', 'switch_event', switch_event_id, oc.household_id, se.case_id,
    jsonb_build_object('state', se.state),
    jsonb_build_object('state', target_state)
  );
  return jsonb_build_object('success', true);
end $$;

-- =============================== 3. tighten RLS ===============================

-- Revoke authenticated insert on audit_events.
revoke insert on audit_events from authenticated;

-- Drop and recreate overly permissive policies.
drop policy if exists cases_update on optimization_cases;
create policy cases_update on optimization_cases
  for update using (is_staff() and can_access_case(id));

drop policy if exists recommendations_update on recommendations;
create policy recommendations_update on recommendations
  for update using (is_staff() and can_access_case(case_id));

drop policy if exists rec_approvals_insert on recommendation_approvals;
drop policy if exists switch_events_select on switch_events;
drop policy if exists switch_events_insert on switch_events;
drop policy if exists switch_events_update on switch_events;

create policy switch_events_select on switch_events for select using (can_access_case(case_id));
create policy switch_events_insert on switch_events for insert
  with check (is_staff() and can_access_case(case_id));
create policy switch_events_update on switch_events for update
  using (is_staff() and can_access_case(case_id));

drop policy if exists questions_update on customer_questions;
create policy questions_update on customer_questions for update
  using (is_staff() and can_access_case(case_id));

-- Document metadata: only staff may update status/extraction results.
drop policy if exists policy_documents_update on policy_documents;
create policy policy_documents_update on policy_documents for update
  using (is_staff() and can_access_household(household_id));

-- Ensure uploaded_by is always the authenticated user on insert.
create or replace function set_policy_document_uploaded_by()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.uploaded_by := auth.uid();
  return new;
end $$;

create trigger policy_documents_set_uploaded_by
  before insert on policy_documents
  for each row execute function set_policy_document_uploaded_by();

-- =============================== 4. database constraints ===============================

-- One subscription per profile.
alter table subscriptions add constraint subscriptions_profile_id_unique unique (profile_id);

-- One current coverage-requirements row per household.
 create unique index idx_coverage_requirements_one_current
   on coverage_requirements (household_id)
   where is_current = true;

-- One current switching-preferences row per household.
 create unique index idx_switching_preferences_one_current
   on switching_preferences (household_id)
   where is_current = true;

-- One approval decision per role per recommendation.
 create unique index idx_recommendation_approvals_one_per_role
   on recommendation_approvals (recommendation_id, approver_role);

-- One active (non-failed) switch event per recommendation.
 create unique index idx_switch_events_one_active
   on switch_events (recommendation_id)
   where state <> 'failed';

-- =============================== 5. stripe webhook idempotency ===============================

alter table stripe_webhook_events
  add column if not exists status text not null default 'pending',
  add column if not exists attempt_count int not null default 0,
  add column if not exists last_error text,
  add column if not exists completed_at timestamptz;

create or replace function process_stripe_event(
  p_event_id text,
  p_event_type text,
  p_profile_id uuid,
  p_status subscription_status,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_current_period_end timestamptz
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  existing stripe_webhook_events%rowtype;
  result jsonb;
begin
  select * into existing from stripe_webhook_events where id = p_event_id;
  if found and existing.status = 'completed' then
    return jsonb_build_object('success', true, 'already_processed', true);
  end if;
  insert into subscriptions (profile_id, status, stripe_customer_id, stripe_subscription_id, current_period_end)
  values (p_profile_id, p_status, p_stripe_customer_id, p_stripe_subscription_id, p_current_period_end)
  on conflict (profile_id) do update set
    status = excluded.status,
    stripe_customer_id = coalesce(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
    stripe_subscription_id = coalesce(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
    current_period_end = coalesce(excluded.current_period_end, subscriptions.current_period_end),
    updated_at = now();
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, after_summary)
  values (p_profile_id, 'customer', 'subscription_event', 'subscription', p_profile_id,
          jsonb_build_object('status', p_status, 'event_type', p_event_type));
  insert into stripe_webhook_events (id, event_type, status, attempt_count, completed_at, processed_at)
  values (p_event_id, p_event_type, 'completed', coalesce(existing.attempt_count, 0) + 1, now(), now())
  on conflict (id) do update set
    status = 'completed',
    attempt_count = stripe_webhook_events.attempt_count + 1,
    completed_at = now(),
    last_error = null;
  return jsonb_build_object('success', true);
exception when others then
  insert into stripe_webhook_events (id, event_type, status, attempt_count, last_error)
  values (p_event_id, p_event_type, 'failed', coalesce(existing.attempt_count, 0) + 1, SQLERRM)
  on conflict (id) do update set
    status = 'failed',
    attempt_count = stripe_webhook_events.attempt_count + 1,
    last_error = excluded.last_error;
  return jsonb_build_object('success', false, 'error', SQLERRM);
end $$;
