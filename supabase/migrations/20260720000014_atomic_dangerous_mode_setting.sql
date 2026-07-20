-- Make Dangerous mode consent, settings and audit writes atomic.
begin;

create or replace function enable_dangerous_mode_v1(
  p_household_id uuid,
  p_disclosure_version text,
  p_processor_contract_version text,
  p_configured_provider text,
  p_configured_model_id text,
  p_explicit_confirmation boolean,
  p_foreign_processing_acknowledged boolean,
  p_automated_processing_acknowledged boolean,
  p_raw_processing_approved boolean
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_password_authenticated_at bigint;
  v_consent_id uuid;
  v_next_version integer;
  v_enabled_at timestamptz := now();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;
  if not coalesce(p_explicit_confirmation, false)
     or not coalesce(p_foreign_processing_acknowledged, false)
     or not coalesce(p_automated_processing_acknowledged, false)
     or not coalesce(p_raw_processing_approved, false) then
    raise exception 'Every Dangerous mode acknowledgement is required';
  end if;
  if p_disclosure_version <> 'dangerous-mode-v1' then
    raise exception 'Dangerous mode disclosure version is invalid';
  end if;
  if p_configured_provider <> 'kimi-k3'
     or p_configured_model_id is null
     or lower(p_configured_model_id) not like '%kimi-k3%' then
    raise exception 'Dangerous mode provider configuration is invalid';
  end if;
  if nullif(p_processor_contract_version, '') is null then
    raise exception 'Document processor terms are not configured';
  end if;

  select max((entry->>'timestamp')::bigint)
  into v_password_authenticated_at
  from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) entry
  where entry->>'method' = 'password'
    and entry->>'timestamp' ~ '^[0-9]+$';

  if v_password_authenticated_at is null
     or extract(epoch from v_enabled_at)::bigint - v_password_authenticated_at > 300
     or v_password_authenticated_at > extract(epoch from v_enabled_at)::bigint + 30 then
    raise exception 'Recent password reauthentication is required';
  end if;

  -- Serialize before touching consent so enable/disable use one lock order and
  -- cannot deadlock while updating the household snapshot.
  perform pg_advisory_xact_lock(hashtextextended('dangerous-mode:' || p_household_id::text, 0));

  -- This existing canonical boundary verifies owner/admin authority and records
  -- the versioned household processing consent in this same transaction.
  v_consent_id := record_document_processing_consent(
    p_household_id,
    v_actor,
    'insurance_policy_extraction',
    p_disclosure_version,
    p_processor_contract_version,
    p_foreign_processing_acknowledged,
    p_automated_processing_acknowledged,
    p_raw_processing_approved,
    'household_owner'
  );

  select coalesce(setting_version, 0) + 1
  into v_next_version
  from household_document_processing_settings
  where household_id = p_household_id
  for update;
  v_next_version := coalesce(v_next_version, 1);

  insert into household_document_processing_settings (
    household_id, dangerous_mode_enabled, setting_version, enabled_by,
    enabled_at, disabled_at, disclosure_version, configured_provider,
    configured_model_id, updated_at
  ) values (
    p_household_id, true, v_next_version, v_actor,
    v_enabled_at, null, p_disclosure_version, p_configured_provider,
    p_configured_model_id, v_enabled_at
  )
  on conflict (household_id) do update set
    dangerous_mode_enabled = excluded.dangerous_mode_enabled,
    setting_version = excluded.setting_version,
    enabled_by = excluded.enabled_by,
    enabled_at = excluded.enabled_at,
    disabled_at = excluded.disabled_at,
    disclosure_version = excluded.disclosure_version,
    configured_provider = excluded.configured_provider,
    configured_model_id = excluded.configured_model_id,
    updated_at = excluded.updated_at;

  insert into household_document_processing_setting_events (
    household_id, actor_profile_id, event_type, enabled_state,
    disclosure_version, configured_provider, configured_model_id,
    reauthenticated_at, foreign_processing_acknowledged,
    automated_processing_acknowledged, raw_processing_approved
  ) values (
    p_household_id, v_actor, 'enabled', true,
    p_disclosure_version, p_configured_provider, p_configured_model_id,
    to_timestamp(v_password_authenticated_at), p_foreign_processing_acknowledged,
    p_automated_processing_acknowledged, p_raw_processing_approved
  );

  insert into audit_events (
    actor_profile_id, action, entity_type, household_id, after_summary
  ) values (
    v_actor, 'dangerous_mode_enabled', 'household_document_processing_setting',
    p_household_id,
    jsonb_build_object('enabled', true, 'disclosure_version', p_disclosure_version)
  );

  return jsonb_build_object(
    'enabled', true,
    'disclosure_version', p_disclosure_version,
    'enabled_at', v_enabled_at,
    'consent_id', v_consent_id
  );
end;
$$;

create or replace function disable_dangerous_mode_v1(
  p_household_id uuid
) returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_setting household_document_processing_settings%rowtype;
  v_disabled_at timestamptz := now();
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1
    from households h
    where h.id = p_household_id and h.owner_profile_id = v_actor
  ) and not exists (
    select 1
    from household_members hm
    where hm.household_id = p_household_id
      and hm.profile_id = v_actor
      and hm.member_role in ('admin', 'owner')
  ) then
    raise exception 'Profile is not authorized to change Dangerous mode';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('dangerous-mode:' || p_household_id::text, 0));
  select * into v_setting
  from household_document_processing_settings
  where household_id = p_household_id
  for update;

  if not found or not v_setting.dangerous_mode_enabled then
    return jsonb_build_object(
      'enabled', false,
      'disclosure_version', coalesce(v_setting.disclosure_version, 'dangerous-mode-v1'),
      'enabled_at', v_setting.enabled_at
    );
  end if;

  update household_document_processing_settings
  set dangerous_mode_enabled = false,
      setting_version = setting_version + 1,
      disabled_at = v_disabled_at,
      updated_at = v_disabled_at
  where household_id = p_household_id;

  update document_processing_consent
  set status = 'withdrawn',
      withdrawn_at = v_disabled_at,
      updated_at = v_disabled_at
  where household_id = p_household_id
    and purpose = 'insurance_policy_extraction'
    and status = 'active';

  insert into household_document_processing_setting_events (
    household_id, actor_profile_id, event_type, enabled_state,
    disclosure_version, configured_provider, configured_model_id
  ) values (
    p_household_id, v_actor, 'disabled', false,
    v_setting.disclosure_version, v_setting.configured_provider,
    v_setting.configured_model_id
  );

  insert into audit_events (
    actor_profile_id, action, entity_type, household_id,
    before_summary, after_summary
  ) values (
    v_actor, 'dangerous_mode_disabled', 'household_document_processing_setting',
    p_household_id, jsonb_build_object('enabled', true),
    jsonb_build_object('enabled', false)
  );

  return jsonb_build_object(
    'enabled', false,
    'disclosure_version', coalesce(v_setting.disclosure_version, 'dangerous-mode-v1'),
    'enabled_at', v_setting.enabled_at
  );
end;
$$;

revoke all on function enable_dangerous_mode_v1(
  uuid, text, text, text, text, boolean, boolean, boolean, boolean
) from public, anon;
grant execute on function enable_dangerous_mode_v1(
  uuid, text, text, text, text, boolean, boolean, boolean, boolean
) to authenticated;

revoke all on function disable_dangerous_mode_v1(uuid) from public, anon;
grant execute on function disable_dangerous_mode_v1(uuid) to authenticated;

commit;
