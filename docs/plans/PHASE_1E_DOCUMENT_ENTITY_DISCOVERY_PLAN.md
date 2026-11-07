# Phase 1E: Document-Driven Entity Discovery and Mandate Import

## Scope

Implement a mobile-first policy-import workflow for the four private acceptance PDFs. The workflow must discover candidate insured assets, let the customer confirm current facts and adjust mandates, and atomically create approved assets with policy-term snapshots and Mandate V2 overrides. Multi-asset recommendation optimization remains explicitly deferred.

## Key entities

| Concept               | Definition                                                                                                                                                                      | Examples in this phase                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Document**          | A raw file uploaded by the customer, plus metadata and extracted text per page.                                                                                                 | The four PDFs; may be one file or many; order must not matter.                                                              |
| **Policy term**       | A contractual insurance period (effective → expiry), premium, policy number, and insurer/agency, as asserted by one or more documents.                                          | TD/Security National auto renewal 2026-08-27 → 2027-08-27.                                                                  |
| **Insured asset**     | A real-world thing being insured: a vehicle or a property. It persists beyond any single policy term.                                                                           | 2006 Mazda Mazda5 GT; rental property T3A 0Z4; rental property T3A 0C2; principal residence T3A 0G9 (redacted address).     |
| **Coverage snapshot** | The current insurance coverages for an asset during a specific policy term, extracted from authoritative document sections (coverage summary, certificate, active endorsement). | Auto liability $1M, collision not covered, comprehensive not covered; property dwelling $438k, fair rental $89k, hail $35k. |
| **Mandate**           | The customer’s forward-looking coverage requirement, derived from confirmed current coverage but independently adjustable.                                                      | Minimum dwelling $438k, maximum base deductible $2k, required sewer backup, etc.                                            |

## Privacy controls

- All four real PDFs live in `fixtures/private/phase-1e/`, which is in `.gitignore`.
- Extraction logs, full text dumps, and screenshots stay under `fixtures/private/` and are never committed.
- Source code, schemas, and committed fixtures use synthetic PII; real addresses, policy numbers, VINs, and names are masked in reports.
- Private attachments are parsed locally with `pdfjs-dist`; no external OCR or LLM service receives the files.

## Current document upload path

`apps/mobile/lib/upload.ts` → `supabase/functions/upload-document/index.ts` stores files in the `policy-documents` bucket and inserts a `policy_documents` row with `status = 'uploaded'`. The mobile `documents.tsx` screen lists uploaded documents and lets the customer download them. No extraction, parsing, or entity creation currently exists.

## Extraction layer

A new shared module in the workspace provides PDF text extraction for both local tests and the Edge Function.

- `ExtractedPdf`: `{ documentId, fileDigest, pageCount, pages: [{ pageNumber, text, items? }] }`
- Use `pdfjs-dist` (Node in tests, `npm:pdfjs-dist` in Deno Edge Functions) with page-by-page `getTextContent`.
- Pages with no extractable text are kept and flagged for manual review.
- Text item coordinates are retained when they help detect columns; the primary output is ordered text per page.

## Parser architecture

Introduce a typed `InsuranceDocumentParser` interface:

```ts
interface InsuranceDocumentParser {
  id: string;
  version: string;
  canParse(document: ExtractedPdf): boolean;
  parse(document: ExtractedPdf): ParsedInsuranceDocument;
}
```

Initial implementations:

- `TdSecurityNationalHomeRenewalParserV1`
- `TdSecurityNationalAlbertaAutoRenewalParserV1`

Parser output (`ParsedInsuranceDocument`) contains:

- `classification`: `home_policy_renewal`, `auto_policy_renewal`, or `unsupported`
- `insurer`, optional `agency`
- `policyTerms`: one term per distinct effective/expiry/policy-number combination found
- `assetAssertions`: vehicle or property identity facts
- `coverageAssertions`: extracted coverage values with page-level provenance
- `notices`: informational or future-change statements
- `conflicts`: values that contradict another assertion in the same document

## Assertions and provenance

Every extracted value becomes an `ExtractedFactAssertion`:

- `id`, `documentId`, `pageNumber`
- `entityScope`: `policy`, `property`, `vehicle`, `coverage`, `premium`, `notice`
- `fieldPath`: dotted path such as `property.address.postal_code`
- `rawText`: the raw extracted string(s)
- `parsedValue` / `normalizedValue`
- `parserId`, `parserVersion`, `confidence`
- `authority`: `coverage_summary`, `insurance_certificate`, `invoice`, `renewal_overview`, `endorsement`, `notice`, `header_footer`

Higher-authority assertions win when values conflict, but lower-authority assertions are preserved for audit.

## Address and VIN normalization

- VIN: uppercase, strip spaces/punctuation, validate length and character set, mask display value.
- Property address: expand street-type and directional abbreviations, normalize unit numbers, punctuation, capitalization, postal-code spacing, province. The normalized form is the identity fingerprint.

## Entity resolution

Persisted `entity_candidates` records hold:

- `id`, `household_id`, `review_session_id`
- `candidate_type`: `property` | `vehicle`
- `identity_fingerprint`: normalized VIN or normalized address
- `match_classification`: `new` | `exact_existing_match` | `possible_existing_match` | `new_identity_confirmation_required`
- `suggested_label`
- `source_document_ids`
- `selected_assertions`
- `conflicts`
- `review_status`: `undecided` | `approved_new` | `link_existing` | `skipped` | `not_sure`

Exact-match priority:

- Vehicle: normalized VIN > existing policy-to-vehicle association > year/make/model + household.
- Property: normalized full insured civic address > existing policy-to-property association > customer-confirmed match.

Rules:

- Postal code alone, policy number alone, and shared mailing address are never exact matches.
- Redacted street information cannot be exact-matched; it requires customer confirmation.
- Processing order and filenames must not affect the result.
- Duplicate file digests within a household are ignored and attached to the existing review session.

## Customer review flow

Mobile screens:

1. **Upload documents** – one or many PDFs; optionally resume later.
2. **Processing** – run extraction and parsing; then show:
   - `We found 4 insured assets`
   - per-card: icon, label, insurer, term, premium, match state, facts to confirm, source count.
   - actions: `Review`, `Skip`, `Review all`, `Approve all using current defaults`.
3. **One-specification-per-screen review** for each candidate:
   - Title, plain-language explanation, formal term, detected value, source document/page, confidence.
   - Customer chooses: `Confirm current value`, `Correct current value`, `I do not know`.
   - For mandateable fields: display derived mandate rule and value; allow customer customization; `Reset mandate to current`.
   - Factual/non-mandateable fields (address, VIN, year, premium, policy number, roof age, occupancy, effective date) show confirmation only.
4. **Conflict screen** when two assertions disagree:
   - Show Value A/B, source document/page, and `Which is current?`.
5. **Final summary** and `Add 4 assets and activate mandates`.

## Mandate defaults

| Current coverage                 | Default mandate                           |
| -------------------------------- | ----------------------------------------- |
| Limit $X                         | minimum $X                                |
| Deductible $X                    | maximum $X                                |
| Coverage form / settlement basis | match_current_or_better                   |
| Optional coverage included       | required                                  |
| Optional coverage not included   | indifferent                               |
| Unknown current value            | no requirement (do not invent zero/false) |

When the customer corrects a current fact:

- Update the mandate only if `mandateOrigin === "defaulted_from_current"`.
- Never overwrite `customer_customized`.
- Show when current and mandate values differ.

## Atomic final approval

A service-role-only RPC `approve_policy_candidates_v1` performs the final transaction:

- Verify the review session belongs to the household.
- Verify each candidate has not already been approved.
- Verify required identity confirmations (e.g. redacted address).
- For each approved `new` candidate:
  - Create `property` or `vehicle`.
  - Create `policy` term and link to asset.
  - Attach source `policy_documents`.
  - Create immutable current-coverage snapshot.
  - Preserve assertion-level provenance in the snapshot.
  - Create asset-specific Mandate V2 override.
- For `link_existing` candidates:
  - Create new policy-term snapshot only.
  - Apply customer-approved mandate changes.
- Create one new `household_coverage_mandates` version containing all approved asset overrides.
- If any step fails, roll back all creations (idempotent retry allowed).
- Skipped candidates remain available under `Documents → Skipped discoveries`.

## Database additions

- `entity_review_sessions` (household scoped, resumable)
- `entity_candidates` (per candidate with classification, fingerprint, review status)
- `candidate_assertions` (link candidates to assertions from parsed documents)
- `policy_document_parses` (one row per document: parser id/version, parsed JSON, status)
- Extend `policy_documents` with `file_digest` and `status` values `uploaded` / `extracted` / `parsed` / `manual_review`.
- Extend `vehicles` and `properties` with optional external policy-document links where useful.

## Edge Function

`supabase/functions/extract-policy-entities/index.ts`

- Accepts `{ householdId, documentIds?: string[] }`.
- Authenticates the customer and verifies household access.
- Fetches document bytes from `policy-documents` bucket.
- Runs extraction + parser chain.
- Persists assertions, candidates, and review session.
- Returns a summary for the mobile UI:
  - `documentsProcessed`, `propertyCandidates`, `vehicleCandidates`, `identityConfirmationRequired`, `parserFailures`.

## Workspaces

- `packages/document-extraction`: extraction, parser interface, TD parsers, candidate resolver, mandate-default mapper.
- `supabase/functions/extract-policy-entities`: Edge Function wrapper.
- `supabase/migrations/20260717000002_policy_entity_discovery.sql`: tables, RLS, RPC.
- `apps/mobile/app/onboarding/policy-import.tsx` and related screens (deferred to a follow-up if time-constrained).
- `apps/admin/src/app/cases/[id]/tabs/extraction-review.tsx` operations interface (deferred if time-constrained).

## Tests

- `packages/document-extraction/test/private-policy-import.test.ts` (or script) runs `pnpm test:private-policy-import` against `fixtures/private/phase-1e/`. It prints a redacted report and asserts the four-candidate outcome without exposing PII.
- Sanitized fixtures under `packages/test-fixtures/document-extraction/` exercise classification, dates, premiums, limits, deductibles, occupancy, VIN, liability, confirmed absence of physical damage, source-page attribution, and conflicts.
- Entity-resolution tests: exact VIN, exact address, policy-number change does not create new asset, postal-code-only stays possible, mailing address not identity.
- Mandate-default tests: minimum/maximum, match-current-or-better, required/indifferent/unknown handling.
- Approval tests: three properties and one vehicle created, overrides created, idempotent.

## Verification

Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:edge`, `pnpm test`, admin build, mobile `expo:doctor`, `supabase db reset`, `supabase test db`, `pnpm --filter @autopilot/database test:integration`, `pnpm db:types`, `pnpm db:types:check`, `pnpm --filter @autopilot/insurance-engine check:edge`, and `pnpm test:private-policy-import`. Save a redacted `docs/plans/phase-1e-verification.txt`.

## Explicitly deferred

- Generic OCR and image-only PDFs.
- Handwritten documents.
- Arbitrary insurer parsing beyond TD/Security National renewals.
- External LLM extraction or insurer APIs.
- Multi-asset recommendation optimization.
- Automatic binding or cancellation.
- Silent switching.

## Definition of done

Phase 1E is complete when all four attached PDFs parse locally into three distinct properties and one vehicle, processing order and filenames do not affect the result, redacted addresses require customer confirmation, mailing addresses do not merge properties, notices do not become active coverage, every material value has page-level provenance, mandates derive from confirmed current values with safe defaults, and final approval creates all four assets atomically.
