import { z } from "zod";
import {
  AnalyzedDocumentSchema,
  AnalysisWarningSchema,
  DetectedConflictSchema,
  DetectedInsuranceEntitySchema,
  EvidenceReferenceSchema,
  type AnalyzedDocument,
  type AnalysisWarning,
  type DetectedConflict,
  type DetectedInsuranceEntity,
  type EvidenceReference,
} from "./document-analyzer.ts";

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
  "approvedAssetId",
  "approved_asset_id",
  "approvedAssetType",
  "approved_asset_type",
  "selectedFactsJson",
  "selected_facts_json",
]);

export interface NormalizedDocumentOutput {
  document: AnalyzedDocument;
  modelProvider: string;
  modelId: string;
  promptVersion?: string;
  outputSchemaVersion?: string;
  warnings: AnalysisWarning[];
}

export const NormalizedDocumentOutputSchema = z
  .object({
    document: AnalyzedDocumentSchema,
    modelProvider: z.string().min(1),
    modelId: z.string().min(1),
    promptVersion: z.string().optional(),
    outputSchemaVersion: z.string().optional(),
    warnings: z.array(AnalysisWarningSchema).default([]),
  })
  .strict();

export interface DocumentNormalizationProjectionInput {
  policyDocumentId: string;
  contentSha256: string;
  document: AnalyzedDocument;
  detectedEntities: DetectedInsuranceEntity[];
  unresolvedConflicts: DetectedConflict[];
  warnings: AnalysisWarning[];
  modelProvider: string;
  modelId: string;
  promptVersion?: string;
  outputSchemaVersion?: string;
}

export interface BuildNormalizationPersistencePayloadInput {
  projection: DocumentNormalizationProjectionInput;
  normalizationSchemaVersion: string;
  analyzerVersion: string;
}

export interface NormalizationPersistencePayload {
  policyDocumentId: string;
  contentSha256: string;
  normalizationSchemaVersion: string;
  analyzerVersion: string;
  modelProvider: string;
  modelId: string;
  promptVersion?: string;
  classification: string;
  normalizedOutputJson: NormalizedDocumentOutput;
  normalizedEntitiesJson: DetectedInsuranceEntity[];
  conflictsJson: DetectedConflict[];
  evidenceJson: EvidenceReference[];
}

export interface CandidateDerivationProjectionInput {
  normalization: {
    normalizedOutput: unknown;
    normalizedEntities: unknown[];
    conflicts: unknown[];
    evidence: unknown[];
  };
}

export interface CandidateDerivationProjection {
  detectedEntities: DetectedInsuranceEntity[];
  conflicts: DetectedConflict[];
  evidence: EvidenceReference[];
}

export class NormalizationProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormalizationProjectionError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function stripCandidateReviewFields(value: unknown): unknown {
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

function evidenceReferenceKey(reference: EvidenceReference): string {
  return JSON.stringify(
    Object.entries(reference)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function collectEntityEvidence(
  entity: DetectedInsuranceEntity,
  policyDocumentId: string,
): EvidenceReference[] {
  const collected: EvidenceReference[] = [];
  const seen = new Set<string>();

  const addEvidence = (references: EvidenceReference[] | undefined): void => {
    if (!Array.isArray(references)) return;
    for (const reference of references) {
      if (reference.documentId !== policyDocumentId) {
        throw new NormalizationProjectionError(
          `Evidence reference ${reference.documentId} does not belong to target document ${policyDocumentId}`,
        );
      }
      const key = evidenceReferenceKey(reference);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(reference);
    }
  };

  addEvidence(entity.evidence);

  for (const coverage of Object.values(entity.currentCoverage)) {
    addEvidence(coverage.evidence);
    if (Array.isArray(coverage.alternatives)) {
      for (const alternative of coverage.alternatives) {
        addEvidence(alternative.evidence);
      }
    }
  }

  return collected;
}

function parseOrThrow<T>(
  label: string,
  result: { success: boolean; data?: T; error?: { message: string } },
): T {
  if (!result.success || result.data === undefined) {
    throw new NormalizationProjectionError(
      `${label} is invalid: ${result.error?.message ?? "unknown error"}`,
    );
  }
  return result.data;
}

function validateDocumentScoping(
  input: BuildNormalizationPersistencePayloadInput,
): DocumentNormalizationProjectionInput {
  const projection = deepCloneJson(input.projection);

  const validatedDocument = parseOrThrow(
    "document",
    AnalyzedDocumentSchema.safeParse(projection.document),
  );
  const validatedEntities = parseOrThrow(
    "detectedEntities",
    DetectedInsuranceEntitySchema.array().safeParse(projection.detectedEntities),
  );
  const validatedConflicts = parseOrThrow(
    "unresolvedConflicts",
    DetectedConflictSchema.array().safeParse(projection.unresolvedConflicts),
  );
  const validatedWarnings = parseOrThrow(
    "warnings",
    AnalysisWarningSchema.array().safeParse(projection.warnings),
  );

  if (projection.policyDocumentId !== validatedDocument.documentId) {
    throw new NormalizationProjectionError(
      `policyDocumentId ${projection.policyDocumentId} does not match document.documentId ${validatedDocument.documentId}`,
    );
  }

  if (projection.contentSha256.toLowerCase() !== validatedDocument.fileDigest.toLowerCase()) {
    throw new NormalizationProjectionError(
      `contentSha256 ${projection.contentSha256} does not match document.fileDigest ${validatedDocument.fileDigest}`,
    );
  }

  const sha256HexRe = /^[0-9a-f]{64}$/i;
  if (!sha256HexRe.test(projection.contentSha256)) {
    throw new NormalizationProjectionError(`contentSha256 is not a valid 64-character hex digest`);
  }

  if (typeof projection.modelProvider !== "string" || projection.modelProvider.length === 0) {
    throw new NormalizationProjectionError("modelProvider is required");
  }
  if (typeof projection.modelId !== "string" || projection.modelId.length === 0) {
    throw new NormalizationProjectionError("modelId is required");
  }

  const entityIds = new Set(validatedEntities.map((entity) => entity.temporaryId));
  for (const conflict of validatedConflicts) {
    if (!entityIds.has(conflict.entityRef)) {
      throw new NormalizationProjectionError(
        `Conflict entityRef ${conflict.entityRef} does not reference an entity in the document-scoped input`,
      );
    }
  }

  const policyDocumentId = projection.policyDocumentId;
  for (const warning of validatedWarnings) {
    if (warning.documentId !== undefined && warning.documentId !== policyDocumentId) {
      throw new NormalizationProjectionError(
        `Warning references document ${warning.documentId} instead of target ${policyDocumentId}`,
      );
    }
  }

  for (const entity of validatedEntities) {
    const entityEvidence = collectEntityEvidence(entity, policyDocumentId);
    if (entityEvidence.length === 0) {
      throw new NormalizationProjectionError(
        `Entity ${entity.temporaryId} has no evidence attributable to target document ${policyDocumentId}`,
      );
    }
  }

  return {
    ...projection,
    document: validatedDocument,
    detectedEntities: validatedEntities,
    unresolvedConflicts: validatedConflicts,
    warnings: validatedWarnings,
  };
}

function collectDocumentEvidence(
  entities: DetectedInsuranceEntity[],
  policyDocumentId: string,
): EvidenceReference[] {
  const collected: EvidenceReference[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    const entityEvidence = collectEntityEvidence(entity, policyDocumentId);
    for (const reference of entityEvidence) {
      const key = evidenceReferenceKey(reference);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(reference);
    }
  }

  return collected;
}

/**
 * Builds a persistence payload from a document-scoped analyzer projection.
 * Validates that the supplied policyDocumentId, contentSha256 and every evidence
 * reference are attributable to the target document, then constructs the
 * normalized output from an explicit whitelist of analyzer-owned fields.
 */
export function buildNormalizationPersistencePayload(
  input: BuildNormalizationPersistencePayloadInput,
): NormalizationPersistencePayload {
  const projection = validateDocumentScoping(input);

  const normalizedOutput: NormalizedDocumentOutput = {
    document: projection.document,
    modelProvider: projection.modelProvider,
    modelId: projection.modelId,
    ...(projection.promptVersion !== undefined && { promptVersion: projection.promptVersion }),
    ...(projection.outputSchemaVersion !== undefined && {
      outputSchemaVersion: projection.outputSchemaVersion,
    }),
    warnings: projection.warnings,
  };

  const cleanedOutput = stripCandidateReviewFields(normalizedOutput) as NormalizedDocumentOutput;
  const cleanedEntities = stripCandidateReviewFields(
    projection.detectedEntities,
  ) as DetectedInsuranceEntity[];
  const cleanedConflicts = stripCandidateReviewFields(
    projection.unresolvedConflicts,
  ) as DetectedConflict[];

  return {
    policyDocumentId: projection.policyDocumentId,
    contentSha256: projection.contentSha256.toLowerCase(),
    normalizationSchemaVersion: input.normalizationSchemaVersion,
    analyzerVersion: input.analyzerVersion,
    modelProvider: projection.modelProvider,
    modelId: projection.modelId,
    ...(projection.promptVersion !== undefined && { promptVersion: projection.promptVersion }),
    classification: projection.document.classification,
    normalizedOutputJson: cleanedOutput,
    normalizedEntitiesJson: cleanedEntities,
    conflictsJson: cleanedConflicts,
    evidenceJson: collectDocumentEvidence(cleanedEntities, projection.policyDocumentId),
  };
}

/**
 * Projects a stored normalization into canonical candidate-derivation inputs.
 * The returned objects are deep clones parsed through strict analyzer schemas,
 * so malformed entities, conflicts or evidence references are rejected rather than
 * coerced to empty arrays. Candidate-review fields are stripped as defense in depth.
 */
export function projectNormalizationForCandidateDerivation(
  input: CandidateDerivationProjectionInput,
): CandidateDerivationProjection {
  const source = deepCloneJson(input.normalization);

  const parsedOutput = NormalizedDocumentOutputSchema.safeParse(source.normalizedOutput);
  if (!parsedOutput.success) {
    throw new NormalizationProjectionError(
      `Invalid normalized output: ${parsedOutput.error.message}`,
    );
  }

  const parsedEntities = DetectedInsuranceEntitySchema.array().safeParse(source.normalizedEntities);
  if (!parsedEntities.success) {
    throw new NormalizationProjectionError(
      `Invalid normalized entities: ${parsedEntities.error.message}`,
    );
  }

  const parsedConflicts = DetectedConflictSchema.array().safeParse(source.conflicts);
  if (!parsedConflicts.success) {
    throw new NormalizationProjectionError(`Invalid conflicts: ${parsedConflicts.error.message}`);
  }

  const parsedEvidence = EvidenceReferenceSchema.array().safeParse(source.evidence);
  if (!parsedEvidence.success) {
    throw new NormalizationProjectionError(`Invalid evidence: ${parsedEvidence.error.message}`);
  }

  return {
    detectedEntities: stripCandidateReviewFields(parsedEntities.data) as DetectedInsuranceEntity[],
    conflicts: stripCandidateReviewFields(parsedConflicts.data) as DetectedConflict[],
    evidence: stripCandidateReviewFields(parsedEvidence.data) as EvidenceReference[],
  };
}
