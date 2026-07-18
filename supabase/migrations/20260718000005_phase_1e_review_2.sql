-- Phase 1E review-2: one auditable analysis-run record, household-level candidate identity,
-- canonical server-side identity resolution, and restricted customer DML.

-- -----------------------------------------------------------------------------
-- 1. Analysis-run provenance
-- -----------------------------------------------------------------------------

create table if not exists document_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references document_extraction_sessions(id) on delete set null,
  household_id uuid not null references households(id) on delete cascade,
  model_provider text not null,
  model_id text not null,
  attempted_model_provider text,
  attempted_model_id text,
  fallback_reason text,
  prompt_version text not null default '1.0.0',
  output_schema_version text not null default '1.0.0',
  attempt_count int not null default 1 check (attempt_count > 0),
  raw_response_json jsonb,
  validated_output_json jsonb not null,
  warnings_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_analysis_runs_session on document_analysis_runs (session_id);
create index if not exists idx_analysis_runs_household on document_analysis_runs (household_id);

-- -----------------------------------------------------------------------------
-- 2. Link extraction artifacts to the analysis run that produced them
-- -----------------------------------------------------------------------------

alter table extracted_documents
  add column if not exists analysis_run_id uuid references document_analysis_runs(id) on delete set null;

alter table asset_candidates
  add column if not exists analysis_run_id uuid references document_analysis_runs(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 3. Household-level identity uniqueness for pending candidates
-- -----------------------------------------------------------------------------

-- The previous session-level unique constraint allowed duplicate pending candidates
-- across sessions for the same household. Drop it and enforce at household scope.
alter table asset_candidates
  drop constraint if exists asset_candidates_session_identity_unique;

create unique index if not exists asset_candidates_household_pending_identity_unique
  on asset_candidates (household_id, asset_type, identity_fingerprint)
  where review_status in ('pending', 'reviewing') and decision in ('undecided', 'not_sure');

-- -----------------------------------------------------------------------------
-- 4. Restrict direct customer mutation of extraction records
-- -----------------------------------------------------------------------------

-- Customers may only view (select) sessions, extracted documents, and candidates.
-- All writes must go through the service_role extraction Edge Function or RPCs.
revoke insert, update, delete on document_extraction_sessions from authenticated;
revoke insert, update, delete on extracted_documents from authenticated;
revoke insert, update, delete on asset_candidates from authenticated;

grant select on document_extraction_sessions, extracted_documents, asset_candidates to authenticated;
grant select on document_analysis_runs to authenticated;

-- -----------------------------------------------------------------------------
-- 5. RLS for the analysis-run table
-- -----------------------------------------------------------------------------

alter table document_analysis_runs enable row level security;

create policy document_analysis_runs_select on document_analysis_runs
  for select using (can_access_household(household_id));

-- -----------------------------------------------------------------------------
-- 6. Service-role grants
-- -----------------------------------------------------------------------------

grant select, insert, update, delete on document_analysis_runs to service_role;
