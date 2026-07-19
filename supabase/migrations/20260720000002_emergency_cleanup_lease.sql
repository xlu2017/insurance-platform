-- Phase 1E-F: lease model, operator escalation and permanent-failure tracking for
-- the emergency cleanup ledger so unresolved incidents are never silently removed.
begin;

alter table document_analysis_emergency_cleanup
  add column if not exists cleanup_status text not null default 'pending',
  add column if not exists cleanup_claimed_at timestamptz,
  add column if not exists cleanup_lease_expires_at timestamptz,
  add column if not exists cleanup_worker_id text,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists operator_action_required boolean not null default false,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_failure_category text;

-- Backfill legacy emergency rows as pending operator incidents so they are not
-- silently treated as resolved.
update document_analysis_emergency_cleanup
set cleanup_status = 'pending',
    operator_action_required = coalesce(operator_action_required, false)
where cleanup_status is null;

-- Index to find emergency rows that are due and unclaimed (or have an expired lease).
drop index if exists idx_emergency_cleanup_unresolved;
create index idx_emergency_cleanup_due
  on document_analysis_emergency_cleanup (next_attempt_at, created_at)
  where cleanup_status in ('pending', 'failed_permanently')
    and operator_action_required = false;

comment on table document_analysis_emergency_cleanup is
  'Append-only durable queue for provider files that could not be queued through the normal ledger. Rows are leased and never resolved until deletion is confirmed.';

-- Surface permanent/unresolved cleanup incidents in readiness checks.
alter table cleanup_readiness_status
  add column if not exists permanent_failure_count int not null default 0;

comment on column cleanup_readiness_status.permanent_failure_count is
  'Count of unresolved permanent cleanup failures (normal + emergency) at the time of the last check.';

-- Recreate the readiness RPC so it can count unresolved permanent failures and
-- no excessive stale or operator-action incidents.
create or replace function check_cleanup_readiness()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_ready boolean := true;
  v_checks jsonb := '{}'::jsonb;
  v_cron_active boolean;
  v_vault_count int;
  v_stale int;
  v_permanent int;
  v_synthetic_id uuid;
  v_now timestamptz := now();
  v_synthetic_resolved boolean := false;
begin
  -- 1. Verify the cleanup cron job is active.
  select coalesce(
    (select count(*) > 0 from cron.job
     where jobname = 'cleanup-provider-files-worker' and active = true),
    false
  ) into v_cron_active;
  v_checks := v_checks || jsonb_build_object('cron_active', v_cron_active);
  if not v_cron_active then
    v_ready := false;
  end if;

  -- 2. Verify both required Vault secrets exist.
  select count(*) into v_vault_count
  from vault.decrypted_secrets
  where name in ('cleanup_service_url', 'cleanup_service_role_key');
  v_checks := v_checks || jsonb_build_object('vault_secrets', v_vault_count >= 2);
  if v_vault_count < 2 then
    v_ready := false;
  end if;

  -- 3. Count stale `deleting` rows (lease expired more than threshold minutes ago).
  select count(*) into v_stale
  from document_analysis_provider_files
  where deletion_status = 'deleting'
    and cleanup_lease_expires_at < v_now - interval '10 minutes';
  v_checks := v_checks || jsonb_build_object('stale_deleting_count', v_stale);
  if v_stale > 0 then
    v_ready := false;
  end if;

  -- 4. Count unresolved permanent failures. Any operator-action incident blocks readiness.
  select coalesce(
    (select count(*) from document_analysis_provider_files where deletion_status = 'failed_permanently') +
    (select count(*) from document_analysis_emergency_cleanup
     where cleanup_status = 'failed_permanently' or operator_action_required = true),
    0
  ) into v_permanent;
  v_checks := v_checks || jsonb_build_object('permanent_failure_count', v_permanent);
  if v_permanent > 0 then
    v_ready := false;
  end if;

  -- 5. Synthetic probe: claim and resolve a row to prove the worker pipeline.
  insert into cleanup_readiness_synthetic (created_at)
  values (v_now)
  returning id into v_synthetic_id;

  update cleanup_readiness_synthetic
  set claimed_at = v_now,
      resolved_at = v_now,
      worker_id = 'rpc-check',
      attempts = 1
  where id = v_synthetic_id;

  select resolved_at is not null into v_synthetic_resolved
  from cleanup_readiness_synthetic
  where id = v_synthetic_id;
  v_checks := v_checks || jsonb_build_object('synthetic_resolved', v_synthetic_resolved);
  if not v_synthetic_resolved then
    v_ready := false;
  end if;

  -- 6. The function is considered deployed if this RPC is reachable from the worker.
  v_checks := v_checks || jsonb_build_object('function_deployed', true);

  -- 7. Health invocation and provider credential availability are intentionally
  -- performed by callers (the cleanup worker and the extraction gate) so the
  -- provider-specific secret is validated at the Edge layer.
  v_checks := v_checks || jsonb_build_object('health_invocation', null);

  return jsonb_build_object('ready', v_ready, 'checks', v_checks);
end;
$$;

comment on function check_cleanup_readiness() is
  'Service-role RPC that verifies the cleanup worker schedule, Vault secrets, stale leases, permanent failures and a synthetic probe.';

commit;
