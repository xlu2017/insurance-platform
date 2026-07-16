-- Corrective Phase 1D: quote coverage validation status and quality states.

-- =============================================================================
-- 1. Quote validation enum and columns
-- =============================================================================

create type quote_validation_status as enum (
  'draft',
  'incomplete',
  'valid',
  'invalid',
  'superseded'
);

alter table quote_coverages
  add column if not exists validation_status quote_validation_status not null default 'draft',
  add column if not exists validation_errors jsonb not null default '[]'::jsonb,
  add column if not exists validated_at timestamptz,
  add column if not exists validated_by uuid references profiles (id),
  add column if not exists coverage_schema_version int not null default 2,
  add column if not exists data_source text;

-- =============================================================================
-- 2. Backfill existing quote coverages that already survived canonicalization
--    as valid under schema version 2. New coverages remain draft until the
--    validated quote boundary promotes them.
-- =============================================================================

update quote_coverages
set validation_status = 'valid',
    coverage_schema_version = 2,
    validated_at = coalesce(validated_at, now())
where validation_status = 'draft';

-- =============================================================================
-- 3. Trigger: keep validation_status in sync with the coverage schema.
--    Updating coverage resets the row to draft so it must be re-validated.
--    This is a lightweight guard; full validation runs in the controlled
--    quote-write boundary.
-- =============================================================================

create or replace function reset_quote_coverage_validation()
returns trigger as $$
begin
  if old.coverage is distinct from new.coverage then
    new.validation_status := 'draft';
    new.validated_at := null;
    new.validated_by := null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists quote_coverages_coverage_changed on quote_coverages;
create trigger quote_coverages_coverage_changed
  before update on quote_coverages
  for each row
  execute function reset_quote_coverage_validation();

-- =============================================================================
-- 4. Index to help the recommendation loader filter valid components.
-- =============================================================================

create index if not exists idx_quote_coverages_validation_status
  on quote_coverages (validation_status);
