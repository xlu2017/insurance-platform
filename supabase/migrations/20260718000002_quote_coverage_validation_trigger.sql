-- Fix the quote_coverages validation trigger so that any material change to
-- raw or normalized coverage resets the validation status to draft. The previous
-- version only checked the legacy `coverage` column, which allowed an update
-- that changed `normalized_coverage` (e.g., from a validated value to null when
-- saving as draft) to leave the row marked `valid` and violate the metadata check.

create or replace function reset_quote_coverage_validation()
returns trigger as $$
begin
  if old.coverage is distinct from new.coverage
     or old.raw_coverage is distinct from new.raw_coverage
     or old.normalized_coverage is distinct from new.normalized_coverage then
    new.validation_status := 'draft';
    new.validated_at := null;
    new.validated_by := null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists quote_coverages_coverage_changed on quote_coverages;
create trigger quote_coverages_coverage_changed
  before update on quote_coverages
  for each row
  execute function reset_quote_coverage_validation();
