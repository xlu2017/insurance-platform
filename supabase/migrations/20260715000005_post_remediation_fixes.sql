-- Post-remediation tweaks: correct role checks, ownership fields, and quote-request audit support.

-- assign_staff_role should check the JWT role, not the Postgres connection role.
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
  if auth.role() <> 'service_role' then
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

-- Ensure ownership fields reflect the authenticated user on insert, not the client.
create or replace function set_coverage_requirements_ownership()
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

create trigger coverage_requirements_set_ownership
  before insert or update on coverage_requirements
  for each row execute function set_coverage_requirements_ownership();

-- Drop the narrower trigger that only handled updates.
drop trigger if exists coverage_requirements_set_updated_by on coverage_requirements;

create or replace function set_switching_preferences_ownership()
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

create trigger switching_preferences_set_ownership
  before insert or update on switching_preferences
  for each row execute function set_switching_preferences_ownership();

-- Drop the narrower trigger that only handled updates.
drop trigger if exists switching_preferences_set_updated_by on switching_preferences;

-- Quote-request rate limit / duplicate send table for the email outbox guard.
create table if not exists quote_request_sends (
  quote_request_id uuid primary key references quote_requests (id),
  sent_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  provider text not null default 'outbox',
  status text not null default 'success',
  created_at timestamptz not null default now()
);
