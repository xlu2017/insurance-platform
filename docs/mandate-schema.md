# Coverage Mandate Schema

The mandate is the single source of truth for what a household considers acceptable coverage.
It is stored in `coverage_requirements` (household auto/property defaults and asset overrides) and
`switching_preferences` (economic and process rules).

## Design principles

- **Inheritance**: household defaults apply to every vehicle and property unless an asset-specific
  override exists in `vehicle_mandates` or `property_mandates`.
- **Rich preference semantics**: most coverage items use `required | preferred | indifferent | prohibited`
  instead of booleans.
- **Limit and deductible rules**: numeric requirements use `minimum | maximum | exact | match_current_or_better | any`.
- **Type-safe**: every field is validated by Zod in `packages/schemas` before it reaches the engine.

## Household mandate (`HouseholdMandate`)

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
`HouseholdMandate.parse({})` returns a complete, valid default mandate so the UI and engine always
have a fully populated object to work with.
