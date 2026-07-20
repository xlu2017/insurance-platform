-- Allow authenticated users to update asset candidate display labels from the mobile app.
grant update on asset_candidates to authenticated;

drop policy if exists asset_candidates_update on asset_candidates;
create policy asset_candidates_update on asset_candidates
  for update using (can_access_household(household_id))
  with check (can_access_household(household_id));
