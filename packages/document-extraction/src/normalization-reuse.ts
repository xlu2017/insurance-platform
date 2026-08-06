export interface NormalizationCompatibilityKey {
  contentSha256: string;
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

export interface SelectCompatibleNormalizationInput {
  document: NormalizationPartitionDocument;
  normalizations: readonly StoredNormalization[];
  targetCompatibility: NormalizationCompatibilityKey;
}

export interface NormalizationReuseMatch {
  documentId: string;
  contentSha256: string;
  normalizationId: string;
}

export interface NormalizationProviderDocument {
  documentId: string;
  contentSha256: string;
  reason:
    | "no_compatible_normalization"
    | "schema_mismatch"
    | "analyzer_mismatch"
    | "incomplete_or_failed";
}

export interface NormalizationUnavailableDocument {
  documentId: string;
  reason: "missing_content_digest" | "invalid_content_digest";
}

export interface PartitionDocumentsByNormalizationInput {
  documents: readonly NormalizationPartitionDocument[];
  normalizations: readonly StoredNormalization[];
  targetCompatibility: NormalizationCompatibilityKey;
}

export interface PartitionDocumentsByNormalizationResult {
  reusable: NormalizationReuseMatch[];
  requiresProvider: NormalizationProviderDocument[];
  unavailable: NormalizationUnavailableDocument[];
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

function isValidSha256Hex(value: string): boolean {
  return SHA256_HEX_RE.test(value);
}

function normalizeContentSha256(value: string): string {
  return value.trim().toLowerCase();
}

function compatibilityKey(normalization: StoredNormalization): NormalizationCompatibilityKey {
  return {
    contentSha256: normalizeContentSha256(normalization.contentSha256),
    normalizationSchemaVersion: normalization.normalizationSchemaVersion,
    analyzerVersion: normalization.analyzerVersion,
  };
}

function isCompleteNormalization(
  normalization: StoredNormalization,
): normalization is ReusableNormalization {
  return normalization.status === "complete";
}

function compatibilityKeyMatches(
  target: NormalizationCompatibilityKey,
  candidate: NormalizationCompatibilityKey,
): boolean {
  return (
    normalizeContentSha256(target.contentSha256) === candidate.contentSha256 &&
    target.normalizationSchemaVersion === candidate.normalizationSchemaVersion &&
    target.analyzerVersion === candidate.analyzerVersion
  );
}

/**
 * Selects a single reusable normalization that exactly matches the target compatibility.
 * Failed or incomplete normalizations are never returned because the ReusableNormalization
 * type only admits `status: "complete"` and this function additionally filters on that
 * exact status.
 */
export function selectCompatibleNormalization(
  input: SelectCompatibleNormalizationInput,
): ReusableNormalization | null {
  const documentDigest = input.document.contentSha256
    ? normalizeContentSha256(input.document.contentSha256)
    : "";

  for (const normalization of input.normalizations) {
    if (!isCompleteNormalization(normalization)) continue;
    if (normalizeContentSha256(normalization.contentSha256) !== documentDigest) continue;
    if (!compatibilityKeyMatches(input.targetCompatibility, compatibilityKey(normalization)))
      continue;
    return normalization;
  }

  return null;
}

/**
 * Partitions a batch of documents into reusable, provider-required and unavailable
 * buckets while preserving input order in each bucket. A document is only reusable
 * when a complete normalization exists with the exact digest, schema version and
 * analyzer version. Any schema or analyzer mismatch, or a non-complete normalization,
 * forces provider processing.
 */
export function partitionDocumentsByNormalization(
  input: PartitionDocumentsByNormalizationInput,
): PartitionDocumentsByNormalizationResult {
  const reusable: NormalizationReuseMatch[] = [];
  const requiresProvider: NormalizationProviderDocument[] = [];
  const unavailable: NormalizationUnavailableDocument[] = [];

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

    const matched = selectCompatibleNormalization({
      document: { documentId: document.documentId, contentSha256 },
      normalizations: input.normalizations,
      targetCompatibility: {
        ...input.targetCompatibility,
        contentSha256,
      },
    });

    if (matched) {
      reusable.push({
        documentId: document.documentId,
        contentSha256,
        normalizationId: matched.id,
      });
      continue;
    }

    const matchingDigest = input.normalizations.find(
      (n) => normalizeContentSha256(n.contentSha256) === contentSha256,
    );

    if (!matchingDigest) {
      requiresProvider.push({
        documentId: document.documentId,
        contentSha256,
        reason: "no_compatible_normalization",
      });
      continue;
    }

    if (
      matchingDigest.normalizationSchemaVersion !==
      input.targetCompatibility.normalizationSchemaVersion
    ) {
      requiresProvider.push({
        documentId: document.documentId,
        contentSha256,
        reason: "schema_mismatch",
      });
      continue;
    }

    if (matchingDigest.analyzerVersion !== input.targetCompatibility.analyzerVersion) {
      requiresProvider.push({
        documentId: document.documentId,
        contentSha256,
        reason: "analyzer_mismatch",
      });
      continue;
    }

    requiresProvider.push({
      documentId: document.documentId,
      contentSha256,
      reason: "incomplete_or_failed",
    });
  }

  return { reusable, requiresProvider, unavailable };
}
