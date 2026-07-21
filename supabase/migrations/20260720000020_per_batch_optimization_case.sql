begin;

-- Link each document extraction session to the optimization case it feeds.
-- This lets the mobile Autopilot screen map a case to its review session.
alter table document_extraction_sessions
  add column if not exists case_id uuid references optimization_cases(id) on delete set null;

create index if not exists idx_document_extraction_sessions_case_id
  on document_extraction_sessions(case_id);

-- Link each document processing batch to its per-upload optimization case.
alter table document_processing_batches
  add column if not exists case_id uuid references optimization_cases(id) on delete set null;

create index if not exists idx_document_processing_batches_case_id
  on document_processing_batches(case_id);

commit;
