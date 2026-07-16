-- Harden document storage: bucket size and MIME limits, strict household-scoped storage policies,
-- and a server-side upload function the mobile app can invoke.

-- Update the private policy-documents bucket with hard limits.
update storage.buckets
set
  file_size_limit = 10485760, -- 10 MB
  allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
where id = 'policy-documents';

-- Drop the old permissive storage policies and replace them with strict household-scoped ones.
drop policy if exists "household docs read" on storage.objects;
drop policy if exists "household docs write" on storage.objects;

-- Only allow reads on objects inside a household the caller can access.
create policy "household docs read" on storage.objects for select
  using (
    bucket_id = 'policy-documents'
    and (string_to_array(name, '/'))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and can_access_household(((string_to_array(name, '/'))[1])::uuid)
  );

-- Only allow writes that:
--   - target the policy-documents bucket
--   - use a household-scoped path
--   - are within the bucket size and MIME limits (belt-and-suspenders with the Edge Function)
--   - are performed by a member of the household or staff with access.
create policy "household docs write" on storage.objects for insert
  with check (
    bucket_id = 'policy-documents'
    and (string_to_array(name, '/'))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and can_access_household(((string_to_array(name, '/'))[1])::uuid)
    and coalesce((metadata->>'size')::bigint, 0) <= 10485760
    and coalesce(metadata->>'mimetype', '') in ('application/pdf', 'image/jpeg', 'image/png')
  );

-- Only the household owner/member or staff can delete their own objects.
create policy "household docs delete" on storage.objects for delete
  using (
    bucket_id = 'policy-documents'
    and (string_to_array(name, '/'))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and can_access_household(((string_to_array(name, '/'))[1])::uuid)
  );
