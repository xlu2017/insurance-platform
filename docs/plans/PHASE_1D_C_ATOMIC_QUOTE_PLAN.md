# Devin Corrective Phase 1D-C: Atomic Quote Persistence and Coverage Equivalence

## Objective

Complete the single-vehicle and single-property quote and recommendation foundation by correcting the remaining quote-persistence, provenance, validation, and coverage-equivalence defects.

## Current quote-write boundary audit

### Direct client writes to `quotes`

- `apps/admin/src/app/cases/[id]/tabs/quotes.tsx`: `createQuote` mutation inserts into `quotes` with `case_id`, `insurer_id`, `state`, `policy_fees_cents`, `payment_fees_cents`, `bundle_discount_cents`, `cancellation_charge_cents`, `underwriting_conditions`, and `expires_at`.
- `supabase/seed.sql` and migrations insert seed/demo quotes; these are trusted initialization, not runtime client writes.
- No `UPDATE` or `DELETE` paths on `quotes` from the current admin UI.

### Direct client writes to `quote_policy_components`

- `apps/admin/src/app/cases/[id]/tabs/quotes.tsx`: after inserting the quote, it inserts one or more `quote_policy_components` rows with `quote_id`, `product_line`, `annual_premium_cents`, and `asset_id`.
- `scripts/e2e-v2-mandate-lifecycle.mjs`: selects `quote_policy_components` by `product_line` and `quote_id` to locate coverage rows.
- `supabase/seed.sql` and migrations seed components.

### Direct client writes to `quote_coverages`

- `supabase/functions/validate-quote/index.ts`: `UPDATE` or `INSERT` a single `quote_coverages` row per component, setting `coverage`, `validation_status`, `validation_errors`, `validated_at`, `validated_by`, `coverage_schema_version`, and `data_source`.
- `apps/admin/src/app/cases/[id]/tabs/quotes.tsx`: invokes `validate-quote` after creating each component; the quote and component may already be persisted if validation fails.
- `scripts/e2e-v2-mandate-lifecycle.mjs`: directly `UPDATE`s `quote_coverages.coverage`, then directly sets `validation_status = 'valid'`, `validated_at`, `validated_by`, `coverage_schema_version = 2`, and `data_source = 'e2e_test'` in a second service-role call.
- `supabase/seed.sql` seeds coverage rows.

### Current partial-write failure modes

1. The admin quote form is not atomic: a quote and its components are inserted first; validation runs afterward. If validation fails or is interrupted, a quote without complete coverage remains in the database.
2. `validate-quote` only writes `quote_coverages`; it does not update the owning quote or component, so premium/line/assetchanges require separate calls.
3. `validate-quote` uses a fabricated `annualPremiumCents: 0` to satisfy the `QuoteComponent` schema when classifying, so it does not validate against the real premium.
4. `validate-quote` classifies `incomplete` vs `invalid` by grepping the Zod error message for the word "required".
5. `validate-quote` silently replaces an unsupported `data_source` with `manual_entry`.
6. `quote-normalizer.ts` defaults `validationStatus ?? "valid"` and `coverage ?? {}`, so unvalidated or missing coverage rows are treated as valid.
7. `AutoCoverageDetails` and `PropertyCoverageDetails` schemas default material flags to booleans, and the admin form pre-fills `collisionIncluded`, `comprehensiveIncluded`, `replacementCostIncluded`, `sewerBackupIncluded`, and `overlandWaterIncluded` to `true`.
8. The current auto coverage capability map treats `comprehensive` as including `collision`, which is incorrect.
9. The current property coverage capability map treats `comprehensive` only as `all_risks`, so it may fail a `basic`/`named_perils`/`broad` requirement.
10. Deductible `LimitRule` includes `minimum`, but the engine ignores a deductible below the required minimum.
11. `quotes` has no version field; concurrent edits are not detected.
12. Recommendation snapshots do not have strict, versioned canonical schemas.

## Implementation plan

### 1. Add strict `QuoteDataSource` enforcement and repair provenance

- Add a `quote_data_source` enum to PostgreSQL (`manual_entry`, `insurer_document`, `insurer_portal`, `api`, `customer_confirmed`, `migration_unknown`).
- Change `quote_coverages.data_source` from `text` to the enum.
- Migration `20260716000010_quote_provenance.sql` reclassifies existing rows:
  - seeded demo rows that are explicitly complete -> `valid` and `data_source = 'seed'`? No, use `manual_entry` for explicit admin demo seed, `migration_unknown` for rows from earlier migrations, and leave `api`/`insurer_document` if already present.
  - rows that were not validated by a trusted boundary -> `incomplete`.
  - malformed rows -> `invalid`.
- Reject `e2e_test` and other synthetic values.

### 2. Add quote aggregate versioning and one-active-coverage invariant

- Add `version int not null default 1` to `quotes`.
- Add a partial unique index on `quote_coverages(quote_component_id) where deleted_at is null` (or use a `is_current` flag) to enforce one active coverage row per component.
- Add `updated_at` trigger on `quotes` and `quote_policy_components`.
- Add triggers to reset `quote_coverages.validation_status` to `draft` when any recommendation-relevant column changes on the quote or component (premium, asset, product line, quote state, expiry, fees, discounts, cancellation charge, insurer).

### 3. Replace `validate-quote` with `save-case-quote` Edge Function

- Rename/replace `supabase/functions/validate-quote/index.ts` with `supabase/functions/save-case-quote/index.ts`.
- Accept the full aggregate from the plan:
  ```ts
  interface SaveCaseQuoteRequest {
    caseId: string;
    quoteId?: string;
    expectedVersion?: number;
    insurerId: string;
    state: QuoteState;
    isIncumbent: boolean;
    expiresAt?: string | null;
    policyFeesCents: number;
    paymentFeesCents: number;
    bundleDiscountCents: number;
    cancellationChargeCents: number;
    underwritingConditions: string[];
    dataSource: QuoteDataSource;
    components: QuoteComponentDraft[];
  }
  ```
- Authenticate operations/admin with the user-scoped client.
- Verify actor role and case access with the user-scoped client.
- Validate the complete request with strict Zod schemas.
- Use the service-role client only to call `persist_case_quote_v2`.
- Return the persisted quote, components, coverages, and validation classification.

### 4. Add `persist_case_quote_v2` service-role-only RPC

- `SECURITY DEFINER`, `search_path = public`.
- Revoke execute from `public`, `anon`, and `authenticated`; grant only to `service_role`.
- Verify the supplied `p_actor_profile_id` is operations or admin and can access the case.
- Lock the case or quote row.
- If `p_quote_id` is provided, compare `expected_version` against the current quote version; reject stale edits.
- Insert or update the `quotes` row, incrementing `version`.
- Upsert `quote_policy_components` by matching `product_line` + `asset_id` or by provided `component_id`.
- For each component, insert or update exactly one `quote_coverages` row.
- Classify each coverage as `draft`, `incomplete`, `invalid`, or `valid` using a deterministic classifier based on Zod issue `code` and `path`.
- Store `validation_errors`, `coverage_schema_version`, `validated_at`, `validated_by`, `data_source`.
- Write one `audit_events` row for the aggregate change.
- Commit atomically; any failure rolls back the entire aggregate.
- Return the complete aggregate JSON.

### 5. Revoke direct authenticated writes

- Migration `20260716000011_quote_rls_lockdown.sql`:
  - Revoke direct `INSERT`/`UPDATE`/`DELETE` on `quote_policy_components` and `quote_coverages` from `authenticated`.
  - Keep `SELECT` for `quote_policy_components` and `quote_coverages` where appropriate via RLS.
  - Replace direct `quotes` write policy with a narrower one if necessary, or require going through `save-case-quote`.
  - Add pgTAP tests proving customer, operations, reviewer, and admin cannot directly insert coverage rows.

### 6. Correct coverage defaulting and admin quote-entry UI

- Remove default `true` values for material coverage flags from `apps/admin/src/app/cases/[id]/tabs/quotes.tsx`.
- Change admin form to collect `unknown` / `yes` / `no` / `not_applicable` for material boolean fields.
- Replace the separate `quotes` + `quote_policy_components` + `validate-quote` calls with a single `save-case-quote` invocation.
- Show aggregate quote status and component-level validation results.

### 7. Correct `quote-normalizer.ts`

- Remove `validationStatus ?? "valid"` and `coverage ?? {}` fallbacks.
- Only pass `valid` components to the engine; return `QUOTE_NOT_USABLE` for non-valid components.
- Use the actual premium/asset/product line from the component row.

### 8. Correct auto coverage capability model

- In `packages/insurance-engine/src/preference-evaluator.ts` and `engine.ts`, separate `collision`, `comprehensive`, `specified_perils`, and `all_perils` capabilities.
- `comprehensive` does NOT imply `collision`.
- `specified_perils` is not a linear upgrade from `comprehensive`.
- `all_perils` satisfies `collision` and `comprehensive` only where explicitly documented.
- Unknown forms make the quote incomplete.
- Add tests for each capability pair.

### 9. Correct property coverage capability model

- Define implication map:
  - `comprehensive` -> `broad`, `named_perils`, `basic` (jurisdiction assumptions documented).
  - `broad` -> `named_perils`, `basic`.
  - `named_perils` -> `basic`.
  - `basic` -> itself only.
- Distinguish broader form, exact form, prohibited form, unknown form, and non-comparable form.
- Add tests for supported pairs.

### 10. Resolve deductible rule semantics

- Remove `minimum` from `deductibleRules` enum.
- Update `DeductibleRule`, migrations, adapters, UI, and tests.
- `evaluateMonetaryRule` only handles `maximum`, `exact`, `match_current_or_better`, and `any` for deductibles.

### 11. Add strict canonical snapshot schemas

- In `packages/schemas/src/recommendation.ts`:
  - `CanonicalQuoteSnapshot`, `CanonicalComponentSnapshot`, `CanonicalInsurerMetadataSnapshot`, `CanonicalReasonDetail`, `CanonicalRecommendationInputSnapshot`, `CanonicalEngineOutput`.
- Use `.strict()` and avoid `z.record(z.unknown())`.
- The Edge Function and the RPC validate with these schemas before persisting.

### 12. Strengthen digest tests

- Extend `packages/insurance-engine/test/digest-and-persistence.test.ts` to prove:
  - changing component premium changes the digest;
  - changing coverage changes the digest;
  - changing asset association changes the digest;
  - changing insurer rating changes the digest;
  - changing validation provenance changes the digest when provenance is in the audited input;
  - mismatched canonical JSON/object rejected;
  - malformed snapshots rejected before SQL;
  - SQL rejects incorrect digests.

### 13. Rewrite E2E quote setup

- Replace `updateAutoLiabilityForCase` direct updates with `save-case-quote` calls.
- The E2E must:
  1. authenticate as operations;
  2. create an incomplete quote through `save-case-quote` and verify `incomplete` status;
  3. verify recommendation generation rejects incomplete quotes;
  4. correct the quote through `save-case-quote`;
  5. verify it becomes `valid`;
  6. verify `data_source` is one of the allowed values;
  7. generate recommendation;
  8. verify component identities and quote versions in the snapshot.
- Remove `data_source = 'e2e_test'`.

### 14. Add transactional rollback and recommendation-integrity tests

- pgTAP / integration tests proving:
  - quote validation failure rolls back all rows;
  - cross-household component rejected;
  - malformed coverage rejected;
  - duplicate components rejected;
  - stale quote version rejected;
  - unsupported data source rejected;
  - invalid/incomplete/draft/superseded coverage never enters a recommendation snapshot;
  - changing a valid quote makes an existing recommendation stale;
  - direct recommendation persistence remains service-only;
  - generation-attempt terminal states durable.

### 15. Documentation

- Update `docs/recommendation-engine.md` with the atomic `save-case-quote` boundary.
- Update `docs/security.md` executor grants table.
- Update `docs/data-model.md` with quote versioning and coverage invariants.
- Update `docs/architecture.md` if needed.

## Verification

```bash
pnpm ci:local
pnpm test:schemas
pnpm test:engine
pnpm test:database
pnpm test:e2e
pnpm --filter @autopilot/insurance-engine check:edge
```

Commit `artifacts/phase-1d-c-verification.txt` after a clean run.

## Deferred

- Multi-vehicle, multi-property, cross-product package enumeration, carrier APIs, OCR, insurer portal automation, automated binding, silent switching, and unrelated visual redesign remain out of scope.
