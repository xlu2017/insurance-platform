begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

-- Set up a customer household with ownership and staff user.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('40000000-0000-0000-0000-00000000a001', 'doccustomer@example.com', '{"role":"customer"}'::jsonb),
  ('40000000-0000-0000-0000-00000000a002', 'docother@example.com', '{"role":"customer"}'::jsonb);

insert into profiles (id, email, full_name, role)
values
  ('40000000-0000-0000-0000-00000000a001', 'doccustomer@example.com', 'Doc Customer', 'customer'),
  ('40000000-0000-0000-0000-00000000a002', 'docother@example.com', 'Doc Other', 'customer')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

insert into households (id, name, province, owner_profile_id, onboarding_step, autopilot_active)
values ('40000000-0000-0000-0000-00000000b001', 'Doc Household', 'AB', '40000000-0000-0000-0000-00000000a001', 'complete', true);

insert into household_members (household_id, profile_id)
values ('40000000-0000-0000-0000-00000000b001', '40000000-0000-0000-0000-00000000a001');

-- 1. The policy-documents bucket has a size and MIME-type limit.
select is(
  (select file_size_limit from storage.buckets where id = 'policy-documents'),
  10485760::bigint,
  'policy-documents bucket size limit is 10 MB'
);

select bag_eq(
  $$select unnest(allowed_mime_types) from storage.buckets where id = 'policy-documents' order by 1$$,
  $$values ('application/pdf'), ('image/jpeg'), ('image/png')$$,
  'policy-documents bucket allows only pdf, jpeg and png'
);

-- Direct metadata insert works for the owner and is restricted to members by RLS.
set local role authenticated;
set local request.jwt.claims to '{"sub":"40000000-0000-0000-0000-00000000a001","role":"authenticated"}';

-- 2. Owner can insert a document metadata row.
select lives_ok(
  $$insert into policy_documents (id, household_id, category, status, storage_path, file_name, mime_type, size_bytes)
    values ('40000000-0000-0000-0000-00000000c001', '40000000-0000-0000-0000-00000000b001', 'current_auto_policy', 'uploaded', '40000000-0000-0000-0000-00000000b001/test.pdf', 'test.pdf', 'application/pdf', 1234)$$,
  'household owner can insert document metadata'
);

-- 3. A different customer cannot forge a document row for another household.
set local request.jwt.claims to '{"sub":"40000000-0000-0000-0000-00000000a002","role":"authenticated"}';
select throws_ok(
  $$insert into policy_documents (id, household_id, category, status, storage_path, file_name, mime_type, size_bytes)
    values ('40000000-0000-0000-0000-00000000c002', '40000000-0000-0000-0000-00000000b001', 'current_auto_policy', 'uploaded', '40000000-0000-0000-0000-00000000b001/forged.pdf', 'forged.pdf', 'application/pdf', 1234)$$,
  '42501',
  null,
  'non-member cannot insert document metadata for another household'
);

-- 4. Document status updates are staff-only; the owner cannot change status directly.
set local request.jwt.claims to '{"sub":"40000000-0000-0000-0000-00000000a001","role":"authenticated"}';
select lives_ok(
  $$update policy_documents set status = 'in_review' where id = '40000000-0000-0000-0000-00000000c001'$$,
  'customer update attempt does not throw but changes no rows'
);
select is(
  (select status from policy_documents where id = '40000000-0000-0000-0000-00000000c001'),
  'uploaded',
  'customer cannot change document status'
);

-- 5. Document file size must be non-negative.
select throws_ok(
  $$insert into policy_documents (id, household_id, category, status, storage_path, file_name, mime_type, size_bytes, uploaded_by)
    values ('40000000-0000-0000-0000-00000000c004', '40000000-0000-0000-0000-00000000b001', 'current_auto_policy', 'uploaded', '40000000-0000-0000-0000-00000000b001/neg.pdf', 'neg.pdf', 'application/pdf', -1, '40000000-0000-0000-0000-00000000a001')$$,
  '23514',
  null,
  'document size_bytes must be non-negative'
);

-- 6. The uploaded_by column is set automatically from auth.uid().
select is(
  (select uploaded_by from policy_documents where id = '40000000-0000-0000-0000-00000000c001'),
  '40000000-0000-0000-0000-00000000a001'::uuid,
  'uploaded_by is set from auth uid'
);

select * from finish();
rollback;
