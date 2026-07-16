# Corrective Phase 1D — Recommendation and Quote Integrity Plan

## Objective

Make the single-vehicle / single-property recommendation pipeline trustworthy and reproducible before any multi-asset optimization work begins. At the end of this phase:

- Only the trusted recommendation Edge Function (via service-role) can persist an engine recommendation.
- Operations or admin users cannot fabricate recommendation results by calling an RPC directly.
- Every persisted recommendation is bound to a complete, canonical, digest-verified input snapshot and an engine-output digest.
- Incomplete quote facts remain explicitly unknown; they are not coerced to `false` or `0`.
- Only validated quote components reach the engine.
- Monetary rules, coverage-form compatibility, and preferred-requirement scoring are enforced consistently.
- The Edge engine bundle is deterministic and all local CI checks pass.
- True multi-vehicle / multi-property optimization remains deferred.

---

## 1. Current trust boundary

### 1.1 Recommendation generation path

1. `POST /functions/v1/recommendation-generator` (`supabase/functions/recommendation-generator/index.ts`)

   - Authenticates the operations/admin caller via `supabase.auth.getUser()`.
   - Verifies `optimization_cases.state` is `comparing_quotes` or `customer_decision`.
   - Loads a `RecommendationInputSnapshot` via `loadRecommendationInputSnapshot`.
   - Builds `EngineInput` via `buildEngineInputFromSnapshot`.
   - Runs `evaluateHousehold` from the generated `autopilot.js` bundle.
   - Calls `supabase.rpc("persist_recommendation", ...)` using the **user-scoped** `supabase` client.

2. `persist_recommendation` RPC (`supabase/migrations/20260716000005_phase_1c_v2_authoritative.sql`)
   - `SECURITY DEFINER`, `search_path = public`.
   - Derives caller from `auth.uid()` and `profiles.role`.
   - Validates current V2 mandate/switching and quote snapshot `updated_at`.
   - Inserts `recommendations` and `recommendation_options`.
   - **Current grant**: `EXECUTE` granted to `authenticated`.

### 1.2 Problem

Because the RPC is granted to `authenticated`, any operations/admin user with a valid access token can call it directly with fabricated `p_options`, `p_current_total_cents`, `p_proposed_total_cents`, `p_net_savings_cents`, `p_quote_snapshot`, etc. The Edge Function is not a mandatory gate. This violates the requirement that only trusted server-side code can persist a recommendation.

### 1.3 Direct RPC grants today

| Function                                    | Granted to                     |
| ------------------------------------------- | ------------------------------ |
| `persist_recommendation(...)`               | `authenticated`                |
| `review_recommendation(...)`                | `authenticated`                |
| `approve_customer_recommendation(uuid,int)` | `authenticated`                |
| `decline_customer_recommendation(uuid,int)` | `authenticated`                |
| `persist_household_mandate_v2(...)`         | `service_role` only (Phase 1C) |

Phase 1D will rename/replace `persist_recommendation` with `persist_engine_recommendation_v2` and grant it **only** to `service_role`. The Edge Function will authenticate the human user, verify access, run the engine, then call the internal RPC with the human actor ID as an explicit parameter.

---

## 2. Current quote creation/update paths

### 2.1 Admin UI writes directly

`apps/admin/src/app/cases/[id]/tabs/quotes.tsx` inserts into:

- `quotes`
- `quote_policy_components`
- `quote_coverages`

in three separate Supabase client calls. There is no transaction, no schema-version assignment, no validation status, no component-to-asset integrity check beyond the existing trigger, and no audit event.

### 2.2 Database repair/normalization

`20260716000005_phase_1c_v2_authoritative.sql` contains `canonicalize_quote_auto_coverage` and `canonicalize_quote_property_coverage` that currently `coalesce(..., 0)` missing limits and `coalesce(..., false)` missing booleans, and `coalesce(..., 'liability_only')` / `coalesce(..., 'homeowner')` / `coalesce(..., 'replacement_cost')` for form/type/settlement. This converts "unknown" into a concrete coverage fact.

`packages/schemas/src/quotes.ts` also applies `.default(...)` for `vehicleClass`, `financingStatus`, and `propertyType`, silently replacing missing values with defaults.

`packages/database/src/quote-normalizer.ts` parses the raw `quote_coverages.coverage` JSON with the same defaulting schemas and returns an `EngineQuote` without a validation gate.

### 2.3 Result

Missing coverage facts are treated as confirmed absence or default values, which can cause the engine to accept incomplete quotes or reject valid ones for the wrong reason.

---

## 3. Engine fields whose unknown values are currently defaulted

From `canonicalize_quote_*_coverage` and `quotes.ts`:

| Field                               | Current default when missing |
| ----------------------------------- | ---------------------------- |
| `thirdPartyLiabilityCents`          | `0`                          |
| `coverageForm` (auto)               | `liability_only`             |
| `collisionIncluded`                 | `false`                      |
| `comprehensiveIncluded`             | `false`                      |
| `accidentForgivenessIncluded`       | `false`                      |
| `rentalVehicleCoverageIncluded`     | `false`                      |
| `nonOwnedAutomobileIncluded`        | `false`                      |
| `familyProtectionIncluded`          | `false`                      |
| `depreciationWaiverIncluded`        | `false`                      |
| `oemPartsIncluded`                  | `false`                      |
| `roadsideAssistanceIncluded`        | `false`                      |
| `disappearingDeductibleIncluded`    | `false`                      |
| `glassCoverageIncluded`             | `false`                      |
| `telematicsRequired`                | `false`                      |
| `vehicleClass`                      | `personal`                   |
| `financingStatus`                   | `owned`                      |
| `propertyType`                      | `homeowner`                  |
| `coverageForm` (property)           | `comprehensive`              |
| `settlementBasis`                   | `replacement_cost`           |
| `dwellingLimitCents`                | `0`                          |
| `contentsLimitCents`                | `0`                          |
| `detachedStructuresLimitCents`      | `0`                          |
| `personalLiabilityLimitCents`       | `0`                          |
| `additionalLivingExpenseLimitCents` | `0`                          |
| `baseDeductibleCents`               | `0`                          |
| `windHailIncluded`                  | `false`                      |
| `earthquakeIncluded`                | `false`                      |
| `sewerBackupIncluded`               | `false`                      |
| `overlandWaterIncluded`             | `false`                      |
| `groundwaterIncluded`               | `false`                      |
| `iceDamIncluded`                    | `false`                      |
| `equipmentBreakdownIncluded`        | `false`                      |
| `serviceLineIncluded`               | `false`                      |
| `bylawCoverageIncluded`             | `false`                      |
| `homeSystemsIncluded`               | `false`                      |
| `cyberCoverageIncluded`             | `false`                      |
| `scheduledValuablesIncluded`        | `false`                      |
| `homeBusinessIncluded`              | `false`                      |
| `shortTermRentalPermissionIncluded` | `false`                      |
| `claimsForgivenessIncluded`         | `false`                      |

Deduction-only fields (`collisionDeductibleCents`, etc.) are left `null` when JSON `null`, but the engine later coerces them to `0` with `?? 0` in `checkAutoHardRequirements` and `checkPropertyHardRequirements`.

---

## 4. Hard vs preferred requirement semantics

### 4.1 Coverage preference enum

`CoveragePreference = "required" | "preferred" | "indifferent" | "prohibited"`.

### 4.2 Current handling

- `required` and `prohibited` are hard eligibility filters.
- `preferred` is treated as `indifferent` in `autoFormSatisfies`, `propertyFormSatisfies`, `settlementSatisfies`, and endorsement loops.
- `rankConfigurations` does not use preference alignment.

### 4.3 Target

- `required` / `prohibited` continue to determine eligibility.
- `preferred` produces a deterministic `PreferenceAlignment` score that breaks ties in ranking after hard eligibility, total cost, deductible exposure, and underwriting conditions.
- `indifferent` never affects alignment.

---

## 5. Required migrations

1. **Edge bundle reproducibility**

   - Already addressed in Phase 1C by `.prettierignore` and deterministic build. Re-verify `check:edge` passes twice consecutively with no diff.

2. **Recommendation snapshot + digests**

   - Extend `recommendations` with:
     - `input_snapshot_digest text`
     - `engine_output_digest text`
     - `input_snapshot_json jsonb`
   - Add `recommendation_generation_attempts` table.
   - Extend `recommendation_options` with:
     - `ranking_factors jsonb`
     - `preference_alignment jsonb`
     - `deductible_total_cents bigint`
     - `underwriting_condition_count int`

3. **Internal recommendation persistence**

   - Create `persist_engine_recommendation_v2(...)`.
   - Revoke `authenticated`/`anon`/`public` execute on it.
   - Accept `p_actor_profile_id uuid` explicitly.
   - Validate all snapshot/option invariants and insert attempt record atomically.

4. **Quote validation states**

   - Add to `quote_coverages`:
     - `validation_status text`
     - `validation_errors jsonb`
     - `validated_at timestamptz`
     - `validated_by uuid`
     - `coverage_schema_version int`
     - `data_source text`
   - Add unique partial index to enforce at most one active coverage per component.

5. **Repair existing quote data**

   - Migration that reclassifies existing `quote_coverages` as `valid`, `incomplete`, or `invalid` based on required fields, preserving present values and explicit nulls.
   - Update seeded demo data to be explicitly `valid`.

6. **Validated quote-write boundary**
   - Create `persist_quote_v2` RPC (or Edge Function) for operations/admin.
   - Validate quote-level schema, component/asset integrity, one coverage per component, and set `validation_status`.

---

## 6. Required negative tests

### 6.1 Tamper-resistance

- Authenticated operations token cannot call `persist_engine_recommendation_v2` directly (returns `permission denied` or explicit rejection).
- `persist_engine_recommendation_v2` rejects `p_actor_profile_id` not belonging to operations/admin or without case access.
- Fabricated `p_options` with non-contiguous ranks, ineligible top option, or mismatched totals are rejected.
- Quote from another case in the snapshot is rejected.
- Missing incumbent from snapshot is rejected.
- Stale `updated_at` in snapshot is rejected.
- `p_engine_version`/`p_engine_source_hash` mismatch is rejected.

### 6.2 Quote quality

- Missing liability stays `incomplete` and is not treated as `0`.
- Missing endorsement information stays `unknown`.
- `null` deductible distinct from `not_applicable`.
- Component with two active coverages rejected.
- Cross-household asset ID rejected.
- Unknown insurer rating fails minimum-rating requirement.

### 6.3 Engine semantics

- Table-driven monetary rules for minimum/maximum/exact/match_current_or_better on each field category.
- Unknown actual / unknown incumbent behavior.
- Auto coverage-form compatibility (non-comparable forms, exact-match cases).
- Preferred endorsement/property coverage ranking.
- Deterministic tie-breaking with preference alignment.

### 6.4 End-to-end

- Customer saves V2 mandate.
- Operations enters a complete quote through `persist_quote_v2`.
- Incomplete quote is rejected from evaluation.
- Unknown insurer rating fails minimum rating.
- Trusted Edge generates recommendation.
- Direct operations persistence denial.
- Snapshot + digest verification.
- Licensed review, stale mandate rejection, regeneration, approval, switch completion, audit verification.

---

## 7. Implementation order

1. Reproduce and confirm Edge bundle parity.
2. Add `recommendation_generation_attempts` and extend `recommendations` / `recommendation_options`.
3. Create strict `EngineRecommendationPersistencePayload` schema in `packages/schemas`.
4. Implement `persist_engine_recommendation_v2` and revoke `persist_recommendation` grants.
5. Update `recommendation-generator` Edge Function:
   - validate payload before RPC;
   - compute canonical input snapshot JSON and SHA-256 digest;
   - compute engine-output digest;
   - use engine canonical ranking for options;
   - call internal persistence with `p_actor_profile_id`.
6. Add `validateQuoteCoverage`, `validateQuote` logic in `packages/insurance-engine`.
7. Add quote validation fields and migrate existing rows.
8. Create `persist_quote_v2` RPC and update admin `QuotesTab`.
9. Fix `evaluateMonetaryRule` and nullable deductible handling.
10. Replace numeric coverage-form rank with compatibility model.
11. Implement `PreferenceAlignment` and ranking.
12. Strengthen property reason codes.
13. Add tests.
14. Update E2E.
15. Update docs.
16. Run `pnpm ci:local` and push focused commits.

---

## 8. Deferred

- Multiple-vehicle / multiple-property optimization.
- Cross-product package enumeration beyond single auto + single property.
- Carrier APIs / automated policy extraction / automated binding.
- Silent switching.
- New customer-facing coverage fields.
- Visual redesign unrelated to quote errors / recommendation integrity.
