-- Corrective Phase 1B: normalize quote coverage JSONB so every auto row is a
-- valid AutoCoverageDetails and every property row is a valid PropertyCoverageDetails.

alter table quote_policy_components add column if not exists asset_id uuid;

create or replace function normalize_quote_auto_coverage(input jsonb)
returns jsonb as $$
select jsonb_strip_nulls(jsonb_build_object(
  'thirdPartyLiabilityCents', coalesce((input->>'thirdPartyLiabilityCents')::bigint, 0),
  'coverageForm', coalesce(input->>'coverageForm', 'liability_only'),
  'collisionIncluded', coalesce((input->>'collisionIncluded')::boolean, false),
  'collisionDeductibleCents', case when input->'collisionDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'collisionDeductibleCents')::bigint, null) end,
  'comprehensiveIncluded', coalesce((input->>'comprehensiveIncluded')::boolean, false),
  'comprehensiveDeductibleCents', case when input->'comprehensiveDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'comprehensiveDeductibleCents')::bigint, null) end,
  'glassDeductibleCents', case when input->'glassDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'glassDeductibleCents')::bigint, null) end,
  'accidentForgivenessIncluded', coalesce((input->>'accidentForgivenessIncluded')::boolean, false),
  'rentalVehicleCoverageIncluded', coalesce((input->>'rentalVehicleCoverageIncluded')::boolean, false),
  'nonOwnedAutomobileIncluded', coalesce((input->>'nonOwnedAutomobileIncluded')::boolean, false),
  'familyProtectionIncluded', coalesce((input->>'familyProtectionIncluded')::boolean, false),
  'depreciationWaiverIncluded', coalesce((input->>'depreciationWaiverIncluded')::boolean, false),
  'oemPartsIncluded', coalesce((input->>'oemPartsIncluded')::boolean, false),
  'roadsideAssistanceIncluded', coalesce((input->>'roadsideAssistanceIncluded')::boolean, false),
  'disappearingDeductibleIncluded', coalesce((input->>'disappearingDeductibleIncluded')::boolean, false),
  'glassCoverageIncluded', coalesce((input->>'glassCoverageIncluded')::boolean, false),
  'telematicsRequired', coalesce((input->>'telematicsRequired')::boolean, false),
  'vehicleClass', coalesce(input->>'vehicleClass', 'personal'),
  'financingStatus', coalesce(input->>'financingStatus', 'owned')
));
$$ language sql immutable;

create or replace function normalize_quote_property_coverage(input jsonb)
returns jsonb as $$
select jsonb_strip_nulls(jsonb_build_object(
  'propertyType', coalesce(input->>'propertyType', 'homeowner'),
  'coverageForm', coalesce(input->>'coverageForm', 'comprehensive'),
  'settlementBasis', coalesce(input->>'settlementBasis', 'replacement_cost'),
  'dwellingLimitCents', coalesce((input->>'dwellingLimitCents')::bigint, 0),
  'contentsLimitCents', coalesce((input->>'contentsLimitCents')::bigint, 0),
  'detachedStructuresLimitCents', coalesce((input->>'detachedStructuresLimitCents')::bigint, 0),
  'personalLiabilityLimitCents', coalesce((input->>'personalLiabilityLimitCents')::bigint, 0),
  'additionalLivingExpenseLimitCents', coalesce((input->>'additionalLivingExpenseLimitCents')::bigint, 0),
  'baseDeductibleCents', coalesce((input->>'baseDeductibleCents')::bigint, 0),
  'waterDeductibleCents', case when input->'waterDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'waterDeductibleCents')::bigint, null) end,
  'windHailIncluded', coalesce((input->>'windHailIncluded')::boolean, false),
  'windHailDeductibleCents', case when input->'windHailDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'windHailDeductibleCents')::bigint, null) end,
  'earthquakeIncluded', coalesce((input->>'earthquakeIncluded')::boolean, false),
  'earthquakeDeductibleCents', case when input->'earthquakeDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'earthquakeDeductibleCents')::bigint, null) end,
  'sewerBackupIncluded', coalesce((input->>'sewerBackupIncluded')::boolean, false),
  'sewerBackupLimitCents', case when input->'sewerBackupLimitCents' = 'null'::jsonb then null else coalesce((input->>'sewerBackupLimitCents')::bigint, null) end,
  'sewerBackupDeductibleCents', case when input->'sewerBackupDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'sewerBackupDeductibleCents')::bigint, null) end,
  'overlandWaterIncluded', coalesce((input->>'overlandWaterIncluded')::boolean, false),
  'overlandWaterLimitCents', case when input->'overlandWaterLimitCents' = 'null'::jsonb then null else coalesce((input->>'overlandWaterLimitCents')::bigint, null) end,
  'overlandWaterDeductibleCents', case when input->'overlandWaterDeductibleCents' = 'null'::jsonb then null else coalesce((input->>'overlandWaterDeductibleCents')::bigint, null) end,
  'groundwaterIncluded', coalesce((input->>'groundwaterIncluded')::boolean, false),
  'iceDamIncluded', coalesce((input->>'iceDamIncluded')::boolean, false),
  'equipmentBreakdownIncluded', coalesce((input->>'equipmentBreakdownIncluded')::boolean, false),
  'serviceLineIncluded', coalesce((input->>'serviceLineIncluded')::boolean, false),
  'bylawCoverageIncluded', coalesce((input->>'bylawCoverageIncluded')::boolean, false),
  'homeSystemsIncluded', coalesce((input->>'homeSystemsIncluded')::boolean, false),
  'cyberCoverageIncluded', coalesce((input->>'cyberCoverageIncluded')::boolean, false),
  'scheduledValuablesIncluded', coalesce((input->>'scheduledValuablesIncluded')::boolean, false),
  'homeBusinessIncluded', coalesce((input->>'homeBusinessIncluded')::boolean, false),
  'shortTermRentalPermissionIncluded', coalesce((input->>'shortTermRentalPermissionIncluded')::boolean, false),
  'claimsForgivenessIncluded', coalesce((input->>'claimsForgivenessIncluded')::boolean, false)
));
$$ language sql immutable;

update quote_coverages qc
set coverage = normalize_quote_auto_coverage(qc.coverage)
from quote_policy_components qpc
where qc.quote_component_id = qpc.id
  and qpc.product_line = 'auto';

update quote_coverages qc
set coverage = normalize_quote_property_coverage(qc.coverage)
from quote_policy_components qpc
where qc.quote_component_id = qpc.id
  and qpc.product_line = 'property';

drop function if exists normalize_quote_auto_coverage(jsonb);
drop function if exists normalize_quote_property_coverage(jsonb);
