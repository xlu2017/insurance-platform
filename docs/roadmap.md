# Roadmap

## Corrective Phase 1B (completed)

- Versioned `HouseholdCoverageMandateV2` schema with discriminated monetary rules.
- Immutable `household_coverage_mandates`, `vehicle_mandate_overrides`, `property_mandate_overrides`
  tables and atomic `save_household_mandate_v2` RPC.
- Typed mandate repository and V2-to-engine adapters.
- Legacy mandate fallback and quote coverage normalization repair migration.
- Mobile mandate edit/save/load using V2; removed contradictory switching toggles.
- Recommendation engine fail-closed on multi-asset and missing-asset cases.
- pgTAP, unit and integration tests for schema, mapping, persistence, RLS and fail-closed guards.

## Corrective Phase 1D (completed)

- Reusable monetary-rule evaluator with typed statuses and unknown-value handling.
- Auto coverage-form compatibility model and preferred-requirement scoring.
- Corrected property rule outcomes and stronger, field-specific reason codes.
- Quote `validation_status` / `validation_errors` / `coverage_schema_version` / `data_source` states.
- Engine input filtered to `valid` quote components; unknown insurer metadata fails closed.
- Internal `persist_engine_recommendation_v2` RPC, canonical input/output snapshot digests, and
  `recommendation_generation_attempts` audit table.
- Deterministic Edge bundle parity (`check:edge`) and V2 E2E pipeline passing locally.

## Now (hardening the MVP)

1. Validated quote-write Edge Function for admin quote entry.
2. Password reauthentication fallback for switch approval on devices without biometrics.
3. Distributed rate limiting for Edge Functions and staff 2FA.
4. Expand pgTAP coverage: per-role matrices for every table, storage policies.
5. CI device farm runs for the Maestro flow; Playwright against a seeded ephemeral database.
6. Push notification delivery via Expo with per-category preferences.

## Next

- Renewal-date monitoring jobs that open cases automatically at the configured lead time.
- Mock extraction provider improvements (per-insurer document templates) and OCR as an optional
  provider behind the same interface.
- Multi-household support per account; invitations for household members.
- Reviewer console with side-by-side coverage diffing.
- Customer document e-signature for authorization forms.

## Later

- Real insurer integrations behind the quote-request abstraction (no scraping).
- Licensed-entity operating model per province; regulated disclosures.
- Savings analytics across the book of business.
- Dark mode and accessibility audit (deferred from MVP).

## Deferred until after foundation review

The following items require a reviewed foundation before implementation:

- Multiple-vehicle and multiple-property configuration generation.
- Carrier APIs and automated policy extraction.
- Additional coverage fields, visual redesign and new insurer-ranking logic.
- Silent or automatic switching.
