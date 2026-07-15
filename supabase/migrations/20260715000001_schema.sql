-- Insurance Autopilot core schema.
-- All money is integer Canadian cents. All timestamps are UTC timestamptz.

create extension if not exists pgcrypto;

-- =============================== enums ===============================

create type user_role as enum ('customer', 'operations', 'reviewer', 'admin');

create type product_line as enum ('auto', 'property');

create type case_state as enum (
  'draft', 'awaiting_documents', 'extracting_information', 'awaiting_customer_confirmation',
  'ready_for_market_search', 'requesting_quotes', 'awaiting_quotes', 'comparing_quotes',
  'licensed_review', 'recommendation_ready', 'customer_decision', 'switching',
  'completed', 'retained_incumbent', 'cancelled'
);

create type quote_request_state as enum (
  'draft', 'queued', 'sent', 'additional_information_required',
  'response_received', 'declined', 'no_response', 'cancelled'
);

create type quote_state as enum ('estimate', 'conditional', 'bindable', 'expired', 'rejected', 'selected');

create type switch_state as enum (
  'customer_approved', 'replacement_pending', 'replacement_confirmed',
  'incumbent_cancellation_pending', 'incumbent_cancelled', 'completed', 'failed'
);

create type document_category as enum (
  'current_auto_policy', 'current_property_policy', 'renewal_notice', 'competing_quote',
  'proof_of_insurance', 'signed_authorization', 'cancellation_confirmation', 'other'
);

create type document_status as enum ('uploaded', 'in_review', 'extracted', 'rejected');

create type question_type as enum ('yes_no', 'single_choice', 'multiple_choice', 'number', 'date', 'short_text');

create type question_status as enum ('pending', 'answered', 'cancelled');

create type consent_type as enum (
  'store_documents', 'share_for_quotation', 'generate_recommendations', 'electronic_communications'
);

create type subscription_status as enum ('inactive', 'pending', 'active', 'past_due', 'cancelled');

create type recommendation_status as enum (
  'draft', 'awaiting_review', 'approved', 'rejected', 'published',
  'customer_approved', 'customer_declined', 'superseded'
);

create type notification_channel as enum ('push', 'email', 'local_log');

-- =============================== helpers ===============================

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- =============================== tables ===============================

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null default 'customer',
  full_name text not null default '',
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table households (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references profiles (id),
  name text not null,
  province text not null default 'AB',
  timezone text not null default 'America/Edmonton',
  autopilot_active boolean not null default false,
  onboarding_step text not null default 'welcome',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  profile_id uuid not null references profiles (id),
  member_role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, profile_id)
);

create table drivers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  full_name text not null,
  date_of_birth date not null,
  licence_class text not null default '5',
  years_licensed int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  year int not null,
  make text not null,
  model text not null,
  vin text,
  annual_km int,
  primary_use text not null default 'commute',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  address_line1 text not null,
  city text not null,
  province text not null default 'AB',
  postal_code text not null,
  year_built int,
  dwelling_type text not null default 'detached',
  owner_occupied boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table insurers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  provinces text[] not null default '{AB}',
  products product_line[] not null default '{auto,property}',
  distribution text not null default 'direct',
  contact_method text not null default 'email',
  email_supported boolean not null default true,
  portal_supported boolean not null default false,
  api_supported boolean not null default false,
  bundle_supported boolean not null default true,
  internal_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table insurer_channels (
  id uuid primary key default gen_random_uuid(),
  insurer_id uuid not null references insurers (id) on delete cascade,
  channel_type text not null,
  address text not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table policies (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  insurer_id uuid references insurers (id),
  insurer_name text not null,
  product_line product_line not null,
  policy_number text,
  annual_premium_cents bigint not null default 0 check (annual_premium_cents >= 0),
  bundle_discount_cents bigint not null default 0 check (bundle_discount_cents >= 0),
  liability_limit_cents bigint,
  dwelling_limit_cents bigint,
  base_deductible_cents bigint,
  collision_deductible_cents bigint,
  comprehensive_deductible_cents bigint,
  coverage_details jsonb not null default '{}',
  renewal_date date,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table policy_documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  policy_id uuid references policies (id),
  category document_category not null default 'other',
  status document_status not null default 'uploaded',
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  uploaded_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table coverage_requirements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  version int not null default 1,
  auto_requirements jsonb not null,
  property_requirements jsonb not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table switching_preferences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  version int not null default 1,
  min_net_annual_savings_cents bigint not null default 20000 check (min_net_annual_savings_cents >= 0),
  renewal_only_switching boolean not null default true,
  household_optimization_enabled boolean not null default true,
  split_insurers_allowed boolean not null default true,
  excluded_insurer_ids uuid[] not null default '{}',
  deductible_increases_allowed boolean not null default false,
  material_coverage_reductions_allowed boolean not null default false check (material_coverage_reductions_allowed = false),
  customer_approval_required boolean not null default true check (customer_approval_required = true),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table optimization_cases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  state case_state not null default 'draft',
  renewal_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table case_assignments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references optimization_cases (id) on delete cascade,
  assignee_profile_id uuid not null references profiles (id),
  assignment_role text not null default 'operations',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, assignee_profile_id)
);

create table quote_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references optimization_cases (id) on delete cascade,
  insurer_id uuid not null references insurers (id),
  state quote_request_state not null default 'draft',
  product_lines product_line[] not null default '{auto,property}',
  inclusion_reason text not null default '',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table quotes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references optimization_cases (id) on delete cascade,
  quote_request_id uuid references quote_requests (id),
  insurer_id uuid not null references insurers (id),
  state quote_state not null default 'estimate',
  is_incumbent boolean not null default false,
  policy_fees_cents bigint not null default 0 check (policy_fees_cents >= 0),
  payment_fees_cents bigint not null default 0 check (payment_fees_cents >= 0),
  bundle_discount_cents bigint not null default 0 check (bundle_discount_cents >= 0),
  cancellation_charge_cents bigint not null default 0 check (cancellation_charge_cents >= 0),
  underwriting_conditions text[] not null default '{}',
  document_id uuid references policy_documents (id),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table quote_policy_components (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes (id) on delete cascade,
  product_line product_line not null,
  annual_premium_cents bigint not null check (annual_premium_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table quote_coverages (
  id uuid primary key default gen_random_uuid(),
  quote_component_id uuid not null references quote_policy_components (id) on delete cascade,
  coverage jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table customer_questions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references optimization_cases (id) on delete cascade,
  question_type question_type not null,
  status question_status not null default 'pending',
  prompt text not null,
  options text[],
  answer text,
  answered_by uuid references profiles (id),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references optimization_cases (id) on delete cascade,
  status recommendation_status not null default 'draft',
  version int not null default 1,
  mandate_version int not null default 1,
  quote_ids uuid[] not null default '{}',
  current_total_cents bigint not null check (current_total_cents >= 0),
  proposed_total_cents bigint not null check (proposed_total_cents >= 0),
  net_savings_cents bigint not null,
  effective_date date,
  reason_codes text[] not null default '{}',
  comparison jsonb not null default '{}',
  disclosure_version text not null default 'v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table recommendation_options (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references recommendations (id) on delete cascade,
  rank int not null,
  auto_quote_id uuid references quotes (id),
  property_quote_id uuid references quotes (id),
  bundled boolean not null default false,
  total_cents bigint not null check (total_cents >= 0),
  net_savings_cents bigint not null,
  eligible boolean not null default false,
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table recommendation_approvals (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references recommendations (id) on delete cascade,
  approver_profile_id uuid not null references profiles (id),
  approver_role user_role not null,
  approved boolean not null,
  notes text not null default '',
  device_info text,
  session_info text,
  created_at timestamptz not null default now()
);

create table switch_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references optimization_cases (id) on delete cascade,
  recommendation_id uuid references recommendations (id),
  state switch_state not null default 'customer_approved',
  replacement_confirmed_at timestamptz,
  incumbent_cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id)
);

create table consents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  household_id uuid references households (id),
  consent_type consent_type not null,
  granted boolean not null,
  granted_at timestamptz not null default now(),
  disclosure_version text not null default 'v1',
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  status subscription_status not null default 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table stripe_webhook_events (
  id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  channel notification_channel not null default 'local_log',
  title text not null,
  body text not null,
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  email_type text not null,
  subject text not null,
  body text not null,
  provider text not null default 'outbox',
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references profiles (id),
  actor_role user_role,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  household_id uuid references households (id),
  case_id uuid references optimization_cases (id),
  before_summary jsonb,
  after_summary jsonb,
  correlation_id text,
  created_at timestamptz not null default now()
);

-- =============================== indexes ===============================

create index idx_household_members_profile on household_members (profile_id);
create index idx_household_members_household on household_members (household_id);
create index idx_drivers_household on drivers (household_id);
create index idx_vehicles_household on vehicles (household_id);
create index idx_properties_household on properties (household_id);
create index idx_policies_household on policies (household_id);
create index idx_policies_renewal on policies (renewal_date);
create index idx_policy_documents_household on policy_documents (household_id);
create index idx_coverage_requirements_household on coverage_requirements (household_id);
create index idx_switching_preferences_household on switching_preferences (household_id);
create index idx_cases_household on optimization_cases (household_id);
create index idx_cases_state on optimization_cases (state);
create index idx_cases_renewal on optimization_cases (renewal_date);
create index idx_case_assignments_case on case_assignments (case_id);
create index idx_case_assignments_assignee on case_assignments (assignee_profile_id);
create index idx_quote_requests_case on quote_requests (case_id);
create index idx_quote_requests_state on quote_requests (state);
create index idx_quotes_case on quotes (case_id);
create index idx_quotes_state on quotes (state);
create index idx_quote_components_quote on quote_policy_components (quote_id);
create index idx_quote_coverages_component on quote_coverages (quote_component_id);
create index idx_questions_case on customer_questions (case_id);
create index idx_questions_status on customer_questions (status);
create index idx_recommendations_case on recommendations (case_id);
create index idx_recommendations_status on recommendations (status);
create index idx_rec_options_rec on recommendation_options (recommendation_id);
create index idx_rec_approvals_rec on recommendation_approvals (recommendation_id);
create index idx_switch_events_case on switch_events (case_id);
create index idx_consents_profile on consents (profile_id);
create index idx_subscriptions_profile on subscriptions (profile_id);
create index idx_notifications_profile on notifications (profile_id);
create index idx_audit_events_household on audit_events (household_id);
create index idx_audit_events_case on audit_events (case_id);
create index idx_audit_events_entity on audit_events (entity_type, entity_id);

-- =============================== updated_at triggers ===============================

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','households','household_members','drivers','vehicles','properties','insurers',
    'insurer_channels','policies','policy_documents','coverage_requirements','switching_preferences',
    'optimization_cases','case_assignments','quote_requests','quotes','quote_policy_components',
    'quote_coverages','customer_questions','recommendations','recommendation_options',
    'switch_events','subscriptions'
  ] loop
    execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- =============================== state machine enforcement ===============================

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
    when 'customer_decision' then array['switching','retained_incumbent','cancelled']::case_state[]
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

create trigger validate_case_transition before update on optimization_cases
  for each row execute function validate_case_transition();

create or replace function validate_quote_request_transition()
returns trigger language plpgsql as $$
declare allowed quote_request_state[];
begin
  if old.state = new.state then return new; end if;
  allowed := case old.state
    when 'draft' then array['queued','cancelled']::quote_request_state[]
    when 'queued' then array['sent','cancelled']::quote_request_state[]
    when 'sent' then array['additional_information_required','response_received','declined','no_response','cancelled']::quote_request_state[]
    when 'additional_information_required' then array['sent','response_received','declined','no_response','cancelled']::quote_request_state[]
    else array[]::quote_request_state[]
  end;
  if not (new.state = any(allowed)) then
    raise exception 'Invalid quote request transition: % -> %', old.state, new.state;
  end if;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, case_id, before_summary, after_summary)
  values (auth.uid(), (select role from profiles where id = auth.uid()), 'quote_request_transition', 'quote_request', new.id, new.case_id,
          jsonb_build_object('state', old.state), jsonb_build_object('state', new.state));
  return new;
end $$;

create trigger validate_quote_request_transition before update on quote_requests
  for each row execute function validate_quote_request_transition();

create or replace function validate_quote_transition()
returns trigger language plpgsql as $$
declare allowed quote_state[];
begin
  if old.state = new.state then return new; end if;
  allowed := case old.state
    when 'estimate' then array['conditional','bindable','expired','rejected']::quote_state[]
    when 'conditional' then array['bindable','expired','rejected']::quote_state[]
    when 'bindable' then array['selected','expired','rejected']::quote_state[]
    else array[]::quote_state[]
  end;
  if not (new.state = any(allowed)) then
    raise exception 'Invalid quote transition: % -> %', old.state, new.state;
  end if;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, case_id, before_summary, after_summary)
  values (auth.uid(), (select role from profiles where id = auth.uid()), 'quote_transition', 'quote', new.id, new.case_id,
          jsonb_build_object('state', old.state), jsonb_build_object('state', new.state));
  return new;
end $$;

create trigger validate_quote_transition before update on quotes
  for each row execute function validate_quote_transition();

create or replace function validate_switch_transition()
returns trigger language plpgsql as $$
declare allowed switch_state[];
begin
  if old.state = new.state then return new; end if;
  allowed := case old.state
    when 'customer_approved' then array['replacement_pending','failed']::switch_state[]
    when 'replacement_pending' then array['replacement_confirmed','failed']::switch_state[]
    when 'replacement_confirmed' then array['incumbent_cancellation_pending','failed']::switch_state[]
    when 'incumbent_cancellation_pending' then array['incumbent_cancelled','failed']::switch_state[]
    when 'incumbent_cancelled' then array['completed','failed']::switch_state[]
    else array[]::switch_state[]
  end;
  if not (new.state = any(allowed)) then
    raise exception 'Invalid switch transition: % -> %', old.state, new.state;
  end if;
  -- Hard guard: incumbent cancellation may never precede replacement confirmation.
  if new.state in ('incumbent_cancellation_pending', 'incumbent_cancelled')
     and old.replacement_confirmed_at is null and new.replacement_confirmed_at is null then
    raise exception 'Incumbent cancellation cannot proceed before replacement coverage is confirmed';
  end if;
  if new.state = 'replacement_confirmed' and new.replacement_confirmed_at is null then
    new.replacement_confirmed_at := now();
  end if;
  if new.state = 'incumbent_cancelled' and new.incumbent_cancelled_at is null then
    new.incumbent_cancelled_at := now();
  end if;
  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, case_id, before_summary, after_summary)
  values (auth.uid(), (select role from profiles where id = auth.uid()), 'switch_transition', 'switch_event', new.id, new.case_id,
          jsonb_build_object('state', old.state), jsonb_build_object('state', new.state));
  return new;
end $$;

create trigger validate_switch_transition before update on switch_events
  for each row execute function validate_switch_transition();

-- Append-only audit trail.
create or replace function reject_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end $$;

create trigger audit_events_no_update before update on audit_events
  for each row execute function reject_audit_mutation();
create trigger audit_events_no_delete before delete on audit_events
  for each row execute function reject_audit_mutation();

-- Create a profile row for each new auth user.
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
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'customer')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();
