# Corrective Phase 1D-D Plan: Draft Semantics, Migration Safety, and Stale-Input Closure

## Objective

Finish the single-asset quote foundation so genuinely incomplete drafts can persist, historical data can migrate safely, and recommendation snapshots capture all provenance required to detect stale input.

## Current state

- `packages/schemas/src/quotes.ts` aliases `AutoCoverageDetailsDraft = AutoCoverageDetails` and `PropertyCoverageDetailsDraft = PropertyCoverageDetails`; all fields are required, so an incomplete submission fails `SaveCaseQuoteRequest` parsing before it can be classified.
- `apps/admin/src/app/cases/[id]/tabs/quotes.tsx` pre-fills numeric defaults (C$2M liability, C$500 deductibles, C$450k dwelling, C$1000 base deductible, zero limits) and maps `no` and `not_applicable` tri-state answers to the same `false` boolean.
- `quote_coverages` has one `coverage` JSONB column. The save boundary stores the validated payload in `coverage` directly; there is no place to keep the raw, incomplete operator input separate from the normalized engine-ready coverage.
- `supabase/migrations/20260716000008_quote_validation_status.sql` blanket-promotes every existing `draft` row to `valid` with `validated_at = now()` and no `validated_by`.
- `supabase/migrations/20260717000000_quote_atomic_persistence.sql` then adds a constraint requiring `validated_by` and `validation_errors = '[]'` for `valid` rows, which will fail on a populated database that ran `20260716000008`.
- `mandate-v2.ts` defines `DeductibleRuleV2 = MonetaryRule`, so V2 deductible mandates may still carry `minimum` rules, while the `deductibleRules` enum has already removed `minimum`.
- `CanonicalQuoteSnapshot = EngineQuote.strict()` still embeds full `QuoteComponent` objects with `validationStatus: QuoteValidationStatus.default("valid")` and lacks raw/normalized distinction, component IDs, validation metadata, insurer metadata version, and field-level provenance.
- `save-case-quote` does not expose `saveIntent`, so draft and validate flows cannot differ.
- The admin UI only creates new quotes; it cannot edit an existing quote, and there is no aggregate quote-readiness view authoritative from the database.
- Direct authenticated `INSERT/UPDATE/DELETE` on `quotes`, `quote_policy_components`, and `quote_coverages` is prevented by dropping RLS write policies, but the explicit `REVOKE` is missing.
- Insurer metadata (`financial_strength_rating`, `payment_frequencies`, etc.) is not versioned, so a recommendation can become stale without any quote being edited.

## Proposed changes

### 1. Schema: separate draft from normalized coverage

- Add explicit `CoveragePresence` enum (`yes`, `no`, `unknown`, `not_applicable`).
- Add `AutoCoverageDraft` and `PropertyCoverageDraft` schemas where every field is optional/nullable/unknown-allowed.
- Add `AutoCoverageNormalized` and `PropertyCoverageNormalized` schemas with complete, strict engine fields and explicit `not_applicable` mapping.
- Add `raw_coverage`, `normalized_coverage` to `quote_coverages`.
- Update `SaveCaseQuoteRequest` to accept `saveIntent: "draft" | "validate"` and `AutoCoverageDraft`/`PropertyCoverageDraft`.
- Update `QuoteComponent`/`EngineQuote` to use normalized coverage and remove `QuoteValidationStatus.default("valid")`.

### 2. Save-intent semantics

- `draft`: allow incomplete/invalid aggregate; persist raw input, classify validation status, never write `normalized_coverage`; return draft/incomplete/invalid.
- `validate`: run strict validation, leave existing quote unchanged on validation failure, atomically persist valid normalized coverage and set status to `valid` on success.

### 3. Admin quote-entry fixes

- Remove all default numeric values; empty fields remain empty/unknown.
- Use `CoveragePresence` tri-state, preserving `not_applicable` distinct from `no`.
- Display `quoteId`/`expectedVersion` when editing.
- Populate form from selected quote for editing and include component IDs.
- Show field-level state indicators and aggregate readiness.
- Validate and Save only sends `saveIntent = "validate"`; Save draft sends `"draft"`.

### 4. Migration safety

- Rewrite `20260717000000_quote_atomic_persistence.sql` to reclassify legacy rows before adding the constraint:
  - Set `validation_status = 'incomplete'`.
  - Set `data_source = 'migration_unknown'`.
  - Add a `legacy_unverified` validation error.
  - Set `validated_at = null`, `validated_by = null`, `normalized_coverage = null`.
  - Preserve `raw_coverage` from existing `coverage`.
  - Only seeded rows with trusted provenance remain `valid`.
- Add `supabase/tests/009_quote_migration_upgrade_test.sql` to apply migrations through `20260716000009`, insert historical rows, apply `20260717000000`, and assert conservative classifications.

### 5. Deductible rules

- Replace `DeductibleRuleV2 = MonetaryRule` with a discriminated union that excludes `minimum`.
- Update `AutoMandateV2`/`PropertyMandateV2` to use `DeductibleRuleV2` for all deductible fields while keeping `MonetaryRule` for limits.
- Reject or repair existing `minimum` deductible rules at the mandate save boundary.

### 6. Quote editing and concurrency

- `persist_case_quote_v2` already supports `p_quote_id` and `p_expected_version`; keep behavior.
- Admin UI sends `quoteId` and `expectedVersion` from the loaded row.
- Return `409` on stale version.

### 7. Direct DML revocation

- Add explicit SQL:
  ```sql
  revoke insert, update, delete on quotes from anon, authenticated;
  revoke insert, update, delete on quote_policy_components from anon, authenticated;
  revoke insert, update, delete on quote_coverages from anon, authenticated;
  ```
- Keep `select` for authenticated as required.

### 8. Aggregate quote readiness

- Add `quote_readiness` view or generated status computed from components/coverages.
- Recommendation generator queries this view; refuse to generate if any selected quote is not `valid`.

### 9. Insurer metadata versioning

- Add `metadata_version` to `insurers`.
- Add `insurer_metadata_version` to `recommendations` and canonical snapshots.
- Increment `metadata_version` on insurer update; trigger recommendation staleness or require regeneration.

### 10. Canonical snapshot completeness

- Expand `CanonicalQuoteSnapshot` to include all quote-level fields, component IDs, validation metadata, insurer metadata version, and normalized coverage.
- Cross-check supplied canonical string against regenerated canonical JSON in the persistence boundary.
- Reject mismatched canonical/JSON.

### 11. Tests

- `supabase/tests/008_quote_atomic_persistence_tests.sql`: pgTAP coverage of direct DML denial, RPC grants, version conflicts, duplicate components, cross-household assets, atomic rollback.
- `packages/insurance-engine/test/coverage-capabilities.test.ts`: pairwise auto/property capability tests.
- `packages/database/test/save-case-quote.integration.test.ts`: integration tests for draft, validate, invalid source, stale version, edit, aggregate readiness.
- `scripts/e2e-v2-mandate-lifecycle.mjs`: rewrite quote portion to save incomplete draft, confirm unanswered fields, validate, check normalized coverage and snapshot, test stale version and invalid source.

### 12. Verification

- `pnpm ci:local` must pass.
- Save `docs/plans/phase-1d-d-verification.txt`.
- Attempt to manually dispatch GitHub workflow and record result.

## Deferred

- Multi-vehicle, multi-property, cross-product bundles.
- Carrier APIs, OCR, portal automation, automated binding, silent switching.
- Unrelated visual redesign.
