begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';

-- Test fixtures: a fresh case in comparing_quotes and a current V2 mandate.
insert into optimization_cases (id, household_id, state, notes) values
  ('31000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'comparing_quotes', 'Phase 1D-E pgTAP');

insert into household_coverage_mandates (id, household_id, schema_version, version, jurisdiction, effective_from, is_current, created_by) values
  ('31000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 2, 1, 'AB', now(), true, '00000000-0000-0000-0000-000000000004');

-- 1. An incomplete draft is persisted and quote_readiness reports incomplete.
create temp table incomplete_quote as
select persist_case_quote_v2(
  '31000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000004'::uuid,
  '10000000-0000-0000-0000-000000000003'::uuid,
  'estimate'::quote_state,
  false,
  'manual_entry'::quote_data_source,
  '[{
    "product_line": "auto",
    "asset_id": "22000000-0000-0000-0000-000000000001",
    "annual_premium_cents": 100000,
    "raw_coverage": {"coverageForm": "comprehensive"},
    "normalized_coverage": null,
    "validation_status": "incomplete",
    "validation_errors": [{"path": ["thirdPartyLiabilityCents"], "code": "missing", "message": "Missing liability limit"}],
    "coverage_schema_version": 2
  }]'::jsonb
) as res;

select is((res->>'success')::boolean, true, 'incomplete draft quote is persisted') from incomplete_quote;
select is(
  (select readiness_status from quote_readiness where quote_id = (incomplete_quote.res->>'quoteId')::uuid),
  'incomplete',
  'incomplete draft quote readiness is incomplete'
) from incomplete_quote;

-- 2. not_applicable is preserved in raw coverage and normalized to false; field-level provenance is recorded.
create temp table not_applicable_quote as
select persist_case_quote_v2(
  '31000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000004'::uuid,
  '10000000-0000-0000-0000-000000000003'::uuid,
  'conditional'::quote_state,
  false,
  'manual_entry'::quote_data_source,
  '[{
    "product_line": "auto",
    "asset_id": "22000000-0000-0000-0000-000000000001",
    "annual_premium_cents": 120000,
    "raw_coverage": {"coverageForm": "comprehensive", "thirdPartyLiabilityCents": 200000000, "collisionIncluded": true, "collisionDeductibleCents": 50000, "comprehensiveIncluded": true, "comprehensiveDeductibleCents": 50000, "familyProtectionIncluded": "not_applicable"},
    "normalized_coverage": {"coverageForm": "comprehensive", "thirdPartyLiabilityCents": 200000000, "collisionIncluded": true, "collisionDeductibleCents": 50000, "comprehensiveIncluded": true, "comprehensiveDeductibleCents": 50000, "familyProtectionIncluded": false},
    "validation_status": "valid",
    "validation_errors": [],
    "coverage_schema_version": 2
  }]'::jsonb
) as res;

select is((res->>'success')::boolean, true, 'valid quote with not_applicable coverage is persisted') from not_applicable_quote;

select is(
  (select quote_coverages.raw_coverage->>'familyProtectionIncluded'
   from quote_coverages
   join quote_policy_components on quote_policy_components.id = quote_coverages.quote_component_id
   join quotes on quotes.id = quote_policy_components.quote_id
   where quotes.id = (not_applicable_quote.res->>'quoteId')::uuid),
  'not_applicable',
  'raw coverage preserves not_applicable'
) from not_applicable_quote;

select is(
  (select (quote_coverages.normalized_coverage->>'familyProtectionIncluded')::boolean
   from quote_coverages
   join quote_policy_components on quote_policy_components.id = quote_coverages.quote_component_id
   join quotes on quotes.id = quote_policy_components.quote_id
   where quotes.id = (not_applicable_quote.res->>'quoteId')::uuid),
  false,
  'normalized coverage converts not_applicable to false'
) from not_applicable_quote;

select is(
  (select quote_coverages.field_provenance->'familyProtectionIncluded'->>'dataSource'
   from quote_coverages
   join quote_policy_components on quote_policy_components.id = quote_coverages.quote_component_id
   join quotes on quotes.id = quote_policy_components.quote_id
   where quotes.id = (not_applicable_quote.res->>'quoteId')::uuid),
  'manual_entry',
  'field-level provenance records data source'
) from not_applicable_quote;

select is(
  (select quote_coverages.field_provenance->'familyProtectionIncluded'->>'validatedBy'
   from quote_coverages
   join quote_policy_components on quote_policy_components.id = quote_coverages.quote_component_id
   join quotes on quotes.id = quote_policy_components.quote_id
   where quotes.id = (not_applicable_quote.res->>'quoteId')::uuid),
  '00000000-0000-0000-0000-000000000004',
  'field-level provenance records validator'
) from not_applicable_quote;

select is(
  (select (quote_coverages.field_provenance->'familyProtectionIncluded'->>'coverageSchemaVersion')::int
   from quote_coverages
   join quote_policy_components on quote_policy_components.id = quote_coverages.quote_component_id
   join quotes on quotes.id = quote_policy_components.quote_id
   where quotes.id = (not_applicable_quote.res->>'quoteId')::uuid),
  2,
  'field-level provenance records schema version'
) from not_applicable_quote;

-- 3. Duplicate product-line/asset pair in a single quote is rejected.
select throws_like(
  $$select persist_case_quote_v2(
    '31000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000004'::uuid,
    '10000000-0000-0000-0000-000000000003'::uuid,
    'estimate'::quote_state,
    false,
    'manual_entry'::quote_data_source,
    '[{
      "product_line": "auto",
      "asset_id": "22000000-0000-0000-0000-000000000001",
      "annual_premium_cents": 100000,
      "raw_coverage": {"coverageForm": "comprehensive"},
      "normalized_coverage": null,
      "validation_status": "draft",
      "validation_errors": [],
      "coverage_schema_version": 2
    }, {
      "product_line": "auto",
      "asset_id": "22000000-0000-0000-0000-000000000001",
      "annual_premium_cents": 90000,
      "raw_coverage": {"coverageForm": "comprehensive"},
      "normalized_coverage": null,
      "validation_status": "draft",
      "validation_errors": [],
      "coverage_schema_version": 2
    }]'::jsonb
  )$$,
  '%duplicate product_line and asset_id%',
  'duplicate product-line/asset pair in a single quote is rejected'
);

-- 4. Insurer metadata staleness rejects recommendation publication and customer approval.
insert into recommendations (
  id, case_id, status, version, mandate_version, quote_ids,
  current_total_cents, proposed_total_cents, net_savings_cents,
  reason_codes, comparison, disclosure_version, created_by,
  input_snapshot_json, input_snapshot_digest, engine_output_json, engine_output_digest, rejected_options_json
) values (
  '31000000-0000-0000-0000-000000000003',
  '31000000-0000-0000-0000-000000000002',
  'draft',
  1,
  1,
  '{}',
  0,
  0,
  0,
  '{}',
  '{}'::jsonb,
  'v1',
  '00000000-0000-0000-0000-000000000004',
  '{"quotes":[{"id":"31000000-0000-0000-0000-000000000005","insurer":{"id":"10000000-0000-0000-0000-000000000001","version":1}}]}'::jsonb,
  '0000000000000000000000000000000000000000000000000000000000000000',
  '{}'::jsonb,
  '0000000000000000000000000000000000000000000000000000000000000000',
  '[]'::jsonb
);

update insurers set payment_frequencies = '{"monthly"}'::payment_frequency[] where id = '10000000-0000-0000-0000-000000000001';

select throws_like(
  $$update recommendations set status = 'published' where id = '31000000-0000-0000-0000-000000000003'$$,
  '%insurer metadata changed for quote%',
  'stale insurer metadata rejects recommendation publication'
);

select throws_like(
  $$update recommendations set status = 'customer_approved' where id = '31000000-0000-0000-0000-000000000003'$$,
  '%insurer metadata changed for quote%',
  'stale insurer metadata rejects customer approval'
);

-- 5. Missing insurer version in recommendation snapshot is rejected.
update recommendations set input_snapshot_json = '{"quotes":[{"id":"31000000-0000-0000-0000-000000000005"}]}'::jsonb where id = '31000000-0000-0000-0000-000000000003';

select throws_like(
  $$update recommendations set status = 'published' where id = '31000000-0000-0000-0000-000000000003'$$,
  '%missing insurer version%',
  'recommendation snapshot missing insurer version is rejected'
);

-- 6. persist_engine_recommendation_v2 rejects a canonical input string that does not round-trip to the JSON value.
select throws_like(
  $$select persist_engine_recommendation_v2(
    '31000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000004'::uuid,
    '31000000-0000-0000-0000-000000000004'::uuid,
    1,
    2,
    'AB',
    '26000000-0000-0000-0000-000000000001'::uuid,
    1,
    '{"quoteSnapshot":[{"id":"11111111-1111-1111-1111-111111111111","updated_at":"2026-07-16T00:00:00Z","is_incumbent":true}],"quotes":[{"id":"11111111-1111-1111-1111-111111111111","insurer":{"id":"10000000-0000-0000-0000-000000000001","version":1}}]}'::jsonb,
    '{"quoteSnapshot":[{"id":"22222222-2222-2222-2222-222222222222","updated_at":"2026-07-16T00:00:00Z","is_incumbent":true}],"quotes":[{"id":"22222222-2222-2222-2222-222222222222","insurer":{"id":"10000000-0000-0000-0000-000000000001","version":1}}]}',
    (select encode(extensions.digest('{"quoteSnapshot":[{"id":"22222222-2222-2222-2222-222222222222","updated_at":"2026-07-16T00:00:00Z","is_incumbent":true}],"quotes":[{"id":"22222222-2222-2222-2222-222222222222","insurer":{"id":"10000000-0000-0000-0000-000000000001","version":1}}]}'::bytea, 'sha256'), 'hex')),
    '1.0.0',
    '0000000000000000000000000000000000000000000000000000000000000000',
    '{}'::jsonb,
    '{}',
    (select encode(extensions.digest('{}'::bytea, 'sha256'), 'hex')),
    0,
    0,
    0,
    '{}',
    '{"rank":1}'::jsonb,
    '[]'::jsonb
  )$$,
  '%input snapshot canonical text does not match jsonb value%',
  'persist_engine_recommendation_v2 rejects canonical input mismatch'
);

select * from finish();
rollback;
