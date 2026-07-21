-- Allow authenticated OAuth, OIDC and password sessions to enable Dangerous mode.
-- Explicit versioned consent and household owner/admin authorization remain required.
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
  v_consent_id uuid;
  v_next_version integer;
  v_enabled_at timestamptz := now();
  v_provider_lower text;
  v_model_lower text;
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

  v_provider_lower := lower(coalesce(p_configured_provider, ''));
  v_model_lower := lower(coalesce(p_configured_model_id, ''));

  if not (
    v_provider_lower in ('kimi-k3', 'gemini', 'gemini-2.5-flash-lite')
    or v_provider_lower like '%kimi%k3%'
    or v_provider_lower like '%gemini%'
    or v_model_lower like '%kimi%k3%'
    or v_model_lower like '%gemini%'
    or v_model_lower like '%flash%'
  ) then
    raise exception 'Dangerous mode provider configuration is invalid';
  end if;
  if nullif(p_processor_contract_version, '') is null then
    raise exception 'Document processor terms are not configured';
  end if;

  -- Serialize before recording consent so concurrent enable/disable operations
  -- use one lock order and cannot leave the setting snapshot inconsistent.
  perform pg_advisory_xact_lock(hashtextextended('dangerous-mode:' || p_household_id::text, 0));

  -- This canonical boundary verifies household owner/admin authority and records
  -- the versioned processing consent in the same transaction.
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
    null, p_foreign_processing_acknowledged,
    p_automated_processing_acknowledged, p_raw_processing_approved
  );

  insert into audit_events (
    actor_profile_id, action, entity_type, household_id, after_summary
  ) values (
    v_actor, 'dangerous_mode_enabled', 'household_document_processing_setting',
    p_household_id,
    jsonb_build_object(
      'enabled', true,
      'disclosure_version', p_disclosure_version,
      'separate_reauthentication_required', false
    )
  );

  return jsonb_build_object(
    'enabled', true,
    'disclosure_version', p_disclosure_version,
    'enabled_at', v_enabled_at,
    'consent_id', v_consent_id
  );
end;
$$;

revoke all on function enable_dangerous_mode_v1(
  uuid, text, text, text, text, boolean, boolean, boolean, boolean
) from public, anon;
grant execute on function enable_dangerous_mode_v1(
  uuid, text, text, text, text, boolean, boolean, boolean, boolean
) to authenticated;

commit;
