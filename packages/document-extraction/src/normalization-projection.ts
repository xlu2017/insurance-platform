import type { ReusableNormalization } from "./normalization-reuse.ts";

const CANDIDATE_REVIEW_KEYS = new Set([
  "draftDecision",
  "draft_decision",
  "draftIdentityConfirmed",
  "draft_identity_confirmed",
  "draftExistingAssetId",
  "draft_existing_asset_id",
  "draftExistingAssetType",
  "draft_existing_asset_type",
  "draftUpdatedBy",
  "draft_updated_by",
  "draftUpdatedAt",
  "draft_updated_at",
  "customerCorrection",
  "customer_correction",
  "candidateApprovalState",
  "candidate_approval_state",
  "mandateReviewState",
  "mandate_review_state",
  "reviewState",
  "review_state",
  "reviewStatus",
  "review_status",
  "correctedValue",
  "corrected_value",
  "correctionReason",
  "correction_reason",
]);

export interface NormalizationPersistenceInput {
  policyDocumentId: string;
  contentSha256: string;
  normalizationSchemaVersion: string;
  analyzerVersion: string;
  classification?: string;
  analysisResult: Record<string, unknown>;
}

export interface NormalizationPersistencePayload {
  normalizedOutputJson: Record<string, unknown>;
  normalizedEntitiesJson: unknown[];
  conflictsJson: unknown[];
  evidenceJson: unknown[];
  classification: string;
}

export interface CandidateDerivationProjectionInput {
  normalization: Pick<
    ReusableNormalization,
    "normalizedOutput" | "normalizedEntities" | "conflicts" | "evidence"
  >;
}

export interface CandidateDerivationProjection {
  detectedEntities: unknown[];
  conflicts: unknown[];
  evidence: unknown[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stripCandidateReviewFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripCandidateReviewFields(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (CANDIDATE_REVIEW_KEYS.has(key)) {
      continue;
    }
    result[key] = stripCandidateReviewFields(entry);
  }
  return result;
}

function collectEntityEvidence(entities: unknown[]): unknown[] {
  const collected: unknown[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    if (!isPlainObject(entity)) continue;
    const entityEvidence = entity.evidence;
    if (!Array.isArray(entityEvidence)) continue;

    for (const reference of entityEvidence) {
      if (!isPlainObject(reference)) continue;
      const key = JSON.stringify(
        Object.entries(reference).sort(([left], [right]) => left.localeCompare(right)),
      );
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(reference);
    }
  }

  return collected;
}

function deriveClassification(analysisResult: Record<string, unknown>): string {
  if (
    typeof analysisResult.classification === "string" &&
    analysisResult.classification.length > 0
  ) {
    return analysisResult.classification;
  }

  const documents = analysisResult.documents;
  if (Array.isArray(documents)) {
    for (const document of documents) {
      if (isPlainObject(document) && typeof document.classification === "string") {
        return document.classification;
      }
    }
  }

  return "unsupported";
}

/**
 * Builds a persistence payload from an analyzer result while keeping extracted
 * entities, conflicts and evidence traceable and separate. Any candidate-review
 * fields found in the source object are stripped before persistence.
 */
export function buildNormalizationPersistencePayload(
  input: NormalizationPersistenceInput,
): NormalizationPersistencePayload {
  const source = deepCloneJson(input.analysisResult);
  const cleaned = stripCandidateReviewFields(source) as Record<string, unknown>;

  const normalizedEntitiesJson = Array.isArray(cleaned.detectedEntities)
    ? (cleaned.detectedEntities as unknown[])
    : Array.isArray(cleaned.normalizedEntities)
      ? (cleaned.normalizedEntities as unknown[])
      : [];

  const conflictsJson = Array.isArray(cleaned.unresolvedConflicts)
    ? (cleaned.unresolvedConflicts as unknown[])
    : Array.isArray(cleaned.conflicts)
      ? (cleaned.conflicts as unknown[])
      : [];

  const normalizedOutputJson: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cleaned)) {
    if (key === "detectedEntities" || key === "normalizedEntities") continue;
    if (key === "unresolvedConflicts" || key === "conflicts") continue;
    normalizedOutputJson[key] = value;
  }

  const evidenceJson = collectEntityEvidence(normalizedEntitiesJson);

  return {
    normalizedOutputJson,
    normalizedEntitiesJson,
    conflictsJson,
    evidenceJson,
    classification: input.classification ?? deriveClassification(input.analysisResult),
  };
}

/**
 * Projects a stored normalization into the shape required by candidate derivation.
 * The returned objects are deep clones and never share mutable state with the input.
 * Candidate-review fields are stripped so downstream derivation cannot observe draft
 * decisions, customer corrections, approval state or mandate-review state.
 */
export function projectNormalizationForCandidateDerivation(
  input: CandidateDerivationProjectionInput,
): CandidateDerivationProjection {
  const entities = deepCloneJson(input.normalization.normalizedEntities);
  const conflicts = deepCloneJson(input.normalization.conflicts);
  const evidence = deepCloneJson(input.normalization.evidence);

  return {
    detectedEntities: stripCandidateReviewFields(entities) as unknown[],
    conflicts: stripCandidateReviewFields(conflicts) as unknown[],
    evidence: stripCandidateReviewFields(evidence) as unknown[],
  };
}
