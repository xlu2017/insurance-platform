begin;
create extension if not exists pgtap with schema extensions;

select plan(8);

set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';

-- 1. Service role can persist a valid quote and receives a success payload.
select is(
  (
    select persist_case_quote_v2(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '00000000-0000-0000-0000-000000000004'::uuid,
      '10000000-0000-0000-0000-000000000003'::uuid,
      'bindable'::quote_state,
      false,
      'manual_entry'::quote_data_source,
      '[{
        "product_line": "auto",
        "asset_id": "22000000-0000-0000-0000-000000000001",
        "annual_premium_cents": 150000,
        "raw_coverage": {"thirdPartyLiabilityCents": 200000000, "coverageForm": "comprehensive", "collisionIncluded": true, "collisionDeductibleCents": 50000, "comprehensiveIncluded": true, "comprehensiveDeductibleCents": 50000, "glassDeductibleCents": null, "accidentForgivenessIncluded": true, "rentalVehicleCoverageIncluded": true, "nonOwnedAutomobileIncluded": false, "familyProtectionIncluded": false, "depreciationWaiverIncluded": false, "oemPartsIncluded": false, "roadsideAssistanceIncluded": false, "disappearingDeductibleIncluded": false, "glassCoverageIncluded": false, "telematicsRequired": false, "vehicleClass": "personal", "financingStatus": "owned"},
        "normalized_coverage": {"thirdPartyLiabilityCents": 200000000, "coverageForm": "comprehensive", "collisionIncluded": true, "collisionDeductibleCents": 50000, "comprehensiveIncluded": true, "comprehensiveDeductibleCents": 50000, "glassDeductibleCents": null, "accidentForgivenessIncluded": true, "rentalVehicleCoverageIncluded": true, "nonOwnedAutomobileIncluded": false, "familyProtectionIncluded": false, "depreciationWaiverIncluded": false, "oemPartsIncluded": false, "roadsideAssistanceIncluded": false, "disappearingDeductibleIncluded": false, "glassCoverageIncluded": false, "telematicsRequired": false, "vehicleClass": "personal", "financingStatus": "owned"},
        "validation_status": "valid",
        "validation_errors": [],
        "coverage_schema_version": 2
      }]'::jsonb
    ) ->> 'success'
  )::boolean,
  true,
  'persist_case_quote_v2 succeeds for a valid single-asset quote'
);

-- 2. The persisted coverage row carries raw, normalized and provenance metadata.
select is(
  (
    select count(*)::int
    from quote_coverages qc
    join quote_policy_components qpc on qc.quote_component_id = qpc.id
    join quotes q on qpc.quote_id = q.id
    where q.case_id = '30000000-0000-0000-0000-000000000001'
      and qpc.annual_premium_cents = 150000
      and qc.validation_status = 'valid'
      and qc.raw_coverage is not null
      and qc.normalized_coverage is not null
      and qc.data_source = 'manual_entry'
      and qc.validated_by is not null
      and qc.coverage_schema_version = 2
  ),
  1,
  'valid coverage row stores raw, normalized, data_source, validator and schema version'
);

-- 3. Draft intent does not set normalized coverage or validation metadata.
select is(
  (
    select persist_case_quote_v2(
      '30000000-0000-0000-0000-000000000001'::uuid,
      '00000000-0000-0000-0000-000000000004'::uuid,
      '10000000-0000-0000-0000-000000000003'::uuid,
      'estimate'::quote_state,
      false,
      'manual_entry'::quote_data_source,
      '[{
        "product_line": "auto",
        "asset_id": "22000000-0000-0000-0000-000000000001",
        "annual_premium_cents": 150000,
        "raw_coverage": {"thirdPartyLiabilityCents": 200000000, "coverageForm": "comprehensive"},
        "normalized_coverage": null,
        "validation_status": "draft",
        "validation_errors": [],
        "coverage_schema_version": 2
      }]'::jsonb
    ) ->> 'success'
  )::boolean,
  true,
  'persist_case_quote_v2 stores a draft without normalized coverage'
);

-- 4. The draft coverage row is classified as draft and has no validator.
select is(
  (
    select count(*)::int
    from quote_coverages qc
    join quote_policy_components qpc on qc.quote_component_id = qpc.id
    join quotes q on qpc.quote_id = q.id
    where q.case_id = '30000000-0000-0000-0000-000000000001'
      and qpc.annual_premium_cents = 150000
      and qc.validation_status = 'draft'
      and qc.normalized_coverage is null
      and qc.validated_at is null
      and qc.validated_by is null
  ),
  1,
  'draft coverage row has null normalized coverage and no validator'
);

-- 5. A mismatched expected version is rejected when editing an existing quote.
select throws_like(
  $$select persist_case_quote_v2(
    '30000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000004'::uuid,
    '10000000-0000-0000-0000-000000000003'::uuid,
    'bindable'::quote_state,
    false,
    'manual_entry'::quote_data_source,
    '[{
      "product_line": "auto",
      "asset_id": "22000000-0000-0000-0000-000000000001",
      "annual_premium_cents": 150000,
      "raw_coverage": {"coverageForm": "comprehensive"},
      "normalized_coverage": null,
      "validation_status": "draft",
      "validation_errors": [],
      "coverage_schema_version": 2
    }]'::jsonb,
    '32000000-0000-0000-0000-000000000001'::uuid,
    99
  )$$,
  '%stale quote version%',
  'stale expected version is rejected'
);

-- 6. A non-service role cannot invoke the internal quote persistence RPC.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$select persist_case_quote_v2(
    '30000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000004'::uuid,
    '10000000-0000-0000-0000-000000000003'::uuid,
    'estimate'::quote_state,
    false,
    'manual_entry'::quote_data_source,
    '[]'::jsonb
  )$$,
  '42501',
  'permission denied for function persist_case_quote_v2',
  'authenticated user cannot call persist_case_quote_v2'
);

-- 7. Authenticated users cannot directly insert into the quote-composition tables.
set local role authenticated;
select throws_ok(
  $$insert into quotes (case_id, insurer_id, state) values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'estimate')$$,
  '42501',
  'permission denied for table quotes',
  'authenticated cannot directly insert quotes'
);

select throws_ok(
  $$insert into quote_policy_components (quote_id, product_line, asset_id, annual_premium_cents) values ('32000000-0000-0000-0000-000000000004', 'auto', '22000000-0000-0000-0000-000000000001', 100000)$$,
  '42501',
  'permission denied for table quote_policy_components',
  'authenticated cannot directly insert quote_policy_components'
);

select * from finish();
rollback;
