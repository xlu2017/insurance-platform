import {
  DetectedConflictSchema,
  DetectedInsuranceEntitySchema,
  EvidenceReferenceSchema,
} from "./document-analyzer.ts";

export interface TargetNormalizationContract {
  normalizationSchemaVersion: string;
  analyzerVersion: string;
}

export interface StoredNormalization {
  id: string;
  policyDocumentId: string;
  contentSha256: string;
  normalizationSchemaVersion: string;
  analyzerVersion: string;
  status: string;
  normalizedOutput: Record<string, unknown>;
  normalizedEntities: unknown[];
  conflicts: unknown[];
  evidence: unknown[];
}

export interface ReusableNormalization extends StoredNormalization {
  status: "complete";
}

export interface NormalizationPartitionDocument {
  documentId: string;
  contentSha256?: string;
}

export interface CompatibleNormalizationResult {
  normalization: ReusableNormalization | null;
  integrityWarning?: string;
}

export interface NormalizationReuseMatch {
  documentId: string;
  contentSha256: string;
  normalizationId: string;
  integrityWarning?: string;
}

export interface NormalizationProviderDocument {
  documentId: string;
  contentSha256: string;
  reason:
    | "no_compatible_normalization"
    | "schema_mismatch"
    | "analyzer_mismatch"
    | "incomplete_or_failed"
    | "integrity_error";
}

export interface NormalizationUnavailableDocument {
  documentId: string;
  reason: "missing_content_digest" | "invalid_content_digest";
}

export interface SelectCompatibleNormalizationInput {
  document: NormalizationPartitionDocument;
  normalizations: readonly StoredNormalization[];
  contract: TargetNormalizationContract;
}

export interface PartitionDocumentsByNormalizationInput {
  documents: readonly NormalizationPartitionDocument[];
  normalizations: readonly StoredNormalization[];
  contract: TargetNormalizationContract;
}

export interface PartitionDocumentsByNormalizationResult {
  reusable: NormalizationReuseMatch[];
  requiresProvider: NormalizationProviderDocument[];
  unavailable: NormalizationUnavailableDocument[];
  integrityWarnings: string[];
}

export class NormalizationIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormalizationIntegrityError";
  }
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

function isValidSha256Hex(value: string): boolean {
  return SHA256_HEX_RE.test(value);
}

function normalizeContentSha256(value: string): string {
  return value.trim().toLowerCase();
}

function matchesContract(
  normalization: StoredNormalization,
  contract: TargetNormalizationContract,
): boolean {
  return (
    normalization.normalizationSchemaVersion === contract.normalizationSchemaVersion &&
    normalization.analyzerVersion === contract.analyzerVersion
  );
}

function matchesSchema(
  normalization: StoredNormalization,
  contract: TargetNormalizationContract,
): boolean {
  return normalization.normalizationSchemaVersion === contract.normalizationSchemaVersion;
}

function matchesDigest(normalization: StoredNormalization, documentDigest: string): boolean {
  return normalizeContentSha256(normalization.contentSha256) === documentDigest;
}

function parseReusableNormalization(normalization: StoredNormalization): ReusableNormalization {
  const parsedEntities = DetectedInsuranceEntitySchema.array().safeParse(
    normalization.normalizedEntities,
  );
  const parsedConflicts = DetectedConflictSchema.array().safeParse(normalization.conflicts);
  const parsedEvidence = EvidenceReferenceSchema.array().safeParse(normalization.evidence);

  if (!parsedEntities.success || !parsedConflicts.success || !parsedEvidence.success) {
    throw new NormalizationIntegrityError(
      `Stored normalization ${normalization.id} has malformed domain data and cannot be reused`,
    );
  }

  return normalization as ReusableNormalization;
}

/**
 * Selects a single reusable normalization that exactly matches the target contract
 * and document digest. If multiple complete normalizations match the same canonical
 * key, the one with the lexicographically smallest id is selected deterministically
 * and an integrity warning is returned. Failed or incomplete normalizations are never
 * returned.
 */
export function selectCompatibleNormalization(
  input: SelectCompatibleNormalizationInput,
): CompatibleNormalizationResult {
  const documentDigest = input.document.contentSha256
    ? normalizeContentSha256(input.document.contentSha256)
    : "";

  const completeMatches = input.normalizations
    .filter(
      (normalization) =>
        normalization.status === "complete" &&
        matchesDigest(normalization, documentDigest) &&
        matchesContract(normalization, input.contract),
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  if (completeMatches.length === 0) {
    return { normalization: null };
  }

  const selected = completeMatches[0];
  if (!selected) {
    return { normalization: null };
  }

  const integrityWarning =
    completeMatches.length > 1
      ? `Multiple complete normalizations (${completeMatches.length}) share the canonical key for digest ${documentDigest}, schema ${input.contract.normalizationSchemaVersion}, analyzer ${input.contract.analyzerVersion}; selected ${selected.id} deterministically`
      : undefined;

  const reusable = parseReusableNormalization(selected);
  return { normalization: reusable, integrityWarning };
}

function determineProviderReason(
  matches: readonly StoredNormalization[],
  contract: TargetNormalizationContract,
): NormalizationProviderDocument["reason"] {
  if (matches.length === 0) {
    return "no_compatible_normalization";
  }

  const contractMatches = matches.filter((normalization) =>
    matchesContract(normalization, contract),
  );
  if (contractMatches.some((normalization) => normalization.status !== "complete")) {
    return "incomplete_or_failed";
  }

  const schemaMatches = matches.filter((normalization) => matchesSchema(normalization, contract));
  if (schemaMatches.length > 0) {
    return "analyzer_mismatch";
  }

  return "schema_mismatch";
}

/**
 * Partitions a batch of documents into reusable, provider-required and unavailable
 * buckets while preserving input order in each bucket. The document supplies the
 * digest and the contract supplies the analyzer/schema versions. Provider reasons
 * are determined by inspecting every normalization for the digest in deterministic
 * priority order. Integrity warnings are collected when multiple complete
 * normalizations share a canonical key.
 */
export function partitionDocumentsByNormalization(
  input: PartitionDocumentsByNormalizationInput,
): PartitionDocumentsByNormalizationResult {
  const reusable: NormalizationReuseMatch[] = [];
  const requiresProvider: NormalizationProviderDocument[] = [];
  const unavailable: NormalizationUnavailableDocument[] = [];
  const integrityWarnings: string[] = [];

  for (const document of input.documents) {
    const rawDigest = document.contentSha256;
    if (!rawDigest) {
      unavailable.push({ documentId: document.documentId, reason: "missing_content_digest" });
      continue;
    }

    const contentSha256 = normalizeContentSha256(rawDigest);
    if (!isValidSha256Hex(contentSha256)) {
      unavailable.push({ documentId: document.documentId, reason: "invalid_content_digest" });
      continue;
    }

    const matchingDigest = input.normalizations.filter((normalization) =>
      matchesDigest(normalization, contentSha256),
    );

    const contractMatches = matchingDigest.filter((normalization) =>
      matchesContract(normalization, input.contract),
    );

    if (contractMatches.some((normalization) => normalization.status === "complete")) {
      const { normalization, integrityWarning } = selectCompatibleNormalization({
        document: { documentId: document.documentId, contentSha256 },
        normalizations: input.normalizations,
        contract: input.contract,
      });

      if (integrityWarning) {
        integrityWarnings.push(integrityWarning);
      }

      if (normalization) {
        reusable.push({
          documentId: document.documentId,
          contentSha256,
          normalizationId: normalization.id,
          ...(integrityWarning ? { integrityWarning } : {}),
        });
        continue;
      }

      requiresProvider.push({
        documentId: document.documentId,
        contentSha256,
        reason: "integrity_error",
      });
      continue;
    }

    const reason = determineProviderReason(matchingDigest, input.contract);
    requiresProvider.push({ documentId: document.documentId, contentSha256, reason });
  }

  return { reusable, requiresProvider, unavailable, integrityWarnings };
}
