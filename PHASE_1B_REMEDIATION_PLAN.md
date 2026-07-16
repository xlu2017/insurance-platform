# Corrective Phase 1B: Versioned Mandate Persistence and Safe Foundation

## 1. Objective and scope

The expanded Coverage Mandate implementation completed in the prior phase introduced a large, unversioned, and loosely validated JSONB mandate model. Several foundational defects make the mandate unsafe to persist and unreliable at runtime:

- `HouseholdMandate.parse({})` cannot succeed because `auto`, `property`, and `switching` are required, yet the mobile UI calls a default factory that does exactly this.
- Monetary rules (`minimum`, `maximum`, `exact`, `match_current_or_better`, `any`) share one `{ rule, cents }` object with a silent `cents: 0` default, which produces invalid semantics for non-amount rules and hides bad data.
- Asset overrides are typed as `AutoRequirements.partial()` / `PropertyRequirements.partial()`, allowing arbitrary nested mutation, accidental duplication of risk facts, and no clear way to remove an override.
- Vehicle and property risk facts (financing status, use class, classic/modified, property type) are duplicated in the mandate schema and editable as coverage preferences.
- Mandate and switching preferences are persisted through separate direct client inserts/updates, with no atomicity, no versioning intent, and no conflict detection.
- Quote coverage records produced by the migration are missing required fields and mix auto and property fields inside the same JSON object.
- Recommendation generation silently uses only the first auto and first property component, even when multiple vehicles or properties exist.

This phase corrects those foundation defects and does **not** add new coverages, redesign the interface, or implement multi-asset optimization. Multi-asset recommendation support is explicitly deferred and will fail closed with a clear operational error.

---

## 2. Defects, root causes, and proposed solutions

### 2.1 Correct default mandate construction

**Root cause**
The mobile helper `defaultHouseholdMandate()` calls `HouseholdMandate.parse({})`. Because the Zod object has no defaults on `auto`, `property`, or `switching`, parsing fails and the `catch` block silently returns `defaultHouseholdMandate()` again, creating an infinite or hidden fallback. Shared mutable nested objects (`defaultAutoEndorsements` and `defaultPropertyOptionalCoverages` are cast through `as unknown as`) mean two parsed mandates can mutate the same endorsement map.

**Affected files**
- `packages/schemas/src/mandate.ts`
- `apps/mobile/lib/mandate.ts`
- `apps/mobile/app/edit-mandate.tsx`
- `apps/mobile/app/(tabs)/coverage.tsx`
- `apps/admin/src/lib/engine-input.ts`
- `packages/insurance-engine/src/engine.ts`

**Proposed solution**
Replace `HouseholdMandate.parse({})` with an explicit pure factory `createDefaultHouseholdCoverageMandateV2()` in `packages/schemas/src/mandate-v2.ts` (new file). The factory:
- Builds every required root object explicitly.
- Uses fresh objects for every nested structure (endorsements, optional coverages, water coverage).
- Calls `HouseholdCoverageMandateV2.parse()` at the end to validate the result.
- Returns a new object on every call.

Remove the `as unknown as` casts in `defaultAutoEndorsements` and `defaultPropertyOptionalCoverages`.

**Migration strategy**
None required for the database. Zod-only change. Remove the old mobile helper and re-export the new factory.

**Regression tests**
- Test that `createDefaultHouseholdCoverageMandateV2()` returns a valid object.
- Test that two successive calls produce objects whose nested endorsement/property-coverage maps are not `===` to each other.
- Test that mutating one returned object does not affect a later returned object.
- Test that `HouseholdMandate.parse({})` (legacy type) still fails with a structured Zod error and is not silently swallowed.

**Compatibility implications**
Legacy `HouseholdMandate` type remains exported for existing callers during the transition. The new V2 type becomes the canonical persistence contract. The mobile default helper is renamed to the V2 factory.

---

### 2.2 Introduce an explicitly versioned V2 schema

**Root cause**
No `schemaVersion` or `jurisdiction` field exists in `HouseholdMandate`. The database stores unversioned JSONB in `coverage_requirements.auto_requirements` / `property_requirements`. Migration and backwards compatibility are therefore guesswork based on shape.

**Affected files**
- `packages/schemas/src/mandate.ts`
- New `packages/schemas/src/mandate-v2.ts`
- `packages/insurance-engine/src/types.ts`
- `packages/insurance-engine/src/engine.ts`
- `apps/admin/src/lib/engine-input.ts`
- `apps/mobile/lib/mandate.ts`
- `apps/mobile/app/edit-mandate.tsx`
- `apps/mobile/app/(tabs)/coverage.tsx`

**Proposed solution**
Create a new canonical schema module `packages/schemas/src/mandate-v2.ts` that exports:

```ts
interface HouseholdCoverageMandateV2 {
  schemaVersion: 2;
  jurisdiction: "AB";
  version: number;
  effectiveFrom: string; // ISO datetime
  householdAutoDefaults: AutoMandateV2;
  householdPropertyDefaults: PropertyMandateV2;
  vehicleOverrides: VehicleMandateOverrideV2[];
  propertyOverrides: PropertyMandateOverrideV2[];
}

interface VehicleMandateOverrideV2 {
  vehicleId: string;
  values: AutoMandateOverrideValuesV2;
}

interface PropertyMandateOverrideV2 {
  propertyId: string;
  values: PropertyMandateOverrideValuesV2;
}
```

The V2 schema uses the discriminated `MonetaryRule` union (see 2.3) and removes risk-fact fields from the override values. Add `toHouseholdMandateV2` compatibility export that converts legacy `HouseholdMandate` into V2, and `toLegacyHouseholdMandate` for read-only legacy consumers.

**Migration strategy**
No immediate database migration for schema shape (the V2 tables in 2.6 will store V2 JSON). The new schema file is additive.

**Regression tests**
- Test that every V2 object validates only when `schemaVersion === 2` and `jurisdiction === "AB"`.
- Test that `version` is a positive integer.
- Test that `effectiveFrom` is a valid ISO timestamp.
- Test round-trip from legacy `HouseholdMandate` to V2 and back for a safe subset.

**Compatibility implications**
The unversioned `HouseholdMandate` type is deprecated but kept as a compatibility export. Existing engine functions that accept `HouseholdMandate` will be overloaded to accept V2 or will be migrated after the persistence layer lands.

---

### 2.3 Correct monetary rule schemas

**Root cause**
`LimitRequirement` and `DeductibleRequirement` are `z.object({ rule, cents: NonNegativeCents.default(0) })`. For `match_current_or_better` and `any` the `cents` value is meaningless, but the schema attaches `0` silently and accepts an amount if provided. This makes it impossible to distinguish a real $0 requirement from a rule that should ignore amount.

**Affected files**
- `packages/schemas/src/mandate.ts`
- `packages/schemas/src/mandate-v2.ts`
- `packages/insurance-engine/src/engine.ts`
- `apps/mobile/app/edit-mandate.tsx`
- `apps/mobile/app/(tabs)/coverage.tsx`
- `apps/admin/src/app/cases/[id]/tabs/mandate.tsx`
- `apps/admin/src/lib/mandate.ts`
- `packages/test-fixtures/src/index.ts`

**Proposed solution**
Replace `{ rule, cents }` with a discriminated union:

```ts
type MonetaryRuleV2 =
  | { rule: "minimum"; amountCents: number }
  | { rule: "maximum"; amountCents: number }
  | { rule: "exact"; amountCents: number }
  | { rule: "match_current_or_better" }
  | { rule: "any" };
```

Implement `LimitRuleV2` and `DeductibleRuleV2` as aliases to `MonetaryRuleV2` with identical validation. The Zod schema:
- Requires `amountCents` for `minimum`/`maximum`/`exact` and rejects it for the other rules.
- Rejects unknown properties.
- Does not default `amountCents` to `0`.

Update the mobile `LimitField` and `DeductibleField` components so the amount input is shown only when `rule` is `minimum`, `maximum`, or `exact`.

**Migration strategy**
Add a conversion helper `monetaryRuleV1toV2` that accepts the old `{ rule, cents }` shape and produces the new shape. The V1-to-V2 adapter will map `cents: 0` for `match_current_or_better` / `any` to the no-amount variant. Because the legacy default was `0`, this is safe for rules that truly meant "any". Rules with `match_current_or_better` and a non-zero amount are semantically invalid and the adapter will fail with a structured error.

**Regression tests**
- Test every rule variant with and without `amountCents`.
- Test that `minimum`/`maximum`/`exact` reject missing `amountCents`.
- Test that `match_current_or_better` and `any` reject `amountCents`.
- Test that unknown keys are rejected.
- Test the V1-to-V2 adapter for each legacy rule.
- Test UI amount visibility for each rule.

**Compatibility implications**
The engine and UI must be updated to consume `MonetaryRuleV2`. Old fixtures and test data will be converted via the adapter. A compatibility parser `LegacyLimitRequirement` can remain for reading historical rows until the backfill completes.

---

### 2.4 Create safe override schemas

**Root cause**
`AssetAutoOverride = AutoRequirements.partial()` and `AssetPropertyOverride = PropertyRequirements.partial()` allow any subset of the full requirement object. This permits accidentally overriding derived/risk-fact fields and makes deletion/reset non-obvious. The record keyed by asset UUID is also unvalidated at the database boundary.

**Affected files**
- `packages/schemas/src/mandate.ts`
- `packages/schemas/src/mandate-v2.ts`
- `packages/insurance-engine/src/engine.ts`
- `apps/mobile/app/edit-mandate.tsx`
- `apps/mobile/app/(tabs)/coverage.tsx`

**Proposed solution**
Create explicit override value schemas in V2:

```ts
interface AutoMandateOverrideValuesV2 {
  coverageForm?: { preference: CoveragePreference; value: AutoCoverageForm };
  liability?: MonetaryRuleV2;
  collisionDeductible?: MonetaryRuleV2;
  comprehensiveDeductible?: MonetaryRuleV2;
  glassDeductible?: MonetaryRuleV2;
  endorsements?: Partial<AutoEndorsementPreferences>;
}

interface PropertyMandateOverrideValuesV2 {
  coverageForm?: { preference: CoveragePreference; value: PropertyCoverageForm };
  settlementBasis?: { preference: CoveragePreference; value: PropertySettlement };
  dwellingLimit?: MonetaryRuleV2;
  contentsLimit?: MonetaryRuleV2;
  detachedStructuresLimit?: MonetaryRuleV2;
  personalLiabilityLimit?: MonetaryRuleV2;
  additionalLivingExpenseLimit?: MonetaryRuleV2;
  baseDeductible?: MonetaryRuleV2;
  waterDeductible?: MonetaryRuleV2;
  windHailDeductible?: MonetaryRuleV2;
  earthquakeDeductible?: MonetaryRuleV2;
  sewerBackup?: Partial<WaterCoverageRequirementV2>;
  overlandWater?: Partial<WaterCoverageRequirementV2>;
  optionalCoverages?: Partial<PropertyOptionalCoveragePreferences>;
}
```

The override wrapper objects contain `vehicleId` / `propertyId` (UUID) and `values`. Add `resolveVehicleMandateV2(defaults, override)` and `resolvePropertyMandateV2(defaults, override)` pure functions that deep-merge only the permitted override values, validate the result, and do not mutate inputs. A `clearVehicleOverride(mandate, vehicleId)` helper returns a new mandate with the override removed.

**Migration strategy**
No database migration until 2.6. The new schemas and resolvers are added alongside the existing partial types, then the old partial types are removed once the UI is updated.

**Regression tests**
- Test that `resolveVehicleMandateV2` with no override returns defaults.
- Test that an override of `liability` only leaves all other fields at default.
- Test that nested override (e.g. `endorsements.telematics`) merges with defaults.
- Test that removing an override restores the original default.
- Test that the resolver does not mutate input objects.
- Test that invalid override keys are rejected.

**Compatibility implications**
The legacy `vehicleOverrides` / `propertyOverrides` maps keyed by UUID will be converted to the V2 array form during load. Existing persisted JSON will continue to load through the legacy adapter.

---

### 2.5 Separate risk facts from customer coverage preferences

**Root cause**
`AutoRequirements` includes `vehicleClass` and `financingStatus`; `PropertyRequirements` includes `propertyType`. These are underwriting facts about the asset, not customer-selectable coverage preferences. Exposing them in the mandate editor allows customers to change data that should be derived from the vehicle/property record.

**Affected files**
- `packages/schemas/src/mandate.ts`
- `packages/schemas/src/mandate-v2.ts`
- `packages/insurance-engine/src/engine.ts`
- `apps/mobile/app/edit-mandate.tsx`
- `apps/mobile/app/(tabs)/coverage.tsx`
- `apps/admin/src/app/cases/[id]/tabs/mandate.tsx`
- `supabase/migrations/20260716000002_coverage_mandate_expansion.sql`
- `supabase/seed.sql`

**Proposed solution**
Remove `vehicleClass`, `financingStatus` from `AutoRequirements` / `AutoMandateV2` and `propertyType` from `PropertyRequirements` / `PropertyMandateV2`. Keep those fields on `vehicles` / `properties` tables and on coverage details (`AutoCoverageDetails`, `PropertyCoverageDetails`). The engine may compare a quote component's `assetId` against the vehicle/property record to verify the fact, but the mandate itself no longer stores or edits these fields.

Update the mobile edit screen and coverage summary to display these facts read-only, sourced from the `vehicles` / `properties` query, and provide a link to household-asset editing if needed.

**Migration strategy**
Remove the columns from mental model; database columns added by `20260716000002_coverage_mandate_expansion.sql` remain because they are factual asset metadata. The migration that added `vehicle_use_class`, `financing_status`, `is_classic`, `is_modified` to `vehicles` and `property_type` to `properties` is correct and stays.

**Regression tests**
- Test that `AutoMandateV2` rejects `vehicleClass` / `financingStatus`.
- Test that `PropertyMandateV2` rejects `propertyType`.
- Test that the engine still matches quote coverage facts to the asset record.

**Compatibility implications**
Existing mandate JSON that contains these fields will be stripped during V1-to-V2 conversion. No database schema change beyond the existing asset columns.

---

### 2.6 Add proper versioned mandate tables

**Root cause**
The current model extends `coverage_requirements` with `vehicle_mandates` and `property_mandates` JSONB columns, and extends `switching_preferences` with ad-hoc columns. This is not versioned, not normalized for overrides, and cannot enforce one current mandate per household.

**Affected files**
- `supabase/migrations/20260716000002_coverage_mandate_expansion.sql` (do not edit; forward migration only)
- New `supabase/migrations/20260716000003_coverage_mandate_v2_foundation.sql`
- `packages/database/src/database.types.ts` (regenerated)
- `packages/schemas/src/mandate-v2.ts`
- `apps/mobile/lib/mandate.ts`
- `apps/admin/src/lib/engine-input.ts`
- `supabase/functions/recommendation-generator/index.ts`
- `supabase/functions/recommendation-generator/engine.ts`

**Proposed solution**
Create a forward migration `20260716000003_coverage_mandate_v2_foundation.sql` with:

```sql
create table household_coverage_mandates (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  schema_version integer not null check (schema_version = 2),
  version integer not null,
  jurisdiction text not null,
  effective_from timestamptz not null,
  household_auto_defaults jsonb not null,
  household_property_defaults jsonb not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles (id),
  updated_by uuid references profiles (id),
  unique (household_id, version)
);

create unique index idx_household_coverage_mandates_current
  on household_coverage_mandates (household_id)
  where is_current = true;

create table vehicle_mandate_overrides (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references household_coverage_mandates (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  override_values jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mandate_id, vehicle_id)
);

create table property_mandate_overrides (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references household_coverage_mandates (id) on delete cascade,
  property_id uuid not null references properties (id) on delete cascade,
  override_values jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mandate_id, property_id)
);
```

Implement a constraint trigger or trusted RPC that rejects `vehicle_mandate_overrides` and `property_mandate_overrides` when the asset's `household_id` differs from the mandate's `household_id`.

Enable RLS and revoke direct customer `insert`/`update`/`delete` on these tables. Customer mutation is allowed only through `save_household_mandate_v2`.

**Migration strategy**
Forward-only migration. The legacy `coverage_requirements` and `switching_preferences` tables remain. Backfill is handled by the migration or a trusted function (see 2.8). New code reads V2 tables first, falls back to legacy dual read (see 2.7).

**Regression tests**
- pgTAP: one current mandate per household.
- pgTAP: immutable version history (updating `is_current` to false and inserting new version is allowed, changing JSON is not).
- pgTAP: one override per asset and mandate.
- pgTAP: cross-household override rejected by trigger/RPC.
- pgTAP: customer direct write to V2 tables is denied by RLS.
- pgTAP: `save_household_mandate_v2` creates a new version and marks old version non-current.

**Compatibility implications**
Legacy tables remain readable. Existing code paths that read `coverage_requirements` are shimmed through the dual-read layer until the V2 layer is fully wired.

---

### 2.7 Preserve legacy data through dual read

**Root cause**
No adapter exists to convert legacy `coverage_requirements` / `switching_preferences` rows, the expanded unversioned JSON shape, or the new V2 shape into a single canonical domain object. The mobile UI and engine each reconstruct the mandate differently with raw casts.

**Affected files**
- `apps/mobile/lib/mandate.ts`
- `apps/admin/src/lib/engine-input.ts`
- `packages/insurance-engine/src/engine.ts`
- New `packages/schemas/src/mandate-adapters.ts`
- `supabase/functions/recommendation-generator/index.ts`

**Proposed solution**
Create a shared adapter module `packages/schemas/src/mandate-adapters.ts` exporting:

- `legacyMandateToV2(coverageRow, switchingRow)`
- `expandedUnversionedMandateToV2(coverageRow, switchingRow)`
- `v2ToLegacyProjection(v2)` (fails if V2 cannot be represented in the legacy shape)
- `loadHouseholdMandateV2(supabase, householdId)` (higher-level helper used by UI)
- `mandateRowToV2(row, vehicleOverrides, propertyOverrides)`

`loadHouseholdMandateV2` must:
1. Query `household_coverage_mandates` for `is_current = true` for the household.
2. If found, load `vehicle_mandate_overrides` / `property_mandate_overrides` for that `mandate_id`.
3. If not found, fall back to `coverage_requirements` + `switching_preferences` `is_current = true`.
4. Convert the source record to V2 using the appropriate adapter.
5. Validate the converted result with `HouseholdCoverageMandateV2.parse()`.
6. Return `{ source: "v2" | "legacy_projection", mandate }`.

Malformed stored data must produce a structured error (Zod `ZodError` mapped to field path) and must not be silently replaced with defaults.

**Migration strategy**
Add the adapter module. Update `apps/mobile/lib/mandate.ts` to re-export `loadHouseholdMandateV2`. Update `apps/admin/src/lib/engine-input.ts` and the Edge Function to use the same helper.

**Regression tests**
- Test legacy row conversion.
- Test expanded unversioned row conversion.
- Test V2 row load and override assembly.
- Test that malformed legacy data fails with a `ZodError` containing the offending field path.
- Test that `v2ToLegacyProjection` fails for V2 features not representable in the legacy shape.

**Compatibility implications**
All consumers switch to the adapter-based loader. Legacy tables remain the fallback. `parseHouseholdMandate` is removed from the mobile helper to avoid silent defaulting.

---

### 2.8 Backfill existing development data

**Root cause**
New V2 tables are empty, but `seed.sql` and existing local databases contain rows in `coverage_requirements` and `switching_preferences` that must remain usable.

**Affected files**
- `supabase/migrations/20260716000003_coverage_mandate_v2_foundation.sql`
- `supabase/seed.sql`

**Proposed solution**
Add an idempotent backfill function in the migration:

```sql
create or replace function backfill_coverage_mandate_v2()
returns void as $$
-- for each current coverage_requirements row, create one V2 household_coverage_mandates row
-- create vehicle_mandate_overrides and property_mandate_overrides from the JSONB maps
-- use the existing switching_preferences version as the V2 switching version partner
$$;
```

The backfill:
- Skips households that already have a current V2 mandate.
- Converts legacy monetary rules to V2 discriminated form.
- Strips risk facts from override values.
- Sets `schema_version = 2`, `jurisdiction = 'AB'`, `version = coverage_requirements.version`, `effective_from = now()`.
- Is idempotent (can run twice without creating duplicates).

**Migration strategy**
Call `select backfill_coverage_mandate_v2();` at the end of the migration. The migration is forward-only and safe to re-run.

**Regression tests**
- pgTAP: running backfill twice leaves one current V2 mandate per household and one override per asset.
- pgTAP: backfill produces rows that validate against the V2 schema.

**Compatibility implications**
Legacy rows are left untouched. The backfill does not delete or modify `coverage_requirements` / `switching_preferences`.

---

### 2.9 Correct switching-preference mapping

**Root cause**
`apps/admin/src/lib/engine-input.ts` and `apps/mobile/app/edit-mandate.tsx` pass snake_case database rows directly to camelCase Zod schemas and spread camelCase objects directly into Supabase payloads. This works only when field names accidentally align and silently drops or renames fields that differ.

**Affected files**
- `packages/schemas/src/mandate-v2.ts` or new `packages/schemas/src/switching.ts`
- `apps/mobile/lib/mandate.ts`
- `apps/admin/src/lib/engine-input.ts`
- `supabase/functions/recommendation-generator/index.ts`

**Proposed solution**
Create explicit mappers:

```ts
switchingRowToDomain(row: SwitchingPreferencesRow): SwitchingPreferencesV2
switchingDomainToRow(domain: SwitchingPreferencesV2): SwitchingPreferencesRow
```

Map every field individually, including:
- `min_net_annual_savings_cents` <-> `minNetAnnualSavingsCents`
- `renewal_only_switching` <-> `renewalOnlySwitching`
- `household_optimization_enabled` <-> `householdOptimizationEnabled`
- `split_insurers_allowed` <-> `splitInsurersAllowed`
- `excluded_insurer_ids` <-> `excludedInsurerIds`
- `deductible_increases_allowed` <-> `deductibleIncreasesAllowed`
- `material_coverage_reductions_allowed` <-> `materialCoverageReductionsAllowed`
- `max_premium_increase_cents` <-> `maxPremiumIncreaseCents`
- `max_deductible_increase_cents` <-> `maxDeductibleIncreaseCents`
- `allow_bundle_breakup` <-> `allowBundleBreakup`
- `minimum_insurer_financial_rating` <-> `minimumInsurerFinancialRating`
- `preferred_payment_frequency` <-> `preferredPaymentFrequency`
- `preferred_billing_method` <-> `preferredBillingMethod`
- `broker_direct_preference` <-> `brokerDirectPreference`
- `customer_approval_required` <-> `customerApprovalRequired`
- `switch_only_after_customer_approval` <-> `switchOnlyAfterCustomerApproval`

Remove `materialCoverageReductionsAllowed` from the UI because the database invariant `check (material_coverage_reductions_allowed = false)` forces it to `false`. Remove `switchOnlyAfterCustomerApproval` toggle because `customer_approval_required` is always `true`; display it read-only as "Customer approval required". Remove `maxPremiumIncreaseCents` input from active recommendation because a positive `minNetAnnualSavingsCents` already rejects every premium increase; keep the database column for compatibility but do not expose it as an active rule.

**Migration strategy**
No database migration. The mapper is code-only. The migration already added the needed columns.

**Regression tests**
- Unit test the row-to-domain and domain-to-row mappers for every field.
- Test round-trip with sample rows.
- Test that unknown snake_case fields are ignored and required fields are present.

**Compatibility implications**
Existing rows keep their values. The UI simply stops exposing fields that are constrained by the database.

---

### 2.10 Implement an atomic versioned save operation

**Root cause**
The mobile edit screen updates `coverage_requirements` and `switching_preferences` in two separate client calls, each potentially incrementing a version manually. There is no transaction, no ownership check beyond RLS, and no stale-version conflict.

**Affected files**
- `supabase/migrations/20260716000003_coverage_mandate_v2_foundation.sql`
- `apps/mobile/app/edit-mandate.tsx`
- `apps/mobile/lib/mandate.ts`
- `packages/schemas/src/mandate-v2.ts`

**Proposed solution**
Create a Supabase RPC `save_household_mandate_v2`:

```sql
create or replace function save_household_mandate_v2(
  p_household_id uuid,
  p_expected_mandate_version int,
  p_expected_switching_version int,
  p_household_auto_defaults jsonb,
  p_household_property_defaults jsonb,
  p_vehicle_overrides jsonb,
  p_property_overrides jsonb,
  p_switching_preferences jsonb,
  p_jurisdiction text,
  p_effective_from timestamptz
) returns jsonb
language plpgsql
security definer
as $$
-- verify household ownership
-- verify expected versions match current rows
-- mark old V2 mandate and switching row as non-current
-- insert new V2 mandate version
-- insert vehicle/property override rows
-- insert new switching_preferences version
-- create one audit event
-- return new mandate version or structured conflict error
$$;
```

The function:
- Checks `auth.uid()` owns the household or has service role.
- Verifies `p_expected_mandate_version` matches the current `household_coverage_mandates.version` (or 0 if none).
- Verifies `p_expected_switching_version` matches `switching_preferences.version` (or 0 if none).
- On mismatch, raises `P0001` with a JSON payload `{"code": "STALE_VERSION"}`.
- Runs in one transaction.
- Revokes direct customer writes to V2 tables; all writes go through this RPC.

Update the mobile edit screen to call `save_household_mandate_v2` and handle the conflict error by refreshing the mandate and showing a message.

**Migration strategy**
Add the RPC in the V2 migration. RLS on V2 tables denies direct customer writes. The legacy `coverage_requirements` / `switching_preferences` tables remain writable by their existing RLS policies until the legacy fallback is removed.

**Regression tests**
- pgTAP: save succeeds and creates a new version.
- pgTAP: save with stale version returns conflict.
- pgTAP: save with mismatched switching version returns conflict.
- pgTAP: rollback when switching insert fails leaves no new mandate.
- Unit test mobile save wrapper handles `STALE_VERSION`.

**Compatibility implications**
The legacy edit path no longer exists after this change; the mobile UI uses the RPC exclusively. Admin read path uses the dual-read adapter.

---

### 2.11 Repair existing quote-coverage migration output

**Root cause**
The migration `20260716000002_coverage_mandate_expansion.sql` and `seed.sql` populate `quote_coverages.coverage` with legacy or partial objects. Some required auto fields are missing and irrelevant auto fields appear in property coverage. The admin loader casts these with `as unknown as AutoCoverageDetails`.

**Affected files**
- `supabase/migrations/20260716000002_coverage_mandate_expansion.sql` (do not edit)
- New `supabase/migrations/20260716000004_quote_coverage_normalization.sql`
- `supabase/seed.sql`
- `apps/admin/src/lib/engine-input.ts`
- `supabase/functions/recommendation-generator/index.ts`

**Proposed solution**
Create a repair migration `20260716000004_quote_coverage_normalization.sql` that:
- For every `quote_coverages.coverage` row whose parent `quote_policy_components.product_line = 'auto'`:
  - Ensures all fields in `AutoCoverageDetails` are present, inserting safe defaults (`false`, `null`, or the lowest coverage form) where missing.
  - Removes any property-only fields.
- For every row whose `product_line = 'property'`:
  - Ensures all fields in `PropertyCoverageDetails` are present.
  - Removes auto-only fields.
- Does not overwrite already-valid values.
- Leaves `coverage_details` JSONB in `policies` untouched for now (the policy document extraction is out of scope).

Replace `as unknown as AutoCoverageDetails` in `engine-input.ts` with `AutoCoverageDetails.safeParse()` or `AutoCoverageDetails.parse()`. On validation failure, log the quote ID and skip the component.

**Migration strategy**
Forward-only repair migration. Use a Postgres `do` block or `create or replace function normalize_quote_coverage()` applied idempotently by `quote_coverages.id`.

**Regression tests**
- pgTAP: every `quote_coverages.coverage` row parses through `AutoCoverageDetails` or `PropertyCoverageDetails` depending on product line.
- Unit test: `toEngineQuote` skips invalid coverage with a logged error rather than crashing.

**Compatibility implications**
Existing quote records are normalized in place. The `quotes` table API is unchanged.

---

### 2.12 Add a typed persistence boundary

**Root cause**
Mobile, admin, and the Edge Function each independently query columns, cast JSON, and build `HouseholdMandate`. There is no single source of truth for mandate persistence semantics.

**Affected files**
- New `packages/schemas/src/mandate-repository.ts` (or extend `apps/mobile/lib/mandate.ts` and `apps/admin/src/lib/mandate.ts`)
- `apps/mobile/app/edit-mandate.tsx`
- `apps/mobile/app/(tabs)/coverage.tsx`
- `apps/admin/src/lib/engine-input.ts`
- `supabase/functions/recommendation-generator/index.ts`

**Proposed solution**
Create a shared mandate repository module (in `packages/schemas` or a new `packages/mandate` package if the monorepo build allows) with:

```ts
loadHouseholdMandateV2(supabase, householdId): Promise<MandateLoadResult>
saveHouseholdMandateV2(supabase, request): Promise<SaveResult>
resolveEffectiveVehicleMandate(mandate, vehicleId): AutoMandateV2
resolveEffectivePropertyMandate(mandate, propertyId): PropertyMandateV2
```

All JSON from Supabase passes through Zod validation. All callers (mobile, admin, Edge Function) use these functions. Remove raw casts at the database boundary where possible.

**Migration strategy**
Add the repository module and update callers. No database migration.

**Regression tests**
- Test that the repository validates malformed JSON and returns a structured error.
- Test that `resolveEffectiveVehicleMandate` returns the override when present and defaults otherwise.

**Compatibility implications**
The repository is additive. Callers can be migrated incrementally, but this phase migrates all mandate consumers.

---

### 2.13 Fail closed on unsupported multi-asset optimization

**Root cause**
The recommendation engine currently takes the first auto and first property component and builds all combinations, but does not check whether the household has multiple vehicles or properties, whether an override has no matching asset, or whether a quote omits an active insured asset. This silently produces incorrect recommendations.

**Affected files**
- `packages/insurance-engine/src/engine.ts`
- `packages/insurance-engine/src/types.ts`
- `supabase/functions/recommendation-generator/index.ts`
- `apps/admin/src/lib/engine-input.ts`

**Proposed solution**
Add an explicit guard at the start of `evaluateHousehold` and in the recommendation Edge Function RPC:

- If `input.mandate.vehicleOverrides` is non-empty and any override `vehicleId` is not present in `input.assets.vehicles`, fail.
- If `input.mandate.propertyOverrides` is non-empty and any override `propertyId` is not present in `input.assets.properties`, fail.
- If any active vehicle has no matching auto quote component (`assetId`), fail.
- If any active property has no matching property quote component, fail.
- If any quote has more than one auto component or more than one property component, fail.

The error message is:

> Multi-asset optimization is not enabled in this release.

Add the active assets (vehicles, properties) to `EngineInput` so the engine can perform the guard.

**Migration strategy**
No database migration. The Edge Function and admin loader pass the asset list. Tests are updated.

**Regression tests**
- Engine test: two vehicles -> error.
- Engine test: two properties -> error.
- Engine test: quote with duplicate auto components -> error.
- Engine test: override for missing asset -> error.
- Engine test: missing insured asset in quote -> error.

**Compatibility implications**
The demo fixture has one vehicle and one property, so existing happy-path tests continue to pass after the guard. Multi-asset cases now fail explicitly instead of silently.

---

### 2.14 Correct current mandate UI behaviour

**Root cause**
The edit screen currently:
- Defaults through `HouseholdMandate.parse({})`.
- Shows amount inputs for `match_current_or_better` and `any`.
- Lets users toggle `materialCoverageReductionsAllowed`, `switchOnlyAfterCustomerApproval`, and `maxPremiumIncreaseCents` as if they are active rules.
- Edits vehicle/property risk facts as coverage preferences.
- Does not let the user reset a per-asset override to household defaults.
- Does not surface structured validation or version conflicts.

**Affected files**
- `apps/mobile/app/edit-mandate.tsx`
- `apps/mobile/app/(tabs)/coverage.tsx`
- `apps/mobile/lib/mandate.ts`
- `apps/admin/src/app/cases/[id]/tabs/mandate.tsx`
- `apps/admin/src/lib/mandate.ts`

**Proposed solution**
- Initialize form state from `loadHouseholdMandateV2()`.
- Show amount inputs only for `minimum`, `maximum`, `exact`.
- Remove toggles for `materialCoverageReductionsAllowed` and `switchOnlyAfterCustomerApproval`; show them read-only.
- Remove `maxPremiumIncreaseCents` input; keep it as a hidden/default `0`.
- Remove `vehicleClass`, `financingStatus`, `propertyType` selectors from the mandate editor; display them read-only.
- Add a "Use household defaults" control per asset that deletes the override (calls `clearVehicleOverride` / `clearPropertyOverride`).
- On save, call `save_household_mandate_v2`; on `STALE_VERSION` refresh and show a conflict banner.
- On validation error, render the Zod error paths as field-level messages.
- After save, reopen and verify exact persistence in an integration test.

**Migration strategy**
No database migration beyond V2 tables/RPC. UI is updated in place.

**Regression tests**
- Mobile unit/integration: open edit, load, change one rule, change one switching rule, add an override, save, reopen, verify exact values, remove override, save, verify inheritance restored.

**Compatibility implications**
The coverage summary screen continues to display the same fields, but sourced from V2. The edit screen is less cluttered.

---

## 3. Required tests

### 3.1 Schema tests (`packages/schemas/test/mandate-v2.test.ts`)

- Explicit default factory.
- Independent default objects (no shared references).
- Every coverage preference (`required`, `preferred`, `indifferent`, `prohibited`).
- Every monetary-rule variant and amount presence/absence.
- Required amount for `minimum`/`maximum`/`exact`.
- Forbidden amount for `match_current_or_better`/`any`.
- Unknown-property rejection.
- `schemaVersion`, `jurisdiction`, `version`, `effectiveFrom` validation.
- Valid nested overrides.
- Invalid nested overrides (unknown keys, risk facts in override values).

### 3.2 Mapping tests (`packages/schemas/test/mandate-adapters.test.ts`)

- `switchingRowToDomain` and `switchingDomainToRow` for every field.
- Full round-trip.
- No field silently resets to default.
- Legacy conversion.
- Expanded unversioned conversion.
- Unsafe V2-to-legacy projection failure.

### 3.3 Resolver tests (`packages/insurance-engine/test/mandate-resolvers.test.ts`)

- No override returns defaults.
- One nested override merges correctly.
- Multiple nested overrides merge correctly.
- Removing an override restores defaults.
- No input mutation.
- Independent asset resolution.

### 3.4 Engine fail-closed tests (`packages/insurance-engine/test/engine.test.ts`)

- Two vehicles.
- Two properties.
- Duplicate product-line components in one quote.
- Missing `assetId` when an override exists.
- Missing insured asset in the quote set.

### 3.5 Database tests (`supabase/tests/007_mandate_v2_tests.sql`)

- One current mandate per household.
- Immutable version history.
- One override per asset and mandate.
- Cross-household override rejection.
- Customer RLS isolation.
- Direct customer write to V2 tables denied.
- `save_household_mandate_v2` atomicity and stale-version conflict.
- Idempotent backfill.
- Quote coverage normalization.

### 3.6 Application tests

- `apps/mobile/app/edit-mandate.tsx` integration: open, load, edit, save, reopen, verify exact values, remove override.
- Admin mandate tab renders V2 fields and risk facts read-only.
- Edge Function returns the multi-asset error for households with two vehicles.

---

## 4. CI requirements

Ensure the following commands complete successfully before reporting completion:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @autopilot/admin build
pnpm --filter @autopilot/mobile expo:doctor
supabase db reset
supabase test db
pnpm db:types
pnpm db:types:check
```

Add the mandate save/reload integration test to CI if not already present. Do not report completion while any workflow job is pending, in progress, cancelled, or failed.

---

## 5. Documentation corrections

Update the following files:

- `docs/mandate-schema.md` — document V2 schema, versioning, jurisdiction, monetary rules, override inheritance, and risk-fact separation.
- `docs/data-model.md` — add `household_coverage_mandates`, `vehicle_mandate_overrides`, `property_mandate_overrides`, and switching-preference mapping.
- `docs/architecture.md` — update the mandate persistence layer, repository pattern, and fail-closed engine note.
- `docs/recommendation-engine.md` — document single-vehicle/single-property limitation and multi-asset guard.
- `docs/roadmap.md` — move multi-asset engine and preferred-coverage scoring to explicitly deferred phases.

Remove any statement that `HouseholdMandate.parse({})` produces a complete mandate. Clearly state the current legacy fallback and the current single-asset recommendation limitation.

---

## 6. Explicitly deferred work

The following will **not** be implemented in this phase:

- Multiple-vehicle configuration generation.
- Multiple-property configuration generation.
- Preferred-coverage scoring (preferred vs required).
- New auto coverage hierarchy beyond the V2 schema.
- Carrier APIs.
- Automated policy extraction.
- Additional coverage fields.
- Visual redesign.
- New insurer-ranking logic.
- Silent or automatic switching.

---

## 7. Commit structure

Use focused, unsquashed commits:

1. `fix(schemas): add valid versioned mandate model and monetary rules`
2. `feat(database): add immutable v2 mandate and override persistence`
3. `fix(persistence): map switching fields and save mandate atomically`
4. `fix(migration): normalize expanded quote coverage records`
5. `fix(mobile): persist and restore mandate v2 correctly`
6. `test(mandate): add schema mapping persistence and RLS coverage`
7. `docs(mandate): correct versioning and current limitations`

---

## 8. Definition of done

This phase is complete only when:

1. Default mandate construction cannot throw.
2. Malformed persisted data produces a visible structured error.
3. Monetary-rule validation is correct.
4. V2 records carry `schemaVersion` and `jurisdiction`.
5. Mandate versions are immutable.
6. One current mandate exists per household.
7. Overrides use asset foreign keys.
8. Cross-household overrides are impossible.
9. Legacy records remain readable.
10. Existing records are backfilled idempotently.
11. Switching preferences round-trip without resetting to defaults.
12. Mandate and switching saves are atomic.
13. The edit screen restores exact saved values.
14. Overrides can be removed.
15. Migrated quote records conform to declared schemas.
16. Unsupported multi-asset recommendations fail closed.
17. Dedicated mandate tests exist and pass.
18. Database and RLS tests pass.
19. End-to-end CI completes successfully.
20. No additional feature phase has begun.

When complete, push the focused commits to `devin/1784150712-mvp-scaffold`, update PR #1 description with a `Corrective Phase 1B` section, and end the report with:

> Corrective Phase 1B complete. Multi-asset engine work has not begun. Awaiting review.
