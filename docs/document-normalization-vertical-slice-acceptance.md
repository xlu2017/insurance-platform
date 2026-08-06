# Document Normalization Vertical Slice Acceptance Specification

## Scope

This document defines the acceptance criteria for the vertical slice:

```
upload and digest
  → plan restart/wait
  → reuse or create immutable normalization
  → assess document/asset overlap
  → create session-local candidates only when review is needed
```

It is an adversarial review. The final Wave 2 integration session must satisfy every scenario described below.

## Current architecture map

```
Client upload (mode=staged)
  → Edge Function: upload-document/index.ts
    → handleStagedUpload
      → authenticate, household membership check, file validation
      → storage upload, sha256 digest
      → policy_documents row with status = 'staged'
      → does NOT create batch, batch item, session, candidate

Mobile upload-plan-controller.ts
  → calls plan_document_upload_v1 via document-processing-batch Edge Function
  → outcomes:
      proceed_without_active_batch
      exact_duplicate_only
      choice_required
      restart_completed
      wait_queued
      cancelled
      stale_plan
      use_existing

Edge Function: document-processing-batch
  → action: plan
  → action: supersede
      → supersede_processing_batch_v1
  → action: queue-successor
      → create_successor_document_batch_v1

Database RPCs
  → plan_document_upload_v1(household_id, new_policy_document_ids, case_id, schema_version, actor_id?)
  → supersede_processing_batch_v1(active_batch_id, household_id, new_policy_document_ids, expected_generation, continuation_request_id, actor_id)
  → create_successor_document_batch_v1(predecessor_batch_id, household_id, new_policy_document_ids, expected_generation, continuation_request_id, actor_id)
  → persist_document_normalization_for_batch_v1(...)
  → record_document_asset_overlap_v1(...)
  → persist_document_batch_analysis_v1(...)

Immutability/concurrency guards
  → document_normalizations_immutable_after_complete trigger
  → document_normalizations_no_superseded_status trigger
  → document_processing_batch_normalizations_integrity trigger
  → document_asset_overlap_assessment_integrity trigger

Extraction path (Wave 2)
  → Edge Function: extract-policy-entities/index.ts
      → calculate digest before provider transmission
      → look for completed compatible normalization by (household_id, content_sha256, normalization_schema_version, analyzer_version)
      → reuse → no provider call
      → new → provider call → persist immutable normalization
      → derive overlap assessments
      → create session-local asset_candidates only when review is needed
```

## Exact production call sequence

### No active batch, new documents

1. `stagePolicyDocument(householdId, category, file, stagingRequestId)`
   - `POST /functions/v1/upload-document` with `mode=staged`
   - Returns `{ id, path, content_sha256, file_name, staged: true }`
2. `UploadPlanController.start()`
   - `POST /functions/v1/document-processing-batch` with `action=plan`
   - Returns `{ activeBatchId: null, newUploadCount: N, newNormalizationCount: N, ... }`
3. Client proceeds to create a batch (existing flow, out of scope for this spec)
4. `extract-policy-entities` Edge Function processes documents
   - For each document: digest, find normalization, reuse or call provider
   - `persist_document_normalization_for_batch_v1` for each new result
   - `record_document_asset_overlap_v1` for each normalized entity
   - `persist_document_batch_analysis_v1` for candidates/reviews

### Active batch, restart

1. `stagePolicyDocument(...)`
2. `UploadPlanController.start()`
   - Returns `choice_required` with `activeBatchId`, `activeBatchGeneration`, estimates
3. User chooses "Restart with all documents"
4. `UploadPlanController.restart()`
   - `POST /functions/v1/document-processing-batch` with `action=supersede`
   - Body: `batch_id`, `expected_processing_generation`, `continuation_request_id`, `new_policy_document_ids`
   - `supersede_processing_batch_v1` creates replacement batch/session with all documents
5. Extraction runs on replacement batch
   - Reusable normalizations attached as `reused`
   - New/unfinished documents sent to provider
   - `persist_document_batch_analysis_v1` produces one combined review

### Active batch, wait

1–2 same as restart 3. User chooses "Finish current processing first" 4. `UploadPlanController.wait()`

- `POST /functions/v1/document-processing-batch` with `action=queue-successor`
- `create_successor_document_batch_v1` creates successor batch in `waiting_for_predecessor`

5. Predecessor continues, reaches terminal point
6. Trigger `advance_waiting_successor_on_terminal` advances successor to `queued`
7. Extraction runs on successor batch
   - Reuses compatible normalizations
   - Creates candidates/reviews only for new/update/conflict information

## Scenario: Exact duplicate

### Setup

- Household H has no active batch.
- Upload file F with sha256 S at time T0.
- Upload the identical file F again at time T1.

### Expected behavior

1. First upload
   - 1 `policy_documents` row with `status = 'staged'`
   - 1 storage object
   - 1 `document_normalizations` row with `status = 'complete'` after extraction
   - Provider transmission count: 1
   - `document_processing_batch_normalizations` row with `use_status = 'created'`
2. Second upload
   - New `policy_documents` row with `status = 'staged'`
   - New storage object may be created (or deduplicated by staging request id)
   - `plan_document_upload_v1` returns `newUploadCount: 1`, `newNormalizationCount: 0`, `exactDuplicateDocuments: [first document metadata]`
   - `UploadPlanController.start()` returns `exact_duplicate_only`
   - No second provider transmission
   - No new `document_normalizations` row
   - If the user chooses "Use existing information":
     - `document_processing_batch_normalizations` row with `use_status = 'reused'`
     - No `asset_candidates` created for this duplicate
     - No mandate review created for this duplicate
3. Provider transmission count remains 1.
4. Candidate count: 0 for this exact duplicate.
5. Review count: 0 for this exact duplicate.
6. User receives metadata: original filename, upload date, insurer, policy number, identified assets, policy term.

### Expected database rows after second upload (exact duplicate chosen)

| table                                    | count  | notes                                                                    |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------ |
| policy_documents                         | 2      | both staged; one may later be attached to a batch                        |
| document_normalizations                  | 1      | immutable, reused for second document                                    |
| document_processing_batch_normalizations | 2      | one 'created' (first), one 'reused' (second) if both attached to a batch |
| document_processing_batches              | 0 or 1 | if user directly proceeds, a batch may be created                        |
| document_processing_batch_items          | 0 or 2 | if batch created                                                         |
| document_asset_overlap_assessments       | 0      | exact duplicate needs no overlap assessment                              |
| asset_candidates                         | 0      | exact duplicate does not generate a candidate                            |
| mandate_reviews                          | 0      | exact duplicate does not generate a review                               |

### Audit events

- `policy_documents` created for both uploads.
- `document_normalizations` created once.
- `document_processing_batch_normalizations` records reuse.

### Failure-state behavior

- If second upload has a different `content_sha256` due to a re-encode, it is treated as a new document.
- If the first normalization is `failed` or `processing`, the second upload must not reuse it; it should wait or reprocess.

### Remaining risks

- P0: A stale normalization (failed/incomplete) is reused because `status` is not checked.
- P1: Storage is duplicated for identical files because staging only deduplicates by `stagingRequestId`.
- P1: Cross-household digest reuse is possible if RLS/normalization uniqueness boundary is wrong.

## Scenario: Mixed batch

### Setup

- Upload file A with sha256 S1 (already normalized at T0).
- Upload file B with sha256 S2 (new).
- Both staged documents supplied to a new batch.

### Expected behavior

1. `plan_document_upload_v1` returns `newUploadCount: 2`, `reusableNormalizationCount: 1`, `newNormalizationCount: 1`, `exactDuplicateDocuments: [A metadata]`.
2. If no active batch: `proceed_without_active_batch`.
3. Extraction runs.
   - Document A: normalization reused, `use_status = 'reused'`, no provider transmission.
   - Document B: provider call, normalization persisted with `use_status = 'created'`.
4. Provider transmission count: 1.
5. Candidate derivation sees both normalized outputs.
6. Source evidence (page, section, parser provenance) remains document-specific even when reusing normalization.

### Expected database rows

| table                                    | count                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| policy_documents                         | 2                                                                       |
| document_normalizations                  | 2 (one pre-existing, one new)                                           |
| document_processing_batch_normalizations | 2 (1 reused, 1 created)                                                 |
| document_processing_batch_items          | 2                                                                       |
| document_asset_overlap_assessments       | ≥1 per normalized entity in B; A may also trigger overlap if new assets |
| asset_candidates                         | only for entities requiring review                                      |
| mandate_reviews                          | one per reviewable candidate group                                      |

### Failure-state behavior

- If reusable normalization belongs to a different household, reuse must be rejected.
- If B's provider call fails, the batch must not advance to `ready_for_review`.

### Remaining risks

- P0: Mixed batch fails to combine reused and new outputs, causing missing candidate evidence.
- P1: Provider is called for reused document because digest lookup misses compatible normalization.

## Scenario: Restart

### Setup

- Active batch B1 has documents D1 (complete normalization N1) and D2 (incomplete or not yet normalized).
- New document D3 is staged.
- User chooses "Restart with all documents".

### Expected behavior

1. `plan_document_upload_v1` returns `activeBatchId: B1`, `activeStatus: ...`, `unfinishedCurrentCount: 1`, `newUploadCount: 1`.
2. `supersede_processing_batch_v1`:
   - Locks B1.
   - Sets `cancellation_requested_at`, `superseded_at`, `status = 'superseded'`, `superseded_by_batch_id = B2`.
   - Creates B2 and S2.
   - Includes D1, D2, D3 as batch items.
   - Reuses N1 for D1 (`use_status = 'reused'`).
   - Sends D2 and D3 to provider as needed.
3. Old generation cannot advance state.
   - `persist_document_normalization_for_batch_v1` for B1 with a late result stores normalization as `late_superseded_result`.
   - `candidate_derivation_allowed = false`.
   - No candidate or review created for B1.
4. Replacement batch B2 produces one combined review.

### Expected database rows

| table                                    | count                                                                      | notes                                           |
| ---------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| document_processing_batches              | 2                                                                          | B1 superseded, B2 replacement                   |
| document_extraction_sessions             | 2                                                                          | S1 linked to B1, S2 linked to B2                |
| document_processing_batch_items          | 3 in B1 + 3 in B2                                                          | D1/D2/D3 each (or supersession may carry items) |
| document_normalizations                  | 1 original N1 + new for D2/D3                                              | N1 reused                                       |
| document_processing_batch_normalizations | N1 linked to B1 (created) and B2 (reused); new normalizations linked to B2 |
| asset_candidates                         | only in S2                                                                 | session-local                                   |
| mandate_reviews                          | 1                                                                          | combined review in S2                           |

### Audit events

- B1 updated: `continuation_choice = 'restart'`, `continuation_request_id`, `continuation_chosen_by`, `continuation_chosen_at`.
- B2 created with `superseded_by_batch_id` set on B1.

### Failure-state behavior

- If a worker tries to advance B1 after supersession, `assert_document_batch_generation_v1` or status check fails.
- Late result for B1 stored but not used for candidates/reviews.

### Remaining risks

- P0: A late result for B1 creates candidates or reviews after B1 is superseded.
- P0: B1 status can be advanced by a worker holding an old generation.
- P1: Combined review in B2 misses reusable normalizations.

## Scenario: Wait

### Setup

- Active batch B1 has documents D1 and D2.
- New document D3 is staged.
- User chooses "Finish current processing first".

### Expected behavior

1. `create_successor_document_batch_v1` creates B2 with `depends_on_batch_id = B1`, `status = 'waiting_for_predecessor'`.
2. B1 continues unchanged and reaches a terminal state (`ready_for_review`, `additional_information_required`, `manual_review`, `processing_unavailable`, `superseded`).
3. Trigger `advance_waiting_successor_on_terminal` or explicit advancement RPC transitions B2 `waiting_for_predecessor → queued`.
4. B2 may later be claimed and processed.
5. Compatible normalizations for D1/D2 are reused in B2.
6. Candidate and review rows remain session-local for B2; B1 candidates are not reused or mutated.
7. Two-pass UX: first result from B1, second from B2.

### Expected database rows

| table                           | count                        | notes                                 |
| ------------------------------- | ---------------------------- | ------------------------------------- |
| document_processing_batches     | 2                            | B1 active/terminal, B2 queued/waiting |
| document_extraction_sessions    | 2                            | one per batch                         |
| document_processing_batch_items | 2 in B1, 3 in B2             | B2 includes D1/D2/D3                  |
| document_normalizations         | 2 (if D1/D2 normalized once) | reused in B2                          |
| asset_candidates                | per batch                    | separate sessions                     |
| mandate_reviews                 | 2                            | one for B1, one for B2                |

### Failure-state behavior

- B2 cannot be claimed before predecessor is terminal (`claim_document_processing_batch_v1` rejects `waiting_for_predecessor`).
- If B1 is superseded by another restart, B2's `depends_on_batch_id` chain must not form a cycle.

### Remaining risks

- P0: Successor batch is claimed and processed before predecessor is terminal.
- P1: Two reviews are merged or one review contains both batches' data.
- P1: Predecessor terminal trigger fails and B2 never advances.

## Scenario: Overlap

### Setup

- Document D1 already produced an asset candidate for vehicle V1 with policy P1, term 2025-01-01 to 2026-01-01.
- Document D2 references the same vehicle V1, same insurer, same policy number, term 2025-01-01 to 2026-01-01 (same policy term).
- Document D3 references V1, same insurer, policy number, term 2026-01-01 to 2027-01-01 (newer term).
- Document D4 references V1 but with conflicting declared value (conflicting facts).
- Document D5 references a possible matching property but evidence is weak.
- Document D6 references a clearly different asset.

### Expected classifications

| document | classification                       | action                                        |
| -------- | ------------------------------------ | --------------------------------------------- |
| D2       | `same_asset_same_policy_term`        | warn as likely duplicate; no silent overwrite |
| D3       | `same_asset_newer_policy_term`       | renewal/update candidate                      |
| D4       | `same_asset_conflicting_information` | correction review                             |
| D5       | `possible_asset_match`               | explicit customer confirmation required       |
| D6       | `new_asset`                          | normal candidate flow                         |

### Expected behavior

- `document_asset_overlap_assessments` rows are idempotent on `(batch_id, normalization_id, normalized_entity_key)`.
- D2 does not create a second candidate for V1 unless the user explicitly wants to.
- D3 creates an update candidate for V1 with new term.
- D4 creates a correction review with the conflict surfaced.
- D5 creates a `possible_asset_match` candidate and a confirmation review.
- D6 creates a normal `new_asset` candidate.

### Expected database rows

| table                              | count                       | notes                                             |
| ---------------------------------- | --------------------------- | ------------------------------------------------- |
| document_asset_overlap_assessments | ≥6                          | one per normalized entity per relevant comparison |
| asset_candidates                   | depends on user choices     | update/confirmation/new candidates                |
| candidate_field_reviews            | per correction/confirmation | user must resolve conflicts                       |

### Failure-state behavior

- If overlap classification is missing, a duplicate document may silently overwrite an existing policy.
- If `possible_asset_match` is treated as `same_asset_same_policy_term`, data may be lost.

### Remaining risks

- P0: Same policy term is treated as a silent update instead of a warning.
- P0: Conflicting facts are merged without review.
- P1: `same_asset_supporting_document` classification is not implemented, causing supporting evidence to be misclassified.

## Scenario: Security and concurrency

### Cross-household

- Customer from household H1 must not be able to plan, supersede, or queue work for H2.
- `plan_document_upload_v1` uses `auth.uid()` and `is_household_member`.
- `supersede_processing_batch_v1` and `create_successor_document_batch_v1` validate actor and household membership.
- `document_normalizations` uniqueness boundary includes `household_id`; H2 cannot reuse H1's normalization.

### Concurrent normalization writers

- Two workers/requests persist a normalization for the same `(household_id, content_sha256, normalization_schema_version, analyzer_version)` at the same time.
- `insert ... on conflict (...) do nothing returning id` followed by `select` must converge.
- Both callers receive the same `normalization_id`.
- One is marked as `reused`, the other as `created` in `document_processing_batch_normalizations`.

### Restart vs. wait concurrency

- Two modals for the same household submit restart and wait concurrently with different `continuation_request_id`s.
- `pg_advisory_xact_lock(household_advisory_lock_key(p_household_id))` serializes.
- Exactly one wins (`supersede_processing_batch_v1` or `create_successor_document_batch_v1`).
- The other receives `CONTINUATION_CONFLICT` or `CONTINUATION_TYPE_CONFLICT`.
- The `UploadPlanController` converts this to `stale_plan`.
- No duplicate successor batches.
- No supersession cycles (`document_processing_batches_no_supersession_cycle` trigger).

### Stale modal choice

- User sees plan with `activeBatchGeneration = 5`.
- Before choosing, batch advances to generation 6 (e.g., by another upload/worker).
- `restart`/`wait` sends `expected_processing_generation = 5`.
- Server RPC rejects with `BATCH_GENERATION_MISMATCH`.
- `UploadPlanController` returns `stale_plan`.
- Screen re-plans and shows updated choices.

### Candidate/review corruption

- Concurrent late results for superseded batch must not create candidates or reviews.
- `persist_document_normalization_for_batch_v1` sets `candidate_derivation_allowed = false` when batch is superseded or cancellation requested.
- `persist_document_batch_analysis_v1` checks `assert_document_batch_generation_v1` before candidate/review creation.

## Provider transmission counts

| scenario                                      | expected provider transmissions |
| --------------------------------------------- | ------------------------------- |
| Exact duplicate (second upload uses existing) | 1 total                         |
| Mixed batch (1 reused, 1 new)                 | 1                               |
| Restart (1 completed, 1 unfinished, 1 new)    | 2 (unfinished + new)            |
| Wait (1 completed, 1 new after predecessor)   | 1 (new document only)           |
| New asset (no reuse)                          | 1 per new document              |

## Candidate and review counts

| scenario                       | candidates                                       | reviews             |
| ------------------------------ | ------------------------------------------------ | ------------------- |
| Exact duplicate                | 0                                                | 0                   |
| Same asset / same policy term  | 0 (warning only)                                 | 0 or 1 confirmation |
| Same asset / newer term        | 1 update candidate                               | 1 review            |
| Same asset / conflicting facts | 1+ correction candidates                         | 1 review            |
| Possible match                 | 1 confirmation candidate                         | 1 review            |
| New asset                      | 1 normal candidate                               | 1 review            |
| Restart                        | combined candidates for all new/conflict info    | 1 combined review   |
| Wait                           | first batch candidates + second batch candidates | up to 2 reviews     |

## Audit events

Expected audit artifacts for every scenario:

- `policy_documents` created with `content_sha256`, `uploaded_by` (customer or service role actor), `created_at`.
- `document_processing_batches` lifecycle fields: `status`, `processing_generation`, `continuation_choice`, `continuation_request_id`, `continuation_chosen_by`, `continuation_chosen_at`, `superseded_by_batch_id`, `depends_on_batch_id`, `cancellation_requested_at`, `superseded_at`.
- `document_extraction_sessions` linked to batch and household.
- `document_normalizations` immutable with provenance: `model_provider`, `model_id`, `prompt_version`, `normalization_schema_version`, `analyzer_version`.
- `document_processing_batch_normalizations` with `use_status` (`created`, `reused`, `late_superseded_result`).
- `document_asset_overlap_assessments` with classification, confidence, `details_json`.
- `asset_candidates` with `session_id` and `household_id`.
- `mandate_reviews` (or equivalent) tied to session and candidate.

## Failure-state behavior summary

| failure                                       | expected behavior                                          |
| --------------------------------------------- | ---------------------------------------------------------- |
| Authentication missing                        | 401/403, no database mutation                              |
| Household membership invalid                  | 404, no data exposure                                      |
| File type/size invalid                        | 415/413 before storage or row creation                     |
| Staging request id reused with different file | no duplicate `policy_documents` row; existing row returned |
| Plan RPC called with foreign document ids     | reject with household/document validation error            |
| Supersede with stale generation               | `stale_plan` outcome, no mutation                          |
| Queue successor with stale generation         | `stale_plan` outcome, no mutation                          |
| Concurrent restart + wait                     | one wins, other gets `stale_plan`                          |
| Late result for superseded batch              | stored as `late_superseded_result`, no candidate/review    |
| Completed normalization update attempt        | trigger raises `NORMALIZATION_IMMUTABLE`                   |
| Overlap retry                                 | idempotent upsert, no duplicate rows                       |

## Remaining risks ranked

### P0 — must fix before production

1. Late results for superseded batches can create candidates or reviews if `candidate_derivation_allowed` is ignored.
2. Stale modal choices can mutate a newer batch generation if `expected_processing_generation` is not enforced.
3. Exact duplicate normalizations are reused before checking `status = 'complete'`.
4. Cross-household reuse of normalizations due to missing `household_id` in uniqueness or RPC validation.
5. A batch can be advanced after `superseded` or `cancellation_requested` if generation fencing is bypassed.

### P1 — high priority

1. Storage deduplication for staged documents is not implemented; identical uploads create duplicate storage objects.
2. Supporting-document overlap classification (`same_asset_supporting_document`) is missing.
3. Predecessor terminal trigger or advancement RPC may not run in all deployment topologies.
4. Two-pass UX does not clearly explain that completed work is reused.
5. `possible_asset_match` requires a customer confirmation flow that is not yet fully wired.

### P2 — follow-up

1. Heuristic time estimates may be inaccurate for small sample sizes.
2. Abandoned staged documents require a cleanup worker.
3. Overlap classification confidence thresholds are not yet tuned.
4. Edge Function `extract-policy-entities` still needs Wave 2 wiring to replace `duplicate_snapshot` path.
