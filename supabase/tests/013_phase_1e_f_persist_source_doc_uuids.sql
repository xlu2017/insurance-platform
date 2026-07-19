begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

-- Set up two customers and households.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('60000000-0000-0000-0000-00000000c001', 'persistowner@example.com', '{"role":"customer"}'::jsonb),
  ('60000000-0000-0000-0000-00000000c002', 'persistother@example.com', '{"role":"customer"}'::jsonb);

insert into profiles (id, email, full_name, role)
values
  ('60000000-0000-0000-0000-00000000c001', 'persistowner@example.com', 'Persist Owner', 'customer'),
  ('60000000-0000-0000-0000-00000000c002', 'persistother@example.com', 'Persist Other', 'customer')
on conflict (id) do update set role = excluded.role, full_name = excluded.full_name;

insert into households (id, name, province, owner_profile_id, onboarding_step, autopilot_active)
values
  ('60000000-0000-0000-0000-00000000d001', 'Persist Household', 'AB', '60000000-0000-0000-0000-00000000c001', 'complete', true),
  ('60000000-0000-0000-0000-00000000d002', 'Other Persist Household', 'AB', '60000000-0000-0000-0000-00000000c002', 'complete', true);

insert into household_members (household_id, profile_id)
values
  ('60000000-0000-0000-0000-00000000d001', '60000000-0000-0000-0000-00000000c001'),
  ('60000000-0000-0000-0000-00000000d002', '60000000-0000-0000-0000-00000000c002');

-- Sessions for both households.
insert into document_extraction_sessions (id, household_id, status)
values
  ('70000000-0000-0000-0000-00000000e001', '60000000-0000-0000-0000-00000000d001', 'open'),
  ('70000000-0000-0000-0000-00000000e002', '60000000-0000-0000-0000-00000000d002', 'open');

set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';

-- 1. Persist an analysis with a candidate whose source_document_ids reference
--    the current run's extracted document UUIDs.
select lives_ok(
  format($q$
    select persist_document_analysis_v1(
      %L::uuid,
      %L::uuid,
      %L,
      %L::uuid,
      '{"modelProvider":"generic","modelId":"generic","validatedOutput":{"assets":[]}}'::jsonb,
      '[{"id":"%s","file_digest":"abc","page_count":1,"classification":"auto_policy_renewal","parser_id":"native-document-analysis","parser_version":"1.0.0","pages_json":[]}]'::jsonb,
      '[{"id":"%s","identity_fingerprint":"fp-car","asset_type":"vehicle","match_classification":"new","display_label":"Car","source_document_ids":["%s"]}]'::jsonb,
      null,
      null
    )
  $q$,
  '60000000-0000-0000-0000-00000000d001',
  '70000000-0000-0000-0000-00000000e001',
  'persist-test-1',
  gen_random_uuid(),
  '80000000-0000-0000-0000-00000000f001',
  '90000000-0000-0000-0000-00000000f001',
  '80000000-0000-0000-0000-00000000f001'
  ),
  'persist accepts source document UUIDs from the current analysis run'
);

select is(
  (select source_document_ids from asset_candidates where household_id = '60000000-0000-0000-0000-00000000d001'::uuid),
  ARRAY['80000000-0000-0000-0000-00000000f001'::uuid],
  'source document ids are preserved on the candidate'
);

-- 2. Create a candidate in the other household, then try to reference its
--    extracted document from the first household. This must fail.
insert into document_analysis_runs (
  id, session_id, household_id, model_provider, model_id, validated_output_json, client_request_id
) values (
  '71000000-0000-0000-0000-00000000a001'::uuid,
  '70000000-0000-0000-0000-00000000e002'::uuid,
  '60000000-0000-0000-0000-00000000d002'::uuid,
  'generic',
  'generic',
  '{}'::jsonb,
  'other-run'
);

insert into extracted_documents (
  id,
  session_id,
  household_id,
  policy_document_id,
  file_digest,
  page_count,
  classification,
  parser_id,
  parser_version,
  pages_json,
  analysis_run_id
) values (
  '81000000-0000-0000-0000-00000000f001'::uuid,
  '70000000-0000-0000-0000-00000000e002'::uuid,
  '60000000-0000-0000-0000-00000000d002'::uuid,
  null,
  'otherdigest',
  1,
  'auto_policy_renewal',
  'native-document-analysis',
  '1.0.0',
  '[]'::jsonb,
  '71000000-0000-0000-0000-00000000a001'::uuid
);

select throws_ok(
  format($q$
    select persist_document_analysis_v1(
      %L::uuid,
      %L::uuid,
      %L,
      %L::uuid,
      '{"modelProvider":"generic","modelId":"generic","validatedOutput":{"assets":[]}}'::jsonb,
      '[{"id":"%s","file_digest":"def","page_count":1,"classification":"auto_policy_renewal","parser_id":"native-document-analysis","parser_version":"1.0.0","pages_json":[]}]'::jsonb,
      '[{"id":"%s","identity_fingerprint":"fp-property","asset_type":"property","match_classification":"new","display_label":"Home","source_document_ids":["%s"]}]'::jsonb,
      null,
      null
    )
  $q$,
  '60000000-0000-0000-0000-00000000d001',
  '70000000-0000-0000-0000-00000000e001',
  'persist-test-2',
  gen_random_uuid(),
  '80000000-0000-0000-0000-00000000f002',
  '90000000-0000-0000-0000-00000000f002',
  '81000000-0000-0000-0000-00000000f001'
  ),
  'P0001',
  'candidate references source document id not belonging to this household',
  'persist rejects cross-household source document references'
);

-- 3. Reference a prior-run extracted document that belongs to the same household.
insert into document_analysis_runs (
  id, session_id, household_id, model_provider, model_id, validated_output_json, client_request_id
) values (
  '72000000-0000-0000-0000-00000000a001'::uuid,
  '70000000-0000-0000-0000-00000000e001'::uuid,
  '60000000-0000-0000-0000-00000000d001'::uuid,
  'generic',
  'generic',
  '{}'::jsonb,
  'prior-run'
);

insert into extracted_documents (
  id,
  session_id,
  household_id,
  policy_document_id,
  file_digest,
  page_count,
  classification,
  parser_id,
  parser_version,
  pages_json,
  analysis_run_id
) values (
  '82000000-0000-0000-0000-00000000f001'::uuid,
  '70000000-0000-0000-0000-00000000e001'::uuid,
  '60000000-0000-0000-0000-00000000d001'::uuid,
  null,
  'priordigest',
  1,
  'auto_policy_renewal',
  'native-document-analysis',
  '1.0.0',
  '[]'::jsonb,
  '72000000-0000-0000-0000-00000000a001'::uuid
);

select lives_ok(
  format($q$
    select persist_document_analysis_v1(
      %L::uuid,
      %L::uuid,
      %L,
      %L::uuid,
      '{"modelProvider":"generic","modelId":"generic","validatedOutput":{"assets":[]}}'::jsonb,
      '[{"id":"%s","file_digest":"ghi","page_count":1,"classification":"auto_policy_renewal","parser_id":"native-document-analysis","parser_version":"1.0.0","pages_json":[]}]'::jsonb,
      '[{"id":"%s","identity_fingerprint":"fp-prior","asset_type":"property","match_classification":"new","display_label":"Prior Home","source_document_ids":["%s"]}]'::jsonb,
      null,
      null
    )
  $q$,
  '60000000-0000-0000-0000-00000000d001',
  '70000000-0000-0000-0000-00000000e001',
  'persist-test-3',
  gen_random_uuid(),
  '80000000-0000-0000-0000-00000000f003',
  '90000000-0000-0000-0000-00000000f003',
  '82000000-0000-0000-0000-00000000f001'
  ),
  'persist accepts source document UUIDs from a prior run in the same household'
);

select * from finish();
rollback;
