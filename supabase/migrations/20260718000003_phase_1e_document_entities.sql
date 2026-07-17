-- Phase 1E: document extraction sessions, parsed assertions, and stable asset candidates.

-- =============================================================================
-- 1. Enums
-- =============================================================================

create type candidate_asset_type as enum ('property', 'vehicle');

create type candidate_match_classification as enum (
  'new',
  'exact_existing_match',
  'possible_existing_match',
  'new_identity_confirmation_required'
);

create type candidate_decision as enum (
  'undecided',
  'approve_new',
  'link_existing',
  'skip',
  'not_sure'
);

create type assertion_authority as enum (
  'coverage_summary',
  'insurance_certificate',
  'endorsement',
  'invoice',
  'renewal_overview',
  'notice',
  'header_footer'
);

create type assertion_confirmation_status as enum (
  'extracted',
  'confirmed',
  'corrected',
  'unknown',
  'not_applicable',
  'conflicting'
);

-- =============================================================================
-- 2. Extraction session
-- =============================================================================

create table if not exists document_extraction_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'submitted', 'closed', 'approved')),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- 3. Extracted documents
-- =============================================================================

create table if not exists extracted_documents (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references document_extraction_sessions (id) on delete cascade,
  policy_document_id uuid references policy_documents (id) on delete set null,
  file_digest text not null,
  page_count int not null default 0 check (page_count >= 0),
  classification text not null default 'unsupported',
  parser_id text,
  parser_version text,
  pages_json jsonb not null default '[]'::jsonb,
  extracted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- 4. Asset candidates
-- =============================================================================

create table if not exists asset_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references document_extraction_sessions (id) on delete cascade,
  household_id uuid not null references households (id) on delete cascade,
  asset_type candidate_asset_type not null,
  identity_fingerprint text not null,
  display_label text not null,
  occupancy text check (occupancy in ('principal_residence', 'rental', 'unknown')),
  match_classification candidate_match_classification not null default 'new',
  decision candidate_decision not null default 'undecided',
  review_status text not null default 'pending' check (review_status in ('pending', 'reviewing', 'confirmed', 'skipped', 'approved')),
  source_document_ids uuid[] not null default '{}',
  selected_facts_json jsonb not null default '{}'::jsonb,
  conflicts_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- 5. Extracted fact assertions
-- =============================================================================

create table if not exists extracted_fact_assertions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references extracted_documents (id) on delete cascade,
  candidate_id uuid references asset_candidates (id) on delete set null,
  page_number int not null check (page_number > 0),
  entity_scope text not null check (entity_scope in ('policy', 'property', 'vehicle', 'coverage', 'premium', 'notice')),
  field_path text not null,
  raw_text text not null,
  parsed_value jsonb,
  normalized_value jsonb,
  parser_id text not null,
  parser_version text not null,
  confidence float not null check (confidence >= 0 and confidence <= 1),
  authority assertion_authority not null,
  confirmation_status assertion_confirmation_status not null default 'extracted',
  confirmed_by uuid references profiles (id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 6. Candidate conflicts
-- =============================================================================

create table if not exists candidate_conflicts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references asset_candidates (id) on delete cascade,
  field_path text not null,
  assertion_ids uuid[] not null,
  selected_assertion_id uuid references extracted_fact_assertions (id),
  reason text not null,
  created_at timestamptz not null default now()
);

-- =============================================================================
-- 7. Indexes
-- =============================================================================

create index if not exists idx_extracted_documents_session on extracted_documents (session_id);
create index if not exists idx_extracted_documents_digest on extracted_documents (file_digest);

create index if not exists idx_asset_candidates_session on asset_candidates (session_id);
create index if not exists idx_asset_candidates_household_fingerprint on asset_candidates (household_id, asset_type, identity_fingerprint);

create index if not exists idx_assertions_document on extracted_fact_assertions (document_id);
create index if not exists idx_assertions_candidate on extracted_fact_assertions (candidate_id);

create index if not exists idx_conflicts_candidate on candidate_conflicts (candidate_id);

-- =============================================================================
-- 8. RLS
-- =============================================================================

alter table document_extraction_sessions enable row level security;
alter table extracted_documents enable row level security;
alter table asset_candidates enable row level security;
alter table extracted_fact_assertions enable row level security;
alter table candidate_conflicts enable row level security;

create policy document_extraction_sessions_select on document_extraction_sessions
  for select using (can_access_household(household_id));

create policy document_extraction_sessions_insert on document_extraction_sessions
  for insert with check (can_access_household(household_id));

create policy document_extraction_sessions_update on document_extraction_sessions
  for update using (can_access_household(household_id));

create policy extracted_documents_select on extracted_documents
  for select using (exists (
    select 1 from document_extraction_sessions s
    where s.id = extracted_documents.session_id and can_access_household(s.household_id)
  ));

create policy extracted_documents_insert on extracted_documents
  for insert with check (exists (
    select 1 from document_extraction_sessions s
    where s.id = extracted_documents.session_id and can_access_household(s.household_id)
  ));

create policy extracted_documents_update on extracted_documents
  for update using (exists (
    select 1 from document_extraction_sessions s
    where s.id = extracted_documents.session_id and staff_can_access_household(s.household_id)
  ));

create policy asset_candidates_select on asset_candidates
  for select using (can_access_household(household_id));

create policy asset_candidates_insert on asset_candidates
  for insert with check (can_access_household(household_id));

create policy asset_candidates_update on asset_candidates
  for update using (can_access_household(household_id));

create policy extracted_fact_assertions_select on extracted_fact_assertions
  for select using (
    exists (
      select 1 from document_extraction_sessions s
      join extracted_documents d on d.session_id = s.id
      where d.id = extracted_fact_assertions.document_id and can_access_household(s.household_id)
    )
    or exists (
      select 1 from asset_candidates c
      where c.id = extracted_fact_assertions.candidate_id and can_access_household(c.household_id)
    )
  );

create policy extracted_fact_assertions_insert on extracted_fact_assertions
  for insert with check (
    exists (
      select 1 from document_extraction_sessions s
      join extracted_documents d on d.session_id = s.id
      where d.id = extracted_fact_assertions.document_id and can_access_household(s.household_id)
    )
  );

create policy extracted_fact_assertions_update on extracted_fact_assertions
  for update using (
    exists (
      select 1 from document_extraction_sessions s
      join extracted_documents d on d.session_id = s.id
      where d.id = extracted_fact_assertions.document_id and can_access_household(s.household_id)
    )
  );

create policy candidate_conflicts_select on candidate_conflicts
  for select using (exists (
    select 1 from asset_candidates c
    where c.id = candidate_conflicts.candidate_id and can_access_household(c.household_id)
  ));

create policy candidate_conflicts_insert on candidate_conflicts
  for insert with check (exists (
    select 1 from asset_candidates c
    where c.id = candidate_conflicts.candidate_id and can_access_household(c.household_id)
  ));

-- =============================================================================
-- 9. Grants
-- =============================================================================

grant usage on schema public to authenticated;
grant select, insert, update, delete on document_extraction_sessions, extracted_documents, asset_candidates, extracted_fact_assertions, candidate_conflicts to authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant select, insert, update, delete on document_extraction_sessions, extracted_documents, asset_candidates, extracted_fact_assertions, candidate_conflicts to service_role;
