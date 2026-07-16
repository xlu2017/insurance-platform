# Phase 1D-B: Complete Quote Integrity and Recommendation Semantics

## Objective

Finish the incomplete Phase 1D work and make the single-vehicle, single-property recommendation pipeline trustworthy enough for a closed real-customer pilot. Do not begin multi-vehicle or multi-property optimization.

## Current defects in Phase 1D persistence

1. `recommendation_generation_attempts` writes happen inside the same transaction that persists the recommendation, so a persistence exception rolls the attempt back.
2. Snapshot quote-membership validation uses a single `IN` check that can accept an option when only one of its two quote IDs is present.
3. Component-level selections are not persisted; options only contain quote IDs.
4. Canonical serialization sorts every array, which re-orders ranked options and other intentionally ordered lists.
5. Persistence schemas still use permissive `z.record(z.unknown())` in places.
6. Digests are accepted from the caller rather than recomputed and verified.
7. The obsolete `persist_recommendation` function is still present.

## Quote creation and update paths

- Quotes, components, and coverages are currently written directly by admin pages and E2E scripts.
- The new boundary is an authenticated Edge Function `save-case-quote` plus a service-role-only internal RPC.
- Direct authenticated `INSERT`/`UPDATE`/`DELETE` on `quotes`, `quote_policy_components`, and `quote_coverages` must be revoked once the boundary is in place.

## Direct database writes that must be removed

- `apps/admin/src/app/cases/[id]/tabs/quotes.tsx` and any other admin code that writes quote tables directly.
- `scripts/e2e-v2-mandate-lifecycle.mjs` currently updates `quote_coverages` directly; it should use `save-case-quote` or a service-role RPC for coverage corrections.

## Quote completeness and validation model

- `quote_coverages` is the canonical validation unit.
- Fields: `validation_status`, `validation_errors`, `coverage_schema_version`, `validated_at`, `validated_by`, `data_source`.
- Statuses: `draft`, `incomplete`, `valid`, `invalid`, `superseded`.
- Only `validation_status = 'valid'` components may enter the engine.
- Structured errors include `path`, `code`, `message`.

## Unknown-value representation

- `unknown` is added to `PropertyType`, `VehicleUseClass`, and `FinancingStatus` enums.
- Schema defaults for `propertyType`, `vehicleClass`, and `financingStatus` are removed; missing values fail validation and produce `incomplete`.
- `not_applicable` is represented by `null` for nullable deductible/ limit fields when the coverage is confirmed absent.
- `data_source` tracks `manual_entry`, `insurer_document`, `insurer_portal`, `api`, `customer_confirmed`, `migration_unknown`.

## Monetary-rule evaluator

- `evaluateMonetaryRule` already exists in `packages/insurance-engine/src/rule-evaluator.ts`.
- Add `not_applicable` status and use it consistently for every limit and deductible field.
- Apply to auto liability, collision, comprehensive, glass, and every property limit/deductible.

## Auto coverage-form compatibility model

- `packages/insurance-engine/src/preference-evaluator.ts` defines capability maps.
- The engine evaluates whether the actual form provides the capabilities required by the mandate instead of relying on a numeric rank.

## Preferred-scoring model

- `evaluatePreferenceAlignment` returns `satisfied_count`, `missed_count`, `not_evaluable_count`, and per-item details.
- Ranking order: hard eligibility, total cost, fewer missed preferred, fewer unknown preferred, lower deductible exposure, fewer underwriting conditions, stable identifier.

## Migrations

- Add `auto_component_id`, `property_component_id`, `auto_asset_id`, `property_asset_id` to `recommendation_options`.
- Add digest-format constraints and attempt-status enum values if needed.
- Add `unknown` to `PropertyType`, `VehicleUseClass`, and `FinancingStatus`.
- Forward migration to repair existing quote coverage records and set validation status based on completeness.
- Drop obsolete `persist_recommendation` function and grants.

## Admin changes

- Update `apps/admin/src/app/cases/[id]/tabs/quotes.tsx` to display validation status, errors, asset association, source, timestamp, validator, and actions to validate/save draft/mark superseded.
- Wire the "Validate quote" action to the `save-case-quote` / `validate-quote` Edge Function.
- Disable recommendation generation when the incumbent/competitor quote set is not complete.

## Tests

- Add `packages/insurance-engine/test/tamper-resistance.test.ts` or similar for direct persistence denial, fabricated totals/savings, mismatched snapshot, duplicate ranks, ineligible top option, invalid digests, etc.
- Add `packages/insurance-engine/test/quote-quality.test.ts` for incomplete auto/property coverage, null vs not-applicable, one-component-one-coverage, unknown insurer rating, etc.
- Extend `scripts/e2e-v2-mandate-lifecycle.mjs` to cover durable attempts, failed generation, snapshot integrity, component IDs, and digest verification.

## Intentionally deferred

- Multiple-vehicle and multiple-property optimization.
- Multiple components per product line in one configuration.
- Carrier APIs, automated document extraction, automated portal submission, automatic binding, silent switching, and unrelated visual redesign.
