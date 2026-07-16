# Coverage Mandate Schema

The mandate is the single source of truth for what a household considers acceptable coverage.
Corrective Phase 1C makes `HouseholdCoverageMandateV2` authoritative end-to-end: the mobile app
saves V2 mandates, the admin console reads the same V2 mandates, the recommendation Edge Function
evaluates the same V2 mandate, and recommendations are bound to the exact V2 mandate snapshot for
approval and audit. V2 data is persisted in `household_coverage_mandates`,
`vehicle_mandate_overrides` and `property_mandate_overrides`. The legacy `coverage_requirements`
table remains only for historical migration, diagnostics, read-only compatibility and rollback
analysis; no active recommendation, persistence or approval path reads it.

## Design principles

- **Versioning**: every stored mandate has `schemaVersion: 2`, `jurisdiction: 'AB'`, a monotonic
  `version` and an `effectiveFrom` ISO datetime.
- **Inheritance**: household defaults apply to every vehicle and property unless an asset-specific
  override exists in `vehicleOverrides` or `propertyOverrides`.
- **Rich preference semantics**: most coverage items use `required | preferred | indifferent | prohibited`
  instead of booleans.
- **Discriminated monetary rules**: numeric rules are a tagged union
  `{ rule: 'minimum' | 'maximum' | 'exact'; amountCents: number }` or
  `{ rule: 'match_current_or_better' }` or `{ rule: 'any' }`. Non-amount rules never carry a default
  `amountCents`.
- **Type-safe**: every field is validated by Zod in `packages/schemas` before it reaches the engine.

## Versioned household mandate (`HouseholdCoverageMandateV2`)

```ts
interface HouseholdCoverageMandateV2 {
  schemaVersion: 2;
  jurisdiction: "AB";
  version: number;
  effectiveFrom: string; // ISO 8601 datetime
  householdAutoDefaults: AutoMandateV2;
  householdPropertyDefaults: PropertyMandateV2;
  vehicleOverrides: Array<{ vehicleId: string; values: Partial<AutoMandateV2> }>;
  propertyOverrides: Array<{ propertyId: string; values: Partial<PropertyMandateV2> }>;
}
```

Use `createDefaultHouseholdCoverageMandateV2()` to build a valid default mandate. The factory
returns a fully populated object; two calls never share nested object references.

Pure resolvers (`resolveVehicleMandateV2`, `resolvePropertyMandateV2`) produce the effective
mandate for an asset by deep-merging the household default with the asset-specific override.
`updateVehicleOverrideV2` / `clearVehicleOverrideV2` provide immutable edit helpers.

## Legacy engine mandate (`HouseholdMandate`)

```ts
interface HouseholdMandate {
  auto: AutoRequirements;
  property: PropertyRequirements;
  switching: SwitchingPreferences;
  vehicleOverrides: Record<string, Partial<AutoRequirements>>;
  propertyOverrides: Record<string, Partial<PropertyRequirements>>;
}
```

Asset overrides are keyed by the asset UUID (`vehicles.id` or `properties.id`). The engine deep-merges
an override with the household default, so only the fields explicitly set in the override replace the
household value. This lets one vehicle have a higher liability limit or one rental property have a
different deductible without duplicating the entire mandate.

## Auto requirements (`AutoRequirements`)

| Field                     | Type                          | Description                                                                      |
| ------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `coverageForm`            | `AutoCoverageFormRequirement` | `liability_only`, `collision`, `comprehensive`, `specified_perils`, `all_perils` |
| `liability`               | `LimitRequirement`            | Third-party liability limit rule and value in cents                              |
| `collisionDeductible`     | `DeductibleRequirement`       | Rule + cents for collision deductible                                            |
| `comprehensiveDeductible` | `DeductibleRequirement`       | Rule + cents for comprehensive deductible                                        |
| `glassDeductible`         | `DeductibleRequirement`       | Rule + cents for glass deductible                                                |
| `endorsements`            | `AutoEndorsementPreferences`  | Preference for each endorsement (see below)                                      |
| `vehicleClass`            | `VehicleUseClass` (optional)  | `personal`, `commercial`, `classic`, `modified`                                  |
| `financingStatus`         | `FinancingStatus` (optional)  | `owned`, `financed`, `leased`                                                    |

### Endorsements

Every endorsement uses `CoveragePreference`:

- `accident_forgiveness`
- `rental_vehicle_coverage`
- `non_owned_automobile`
- `family_protection`
- `depreciation_waiver`
- `oem_parts`
- `roadside_assistance`
- `disappearing_deductible`
- `glass_coverage`
- `telematics`

## Property requirements (`PropertyRequirements`)

| Field                          | Type                                  | Description                                                                                         |
| ------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `propertyType`                 | `PropertyType` (optional)             | `homeowner`, `condo`, `tenant`, `landlord`, `seasonal`, `secondary_residence`                       |
| `coverageForm`                 | `PropertyCoverageFormRequirement`     | `comprehensive`, `broad`, `named_perils`, `basic`                                                   |
| `settlementBasis`              | `PropertySettlementRequirement`       | `replacement_cost`, `guaranteed_replacement_cost`, `extended_replacement_cost`, `actual_cash_value` |
| `dwellingLimit`                | `LimitRequirement`                    | Dwelling/building limit rule + cents                                                                |
| `contentsLimit`                | `LimitRequirement`                    | Contents/personal property limit                                                                    |
| `detachedStructuresLimit`      | `LimitRequirement`                    | Detached structures limit                                                                           |
| `personalLiabilityLimit`       | `LimitRequirement`                    | Personal liability limit                                                                            |
| `additionalLivingExpenseLimit` | `LimitRequirement`                    | ALE limit                                                                                           |
| `baseDeductible`               | `DeductibleRequirement`               | Base policy deductible                                                                              |
| `waterDeductible`              | `DeductibleRequirement`               | Separate water deductible                                                                           |
| `windHailDeductible`           | `DeductibleRequirement`               | Wind/hail deductible                                                                                |
| `earthquakeDeductible`         | `DeductibleRequirement`               | Earthquake deductible                                                                               |
| `sewerBackup`                  | `WaterCoverageRequirement`            | Preference, limit rule and deductible rule                                                          |
| `overlandWater`                | `WaterCoverageRequirement`            | Preference, limit rule and deductible rule                                                          |
| `optionalCoverages`            | `PropertyOptionalCoveragePreferences` | Preference map for optional coverages                                                               |

### Optional property coverages

Every optional coverage uses `CoveragePreference`:

- `equipment_breakdown`
- `service_line`
- `bylaw_coverage`
- `home_systems`
- `cyber`
- `scheduled_valuables`
- `home_business`
- `short_term_rental_permission`
- `claims_forgiveness`
- `groundwater_seepage`
- `ice_dam`
- `earthquake`

## Switching preferences (`SwitchingPreferences`)

| Field                               | Type                     | Description                                                     |
| ----------------------------------- | ------------------------ | --------------------------------------------------------------- |
| `minNetAnnualSavingsCents`          | `number`                 | Minimum annual household savings required to recommend a switch |
| `maxPremiumIncreaseCents`           | `number`                 | Maximum acceptable premium increase                             |
| `maxDeductibleIncreaseCents`        | `number`                 | Maximum acceptable total deductible increase                    |
| `renewalOnlySwitching`              | `boolean`                | Only consider switches at renewal                               |
| `householdOptimizationEnabled`      | `boolean`                | Optimize home + auto together                                   |
| `splitInsurersAllowed`              | `boolean`                | Allow auto and property from different insurers                 |
| `allowBundleBreakup`                | `boolean`                | Allow losing the incumbent bundle discount by splitting         |
| `deductibleIncreasesAllowed`        | `boolean`                | Allow any deductible increase                                   |
| `materialCoverageReductionsAllowed` | `boolean`                | Allow material coverage reductions                              |
| `customerApprovalRequired`          | `true`                   | Invariant: customer approval is always required                 |
| `switchOnlyAfterCustomerApproval`   | `boolean`                | Do not bind replacement until customer approves (default true)  |
| `preferredPaymentFrequency`         | `PaymentFrequency`       | `monthly`, `quarterly`, `semi_annual`, `annual`                 |
| `preferredBillingMethod`            | `BillingMethod`          | `automatic_bank`, `credit_card`, `mail`                         |
| `brokerDirectPreference`            | `BrokerDirectPreference` | `broker`, `direct`, `indifferent`                               |
| `minimumInsurerFinancialRating`     | `FinancialRating`        | `A_plus`, `A`, `A_minus`, `B_plus`, `B_or_lower`, `any`         |
| `excludedInsurerIds`                | `string[]`               | Insurers the customer does not want to consider                 |

## Limit and deductible rule semantics

- `minimum`: quote value must be **greater than or equal to** the required value.
- `maximum`: quote value must be **less than or equal to** the required value.
- `exact`: quote value must equal the required value.
- `match_current_or_better`: at least the current (incumbent) value; if no incumbent, falls back to the required value.
- `any`: no constraint on the numeric value.

## Defaults

`packages/schemas/src/mandate.ts` provides default objects (`defaultAutoEndorsements`,
`defaultPropertyOptionalCoverages`) where every endorsement/optional coverage is `indifferent`.

**Important:** the legacy `HouseholdMandate.parse({})` does **not** produce a complete mandate. It
is a compatibility schema that requires callers to supply all required fields or use the V2
factory and adapters. For new code, call `createDefaultHouseholdCoverageMandateV2()` and convert to
the engine-facing `HouseholdMandate` with `mandateV2ToEngineMandate(v2, switching)`.

## Mapping and persistence

- `legacyMandateToV2(...)` converts an old `coverage_requirements` row to V2.
- `expandedUnversionedMandateToV2(...)` converts the expanded Phase 1 mandate shape to V2.
- `mandateV2ToEngineMandate(v2, switching?)` and `v2ToLegacyProjection(v2, switching?)` produce the
  engine input `HouseholdMandate`.
- `switchingRowToDomain` / `switchingDomainToRow` translate the `switching_preferences` row to and
  from `SwitchingPreferencesV2`.
- The typed repository in `packages/database/src/mandate-repository.ts` loads and saves V2 mandates
  atomically through the `save_household_mandate_v2` RPC.

## Current limitations

- Multi-asset optimization (more than one vehicle or more than one property) is intentionally
  fail-closed in the recommendation engine.
- Risk facts such as financing status, vehicle use class, classic/modified flags and property type
  live on `vehicles` / `properties` rows; they are not part of the customer coverage preference
  mandate.
- `maxPremiumIncreaseCents` is retained in `switching_preferences` for compatibility but is not
  active in the UI or recommendation logic while `minNetAnnualSavingsCents` provides the positive
  savings threshold.
- `materialCoverageReductionsAllowed` is fixed to `false` and `customerApprovalRequired` is fixed to
  `true`.
- Multiple-vehicle, multiple-property, preferred-coverage scoring, a new auto coverage hierarchy,
  carrier APIs, automated extraction, additional coverage fields, visual redesign, new ranking logic,
  silent/automatic switching and other feature work are deferred until the foundation is reviewed.
