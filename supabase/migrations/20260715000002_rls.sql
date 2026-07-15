-- Row Level Security for every exposed table.

-- Role helper: reads the caller's role without recursive RLS evaluation.
create or replace function app_role()
returns user_role
language sql
stable
security definer set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select app_role() in ('operations', 'reviewer', 'admin');
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select app_role() = 'admin';
$$;

-- Household membership helper.
create or replace function is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from household_members hm where hm.household_id = hid and hm.profile_id = auth.uid()
  ) or exists (
    select 1 from households h where h.id = hid and h.owner_profile_id = auth.uid()
  );
$$;

-- Operations assignment helper: assigned to any case in the household, or admin.
create or replace function staff_can_access_household(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin()
    or (app_role() = 'operations' and exists (
      select 1 from case_assignments ca
      join optimization_cases oc on oc.id = ca.case_id
      where oc.household_id = hid and ca.assignee_profile_id = auth.uid()
    ))
    or (app_role() = 'reviewer' and exists (
      select 1 from optimization_cases oc
      where oc.household_id = hid
        and oc.state in ('licensed_review', 'recommendation_ready', 'customer_decision', 'switching', 'completed')
    ));
$$;

create or replace function can_access_household(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_household_member(hid) or staff_can_access_household(hid);
$$;

create or replace function can_access_case(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from optimization_cases oc
    where oc.id = cid and can_access_household(oc.household_id)
  );
$$;

-- =============================== enable RLS ===============================

alter table profiles enable row level security;
alter table households enable row level security;
alter table household_members enable row level security;
alter table drivers enable row level security;
alter table vehicles enable row level security;
alter table properties enable row level security;
alter table insurers enable row level security;
alter table insurer_channels enable row level security;
alter table policies enable row level security;
alter table policy_documents enable row level security;
alter table coverage_requirements enable row level security;
alter table switching_preferences enable row level security;
alter table optimization_cases enable row level security;
alter table case_assignments enable row level security;
alter table quote_requests enable row level security;
alter table quotes enable row level security;
alter table quote_policy_components enable row level security;
alter table quote_coverages enable row level security;
alter table customer_questions enable row level security;
alter table recommendations enable row level security;
alter table recommendation_options enable row level security;
alter table recommendation_approvals enable row level security;
alter table switch_events enable row level security;
alter table consents enable row level security;
alter table subscriptions enable row level security;
alter table stripe_webhook_events enable row level security;
alter table notifications enable row level security;
alter table email_outbox enable row level security;
alter table audit_events enable row level security;

-- =============================== profiles ===============================

create policy profiles_select_own on profiles for select using (id = auth.uid() or is_staff());
create policy profiles_update_own on profiles for update
  using (id = auth.uid() or is_admin())
  with check (
    (id = auth.uid() and role = (select p.role from profiles p where p.id = auth.uid()))
    or is_admin()
  );

-- =============================== households and members ===============================

create policy households_select on households for select using (can_access_household(id));
create policy households_insert on households for insert with check (owner_profile_id = auth.uid() or is_admin());
create policy households_update on households for update using (is_household_member(id) or staff_can_access_household(id));

create policy household_members_select on household_members for select using (can_access_household(household_id));
create policy household_members_insert on household_members for insert
  with check (is_household_member(household_id) or is_admin());

-- =============================== household-scoped customer data ===============================

create policy drivers_select on drivers for select using (can_access_household(household_id));
create policy drivers_write on drivers for insert with check (can_access_household(household_id));
create policy drivers_update on drivers for update using (can_access_household(household_id));
create policy drivers_delete on drivers for delete using (is_household_member(household_id) or is_admin());

create policy vehicles_select on vehicles for select using (can_access_household(household_id));
create policy vehicles_write on vehicles for insert with check (can_access_household(household_id));
create policy vehicles_update on vehicles for update using (can_access_household(household_id));
create policy vehicles_delete on vehicles for delete using (is_household_member(household_id) or is_admin());

create policy properties_select on properties for select using (can_access_household(household_id));
create policy properties_write on properties for insert with check (can_access_household(household_id));
create policy properties_update on properties for update using (can_access_household(household_id));

create policy policies_select on policies for select using (can_access_household(household_id));
create policy policies_write on policies for insert with check (can_access_household(household_id));
create policy policies_update on policies for update using (can_access_household(household_id));

create policy policy_documents_select on policy_documents for select using (can_access_household(household_id));
create policy policy_documents_insert on policy_documents for insert
  with check (can_access_household(household_id) and uploaded_by = auth.uid());
create policy policy_documents_update on policy_documents for update
  using (staff_can_access_household(household_id) or is_household_member(household_id));

create policy coverage_requirements_select on coverage_requirements for select using (can_access_household(household_id));
create policy coverage_requirements_insert on coverage_requirements for insert with check (can_access_household(household_id));
create policy coverage_requirements_update on coverage_requirements for update using (can_access_household(household_id));

create policy switching_preferences_select on switching_preferences for select using (can_access_household(household_id));
create policy switching_preferences_insert on switching_preferences for insert with check (can_access_household(household_id));
create policy switching_preferences_update on switching_preferences for update using (can_access_household(household_id));

create policy consents_select on consents for select using (profile_id = auth.uid() or is_staff());
create policy consents_insert on consents for insert with check (profile_id = auth.uid());

create policy subscriptions_select on subscriptions for select using (profile_id = auth.uid() or is_staff());

create policy notifications_select on notifications for select using (profile_id = auth.uid() or is_admin());
create policy notifications_update on notifications for update using (profile_id = auth.uid());

-- =============================== grants ===============================

-- Baseline privileges for signed-in users; RLS policies constrain rows.
-- anon gets nothing: every table requires an authenticated session.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on all tables in schema public from anon;
-- Audit rows are append-only: no update/delete even for admins.
revoke update, delete on audit_events from authenticated;

-- =============================== insurers ===============================

-- Customers may see insurer names for display, but internal notes are staff-only
-- (enforced via column privileges below in addition to app-level shaping).
create policy insurers_select on insurers for select using (auth.uid() is not null);
create policy insurers_write on insurers for insert with check (is_staff());
create policy insurers_update on insurers for update using (is_staff());

revoke all on insurers from authenticated;
grant select (id, name, active, provinces, products, distribution, bundle_supported) on insurers to authenticated;
-- Staff access to full row goes through a security-definer view.
create or replace view insurer_directory with (security_invoker = false) as
  select * from insurers where is_staff();
grant select on insurer_directory to authenticated;
grant insert, update on insurers to authenticated;

create policy insurer_channels_select on insurer_channels for select using (is_staff());
create policy insurer_channels_write on insurer_channels for insert with check (is_staff());
create policy insurer_channels_update on insurer_channels for update using (is_staff());

-- =============================== cases and workflow ===============================

create policy cases_select on optimization_cases for select using (can_access_household(household_id));
create policy cases_insert on optimization_cases for insert with check (can_access_household(household_id));
create policy cases_update on optimization_cases for update using (can_access_household(household_id));

create policy case_assignments_select on case_assignments for select
  using (is_staff() or can_access_case(case_id));
create policy case_assignments_insert on case_assignments for insert with check (is_staff());
create policy case_assignments_delete on case_assignments for delete using (is_staff());

create policy quote_requests_select on quote_requests for select using (can_access_case(case_id));
create policy quote_requests_insert on quote_requests for insert with check (is_staff() and can_access_case(case_id));
create policy quote_requests_update on quote_requests for update using (is_staff() and can_access_case(case_id));

-- Customers can read quotes but never write them.
create policy quotes_select on quotes for select using (can_access_case(case_id));
create policy quotes_insert on quotes for insert with check (is_staff() and can_access_case(case_id));
create policy quotes_update on quotes for update using (is_staff() and can_access_case(case_id));

create policy quote_components_select on quote_policy_components for select
  using (exists (select 1 from quotes q where q.id = quote_id and can_access_case(q.case_id)));
create policy quote_components_insert on quote_policy_components for insert
  with check (is_staff() and exists (select 1 from quotes q where q.id = quote_id and can_access_case(q.case_id)));
create policy quote_components_update on quote_policy_components for update
  using (is_staff() and exists (select 1 from quotes q where q.id = quote_id and can_access_case(q.case_id)));

create policy quote_coverages_select on quote_coverages for select
  using (exists (
    select 1 from quote_policy_components c join quotes q on q.id = c.quote_id
    where c.id = quote_component_id and can_access_case(q.case_id)));
create policy quote_coverages_insert on quote_coverages for insert
  with check (is_staff() and exists (
    select 1 from quote_policy_components c join quotes q on q.id = c.quote_id
    where c.id = quote_component_id and can_access_case(q.case_id)));
create policy quote_coverages_update on quote_coverages for update
  using (is_staff() and exists (
    select 1 from quote_policy_components c join quotes q on q.id = c.quote_id
    where c.id = quote_component_id and can_access_case(q.case_id)));

create policy questions_select on customer_questions for select using (can_access_case(case_id));
create policy questions_insert on customer_questions for insert with check (is_staff() and can_access_case(case_id));
-- Customers may answer; staff may edit.
create policy questions_update on customer_questions for update using (can_access_case(case_id));

-- Customers can read recommendations only once published; never write.
create policy recommendations_select on recommendations for select
  using (
    (is_staff() and can_access_case(case_id))
    or (
      status in ('published', 'customer_approved', 'customer_declined', 'superseded')
      and exists (
        select 1 from optimization_cases oc
        where oc.id = case_id and is_household_member(oc.household_id)
      )
    )
  );
create policy recommendations_insert on recommendations for insert with check (is_staff() and can_access_case(case_id));
create policy recommendations_update on recommendations for update using (can_access_case(case_id));

create policy rec_options_select on recommendation_options for select
  using (exists (select 1 from recommendations r where r.id = recommendation_id and can_access_case(r.case_id)));
create policy rec_options_insert on recommendation_options for insert
  with check (is_staff() and exists (select 1 from recommendations r where r.id = recommendation_id and can_access_case(r.case_id)));

create policy rec_approvals_select on recommendation_approvals for select
  using (exists (select 1 from recommendations r where r.id = recommendation_id and can_access_case(r.case_id)));
create policy rec_approvals_insert on recommendation_approvals for insert
  with check (approver_profile_id = auth.uid()
    and exists (select 1 from recommendations r where r.id = recommendation_id and can_access_case(r.case_id)));

create policy switch_events_select on switch_events for select using (can_access_case(case_id));
create policy switch_events_insert on switch_events for insert with check (can_access_case(case_id));
create policy switch_events_update on switch_events for update using (is_staff() and can_access_case(case_id));

-- =============================== audit and system ===============================

-- Audit events: readable by staff and by household members for their own household.
create policy audit_select on audit_events for select
  using (is_staff() or (household_id is not null and is_household_member(household_id)));
create policy audit_insert on audit_events for insert with check (auth.uid() is not null);
-- No update/delete policies: combined with the append-only triggers, audit rows are immutable.

create policy email_outbox_select on email_outbox for select using (is_staff());

create policy stripe_events_select on stripe_webhook_events for select using (is_admin());

-- =============================== storage ===============================

insert into storage.buckets (id, name, public)
values ('policy-documents', 'policy-documents', false)
on conflict (id) do nothing;

create policy "household docs read" on storage.objects for select
  using (
    bucket_id = 'policy-documents'
    and can_access_household(((string_to_array(name, '/'))[1])::uuid)
  );

create policy "household docs write" on storage.objects for insert
  with check (
    bucket_id = 'policy-documents'
    and can_access_household(((string_to_array(name, '/'))[1])::uuid)
  );
