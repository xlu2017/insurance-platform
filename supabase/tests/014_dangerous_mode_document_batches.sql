begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- Set a minimal JWT claim so policy_document triggers populate uploaded_by without
-- triggering the server-digest guard (which fires only when auth.role() is not null).
set local request.jwt.claims to '{"sub":"70000000-0000-0000-0000-00000000a001"}';

insert into auth.users (id, email, raw_user_meta_data)
values (
  '70000000-0000-0000-0000-00000000a001',
  'batchowner@example.com',
  '{"role":"customer"}'::jsonb
);
insert into profiles (id, email, full_name, role)
values (
  '70000000-0000-0000-0000-00000000a001',
  'batchowner@example.com',
  'Batch Owner',
  'customer'
)
on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;
insert into households (id, name, province, owner_profile_id, onboarding_step, autopilot_active)
values (
  '70000000-0000-0000-0000-00000000b001',
  'Batch Household',
  'AB',
  '70000000-0000-0000-0000-00000000a001',
  'documents',
  false
)
on conflict (id) do nothing;
insert into household_members (household_id, profile_id, member_role)
values (
  '70000000-0000-0000-0000-00000000b001',
  '70000000-0000-0000-0000-00000000a001',
  'owner'
)
on conflict (household_id, profile_id) do nothing;

insert into household_document_processing_settings (household_id)
values ('70000000-0000-0000-0000-00000000b001')
on conflict (household_id) do nothing;

select is(
  (select dangerous_mode_enabled from household_document_processing_settings where household_id = '70000000-0000-0000-0000-00000000b001'),
  false,
  'Dangerous mode defaults to safe mode'
);

insert into document_extraction_sessions (id, household_id, created_by, status)
values (
  '70000000-0000-0000-0000-00000000c001',
  '70000000-0000-0000-0000-00000000b001',
  '70000000-0000-0000-0000-00000000a001',
  'open'
)
on conflict (id) do nothing;
insert into document_processing_batches (
  id, household_id, created_by, client_request_id, session_id, mode_snapshot, settings_version
) values (
  '70000000-0000-0000-0000-00000000d001',
  '70000000-0000-0000-0000-00000000b001',
  '70000000-0000-0000-0000-00000000a001',
  'batch-request-1',
  '70000000-0000-0000-0000-00000000c001',
  'safe',
  1
)
on conflict (id) do nothing;

insert into policy_documents (
  id, household_id, category, status, storage_path, file_name, mime_type, size_bytes, uploaded_by, content_sha256
) values (
  '70000000-0000-0000-0000-00000000e001',
  '70000000-0000-0000-0000-00000000b001',
  'current_auto_policy',
  'uploaded',
  '70000000-0000-0000-0000-00000000b001/70000000-0000-0000-0000-00000000e001.pdf',
  'first-name.pdf',
  'application/pdf',
  100,
  '70000000-0000-0000-0000-00000000a001',
  repeat('a', 64)
);

select throws_ok(
  $$insert into policy_documents (
      household_id, category, status, storage_path, file_name, mime_type, size_bytes, uploaded_by, content_sha256
    ) values (
      '70000000-0000-0000-0000-00000000b001', 'current_auto_policy', 'uploaded',
      'duplicate.pdf', 'duplicate.pdf', 'application/pdf', 100,
      '70000000-0000-0000-0000-00000000a001', repeat('a', 64)
    )$$,
  '23505',
  null,
  'one household cannot store a second canonical row for the same digest'
);

select lives_ok(
  $$insert into document_processing_batch_items (
      batch_id, household_id, client_item_id, policy_document_id, selected_file_name,
      category, content_sha256, deduplicated, duplicate_of_policy_document_id, status
    ) values
      (
        '70000000-0000-0000-0000-00000000d001', '70000000-0000-0000-0000-00000000b001',
        'selection-1', '70000000-0000-0000-0000-00000000e001', 'first-name.pdf',
        'current_auto_policy', repeat('a', 64), false, null, 'uploaded'
      ),
      (
        '70000000-0000-0000-0000-00000000d001', '70000000-0000-0000-0000-00000000b001',
        'selection-2', '70000000-0000-0000-0000-00000000e001', 'new-name.pdf',
        'current_auto_policy', repeat('a', 64), true,
        '70000000-0000-0000-0000-00000000e001', 'deduplicated'
      )$$,
  'duplicate selections can reuse one canonical policy document'
);

select is(
  (select count(*) from document_processing_batch_items where batch_id = '70000000-0000-0000-0000-00000000d001'),
  2::bigint,
  'both user selections remain visible in the batch'
);

select set_eq(
  $$select selected_file_name from document_processing_batch_items where batch_id = '70000000-0000-0000-0000-00000000d001'$$,
  $$values ('first-name.pdf'::text), ('new-name.pdf'::text)$$,
  'new filenames are retained only as selection metadata'
);

select throws_ok(
  $$insert into document_processing_batch_items (
      batch_id, household_id, client_item_id, policy_document_id, selected_file_name,
      category, content_sha256, deduplicated, status
    ) values (
      '70000000-0000-0000-0000-00000000d001', '70000000-0000-0000-0000-00000000b001',
      'selection-1', '70000000-0000-0000-0000-00000000e001', 'third-name.pdf',
      'current_auto_policy', repeat('a', 64), true, 'deduplicated'
    )$$,
  '23505',
  null,
  'client item identity is idempotent and does not depend on filename or order'
);

select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_provider_files_policy_document_once'
      and indexdef like 'CREATE UNIQUE INDEX%'
  ),
  'a canonical policy document has one provider transmission claim'
);

update household_document_processing_settings
set dangerous_mode_enabled = true, setting_version = setting_version + 1
where household_id = '70000000-0000-0000-0000-00000000b001';

select is(
  (select mode_snapshot from document_processing_batches where id = '70000000-0000-0000-0000-00000000d001'),
  'safe',
  'a settings change does not mutate an existing batch snapshot'
);

update household_document_processing_settings
set dangerous_mode_enabled = false, setting_version = setting_version + 1
where household_id = '70000000-0000-0000-0000-00000000b001';

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000000-0000-0000-0000-00000000a001","role":"authenticated"}';

select throws_ok(
  $$select * from household_document_processing_settings$$,
  '42501',
  'permission denied for table household_document_processing_settings',
  'customers cannot read protected provider configuration from settings'
);

select throws_ok(
  $$select * from document_processing_batches$$,
  '42501',
  'permission denied for table document_processing_batches',
  'customers cannot read protected provider configuration from batches'
);

select throws_ok(
  $$select persist_document_batch_analysis_v1(
      '70000000-0000-0000-0000-00000000d001',
      '70000000-0000-0000-0000-00000000b001',
      '70000000-0000-0000-0000-00000000c001',
      'untrusted-request'
    )$$,
  '42501',
  null,
  'customers cannot bypass the atomic service persistence boundary'
);

select lives_ok(
  $$select enable_dangerous_mode_v1(
      '70000000-0000-0000-0000-00000000b001',
      'dangerous-mode-v1', 'processor-v1', 'kimi-k3', 'kimi-k3-test',
      true, true, true, true
    )$$,
  'authenticated OAuth or SSO sessions can enable Dangerous mode after explicit consent'
);

set local role service_role;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role"}';

select is(
  (
    select reauthenticated_at
    from household_document_processing_setting_events
    where household_id = '70000000-0000-0000-0000-00000000b001'
      and event_type = 'enabled'
    order by created_at desc
    limit 1
  ),
  null::timestamptz,
  'OAuth enable does not fabricate a separate password reauthentication timestamp'
);

select ok(
  (select dangerous_mode_enabled from household_document_processing_settings
    where household_id = '70000000-0000-0000-0000-00000000b001')
  and exists (
    select 1 from household_document_processing_setting_events
    where household_id = '70000000-0000-0000-0000-00000000b001'
      and event_type = 'enabled'
  )
  and exists (
    select 1 from audit_events
    where household_id = '70000000-0000-0000-0000-00000000b001'
      and action = 'dangerous_mode_enabled'
  ),
  'Dangerous mode state, event telemetry and audit are committed together'
);

update document_processing_batches set status = 'queued'
where id = '70000000-0000-0000-0000-00000000d001';

select is(
  claim_document_processing_batch_v1(
    '70000000-0000-0000-0000-00000000d001',
    '70000000-0000-0000-0000-00000000b001',
    120
  ),
  true,
  'the first worker acquires the durable batch lease'
);

select is(
  claim_document_processing_batch_v1(
    '70000000-0000-0000-0000-00000000d001',
    '70000000-0000-0000-0000-00000000b001',
    120
  ),
  false,
  'a duplicate worker cannot acquire the active lease'
);

select * from finish();
rollback;
