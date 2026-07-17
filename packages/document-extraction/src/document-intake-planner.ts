export type ReviewSessionStatus =
  | "collecting"
  | "reviewing"
  | "approved"
  | "abandoned";

export interface IncomingPolicyDocument {
  uploadId: string;
  fileDigest: string;
  fileName?: string;
}

export interface ExistingHouseholdDocument {
  documentId: string;
  fileDigest: string;
  reviewSessionIds?: readonly string[];
}

export interface ExistingReviewSession {
  sessionId: string;
  status: ReviewSessionStatus;
  documentIds: readonly string[];
}

export type IntakeSessionReference =
  | { mode: "none" }
  | { mode: "reuse"; sessionId: string }
  | { mode: "create"; provisionalKey: string };

export interface AcceptedPolicyUpload {
  uploadId: string;
  fileDigest: string;
  session: Exclude<IntakeSessionReference, { mode: "none" }>;
}

export interface DuplicatePolicyUpload {
  uploadId: string;
  fileDigest: string;
  reason: "duplicate_in_batch" | "already_exists_in_household";
  canonicalUploadId?: string;
  existingDocumentId?: string;
  existingReviewSessionId?: string;
}

export interface DocumentIntakeBlocker {
  code:
    | "missing_upload_id"
    | "duplicate_upload_id"
    | "missing_file_digest"
    | "invalid_existing_document"
    | "existing_digest_collision"
    | "multiple_active_review_sessions";
  uploadId?: string;
  fileDigest?: string;
  message: string;
}

export interface DocumentIntakePlan {
  ready: boolean;
  session: IntakeSessionReference;
  acceptedUploads: AcceptedPolicyUpload[];
  duplicateUploads: DuplicatePolicyUpload[];
  blockers: DocumentIntakeBlocker[];
}

const ACTIVE_SESSION_STATUSES = new Set<ReviewSessionStatus>([
  "collecting",
  "reviewing",
]);

function normalizeDigest(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeId(value: string): string {
  return value.trim();
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function compareIncoming(
  left: IncomingPolicyDocument,
  right: IncomingPolicyDocument,
): number {
  const digestDifference = normalizeDigest(left.fileDigest).localeCompare(
    normalizeDigest(right.fileDigest),
  );
  if (digestDifference !== 0) return digestDifference;
  return normalizeId(left.uploadId).localeCompare(normalizeId(right.uploadId));
}

/**
 * Plans household document intake without writing to storage.
 *
 * Safety and idempotency properties:
 * - input order and filenames do not affect the result;
 * - repeated file digests within one upload batch are accepted once;
 * - a digest already stored for the household is never accepted again;
 * - separate uploads reuse the household's one active review session;
 * - ambiguous household state blocks the full plan instead of guessing;
 * - a new-session provisional key is deterministic for the accepted digest set.
 *
 * Callers remain responsible for authorization, transactional persistence, and a
 * database-level uniqueness constraint on household plus file digest.
 */
export function planDocumentIntake(input: {
  incoming: readonly IncomingPolicyDocument[];
  existingDocuments?: readonly ExistingHouseholdDocument[];
  existingSessions?: readonly ExistingReviewSession[];
}): DocumentIntakePlan {
  const existingDocuments = input.existingDocuments ?? [];
  const existingSessions = input.existingSessions ?? [];
  const blockers: DocumentIntakeBlocker[] = [];
  const seenUploadIds = new Set<string>();

  for (const document of input.incoming) {
    const uploadId = normalizeId(document.uploadId);
    const fileDigest = normalizeDigest(document.fileDigest);

    if (!uploadId) {
      blockers.push({
        code: "missing_upload_id",
        message: "Every incoming document requires a non-empty upload ID.",
      });
    } else if (seenUploadIds.has(uploadId)) {
      blockers.push({
        code: "duplicate_upload_id",
        uploadId,
        message: "Upload IDs must be unique within one intake request.",
      });
    }
    seenUploadIds.add(uploadId);

    if (!fileDigest) {
      blockers.push({
        code: "missing_file_digest",
        uploadId: uploadId || undefined,
        message: "Every incoming document requires a non-empty file digest.",
      });
    }
  }

  const activeSessions = existingSessions
    .filter((session) => ACTIVE_SESSION_STATUSES.has(session.status))
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));

  if (activeSessions.length > 1) {
    blockers.push({
      code: "multiple_active_review_sessions",
      message:
        "A household may have only one collecting or reviewing policy-import session.",
    });
  }

  const existingByDigest = new Map<string, ExistingHouseholdDocument[]>();
  for (const document of existingDocuments) {
    const documentId = normalizeId(document.documentId);
    const fileDigest = normalizeDigest(document.fileDigest);

    if (!documentId || !fileDigest) {
      blockers.push({
        code: "invalid_existing_document",
        fileDigest: fileDigest || undefined,
        message:
          "Existing household documents require non-empty document IDs and file digests.",
      });
      continue;
    }

    const matches = existingByDigest.get(fileDigest) ?? [];
    matches.push({
      ...document,
      documentId,
      fileDigest,
    });
    existingByDigest.set(fileDigest, matches);
  }

  for (const [fileDigest, documents] of existingByDigest) {
    const uniqueDocumentIds = new Set(documents.map((document) => document.documentId));
    if (uniqueDocumentIds.size > 1) {
      blockers.push({
        code: "existing_digest_collision",
        fileDigest,
        message:
          "Multiple stored household documents share one digest; reconcile them before intake.",
      });
    }
  }

  if (blockers.length > 0) {
    return {
      ready: false,
      session: { mode: "none" },
      acceptedUploads: [],
      duplicateUploads: [],
      blockers,
    };
  }

  const sortedIncoming = [...input.incoming]
    .map((document) => ({
      ...document,
      uploadId: normalizeId(document.uploadId),
      fileDigest: normalizeDigest(document.fileDigest),
    }))
    .sort(compareIncoming);

  const incomingByDigest = new Map<string, IncomingPolicyDocument[]>();
  for (const document of sortedIncoming) {
    const matches = incomingByDigest.get(document.fileDigest) ?? [];
    matches.push(document);
    incomingByDigest.set(document.fileDigest, matches);
  }

  const acceptedDrafts: Array<Omit<AcceptedPolicyUpload, "session">> = [];
  const duplicateUploads: DuplicatePolicyUpload[] = [];

  for (const [fileDigest, documents] of [...incomingByDigest.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const existing = existingByDigest.get(fileDigest)?.[0];

    if (existing) {
      const linkedActiveSession = activeSessions.find((session) =>
        session.documentIds.includes(existing.documentId),
      );
      const fallbackSessionId = [...(existing.reviewSessionIds ?? [])].sort()[0];

      for (const document of documents) {
        duplicateUploads.push({
          uploadId: document.uploadId,
          fileDigest,
          reason: "already_exists_in_household",
          existingDocumentId: existing.documentId,
          existingReviewSessionId:
            linkedActiveSession?.sessionId ?? fallbackSessionId,
        });
      }
      continue;
    }

    const [canonical, ...duplicates] = documents;
    acceptedDrafts.push({
      uploadId: canonical.uploadId,
      fileDigest,
    });

    for (const duplicate of duplicates) {
      duplicateUploads.push({
        uploadId: duplicate.uploadId,
        fileDigest,
        reason: "duplicate_in_batch",
        canonicalUploadId: canonical.uploadId,
      });
    }
  }

  if (acceptedDrafts.length === 0) {
    return {
      ready: true,
      session: { mode: "none" },
      acceptedUploads: [],
      duplicateUploads,
      blockers: [],
    };
  }

  const session: Exclude<IntakeSessionReference, { mode: "none" }> =
    activeSessions.length === 1
      ? { mode: "reuse", sessionId: activeSessions[0].sessionId }
      : {
          mode: "create",
          provisionalKey: `policy-intake:${stableHash(
            acceptedDrafts.map((document) => document.fileDigest).join("|"),
          )}`,
        };

  return {
    ready: true,
    session,
    acceptedUploads: acceptedDrafts.map((document) => ({
      ...document,
      session,
    })),
    duplicateUploads,
    blockers: [],
  };
}
