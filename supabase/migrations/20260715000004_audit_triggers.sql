-- Additional audit triggers so clients never need to insert audit_events directly.

-- =============================== helpers ===============================

create or replace function audit_context()
returns table(actor_id uuid, actor_role user_role)
language sql
security definer set search_path = public
as $$
  select auth.uid(), (select role from profiles where id = auth.uid());
$$;

create or replace function log_audit(
  action text,
  entity_type text,
  entity_id uuid,
  household_id uuid,
  case_id uuid,
  before_summary jsonb,
  after_summary jsonb
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  ctx record;
begin
  select * into ctx from audit_context();
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, case_id, before_summary, after_summary)
  values (ctx.actor_id, ctx.actor_role, action, entity_type, entity_id, household_id, case_id, before_summary, after_summary);
end $$;

-- =============================== policy documents ===============================

create or replace function audit_policy_document_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform log_audit(
    'policy_document_uploaded',
    'policy_document',
    new.id,
    new.household_id,
    null,
    null,
    jsonb_build_object('category', new.category, 'file_name', new.file_name)
  );
  return new;
end $$;

create trigger policy_documents_audit_insert
  after insert on policy_documents
  for each row execute function audit_policy_document_insert();

-- =============================== households ===============================

create or replace function set_household_updated_by()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger households_set_updated_by
  before update on households
  for each row execute function set_household_updated_by();

create or replace function audit_household_changes()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  after jsonb;
  before jsonb;
  action text;
begin
  if old.autopilot_active is distinct from new.autopilot_active then
    action := case when new.autopilot_active then 'autopilot_resumed' else 'autopilot_paused' end;
    perform log_audit(action, 'household', new.id, new.id, null,
      jsonb_build_object('autopilot_active', old.autopilot_active),
      jsonb_build_object('autopilot_active', new.autopilot_active));
  end if;
  if old.onboarding_step is distinct from new.onboarding_step then
    perform log_audit('onboarding_step_changed', 'household', new.id, new.id, null,
      jsonb_build_object('onboarding_step', old.onboarding_step),
      jsonb_build_object('onboarding_step', new.onboarding_step));
  end if;
  return new;
end $$;

create trigger households_audit_update
  after update on households
  for each row execute function audit_household_changes();

-- =============================== coverage requirements ===============================

create or replace function set_coverage_requirements_updated_by()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger coverage_requirements_set_updated_by
  before update on coverage_requirements
  for each row execute function set_coverage_requirements_updated_by();

create or replace function audit_coverage_requirements_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform log_audit(
    case when TG_OP = 'INSERT' then 'coverage_requirements_created' else 'coverage_requirements_updated' end,
    'coverage_requirements',
    new.id,
    new.household_id,
    null,
    case when TG_OP = 'UPDATE' then jsonb_build_object('version', old.version) else null end,
    jsonb_build_object('version', new.version)
  );
  return new;
end $$;

create trigger coverage_requirements_audit
  after insert or update on coverage_requirements
  for each row execute function audit_coverage_requirements_change();

-- =============================== switching preferences ===============================

create or replace function set_switching_preferences_updated_by()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger switching_preferences_set_updated_by
  before update on switching_preferences
  for each row execute function set_switching_preferences_updated_by();

create or replace function audit_switching_preferences_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform log_audit(
    case when TG_OP = 'INSERT' then 'switching_preferences_created' else 'switching_preferences_updated' end,
    'switching_preferences',
    new.id,
    new.household_id,
    null,
    case when TG_OP = 'UPDATE' then jsonb_build_object('version', old.version) else null end,
    jsonb_build_object('version', new.version)
  );
  return new;
end $$;

create trigger switching_preferences_audit
  after insert or update on switching_preferences
  for each row execute function audit_switching_preferences_change();

-- =============================== customer questions ===============================

create or replace function set_customer_questions_created_by()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger customer_questions_set_created_by
  before insert on customer_questions
  for each row execute function set_customer_questions_created_by();

create or replace function audit_customer_question_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform log_audit(
    'customer_question_created',
    'customer_question',
    new.id,
    (select household_id from optimization_cases where id = new.case_id),
    new.case_id,
    null,
    jsonb_build_object('question_type', new.question_type, 'prompt', new.prompt)
  );
  return new;
end $$;

create trigger customer_questions_audit_insert
  after insert on customer_questions
  for each row execute function audit_customer_question_insert();
