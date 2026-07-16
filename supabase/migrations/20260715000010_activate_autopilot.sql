-- Server-side Autopilot activation. Validates subscription, consents, and documents before
-- allowing autopilot_active to become true. The PAYMENTS_BYPASS decision is made by the trusted
-- checkout Edge Function; this RPC relies on the subscriptions table and never reads env vars.
create or replace function activate_autopilot(p_household_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  caller uuid := auth.uid();
  hh households%rowtype;
  sub_status subscription_status;
  consent_count int;
  doc_count int;
  caller_role user_role;
begin
  if caller is null then raise exception 'not authenticated'; end if;

  select * into hh from households where id = p_household_id;
  if not found then raise exception 'household not found'; end if;
  if hh.owner_profile_id <> caller and (hh.created_by is distinct from caller) then
    raise exception 'only the household owner can activate autopilot';
  end if;

  -- Consents must exist and all relevant consents must be granted.
  select count(*) into consent_count
  from consents
  where profile_id = caller and household_id = p_household_id and granted = true;
  if consent_count = 0 then
    raise exception 'required consents are missing';
  end if;

  -- At least one policy document must be on file for the household.
  select count(*) into doc_count
  from policy_documents
  where household_id = p_household_id;
  if doc_count = 0 then
    raise exception 'required policy documents are missing';
  end if;

  -- Subscription must be active. The checkout Edge Function creates/updates this row.
  select status into sub_status
  from subscriptions
  where profile_id = caller;
  if sub_status is distinct from 'active' then
    raise exception 'subscription is not active (status %)', coalesce(sub_status::text, 'missing');
  end if;

  select role into caller_role from profiles where id = caller;

  update households
  set autopilot_active = true, onboarding_step = 'complete', updated_at = now()
  where id = p_household_id;

  insert into audit_events (actor_profile_id, actor_role, action, entity_type, entity_id, household_id, after_summary)
  values (
    caller, coalesce(caller_role, 'customer'::user_role), 'autopilot_activated', 'household', p_household_id, p_household_id,
    jsonb_build_object('autopilot_active', true, 'subscription_status', sub_status)
  );

  return jsonb_build_object('success', true, 'autopilot_active', true);
end $$;

grant execute on function activate_autopilot(uuid) to authenticated;
