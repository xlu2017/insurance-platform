-- Phase 1E-F: remove the get_cleanup_secrets RPC and prepare for the secure
-- check_cleanup_readiness RPC defined in the later lease migration.
begin;

-- get_cleanup_secrets() is intentionally removed: it returned the Supabase
-- service-role key and was callable by PUBLIC by default. The cleanup worker cron
-- job reads Vault directly; the extraction Edge Function uses its own
-- SUPABASE_SERVICE_ROLE_KEY environment variable.
drop function if exists public.get_cleanup_secrets();

commit;
