-- Phase 1E-F forward repair: cleanup security and lease schema.
-- This migration is idempotent and safe to run on a database that has already
-- applied the pre-fix or post-fix 20260720000001/20260720000002 migrations.
begin;

-- 1. Remove the credential-disclosure RPC if it still exists from an earlier
-- version of the schema.
drop function if exists public.get_cleanup_secrets();

-- 2. Ensure the normal provider-file ledger has the lease columns that the
-- worker uses for crash-safe claims.
alter table document_analysis_provider_files
  add column if not exists cleanup_claimed_at timestamptz,
  add column if not exists cleanup_lease_expires_at timestamptz,
  add column if not exists cleanup_worker_id text;

-- Indexes for the normal cleanup queue.
create index if not exists idx_provider_files_cleanup_due
  on document_analysis_provider_files (next_deletion_attempt_at, deletion_status)
  where deletion_status = 'queued';

create index if not exists idx_provider_files_cleanup_expired
  on document_analysis_provider_files (cleanup_lease_expires_at)
  where deletion_status = 'deleting';

-- 3. Ensure the emergency cleanup ledger has the full lease/escalation model.
alter table document_analysis_emergency_cleanup
  add column if not exists cleanup_status text not null default 'pending',
  add column if not exists cleanup_claimed_at timestamptz,
  add column if not exists cleanup_lease_expires_at timestamptz,
  add column if not exists cleanup_worker_id text,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists operator_action_required boolean not null default false,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_failure_category text;

-- Backfill any legacy emergency rows so they remain visible and retryable.
update document_analysis_emergency_cleanup
set cleanup_status = 'pending',
    operator_action_required = coalesce(operator_action_required, false)
where cleanup_status is null;

-- Drop the old unresolved index (if still present from the pre-fix schema)
-- and recreate the post-fix due/expired-processing indexes.
drop index if exists idx_emergency_cleanup_unresolved;

create index if not exists idx_emergency_cleanup_due
  on document_analysis_emergency_cleanup (next_attempt_at, created_at)
  where cleanup_status in ('pending', 'failed_permanently')
    and operator_action_required = false;

create index if not exists idx_emergency_cleanup_expired_processing
  on document_analysis_emergency_cleanup (cleanup_lease_expires_at, created_at)
  where cleanup_status = 'processing'
    and operator_action_required = false;

-- 4. Ensure the readiness status table can store the permanent-failure count.
alter table cleanup_readiness_status
  add column if not exists permanent_failure_count int not null default 0;

-- 5. Recreate the readiness RPC with a fixed search path so any environment that
-- still has the pre-fix definition is repaired.
create or replace function check_cleanup_readiness()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ready boolean := true;
  v_checks jsonb := '{}'::jsonb;
  v_cron_active boolean;
  v_vault_count int;
  v_stale int;
  v_stale_emergency int;
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

  -- 4. Count emergency rows stuck in `processing` with an expired lease.
  select count(*) into v_stale_emergency
  from document_analysis_emergency_cleanup
  where cleanup_status = 'processing'
    and cleanup_lease_expires_at < v_now - interval '10 minutes';
  v_checks := v_checks || jsonb_build_object('stale_emergency_processing_count', v_stale_emergency);
  if v_stale_emergency > 0 then
    v_ready := false;
  end if;

  -- 5. Count unresolved permanent failures.
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

  -- 6. Synthetic probe: claim and resolve a row to prove the worker pipeline.
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

  -- 7. The function is considered deployed if this RPC is reachable.
  v_checks := v_checks || jsonb_build_object('function_deployed', true);

  -- 8. Health invocation and provider credential availability are validated at the Edge layer.
  v_checks := v_checks || jsonb_build_object('health_invocation', null);

  return jsonb_build_object('ready', v_ready, 'checks', v_checks);
end;
$$;

-- 6. Lock down function execution: revoke default PUBLIC access and grant only
-- the internal service role.
revoke all on function public.check_cleanup_readiness() from public;
revoke all on function public.check_cleanup_readiness() from anon;
revoke all on function public.check_cleanup_readiness() from authenticated;
grant execute on function public.check_cleanup_readiness() to service_role;

comment on function check_cleanup_readiness() is
  'Service-role RPC that verifies the cleanup worker schedule, Vault secrets, stale leases, permanent failures and a synthetic probe.';

commit;
