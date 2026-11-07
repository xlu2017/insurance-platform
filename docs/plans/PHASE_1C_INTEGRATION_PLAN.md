# Devin Corrective Phase 1C: Make Coverage Mandate V2 Authoritative End to End

This plan describes how to eliminate the split between the V2 coverage-mandate persistence layer introduced in Phase 1B and the legacy recommendation workflow that still reads `coverage_requirements`.

**Scope:** V2 mandate becomes the single source of truth for mobile save, admin read, recommendation generation, recommendation persistence, and customer approval. Multi-vehicle and multi-property optimization remain explicitly deferred.

**Repository:** `xlu2017/insurance-platform`
**Branch/PR:** `devin/1784150712-mvp-scaffold` / PR #1

---

## 1. Active legacy and V2 mandate readers

### Active legacy readers of `coverage_requirements`

| #   | File / Migration                                                    | Operation                                                                                                                                               | Why it must change                                                                                       |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | `supabase/functions/recommendation-generator/index.ts:149`          | `select version, auto_requirements, property_requirements, vehicle_mandates, property_mandates from coverage_requirements`                              | Edge Function builds the engine mandate directly from the legacy row.                                    |
| 2   | `apps/admin/src/app/cases/[id]/tabs/mandate.tsx:234`                | `select auto_requirements, property_requirements, vehicle_mandates, property_mandates from coverage_requirements`                                       | Admin mandate preview still reads the legacy table instead of `household_coverage_mandates` + overrides. |
| 3   | `apps/mobile/app/onboarding/mandate.tsx:44`                         | `insert into coverage_requirements`                                                                                                                     | Mobile onboarding creates a legacy row.                                                                  |
| 4   | `scripts/e2e-golden-path.mjs:141`                                   | `select version from coverage_requirements`                                                                                                             | Golden-path script asserts on legacy mandate version.                                                    |
| 5   | `supabase/seed.sql:94`                                              | `insert into coverage_requirements`                                                                                                                     | Seed still populates legacy table for the demo household.                                                |
| 6   | `supabase/migrations/20260715000007_rpc_lockdown.sql:201,317`       | `select version into current_mandate_version from coverage_requirements` inside `approve_customer_recommendation` and `decline_customer_recommendation` | Approval/decline RPCs validate the mandate version against the legacy table.                             |
| 7   | `supabase/migrations/20260715000008_generate_recommendation.sql:75` | `select version into current_mandate_version from coverage_requirements` inside `persist_recommendation`                                                | Recommendation persistence validates mandate version against the legacy table.                           |
| 8   | `supabase/migrations/20260715000003_remediation.sql:185,251`        | `select version into current_mandate_version from coverage_requirements` inside older workflow RPCs                                                     | Remediation workflow RPCs still reference the legacy table.                                              |
| 9   | `supabase/migrations/20260715000006_rpc_renames.sql:105,166`        | `select version into current_mandate_version from coverage_requirements` inside renamed RPCs                                                            | RPC renames still point at legacy table.                                                                 |

### Active V2 readers of `household_coverage_mandates`

| #   | File / Migration                                                                   | Operation                                                         | Why it is the new source of truth                                        |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | `packages/database/src/mandate-repository.ts:120`                                  | `select * from household_coverage_mandates ... is_current = true` | Typed repository used by mobile and admin.                               |
| 2   | `supabase/migrations/20260716000003_coverage_mandate_v2_foundation.sql`            | Create, index, RLS, RPC, backfill for V2 tables                   | DB schema foundation.                                                    |
| 3   | `supabase/tests/007_mandate_v2_tests.sql`                                          | pgTAP tests reading V2 tables                                     | Regression tests for V2.                                                 |
| 4   | `apps/admin/src/lib/engine-input.ts:132` (via `loadHouseholdMandateV2`)            | Admin engine input loads V2 mandate                               | Already V2, but needs to be the only admin path.                         |
| 5   | `apps/mobile/app/edit-mandate.tsx` / `coverage.tsx` (via `loadHouseholdMandateV2`) | Mobile V2 save/load                                               | Already V2, but must stop any legacy insert in `onboarding/mandate.tsx`. |

### Recommendation-lifecycle version checks

| RPC / Function                    | Current source                              | Target source                                                    |
| --------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `persist_recommendation`          | `coverage_requirements.version`             | `household_coverage_mandates.version` + mandate identity columns |
| `approve_customer_recommendation` | `coverage_requirements.version`             | V2 snapshot recorded on `recommendations`                        |
| `decline_customer_recommendation` | `coverage_requirements.version`             | V2 snapshot recorded on `recommendations`                        |
| `review_recommendation`           | does not currently validate mandate version | validate against recorded V2 snapshot (optional but desirable)   |

### Edge Function engine duplication

`packages/insurance-engine/src/engine.ts` (workspace) and `supabase/functions/recommendation-generator/engine.ts` (Deno) are two manually maintained copies. They have drifted in imports/types and the Edge Function copy uses `any` casts. The plan calls for one runtime-neutral source.

### Mandate-save trust boundary

`save_household_mandate_v2` is a public RPC that accepts raw JSON and stores it without schema validation. A new `save-household-mandate` Edge Function will validate with canonical V2 Zod schemas before calling an internal `persist_household_mandate_v2` RPC.

---

## 2. Establish the V2 source-of-truth rule

### Authoritative tables

For all new operations, the following tables are the source of truth:

- `household_coverage_mandates` (current V2 household mandate)
- `vehicle_mandate_overrides` (asset-specific vehicle overrides)
- `property_mandate_overrides` (asset-specific property overrides)
- `switching_preferences` (economic and process switching rules)

### Forbidden reads for new operations

New recommendation, approval, persistence, and UI code must not read these legacy fields:

- `coverage_requirements.auto_requirements`
- `coverage_requirements.property_requirements`
- `coverage_requirements.vehicle_mandates`
- `coverage_requirements.property_mandates`

### Permitted uses of legacy tables

- Historical migration and idempotent backfills.
- Diagnostic admin tooling (read-only).
- Temporary rollback analysis.
- Continued existence of legacy rows until a future migration removes them.

### Documentation updates

- `docs/mandate-schema.md` — state V2 as the active contract.
- `docs/data-model.md` — move `coverage_requirements` to a historical/legacy note.
- `docs/architecture.md` — document the source-of-truth rule and the trusted loader.
- `docs/recommendation-engine.md` — document V2 snapshot binding.

---

## 3. Build one trusted server-side V2 loader

### New shared type: `RecommendationInputSnapshot`

```ts
export interface RecommendationInputSnapshot {
  mandateId: string;
  mandateVersion: number;
  mandateSchemaVersion: 2;
  jurisdiction: "AB";
  switchingPreferencesId: string;
  switchingPreferencesVersion: number;
  mandate: HouseholdCoverageMandateV2;
  switching: SwitchingPreferencesV2;
  assets: HouseholdAssets;
  quotes: EngineQuote[];
}

export interface HouseholdAssets {
  vehicles: Array<{ id: string }>;
  properties: Array<{ id: string }>;
}
```

### Loader responsibilities

The loader lives in `packages/database/src/recommendation-loader.ts` and is used by:

- `apps/admin/src/lib/engine-input.ts` (browser side, via `loadHouseholdMandateV2` + quote query)
- `supabase/functions/recommendation-generator/index.ts` (server side)
- future workspace integration tests

It must perform one coherent snapshot load:

1. Lock/select the current `household_coverage_mandates` row for the household.
2. Select all `vehicle_mandate_overrides` and `property_mandate_overrides` for that `mandate_id`.
3. Select the current `switching_preferences` row.
4. Select `vehicles` and `properties` for the household.
5. Select all `quotes` + `quote_policy_components` + `quote_coverages` for the case.
6. Validate every piece of JSON with the appropriate Zod schema (`HouseholdCoverageMandateV2`, `SwitchingPreferencesV2`, `AutoCoverageDetails`, `PropertyCoverageDetails`, `EngineQuote`).
7. Convert the V2 mandate to the engine `HouseholdMandate` using `mandateV2ToEngineMandate`.
8. Build `EngineInput` and `assets`.
9. Return the snapshot; never fall back to legacy values during recommendation generation.

### Error contract

A missing or invalid current V2 mandate returns an operational error with a structured code:

```ts
{
  code: "MANDATE_NOT_CONFIGURED" | "MANDATE_INVALID" | "MANDATE_LOAD_ERROR";
  message: string;
  issues?: Array<{ path: (string | number)[]; message: string }>;
}
```

No `as any`, no unchecked `coverage_requirements` casts.

---

## 4. Eliminate the manually maintained engine copy

### Chosen approach: one runtime-neutral source imported by both runtimes

Because the workspace engine is already pure TypeScript and has no Node-only dependencies, we will:

1. Move `packages/insurance-engine/src/engine.ts` and `types.ts` into a Deno-compatible file that uses only standard imports.
2. Keep `packages/insurance-engine/src/index.ts` as the workspace re-export.
3. In `supabase/functions/recommendation-generator/index.ts`, import from `npm:@autopilot/insurance-engine@*` if the package is published, or from a vendored copy generated at build time.

### Preferred concrete path

Use a vendored copy under `supabase/functions/recommendation-generator/_shared/engine.ts` that is generated by an `esbuild` bundle from `packages/insurance-engine` and committed.

### Build command

```bash
pnpm --filter @autopilot/insurance-engine bundle:edge
```

This writes `supabase/functions/recommendation-generator/_shared/engine.ts` and a `.engine-source-hash` file containing the SHA-256 of `packages/insurance-engine/src/**/*`.

### Source-hash enforcement in CI

```bash
pnpm --filter @autopilot/insurance-engine bundle:edge:check
```

Fails if the generated file does not match the current source hash. The generated file header must say:

```
// AUTO-GENERATED from packages/insurance-engine/src
// Do not edit manually. Run pnpm --filter @autopilot/insurance-engine bundle:edge
// Source hash: <hash>
```

### Engine parity

The generated file must be tested with the same fixture-based tests as the workspace engine. If the generated runtime differs, add a `packages/insurance-engine/test/edge-compat.test.ts` that imports the generated bundle and runs a subset of engine tests against it.

### Deletion

`supabase/functions/recommendation-generator/engine.ts` is deleted after the generated bundle is working.

---

## 5. Use V2 in the recommendation Edge Function

### Rewrite `supabase/functions/recommendation-generator/index.ts`

1. Authenticate the operations/admin user via `Authorization` header.
2. Load `caseId` from the request body.
3. Verify `caseRow.state === "comparing_quotes"`.
4. Verify `can_access_case(caseId)` via a Supabase RPC or RLS check.
5. Call the trusted V2 loader to get `RecommendationInputSnapshot`.
6. If the loader returns an error, return that error as a 4xx/5xx JSON response.
7. Build `EngineInput` with `assets`.
8. Call `evaluateHousehold(input)`.
9. If `result.rejection` is present, return a non-2xx JSON response:

```json
{
  "code": "MULTI_ASSET_OPTIMIZATION_NOT_ENABLED",
  "message": "Multi-asset optimization is not enabled in this release."
}
```

10. If `result.recommended` is null, return `200` with `{ eligible: 0, evaluated: ..., recommendationId: null }` and a clear reason.
11. If a recommendation exists, call `persist_recommendation` with the V2 snapshot metadata (mandate id, version, schema version, jurisdiction, switching id, switching version, engine version, quote snapshot).

### Rejection response shapes

| Condition                                        | HTTP | Response                                                                                          |
| ------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------- |
| No recommended configuration (savings threshold) | 200  | `{ eligible: 0, evaluated, recommendationId: null, reason: { code: "BELOW_SAVINGS_THRESHOLD" } }` |
| Multi-asset input                                | 422  | `{ code: "MULTI_ASSET_OPTIMIZATION_NOT_ENABLED", message: "..." }`                                |
| Missing/unknown insured asset                    | 422  | `{ code: "MISSING_INSURED_ASSET", message: "..." }`                                               |
| Stale mandate                                    | 409  | `{ code: "STALE_MANDATE", message: "..." }`                                                       |
| Invalid quote data                               | 422  | `{ code: "INVALID_QUOTE_DATA", message: "...", details: [...] }`                                  |
| Internal failure                                 | 500  | `{ code: "INTERNAL_ERROR", message: "..." }`                                                      |

---

## 6. Bind recommendations to an exact V2 mandate snapshot

### Forward migration: extend `recommendations`

```sql
alter table recommendations
  add column if not exists mandate_id uuid references household_coverage_mandates(id),
  add column if not exists mandate_schema_version int not null default 2 check (mandate_schema_version = 2),
  add column if not exists mandate_jurisdiction text not null default 'AB' check (mandate_jurisdiction = 'AB'),
  add column if not exists switching_preferences_id uuid references switching_preferences(id);
```

`mandate_version` and `switching_preferences_version` already exist. They will continue to store the versions.

### Data recorded per recommendation

- `mandate_id` — exact V2 mandate row.
- `mandate_version` — version at generation time.
- `mandate_schema_version` — always 2 for new recommendations.
- `mandate_jurisdiction` — always 'AB'.
- `switching_preferences_id` — exact switching row.
- `switching_preferences_version` — version at generation time.
- `engine_version` — engine version string.
- `quote_snapshot` — `{ id, updated_at }` for every referenced quote.

### Foreign-key behavior

- `on delete restrict` on `mandate_id` so a mandate referenced by an active recommendation cannot be deleted.
- `switching_preferences_id` references the switching row; restrict delete while active.

---

## 7. Update recommendation persistence

### Replace `persist_recommendation` mandate-version validation

The RPC signature will change to accept V2 identity:

```sql
create or replace function persist_recommendation(
  p_case_id uuid,
  p_mandate_id uuid,
  p_mandate_version int,
  p_mandate_schema_version int,
  p_mandate_jurisdiction text,
  p_switching_preferences_id uuid,
  p_switching_preferences_version int,
  p_quote_snapshot jsonb,
  p_engine_version text,
  ...
)
```

### Validation inside `persist_recommendation`

1. Verify the caller is `operations` or `admin` and can access the case.
2. Select the current `household_coverage_mandates` row for the case household **with `for update`** (or select `pg_advisory_xact_lock` on the household) to prevent races.
3. Verify `current_row.id = p_mandate_id`.
4. Verify `current_row.version = p_mandate_version`.
5. Verify `current_row.schema_version = p_mandate_schema_version`.
6. Verify `current_row.jurisdiction = p_mandate_jurisdiction` and that it matches the case household's province.
7. Select the current `switching_preferences` row for the household **with `for update`**.
8. Verify `current_row.id = p_switching_preferences_id` and `current_row.version = p_switching_preferences_version`.
9. Validate the quote snapshot: each quote belongs to the case and `updated_at` has not changed.
10. Insert the recommendation with the V2 identity fields.
11. Insert `recommendation_options`.
12. Transition the case to `licensed_review`.
13. Write an `audit_events` row with the V2 mandate identity.

No queries to `coverage_requirements` remain.

---

## 8. Update review and customer approval

### Customer approval preferred signature

```sql
create or replace function approve_customer_recommendation(
  p_recommendation_id uuid,
  p_expected_recommendation_version int
)
```

`expected_mandate_version` and `expected_switching_version` are removed from the customer signature. The database function derives and verifies them from the recommendation snapshot and current V2 rows.

### Validation inside `approve_customer_recommendation`

1. Caller is a household member (existing `require_household_member_for_recommendation`).
2. Recommendation is `published`.
3. Case is `customer_decision`.
4. `rec.version = p_expected_recommendation_version`.
5. The current V2 mandate row is `rec.mandate_id` and `version` matches `rec.mandate_version`.
6. The current switching row is `rec.switching_preferences_id` and `version` matches `rec.switching_preferences_version`.
7. All referenced quotes still exist, are not expired/rejected/superseded, and `updated_at` matches the snapshot.
8. No newer active recommendation exists for the case.

If the customer changed the mandate after generation, approval fails with `STALE_MANDATE`.

### Decline and review

`decline_customer_recommendation` gets the same simplified signature and V2 snapshot validation.
`review_recommendation` should also verify the recommendation's recorded V2 snapshot is still current before publishing (defense in depth).

---

## 9. Secure mandate saving

### Public validation layer: `save-household-mandate` Edge Function

New file: `supabase/functions/save-household-mandate/index.ts`

Responsibilities:

1. Authenticate customer via `Authorization` header.
2. Parse request body with Zod:
   - `householdId` (UUID)
   - `expectedMandateVersion` (int, 0 if none)
   - `expectedSwitchingVersion` (int, 0 if none)
   - `mandate`: `HouseholdCoverageMandateV2`
   - `switching`: `SwitchingPreferencesV2`
3. Reject unknown properties (`strict()`).
4. Validate UUID uniqueness and that `version` inside `mandate` matches `expectedMandateVersion + 1`.
5. Validate every override references an asset in the household:
   - query `vehicles` and `properties` for `householdId`;
   - ensure every `vehicleOverrides.vehicleId` and `propertyOverrides.propertyId` is present.
6. Reject duplicate override `vehicleId` / `propertyId` entries.
7. Call internal RPC `persist_household_mandate_v2` as a service-role client.
8. Return `{ success, mandateVersion, switchingVersion }` or a structured error.

### Internal persistence layer: `persist_household_mandate_v2`

Rename or replace `save_household_mandate_v2` with a service-role-only function:

```sql
create or replace function persist_household_mandate_v2(
  p_household_id uuid,
  p_expected_mandate_version int,
  p_expected_switching_version int,
  p_household_auto_defaults jsonb,
  p_household_property_defaults jsonb,
  p_vehicle_overrides jsonb,
  p_property_overrides jsonb,
  p_switching_preferences jsonb,
  p_jurisdiction text
)
```

Rules:

- `security definer` and `set search_path = public`.
- Revoke `execute` from `authenticated`, `public`, `anon`.
- Only `service_role` may call it.
- Lock the current V2 mandate row or use `pg_advisory_xact_lock` on the household.
- Verify expected versions server-side.
- Set `effective_from = now()` server-side (ignore client value).
- Compute `version = coalesce(max(version), 0) + 1`.
- Mark old rows non-current.
- Insert canonical V2 JSON into `household_coverage_mandates`.
- Insert overrides into `vehicle_mandate_overrides` and `property_mandate_overrides`.
- Upsert `switching_preferences` with `version + 1`.
- Write one `audit_events` row.
- Return `{ success: true, mandateVersion, switchingVersion }` or `STALE_VERSION`.

### Mobile update

`apps/mobile/app/edit-mandate.tsx` and any other save path call `supabase.functions.invoke('save-household-mandate', { body: ... })` instead of `supabase.rpc('save_household_mandate_v2', ...)`.

---

## 10. Enforce canonical V2 storage

### Forward repair migration

Add a migration `20260716000005_v2_canonical_storage.sql`:

1. For every row in `household_coverage_mandates`, recursively rewrite legacy monetary rules from `{ rule, cents }` to `{ rule, amountCents }`.
2. Do the same for `vehicle_mandate_overrides.override_values` and `property_mandate_overrides.override_values`.
3. Ensure `match_current_or_better` and `any` rules do not carry a `cents` or `amountCents` key.

### Repository change

`packages/database/src/mandate-repository.ts` must no longer normalize `cents` to `amountCents` when reading V2 tables. It should parse the stored JSON directly with `HouseholdCoverageMandateV2.parse()`. The legacy adapter (`legacyMandateToV2` / `expandedUnversionedMandateToV2`) runs only when reading an actual legacy `coverage_requirements` row.

---

## 11. Correct backfill execution

### Backfill change

`backfill_coverage_mandate_v2()` currently has a global guard:

```sql
if not exists (select 1 from household_coverage_mandates limit 1) then
  perform backfill_coverage_mandate_v2();
end if;
```

Replace with a per-household guard inside the function body:

```sql
for cr in
  select *
  from coverage_requirements cr
  where cr.is_current = true
    and not exists (
      select 1 from household_coverage_mandates hcm
      where hcm.household_id = cr.household_id and hcm.is_current = true
    )
loop
  -- create V2 mandate + overrides for this household
end loop;
```

### Backfill tests

Add pgTAP tests in `supabase/tests/008_mandate_v2_backfill.sql`:

1. No V2 households in a fresh DB: backfill creates one V2 row per legacy household.
2. One previously migrated household + one legacy-only household: backfill creates only the missing one.
3. Running backfill twice: no duplicate rows.
4. Existing V2 mandate versions unchanged after re-run.
5. Overrides retain canonical V2 shape (`amountCents`, not `cents`).

---

## 12. Correct repository error handling

### `loadHouseholdMandateV2` changes

1. Distinguish `no rows` (return default only if no mandate and caller is starting setup) from query `error` (throw).
2. Check `vehicleOverridesResult.error` and `propertyOverridesResult.error`.
3. Validate switching rows with `SwitchingPreferencesV2` Zod schema; throw `MandateValidationError` on failure.
4. Throw on invalid enums.
5. Return a structured `MandateLoadError` for network / authorization / SQL errors that does not expose SQL details.
6. Do not return defaults after any real error.

### Error shape

```ts
export interface MandateLoadError {
  operation: "load_mandate";
  table?: string;
  code: string;
  message: string;
  issues?: Array<{ path: (string | number)[]; message: string }>;
}
```

---

## 13. Correct staff RLS

### Required grants/policies

- Operations staff can read authorized households and their mandates.
- Reviewers can read review-relevant cases and associated mandates.
- Admins can read all.
- Customers can read own household.
- Service role can manage V2 mandates for internal persistence.

### New policies

Add RLS policies on `vehicle_mandate_overrides` and `property_mandate_overrides` mirroring `household_coverage_mandates`:

- `*_customer_select` — own household via mandate join.
- `*_admin_select` — `is_staff()`.
- `*_service_all` — `auth.role() = 'service_role'`.
- Customer direct writes denied.

### Migration

Add `20260716000006_staff_rls.sql` with the policies and grants.

---

## 14. Correct partial override conversion

### Current bug

`v2PropertyOverrideValuesToLegacy` converts a partial `sewerBackup: { preference: "required" }` by calling `v2WaterToLegacy` with `limit` and `deductible` cast to `MonetaryRule`. If those are missing, it will fail or produce invalid data.

### Fix

1. Resolve the complete effective V2 mandate first:
   - For each asset, call `resolveVehicleMandateV2(defaults, override)` or `resolvePropertyMandateV2(defaults, override)`.
2. Convert the _resolved_ `AutoMandateV2` / `PropertyMandateV2` to the legacy engine shape.
3. The engine's `effectiveAutoMandate` / `effectivePropertyMandate` can then operate on fully resolved legacy requirements, or we can have the engine consume resolved V2 directly.

### Tests

Add `packages/schemas/test/mandate-override-resolution.test.ts`:

1. Water preference only override inherits default limit and deductible.
2. Water limit only override keeps default preference and deductible.
3. Water deductible only override keeps default preference and limit.
4. One optional coverage override leaves others unchanged.
5. One auto endorsement override leaves others unchanged.
6. Coverage-form preference only override works.

---

## 15. Correct quote normalization and validation

### Remove `jsonb_strip_nulls` usage

Find any usage of `jsonb_strip_nulls` in quote normalization and replace it with explicit schema serialization that keeps nullable keys as `null`.

### Normalization rules

`packages/database/src/quote-normalizer.ts` (new file) will:

1. Accept a raw `quote_coverages.coverage` JSONB object.
2. Validate with `AutoCoverageDetails` or `PropertyCoverageDetails`.
3. If invalid, return a structured error containing:
   - `quoteId`
   - `componentId`
   - `productLine`
   - `fieldPath`
   - `message`
4. Never silently drop invalid quotes; either reject them or mark them `incomplete`.

### Edge Function integration

`toEngineQuote` in the Edge Function must call the normalizer and surface errors.

---

## 16. Enforce component-to-asset integrity

### Chosen option: Option B (trusted trigger)

Add triggers `quote_policy_components_validate_asset`:

1. On insert/update of `quote_policy_components`:
   - If `product_line = 'auto'`, require `asset_id` references a `vehicles.id` belonging to the case household.
   - If `product_line = 'property'`, require `asset_id` references a `properties.id` belonging to the case household.
   - Raise `P0001` with a structured message if the asset is missing or wrong type.

### Backfill seeded components

`supabase/seed.sql` and test fixtures must populate `quote_policy_components.asset_id` with the demo vehicle/property UUIDs.

### Engine behavior

The engine already rejects missing assets when `assets` are supplied. The trigger ensures the database cannot contain invalid associations.

---

## 17. Make UI failures visible

### Mobile screens

Update `apps/mobile/app/edit-mandate.tsx` and `apps/mobile/app/(tabs)/coverage.tsx` to handle:

1. Query loading — show spinner.
2. No mandate — show prompt to create one.
3. Validation failure — show `MandateValidationError.issues`.
4. Authorization failure — show sign-in prompt.
5. Database failure — show a generic "Could not load mandate" with a retry button and a diagnostic code.
6. Stale-version conflict on save — show "Mandate changed elsewhere. Reload?" with a reload button.

### Error screen component

Add `apps/mobile/components/ErrorScreen.tsx`:

```tsx
export function ErrorScreen({ title, message, code, onRetry }: Props) { ... }
```

---

## 18. Replace the current golden-path test

### New E2E script

Replace `scripts/e2e-golden-path.mjs` with `scripts/e2e-v2-golden-path.mjs` that:

1. Signs in as `customer@example.com`.
2. Calls `save-household-mandate` with a V2 mandate that sets liability to `1_000_000` cents (different from the legacy row).
3. Verifies the V2 row in `household_coverage_mandates` has canonical JSON and `schema_version = 2`.
4. Verifies the legacy `coverage_requirements` row still has the old value.
5. Signs in as `operations@example.com`.
6. Generates a recommendation for the case.
7. Verifies the recommendation reflects the V2 liability requirement.
8. Verifies `recommendations.mandate_id` and `mandate_version` are set.
9. Advances case to `licensed_review`.
10. Signs in as `reviewer@example.com`, publishes.
11. Signs in as customer, changes the V2 mandate.
12. Tries to approve; verifies `STALE_MANDATE` rejection.
13. Regenerates with the new mandate.
14. Publishes and approves.
15. Completes the switch.
16. Verifies audit events contain the V2 mandate identity.

### Prove legacy does not influence V2

A dedicated assertion updates only `coverage_requirements` and re-runs recommendation generation; it must fail or produce the V2 value, never the legacy value.

---

## 19. Negative integration tests

### Release-blocking tests

Add to `packages/database/test/mandate-v2-negative.integration.test.ts` and pgTAP:

1. Malformed V2 JSON cannot be persisted through the public Edge Function.
2. Duplicate override asset IDs rejected.
3. Cross-household overrides rejected.
4. Customer cannot invoke `persist_household_mandate_v2` directly.
5. Reviewer cannot save a customer mandate.
6. Override-query failure does not produce empty overrides.
7. Unknown switching enums fail validation.
8. Invalid quote coverage is surfaced, not omitted.
9. Edge Function and workspace engine produce identical results on the same fixture.
10. Multi-asset input rejected by the deployed recommendation path.
11. Stale V2 mandate approval fails.
12. Legacy mandate changes do not affect V2 recommendations.

---

## 20. CI

Update `.github/workflows/ci.yml` to run, in order:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @autopilot/admin build
pnpm --filter @autopilot/mobile expo:doctor
supabase db reset
supabase test db
pnpm --filter @autopilot/database test:integration
pnpm db:types
pnpm db:types:check
pnpm --filter @autopilot/insurance-engine bundle:edge:check
pnpm --filter @autopilot/insurance-engine test:edge-compat
pnpm exec node scripts/e2e-v2-golden-path.mjs
```

Add new workflow steps:

- Engine source parity check.
- Edge Function bundle type check.
- V2 save-to-recommendation E2E test.
- Stale-V2-approval integration test.

Do not report completion while any job is pending, in progress, cancelled, or failed.

---

## 21. Explicitly deferred

Do not implement:

- True multi-vehicle optimization.
- True multi-property optimization.
- Preferred-coverage scoring.
- New coverage fields.
- New coverage-form hierarchy.
- Carrier APIs.
- Automated policy extraction.
- Automatic binding.
- Visual redesign.

The only objective is making the current single-auto/single-property recommendation path consistently governed by V2.

---

## 22. Commit structure

Use focused, unsquashed commits:

1. `refactor(engine): generate edge-compatible bundle from workspace engine`
2. `fix(recommendation): load and persist exact v2 mandate snapshot`
3. `fix(approval): validate current v2 mandate through recommendation lifecycle`
4. `fix(security): validate public mandate saves before internal persistence`
5. `fix(database): canonicalize v2 backfill and asset associations`
6. `fix(repository): surface database and validation failures`
7. `test(e2e): prove v2 mandate controls recommendation and approval`
8. `docs: establish v2 as active source of truth`

---

## 23. Definition of done

Phase 1C is complete only when:

- [ ] No active recommendation code reads `coverage_requirements`.
- [ ] The Edge Function uses the same engine logic as workspace tests.
- [ ] The actual Edge Function enforces multi-asset fail-closed checks.
- [ ] Quote components carry validated asset associations.
- [ ] Recommendations store the exact V2 mandate ID and version.
- [ ] Recommendation persistence validates the V2 mandate.
- [ ] Customer approval validates the V2 mandate.
- [ ] Legacy-row changes do not influence recommendations.
- [ ] Invalid V2 JSON cannot enter current mandate tables.
- [ ] The raw persistence RPC is not executable by customers.
- [ ] Staff can read authorized overrides.
- [ ] Database failures are not converted into defaults.
- [ ] Partial water overrides resolve correctly.
- [ ] Canonical V2 records use `amountCents`.
- [ ] Partial-population backfill works idempotently.
- [ ] Invalid quote coverage is surfaced explicitly.
- [ ] The mobile UI displays load and validation failures.
- [ ] V2 end-to-end tests pass.
- [ ] All CI jobs complete successfully.
- [ ] True multi-asset optimization has not begun.

---

## 24. Review checkpoint

When complete:

- Stop implementation.
- Push all commits to `devin/1784150712-mvp-scaffold`.
- Add a **Corrective Phase 1C** section to PR #1 description.
- Report:
  - active legacy reads removed;
  - engine duplication removed;
  - migrations added;
  - recommendation snapshot fields;
  - save trust-boundary changes;
  - RLS changes;
  - quote-validation changes;
  - end-to-end scenarios;
  - CI run and final conclusion;
  - remaining limitations.
- End with:
  `Corrective Phase 1C complete. V2 now governs the full recommendation lifecycle. Multi-asset optimization has not begun. Awaiting review.`

---

## 25. Execution status

Implemented and verified on branch `devin/1784150712-mvp-scaffold`:

- V2 is the active source of truth for mobile save, admin read, recommendation generation, recommendation persistence and customer approval.
- `coverage_requirements` is no longer read by any active recommendation, persistence or approval code. The legacy table remains only for historical migration, diagnostics and rollback analysis.
- The manually maintained `supabase/functions/recommendation-generator/engine.ts` is deleted; the Edge Function imports the workspace engine from a generated `autopilot.js` bundle with a SHA-256 source hash.
- `packages/database/src/recommendation-loader.ts` is the single trusted V2 loader used by the Edge Function.
- Recommendations store `mandate_id`, `mandate_version`, `mandate_schema_version`, `mandate_jurisdiction`, `switching_preferences_id`, `switching_preferences_version`, `quote_snapshot` and `engine_version`.
- `persist_recommendation`, `review_recommendation`, `approve_customer_recommendation` and `decline_customer_recommendation` validate the recorded V2 snapshot; stale mandates block approval.
- Public `save-household-mandate` Edge Function validates V2 JSON and asset associations before calling the service-role-only `persist_household_mandate_v2` RPC.
- Canonical V2 storage (`amountCents`) is enforced by the forward repair migration; the backfill is idempotent per household.
- Mobile mandate screens surface load, validation, authorization and database errors.
- `scripts/e2e-v2-mandate-lifecycle.mjs` exercises the full V2 lifecycle plus negative cases (malformed JSON, internal RPC denial, duplicate overrides, multi-asset rejection, stale approval, legacy non-influence).
- CI now runs engine-source parity (`check:edge`) and the V2 end-to-end test.
- All local CI checks pass: `format:check`, `lint`, `typecheck`, `test`, admin build, `expo:doctor`, `supabase test db`, `test:integration`, `db:types`, `db:types:check`.

Definition of done checklist: all items satisfied.
