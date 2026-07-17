# Devin Corrective Phase 1D-E: Runtime Integrity and Quote Workflow Closure

**Repository:** `xlu2017/insurance-platform`  
**Branch:** `devin/1784150712-mvp-scaffold`  
**PR:** `#1`

## Scope

Close remaining runtime, security, canonical-snapshot, concurrency, and test gaps from Phase 1D-D. Skip all migration-upgrade and historical-data repair tasks; assume the pilot database can be reset from the current migration set.

## Audit findings

### Edge Function runtime defects

- `supabase/functions/recommendation-generator/index.ts` calls `recordAttempt(...)` in two places, but no such function exists. The durable attempt lifecycle is provided by `startAttempt`, `completeAttempt`, and `failAttempt`.
- Edge Functions are not currently type-checked in `pnpm ci:local`; unresolved identifiers can only be caught by manual inspection or E2E runs.

### Coverage-presence conversion

- `apps/admin/src/app/cases/[id]/tabs/quotes.tsx` maps both `no` and `not_applicable` tri-state selects to `false`. It does not preserve an explicit `unknown` or `not_applicable` value, so draft/raw coverage loses the distinction.

### Quote editing

- Admin quote entry always creates a new quote. It does not load an existing quote aggregate, populate the form, or submit `quoteId`/`expectedVersion`.

### Duplicate components

- `SaveCaseQuoteRequest` does not yet reject duplicate component IDs or duplicate `(productLine, assetId)` pairs.
- `persist_case_quote_v2` validates asset existence but does not explicitly reject duplicate component IDs or repeated asset/product-line pairs inside one call.

### Quote readiness

- `packages/database/src/recommendation-loader.ts` loads all case quotes and relies on `quote-normalizer.ts` to derive validity. It does not consult the `quote_readiness` view as the authoritative readiness source.

### Canonical snapshots

- `EngineQuote.strict()` is used as the canonical quote snapshot schema.
- `insurerVersion` is optional in `EngineQuote`.
- There is no standalone `verifyCanonicalPair` helper that validates a value against a strict schema, regenerates its canonical string, and compares it to a supplied canonical string.
- `persist_engine_recommendation_v2` does not cross-check `p_input_snapshot_canonical::jsonb` against `p_input_snapshot_json`.

### Insurer metadata staleness

- `persist_engine_recommendation_v2` does not verify that the insurer metadata version recorded in the canonical snapshot matches the current `insurers.version`.
- `review_recommendation`, `approve_customer_recommendation`, and `decline_customer_recommendation` do not re-verify insurer metadata versions before acting.

### Field-level provenance

- `quote_coverages` stores `data_source` at the row level but not per-field provenance for material values such as premium, limits, deductibles, and optional coverage presence.

### Missing tests

- No Edge Function type-check step in CI.
- No integration test for stale quote editing.
- No test proving `not_applicable` is distinct from `no`.
- No canonical-pair mismatch tests in TypeScript or SQL.
- No insurer-metadata staleness tests.

## Implementation steps

1. Fix `recommendation-generator/index.ts` lifecycle calls and add `pnpm typecheck:edge` to CI.
2. Replace boolean coverage-flag conversion with `CoveragePresence` four-state values and validate contradictions.
3. Implement admin quote editing with `quoteId`/`expectedVersion` and stale-edit 409 handling.
4. Add duplicate-component `.superRefine()` in `SaveCaseQuoteRequest` and SQL guards in `persist_case_quote_v2`.
5. Make `quote_readiness` authoritative in the recommendation loader.
6. Build explicit canonical component/insurer snapshot schemas, `verifyCanonicalPair`, and SQL cross-checks.
7. Add insurer metadata version checks in recommendation persistence, licensed review, and customer approval.
8. Add field-level provenance support where material and include it in canonical snapshots.
9. Extend `scripts/e2e-v2-mandate-lifecycle.mjs` with draft, edit, stale-edit, and insurer-staleness scenarios.
10. Run `pnpm ci:local`, targeted checks, and manual GitHub workflow dispatch.

## Explicitly skipped

- Historical migration-upgrade tests.
- Migration backfill modifications.
- Historical quote repair.
- Phase 1E document ingestion or multi-asset optimization.
- Carrier APIs, automated binding, silent switching, unrelated UI redesign.
