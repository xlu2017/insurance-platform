-- Fix households SELECT RLS so INSERT ... RETURNING (used by supabase-js insert().select())
-- can evaluate the policy against the newly inserted row. The previous policy relied on
-- can_access_household(id), which queries the households table and cannot see the new row
-- within the same RETURNING projection, causing every household creation via the mobile
-- app to fail with "new row violates row-level security policy".
drop policy if exists households_select on public.households;
create policy households_select on public.households for select
  using (owner_profile_id = auth.uid() or can_access_household(id));
