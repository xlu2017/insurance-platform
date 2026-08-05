-- Permissions required by the mobile manual-entry and Documents screens.
-- These were missing from earlier migrations that added the tables and RLS policies.

begin;

grant select on document_processing_batch_items to authenticated;

commit;
