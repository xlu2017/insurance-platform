-- Phase 1E-F: durable emergency cleanup ledger, cleanup readiness status, and synthetic worker probe.
begin;

-- Append-only emergency cleanup ledger used when the primary provider-file ledger
-- and cleanup queue are both unreachable. A separate worker or manual process can
-- resolve these rows using the durable provider_file_id.
create table if not exists document_analysis_emergency_cleanup (
  id uuid primary key default gen_random_uuid(),
  provider_file_id text not null,
  policy_document_id text,
  failure_category text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  retries int not null default 0
);

create index if not exists idx_emergency_cleanup_unresolved
  on document_analysis_emergency_cleanup (created_at)
  where resolved_at is null;

grant select, insert, update, delete on document_analysis_emergency_cleanup to service_role;

-- Singleton readiness status updated by the cleanup worker each run.
create table if not exists cleanup_readiness_status (
  id uuid primary key default '00000000-0000-0000-0000-000000000001'::uuid,
  ready boolean not null default false,
  checked_at timestamptz not null default now(),
  stale_deleting_count int not null default 0,
  checks jsonb not null default '{}'::jsonb
);

grant select, insert, update on cleanup_readiness_status to service_role;

-- Synthetic probe used by the cleanup worker to prove it can claim and resolve a row.
create table if not exists cleanup_readiness_synthetic (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  resolved_at timestamptz,
  worker_id text,
  attempts int not null default 0
);

create index if not exists idx_cleanup_synthetic_unresolved
  on cleanup_readiness_synthetic (created_at)
  where resolved_at is null;

grant select, insert, update on cleanup_readiness_synthetic to service_role;

commit;
