-- Phase 1F-A: grant authenticated users access to candidate_field_reviews.
-- The table was created with RLS but without grants, causing 403s in the
-- mobile review-entities screen.

grant select, insert, update on candidate_field_reviews to authenticated;
grant select, insert, update, delete on candidate_field_reviews to service_role;
