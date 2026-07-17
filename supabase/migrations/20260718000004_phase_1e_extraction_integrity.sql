-- Phase 1E integrity: stable identities, real digests, and restricted direct DML.

-- Prevent duplicate extraction of the same PDF in the same household.
alter table extracted_documents
  add constraint extracted_documents_household_digest_unique
  unique (household_id, file_digest);

-- Prevent duplicate candidates for the same asset within one session.
alter table asset_candidates
  add constraint asset_candidates_session_identity_unique
  unique (session_id, asset_type, identity_fingerprint);

-- Remove invented default values that were being applied to new assets.
alter table vehicles
  alter column primary_use drop default;

alter table properties
  alter column dwelling_type drop default;

-- Revoke direct authenticated DML on extraction evidence/conflict tables;
-- these should be populated only by the extraction service or RPCs.
revoke insert, update, delete on extracted_fact_assertions from authenticated;
revoke insert, update, delete on candidate_conflicts from authenticated;
