# Recommendation Engine

The recommendation engine is a pure, deterministic TypeScript function in
`packages/insurance-engine/src/engine.ts`. It receives a normalized set of quotes and a household
mandate and returns a ranked list of eligible household configurations, each with explicit reason
codes. There is no AI, no probabilistic scoring, and no insurer-specific logic inside the comparison.

## Entry point

```ts
export function evaluateHousehold(input: EngineInput): EngineResult;
```

`EngineInput` contains:

- `mandate`: the full `HouseholdMandate` with household defaults and asset overrides. This is the
  legacy engine shape produced by `mandateV2ToEngineMandate(v2, switching)` from the versioned
  `HouseholdCoverageMandateV2`.
- `quotes`: competing insurer quotes normalized to `EngineQuote`.
- `incumbentAuto`: the current auto policy as a `QuoteComponent`.
- `incumbentProperty`: the current property policy as a `QuoteComponent`.
- `assets` (optional): the household's `vehicles` and `properties` UUIDs used to fail-closed on
  multi-asset or missing-asset cases.

## Fail-closed guard

`validateEngineInput` runs before any comparison and rejects the request when:

- a single quote contains more than one `auto` or more than one `property` component;
- more than one distinct `assetId` appears for auto or for property across all quotes/incumbents;
- any component references an asset not in the supplied `assets` list;
- any household vehicle or property lacks a matching component;
- any mandate override references an asset not in the household.

In all of these cases `evaluateHousehold` returns `rejection:
{ code: 'MULTI_ASSET_OPTIMIZATION_NOT_ENABLED' | 'MISSING_INSURED_ASSET', message: '...' }`
and an empty `evaluated` list. Multi-asset optimization is explicitly deferred to a later phase.

## Quote normalization

Incoming quotes are normalized into `EngineQuote` before they reach the engine. Each quote carries:

- `id`, `insurerId`, `insurerName`, `state`, `isIncumbent`
- Cost fields: `policyFeesCents`, `paymentFeesCents`, `bundleDiscountCents`, `cancellationChargeCents`
- `components`: one or more `QuoteComponent` objects, each with `productLine` (`auto` / `property`),
  optional `assetId`, `annualPremiumCents`, and the typed coverage details (`AutoCoverageDetails` or
  `PropertyCoverageDetails`).
- Switching metadata: `paymentFrequency`, `billingMethod`, `distributionChannel`,
  `insurerFinancialRating`.

No insurer-specific identifiers, strings, or proprietary forms participate in comparison. Every
check operates on these normalized fields.

## Configuration generation

`buildConfigurations` creates every valid household configuration from usable quotes (states `estimate`,
`conditional`, `bindable`, `selected`) plus the mandatory incumbent configuration. A configuration is:

- `bundled` when the auto and property quote share the same `insurerId`.
- `isIncumbentConfiguration` when both lines are the incumbent quote.

Split configurations are generated when `switching.splitInsurersAllowed` is true or when only split
quotes exist; eligibility is checked later.

## Asset-specific inheritance

Before hard checks, `effectiveAutoMandate` and `effectivePropertyMandate` merge the household default
with any override keyed by `component.assetId`. The merge is deep for nested objects (coverage form,
liability, deductibles, water coverage, etc.) and shallow for top-level fields, so an override only
needs to specify the fields that differ for that asset.

Example use cases:

- A financed vehicle is required to carry collision (`vehicleOverrides[vehicleId].coverageForm.value = "collision"`).
- An older vehicle can drop comprehensive.
- A rental property has a higher base deductible than the household default.
- A condo requires a specific endorsement set.

## Hard requirement checks

For each configuration the engine evaluates the effective mandate against the quote's normalized
coverage.

### Auto

- Liability limit satisfies the limit rule.
- Coverage form rank is at least the required form (or not equal when prohibited).
- Collision/comprehensive/glass deductibles satisfy the deductible rule.
- Each endorsement matches its `CoveragePreference` (`required`, `preferred`, `indifferent`, `prohibited`).
- Vehicle class and financing status must match if specified.

### Property

- Property type must match if specified.
- Coverage form and settlement basis must satisfy their preferences.
- Dwelling, contents, detached structures, personal liability and ALE limits satisfy the limit rules.
- Base, water, wind/hail and earthquake deductibles satisfy the deductible rules.
- Sewer backup and overland water presence, limits and deductibles satisfy their rules.
- Each optional coverage matches its `CoveragePreference`.

### Switching / meta

- Split configurations are rejected when `splitInsurersAllowed` is false.
- Bundle breakup is rejected when the incumbent is bundled and `allowBundleBreakup` is false.
- Excluded insurers are rejected.
- Insurer financial rating must be at least `minimumInsurerFinancialRating`.

## Incumbent comparison and coverage reduction

`coverageReductionsVsIncumbent` compares the proposed coverage to the current policy and produces
human-readable reduction strings. A configuration is ineligible when a required coverage is reduced
relative to the incumbent:

- Reduced auto endorsements (`auto_{endorsement}_removed`)
- Reduced liability, lowered deductibles, reduced coverage form
- Reduced property settlement basis (`property_settlement_reduced`)
- Lowered property limits (dwelling, contents, detached structures, liability, ALE)
- Removed water coverage or lowered limits/deductibles
- Removed optional coverages (`property_{key}_removed`)

## Cost and scoring

`computeCost` calculates the annual household cost in integer Canadian cents:

```
total = autoPremium + propertyPremium + policyFees + paymentFees + cancellationCharges - bundleDiscount
```

Cancellation charges apply only to non-incumbent quotes. The bundle discount is the maximum discount
available from the two quotes when they are bundled.

The recommended configuration is the eligible configuration with the lowest total cost, then fewest
coverage reductions, then lowest deductible total, then fewest underwriting conditions. The incumbent
always participates and is ranked; it is the recommended option when no competitor saves enough.

## Reason codes

Every configuration receives one or more `ReasonCode` values:

- Origin: `INCUMBENT_CONFIGURATION`, `BUNDLED_CONFIGURATION`, `SPLIT_CONFIGURATION`
- Switching: `SPLIT_INSURERS_PROHIBITED`, `BUNDLE_BREAKUP_PROHIBITED`, `EXCLUDED_INSURER`,
  `INSURER_RATING_BELOW_MINIMUM`, `DEDUCTIBLE_INCREASE_PROHIBITED`, `PREMIUM_INCREASE_TOO_HIGH`,
  `BELOW_SAVINGS_THRESHOLD`
- Auto: `AUTO_LIABILITY_BELOW_MINIMUM`, `AUTO_LIABILITY_EXCEEDS_MAXIMUM`,
  `AUTO_LIABILITY_NOT_EXACT`, `AUTO_COVERAGE_FORM_INSUFFICIENT`, `AUTO_COVERAGE_FORM_PROHIBITED`,
  `AUTO_COLLISION_DEDUCTIBLE_TOO_HIGH`, `AUTO_COMPREHENSIVE_DEDUCTIBLE_TOO_HIGH`,
  `AUTO_GLASS_DEDUCTIBLE_TOO_HIGH`, `AUTO_ENDORSEMENT_MISSING`, `AUTO_ENDORSEMENT_PROHIBITED`,
  `AUTO_TELEMATICS_REQUIRED`, `AUTO_TELEMATICS_PROHIBITED`, `AUTO_VEHICLE_CLASS_MISMATCH`,
  `AUTO_FINANCING_STATUS_MISMATCH`
- Property: `PROPERTY_TYPE_MISMATCH`, `PROPERTY_COVERAGE_FORM_INSUFFICIENT`,
  `PROPERTY_COVERAGE_FORM_PROHIBITED`, `PROPERTY_SETTLEMENT_BELOW_REQUIRED`,
  `PROPERTY_SETTLEMENT_PROHIBITED`, `PROPERTY_DWELLING_LIMIT_BELOW_MINIMUM`,
  `PROPERTY_CONTENTS_LIMIT_TOO_LOW`, `PROPERTY_SEWER_BACKUP_MISSING`,
  `PROPERTY_OVERLAND_WATER_DEDUCTIBLE_TOO_HIGH`, and others for every limit, deductible and
  optional coverage.
- Success: `MEETS_ALL_HARD_REQUIREMENTS`, `MEETS_SAVINGS_THRESHOLD`

## Edge Function

`supabase/functions/recommendation-generator` loads the household mandate, current policies, and all
competing quotes through the shared `loadRecommendationInputSnapshot` loader in
`packages/database/src/recommendation-loader.ts`, which validates every JSON boundary against the
V2 Zod schemas. It then calls the same `evaluateHousehold` engine used by workspace tests
(`packages/insurance-engine/src/engine.ts`). The engine is bundled into
`supabase/functions/recommendation-generator/_shared/autopilot.js` by
`pnpm --filter @autopilot/insurance-engine build:edge`; the bundle header carries a SHA-256 source
hash and CI enforces parity with `check:edge`.

The Edge Function handles `result.rejection` explicitly (multi-asset, missing insured asset,
invalid quote data) and returns structured non-2xx responses. When a recommendation is persisted,
`persist_recommendation` records the exact V2 mandate identity (`mandate_id`, `mandate_version`,
`mandate_schema_version`, `mandate_jurisdiction`, `switching_preferences_id`,
`switching_preferences_version`), a quote snapshot, and the engine version. `review_recommendation`,
`approve_customer_recommendation` and `decline_customer_recommendation` validate that the recorded
V2 snapshot is still current, so a stale mandate blocks approval.

## Tests

Engine tests live in `packages/insurance-engine/test/engine.test.ts` and cover cost calculation,
bundle-loss detection, hard constraints, exclusions, split-insurer handling, ranking,
asset-specific inheritance, coverage reductions vs incumbent, quote normalization, switching
filters and the fail-closed multi-asset guard.

## Corrective Phase 1D additions

### Monetary-rule evaluator

`packages/insurance-engine/src/rule-evaluator.ts` exposes a single reusable `evaluateMonetaryRule`
function used for every limit and deductible field. It returns typed status values
(`satisfied`, `below_minimum`, `above_maximum`, `not_exact`, `below_incumbent`,
`above_incumbent_deductible`, `unknown_actual`, `unknown_incumbent`) and produces field-specific
reason codes from the engine. Unknown actual or incumbent values fail closed with explicit
`UNKNOWN` codes instead of being coerced to zero.

### Auto coverage-form compatibility

The engine no longer ranks auto coverage forms by a single numeric total order. Instead,
`packages/insurance-engine/src/preference-evaluator.ts` defines capability maps for each form
(`liability_only`, `collision`, `comprehensive`, `specified_perils`, `all_perils`) and checks
whether the proposed form provides the capabilities required by the mandate. Forms that are not
comparable or that require licensed review are explicitly flagged.

### Preferred-requirement scoring

Preferred items remain non-blocking but affect deterministic ranking. The engine computes a
`PreferenceAlignment` result (`satisfied_count`, `missed_count`, `not_evaluable_count`, and per-item
details) for auto endorsements, property optional coverages, water coverages, coverage form,
settlement basis, payment frequency, billing method, and broker/direct preference. The canonical
ranking order is:

1. Hard eligibility
2. Total annual cost
3. Fewer missed preferred requirements
4. Fewer unknown preferred requirements
5. Lower deductible exposure
6. Fewer underwriting conditions
7. Stable deterministic identifier

### Quote validation status

`QuoteComponent` carries `validationStatus` (`draft`, `incomplete`, `valid`, `invalid`,
`superseded`) and `validationErrors`. The `recommendation-loader` and engine snapshot loader only
pass `valid` components to the engine; non-valid components are surfaced as `QUOTE_NOT_USABLE`.
`quote_coverages` stores `validation_status`, `validation_errors`, `validated_at`, `validated_by`,
`coverage_schema_version`, and `data_source`. The `quote_coverages_coverage_changed` trigger resets
validation to `draft` when the coverage payload changes, so a modified component must be
re-validated before it can be evaluated.

### Unknown-value semantics

Unknown insurer metadata fails closed. `quote-normalizer` maps an unrecognized insurer financial
rating, payment frequency, billing method, or distribution channel to `undefined` rather than a
customer-preference sentinel such as `any` or `indifferent`. When the mandate requires a minimum
insurer rating, an unknown rating produces `INSURER_RATING_UNKNOWN`; a known but weaker rating
produces `INSURER_RATING_BELOW_MINIMUM`.

### Recommendation persistence trust boundary

The Edge Function `recommendation-generator` authenticates the operations/admin user, verifies case
access, loads and validates the canonical `RecommendationInputSnapshot`, runs the deterministic
engine, and calls the internal `persist_engine_recommendation_v2` RPC with the authenticated actor
profile ID. The RPC is `SECURITY DEFINER`, granted only to `service_role`, and verifies the actor
role from `profiles`. It stores `input_snapshot_json`, `input_snapshot_digest`,
`engine_output_json`, `engine_output_digest`, and writes a row to
`recommendation_generation_attempts` for auditability. Direct authenticated calls to the
persistence RPC are denied.
