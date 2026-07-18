-- Phase 1E-C: separate customer field review records from immutable LLM output.

-- ---------------------------------------------------------------------------
-- 1. Review actions
-- ---------------------------------------------------------------------------

create type candidate_field_review_action as enum (
  'confirm',
  'correct',
  'unknown',
  'change_mandate',
  'reset_mandate_to_current'
);

-- ---------------------------------------------------------------------------
-- 2. Field review table
-- ---------------------------------------------------------------------------

create table if not exists candidate_field_reviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references asset_candidates(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  field_path text not null,
  action candidate_field_review_action not null,
  corrected_value jsonb,
  mandate_rule_json jsonb,
  reviewed_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, field_path)
);

create index if not exists idx_candidate_field_reviews_candidate on candidate_field_reviews (candidate_id);
create index if not exists idx_candidate_field_reviews_household on candidate_field_reviews (household_id);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------

alter table candidate_field_reviews enable row level security;

create policy candidate_field_reviews_select on candidate_field_reviews
  for select using (can_access_household(household_id));

create policy candidate_field_reviews_insert on candidate_field_reviews
  for insert with check (can_access_household(household_id));

create policy candidate_field_reviews_update on candidate_field_reviews
  for update using (can_access_household(household_id));

create policy candidate_field_reviews_delete on candidate_field_reviews
  for delete using (can_access_household(household_id));

-- ---------------------------------------------------------------------------
-- 4. Trigger for updated_at
-- ---------------------------------------------------------------------------

create or replace function set_candidate_field_reviews_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_candidate_field_reviews_updated_at on candidate_field_reviews;
create trigger set_candidate_field_reviews_updated_at
  before update on candidate_field_reviews
  for each row
  execute function set_candidate_field_reviews_updated_at();
