-- Phase 1E-F: cleanup-worker lease columns and scheduled invocation.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table document_analysis_provider_files
  add column if not exists cleanup_claimed_at timestamptz,
  add column if not exists cleanup_lease_expires_at timestamptz,
  add column if not exists cleanup_worker_id text;

create index if not exists idx_provider_files_cleanup_due
  on document_analysis_provider_files (next_deletion_attempt_at, deletion_status)
  where deletion_status = 'queued';

create index if not exists idx_provider_files_cleanup_expired
  on document_analysis_provider_files (cleanup_lease_expires_at)
  where deletion_status = 'deleting';

-- Invoke the cleanup worker every 5 minutes.  The Edge Function URL and
-- service-role key are read from Supabase Vault so this migration never
-- contains credentials.  Vault secrets expected:
--   - cleanup_service_url      (e.g. http://supabase_kong_<project>:8000)
--   - cleanup_service_role_key
-- If either secret is missing the invocation is a no-op.
select cron.schedule(
  'cleanup-provider-files-worker',
  '*/5 * * * *',
  $$
  with cfg as (
    select
      (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_service_url') as service_url,
      (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_service_role_key') as service_key
  )
  select case
    when cfg.service_url is null or cfg.service_key is null then null
    else net.http_post(
      url := cfg.service_url || '/functions/v1/cleanup-provider-files',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || cfg.service_key,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
  end as request_id
  from cfg;
  $$
);

commit;
