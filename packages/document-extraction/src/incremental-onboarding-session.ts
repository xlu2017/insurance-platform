export type OnboardingSessionDecision =
  | "pending"
  | "approve_new"
  | "link_existing"
  | "skip";

export type OnboardingReviewFreshness = "unreviewed" | "confirmed" | "stale";

export type MandatedValueOrigin =
  | "defaulted_from_current"
  | "customer_customized";

export interface IncomingSpecificationReview {
  fieldPath: string;
  /**
   * Stable signature of the selected source assertion and normalized current value.
   * Callers should change this whenever the extracted meaning changes.
   */
  extractionFingerprint: string;
  currentValue: unknown | undefined;
  /** Defaults to currentValue when omitted. */
  defaultMandatedValue?: unknown;
}

export interface IncomingOnboardingCandidate {
  /** Stable only within this document, such as an asset assertion ID. */
  localCandidateId: string;
  assetType: "property" | "vehicle";
  identityFingerprint: string;
  /**
   * Stable signature of all customer-visible identity and review evidence.
   * It must change whenever reprocessing changes what the customer is asked to approve.
   */
  reviewFingerprint: string;
  specifications: readonly IncomingSpecificationReview[];
}

export interface IncrementalOnboardingUpload {
  /** Opaque upload attempt ID used only for audit metadata. */
  uploadId: string;
  /** Content hash of the source PDF. Equal hashes represent the same document bytes. */
  documentFingerprint: string;
  /** Parser/model/prompt revision used for this extraction attempt. */
  extractionRevision: string;
  candidates: readonly IncomingOnboardingCandidate[];
}

export interface OnboardingSpecificationDraft {
  fieldPath: string;
  extractionFingerprint: string;
  currentValue: unknown | undefined;
  mandatedValue: unknown | undefined;
  mandatedValueOrigin: MandatedValueOrigin;
  confirmed: boolean;
  superseded: boolean;
}

export interface IncrementalOnboardingCandidateState {
  /** Stable across upload order and repeated ingestion of the same document. */
  candidateId: string;
  sourceDocumentFingerprint: string;
  localCandidateId: string;
  assetType: "property" | "vehicle";
  identityFingerprint: string;
  reviewFingerprint: string;
  decision: OnboardingSessionDecision;
  existingEntityId: string | undefined;
  reviewFreshness: OnboardingReviewFreshness;
  specifications: OnboardingSpecificationDraft[];
  duplicateGroupId: string | undefined;
  superseded: boolean;
  revision: number;
}

export interface IncrementalOnboardingDocumentState {
  documentFingerprint: string;
  latestUploadId: string;
  extractionRevision: string;
  snapshotFingerprint: string;
  /** Active candidate IDs from the latest extraction of this document. */
  candidateIds: string[];
}

export interface IncrementalOnboardingSession {
  version: 1;
  revision: number;
  documents: IncrementalOnboardingDocumentState[];
  candidates: IncrementalOnboardingCandidateState[];
}

export interface IncrementalDuplicateGroup {
  duplicateGroupId: string;
  identityFingerprint: string;
  candidateIds: string[];
}

export interface IncrementalUploadBlocker {
  code:
    | "missing_upload_id"
    | "missing_document_fingerprint"
    | "missing_extraction_revision"
    | "missing_local_candidate_id"
    | "duplicate_local_candidate_id"
    | "missing_candidate_review_fingerprint"
    | "missing_specification_field_path"
    | "duplicate_specification_field_path"
    | "missing_specification_extraction_fingerprint";
  message: string;
  localCandidateId?: string;
  fieldPath?: string;
}

export type IncrementalMergeOutcome =
  | "blocked"
  | "document_added"
  | "duplicate_document"
  | "document_reprocessed_unchanged"
  | "document_reprocessed_changed";

export interface IncrementalUploadMergeResult {
  accepted: boolean;
  outcome: IncrementalMergeOutcome;
  session: IncrementalOnboardingSession;
  blockers: IncrementalUploadBlocker[];
  addedCandidateIds: string[];
  updatedCandidateIds: string[];
  staleCandidateIds: string[];
  supersededCandidateIds: string[];
  duplicateGroups: IncrementalDuplicateGroup[];
  warnings: string[];
}

interface SpecificationReconciliation {
  specifications: OnboardingSpecificationDraft[];
  changed: boolean;
}

function normalized(value: string): string {
  return value.trim();
}

function keyPart(value: string): string {
  return encodeURIComponent(normalized(value));
}

function candidateIdFor(
  documentFingerprint: string,
  localCandidateId: string,
): string {
  return `candidate:${keyPart(documentFingerprint)}:${keyPart(localCandidateId)}`;
}

function duplicateGroupIdFor(identityFingerprint: string): string {
  return `duplicate:${keyPart(identityFingerprint)}`;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function defaultMandatedValue(
  specification: IncomingSpecificationReview,
): unknown | undefined {
  return hasValue(specification.defaultMandatedValue)
    ? specification.defaultMandatedValue
    : specification.currentValue;
}

function sortedSpecifications(
  specifications: readonly IncomingSpecificationReview[],
): IncomingSpecificationReview[] {
  return [...specifications].sort((left, right) =>
    normalized(left.fieldPath).localeCompare(normalized(right.fieldPath)),
  );
}

function documentSnapshotFingerprint(
  upload: IncrementalOnboardingUpload,
): string {
  return [...upload.candidates]
    .sort((left, right) =>
      normalized(left.localCandidateId).localeCompare(
        normalized(right.localCandidateId),
      ),
    )
    .map((candidate) => {
      const specifications = sortedSpecifications(candidate.specifications)
        .map(
          (specification) =>
            `${keyPart(specification.fieldPath)}=${keyPart(
              specification.extractionFingerprint,
            )}`,
        )
        .join(",");

      return [
        keyPart(candidate.localCandidateId),
        candidate.assetType,
        keyPart(candidate.identityFingerprint),
        keyPart(candidate.reviewFingerprint),
        specifications,
      ].join("|");
    })
    .join("||");
}

function validateUpload(
  upload: IncrementalOnboardingUpload,
): IncrementalUploadBlocker[] {
  const blockers: IncrementalUploadBlocker[] = [];

  if (!normalized(upload.uploadId)) {
    blockers.push({
      code: "missing_upload_id",
      message: "Incremental uploads require a non-empty upload ID.",
    });
  }
  if (!normalized(upload.documentFingerprint)) {
    blockers.push({
      code: "missing_document_fingerprint",
      message: "Incremental uploads require a source document content fingerprint.",
    });
  }
  if (!normalized(upload.extractionRevision)) {
    blockers.push({
      code: "missing_extraction_revision",
      message: "Incremental uploads require a parser or model extraction revision.",
    });
  }

  const seenCandidateIds = new Set<string>();
  for (const candidate of upload.candidates) {
    const localCandidateId = normalized(candidate.localCandidateId);
    if (!localCandidateId) {
      blockers.push({
        code: "missing_local_candidate_id",
        localCandidateId: candidate.localCandidateId,
        message: "Every extracted asset requires a stable document-local candidate ID.",
      });
    } else if (seenCandidateIds.has(localCandidateId)) {
      blockers.push({
        code: "duplicate_local_candidate_id",
        localCandidateId,
        message: "Document-local candidate IDs must be unique within one extraction.",
      });
    }
    seenCandidateIds.add(localCandidateId);

    if (!normalized(candidate.reviewFingerprint)) {
      blockers.push({
        code: "missing_candidate_review_fingerprint",
        localCandidateId,
        message: "Every candidate requires a semantic review fingerprint.",
      });
    }

    const seenFieldPaths = new Set<string>();
    for (const specification of candidate.specifications) {
      const fieldPath = normalized(specification.fieldPath);
      if (!fieldPath) {
        blockers.push({
          code: "missing_specification_field_path",
          localCandidateId,
          fieldPath: specification.fieldPath,
          message: "Every specification requires a non-empty field path.",
        });
      } else if (seenFieldPaths.has(fieldPath)) {
        blockers.push({
          code: "duplicate_specification_field_path",
          localCandidateId,
          fieldPath,
          message: "A candidate may contain each specification field only once.",
        });
      }
      seenFieldPaths.add(fieldPath);

      if (!normalized(specification.extractionFingerprint)) {
        blockers.push({
          code: "missing_specification_extraction_fingerprint",
          localCandidateId,
          fieldPath,
          message: "Every specification requires an extraction fingerprint.",
        });
      }
    }
  }

  return blockers;
}

function cloneCandidate(
  candidate: IncrementalOnboardingCandidateState,
): IncrementalOnboardingCandidateState {
  return {
    ...candidate,
    specifications: candidate.specifications.map((specification) => ({
      ...specification,
    })),
  };
}

function cloneSession(
  session: IncrementalOnboardingSession,
): IncrementalOnboardingSession {
  return {
    ...session,
    documents: session.documents.map((document) => ({
      ...document,
      candidateIds: [...document.candidateIds],
    })),
    candidates: session.candidates.map(cloneCandidate),
  };
}

function createCandidate(
  documentFingerprint: string,
  candidate: IncomingOnboardingCandidate,
): IncrementalOnboardingCandidateState {
  return {
    candidateId: candidateIdFor(
      documentFingerprint,
      candidate.localCandidateId,
    ),
    sourceDocumentFingerprint: normalized(documentFingerprint),
    localCandidateId: normalized(candidate.localCandidateId),
    assetType: candidate.assetType,
    identityFingerprint: normalized(candidate.identityFingerprint),
    reviewFingerprint: normalized(candidate.reviewFingerprint),
    decision: "pending",
    existingEntityId: undefined,
    reviewFreshness: "unreviewed",
    specifications: sortedSpecifications(candidate.specifications).map(
      (specification) => ({
        fieldPath: normalized(specification.fieldPath),
        extractionFingerprint: normalized(
          specification.extractionFingerprint,
        ),
        currentValue: specification.currentValue,
        mandatedValue: defaultMandatedValue(specification),
        mandatedValueOrigin: "defaulted_from_current",
        confirmed: false,
        superseded: false,
      }),
    ),
    duplicateGroupId: undefined,
    superseded: false,
    revision: 1,
  };
}

function reconcileSpecifications(
  existing: IncrementalOnboardingCandidateState,
  incoming: IncomingOnboardingCandidate,
  forceUnconfirmed: boolean,
): SpecificationReconciliation {
  const existingByField = new Map(
    existing.specifications.map((specification) => [
      normalized(specification.fieldPath),
      specification,
    ]),
  );
  const incomingFields = new Set<string>();
  const reconciled: OnboardingSpecificationDraft[] = [];
  let changed = false;

  for (const specification of sortedSpecifications(incoming.specifications)) {
    const fieldPath = normalized(specification.fieldPath);
    incomingFields.add(fieldPath);
    const previous = existingByField.get(fieldPath);

    if (!previous) {
      changed = true;
      reconciled.push({
        fieldPath,
        extractionFingerprint: normalized(
          specification.extractionFingerprint,
        ),
        currentValue: specification.currentValue,
        mandatedValue: defaultMandatedValue(specification),
        mandatedValueOrigin: "defaulted_from_current",
        confirmed: false,
        superseded: false,
      });
      continue;
    }

    const specificationChanged =
      previous.extractionFingerprint !==
        normalized(specification.extractionFingerprint) ||
      previous.superseded;
    changed ||= specificationChanged;

    reconciled.push({
      fieldPath,
      extractionFingerprint: normalized(specification.extractionFingerprint),
      currentValue: specification.currentValue,
      mandatedValue:
        previous.mandatedValueOrigin === "customer_customized"
          ? previous.mandatedValue
          : defaultMandatedValue(specification),
      mandatedValueOrigin: previous.mandatedValueOrigin,
      confirmed:
        forceUnconfirmed || specificationChanged ? false : previous.confirmed,
      superseded: false,
    });
  }

  for (const previous of existing.specifications) {
    if (incomingFields.has(normalized(previous.fieldPath))) continue;
    changed = true;
    reconciled.push({
      ...previous,
      confirmed: false,
      superseded: true,
    });
  }

  reconciled.sort((left, right) =>
    left.fieldPath.localeCompare(right.fieldPath),
  );

  return { specifications: reconciled, changed };
}

function duplicateGroupsFor(
  candidates: readonly IncrementalOnboardingCandidateState[],
): IncrementalDuplicateGroup[] {
  const candidatesByFingerprint = new Map<string, string[]>();

  for (const candidate of candidates) {
    const fingerprint = normalized(candidate.identityFingerprint);
    if (candidate.superseded || !fingerprint) continue;
    const candidateIds = candidatesByFingerprint.get(fingerprint) ?? [];
    candidateIds.push(candidate.candidateId);
    candidatesByFingerprint.set(fingerprint, candidateIds);
  }

  return [...candidatesByFingerprint.entries()]
    .filter(([, candidateIds]) => candidateIds.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([identityFingerprint, candidateIds]) => ({
      duplicateGroupId: duplicateGroupIdFor(identityFingerprint),
      identityFingerprint,
      candidateIds: [...candidateIds].sort((left, right) =>
        left.localeCompare(right),
      ),
    }));
}

function assignDuplicateGroups(
  candidates: readonly IncrementalOnboardingCandidateState[],
): {
  candidates: IncrementalOnboardingCandidateState[];
  duplicateGroups: IncrementalDuplicateGroup[];
} {
  const duplicateGroups = duplicateGroupsFor(candidates);
  const groupByCandidateId = new Map<string, string>();

  for (const group of duplicateGroups) {
    for (const candidateId of group.candidateIds) {
      groupByCandidateId.set(candidateId, group.duplicateGroupId);
    }
  }

  return {
    candidates: candidates.map((candidate) => ({
      ...candidate,
      duplicateGroupId: groupByCandidateId.get(candidate.candidateId),
    })),
    duplicateGroups,
  };
}

function warningsFor(
  duplicateGroups: readonly IncrementalDuplicateGroup[],
  staleCandidateIds: readonly string[],
  supersededCandidateIds: readonly string[],
): string[] {
  const warnings: string[] = [];
  if (duplicateGroups.length > 0) {
    warnings.push("potential_duplicate_assets_present");
  }
  if (staleCandidateIds.length > 0) {
    warnings.push("customer_review_became_stale");
  }
  if (supersededCandidateIds.length > 0) {
    warnings.push("candidates_removed_by_reprocessing");
  }
  return warnings;
}

export function createEmptyIncrementalOnboardingSession(): IncrementalOnboardingSession {
  return {
    version: 1,
    revision: 0,
    documents: [],
    candidates: [],
  };
}

/**
 * Reconciles one uploaded document into a serializable onboarding draft.
 *
 * Safety properties:
 * - candidate IDs do not depend on batch order;
 * - uploading identical document bytes is idempotent;
 * - candidates from separate uploads are accumulated, never replaced wholesale;
 * - equal identity fingerprints create a potential-duplicate group, never an auto-merge;
 * - changed extraction semantics make prior review stale;
 * - identity changes reset approve/link/skip decisions and existing-entity links;
 * - customer-customized mandate values survive re-extraction, but require reconfirmation;
 * - removed assertions and candidates remain auditable as superseded records;
 * - invalid uploads are rejected atomically without modifying the session.
 *
 * This function performs no persistence, authorization, entity creation, or mandate writes.
 */
export function mergeIncrementalOnboardingUpload(
  session: IncrementalOnboardingSession,
  upload: IncrementalOnboardingUpload,
): IncrementalUploadMergeResult {
  const blockers = validateUpload(upload);
  const currentDuplicateGroups = duplicateGroupsFor(session.candidates);

  if (blockers.length > 0) {
    return {
      accepted: false,
      outcome: "blocked",
      session,
      blockers,
      addedCandidateIds: [],
      updatedCandidateIds: [],
      staleCandidateIds: [],
      supersededCandidateIds: [],
      duplicateGroups: currentDuplicateGroups,
      warnings: [],
    };
  }

  const documentFingerprint = normalized(upload.documentFingerprint);
  const snapshotFingerprint = documentSnapshotFingerprint(upload);
  const existingDocument = session.documents.find(
    (document) => document.documentFingerprint === documentFingerprint,
  );

  if (
    existingDocument &&
    existingDocument.snapshotFingerprint === snapshotFingerprint &&
    existingDocument.extractionRevision === normalized(upload.extractionRevision)
  ) {
    return {
      accepted: true,
      outcome: "duplicate_document",
      session,
      blockers: [],
      addedCandidateIds: [],
      updatedCandidateIds: [],
      staleCandidateIds: [],
      supersededCandidateIds: [],
      duplicateGroups: currentDuplicateGroups,
      warnings:
        currentDuplicateGroups.length > 0
          ? ["potential_duplicate_assets_present"]
          : [],
    };
  }

  const nextSession = cloneSession(session);
  const addedCandidateIds: string[] = [];
  const updatedCandidateIds: string[] = [];
  const staleCandidateIds: string[] = [];
  const supersededCandidateIds: string[] = [];

  if (!existingDocument) {
    const candidateIds: string[] = [];
    for (const incomingCandidate of upload.candidates) {
      const candidate = createCandidate(documentFingerprint, incomingCandidate);
      nextSession.candidates.push(candidate);
      candidateIds.push(candidate.candidateId);
      addedCandidateIds.push(candidate.candidateId);
    }

    nextSession.documents.push({
      documentFingerprint,
      latestUploadId: normalized(upload.uploadId),
      extractionRevision: normalized(upload.extractionRevision),
      snapshotFingerprint,
      candidateIds,
    });
    nextSession.revision += 1;

    const grouped = assignDuplicateGroups(nextSession.candidates);
    nextSession.candidates = grouped.candidates;

    return {
      accepted: true,
      outcome: "document_added",
      session: nextSession,
      blockers: [],
      addedCandidateIds,
      updatedCandidateIds,
      staleCandidateIds,
      supersededCandidateIds,
      duplicateGroups: grouped.duplicateGroups,
      warnings: warningsFor(grouped.duplicateGroups, [], []),
    };
  }

  const documentIndex = nextSession.documents.findIndex(
    (document) => document.documentFingerprint === documentFingerprint,
  );

  if (existingDocument.snapshotFingerprint === snapshotFingerprint) {
    nextSession.documents[documentIndex] = {
      ...nextSession.documents[documentIndex]!,
      latestUploadId: normalized(upload.uploadId),
      extractionRevision: normalized(upload.extractionRevision),
    };
    nextSession.revision += 1;

    const grouped = assignDuplicateGroups(nextSession.candidates);
    nextSession.candidates = grouped.candidates;

    return {
      accepted: true,
      outcome: "document_reprocessed_unchanged",
      session: nextSession,
      blockers: [],
      addedCandidateIds,
      updatedCandidateIds,
      staleCandidateIds,
      supersededCandidateIds,
      duplicateGroups: grouped.duplicateGroups,
      warnings: warningsFor(grouped.duplicateGroups, [], []),
    };
  }

  const incomingCandidateIds = new Set(
    upload.candidates.map((candidate) =>
      candidateIdFor(documentFingerprint, candidate.localCandidateId),
    ),
  );

  for (let index = 0; index < nextSession.candidates.length; index += 1) {
    const existingCandidate = nextSession.candidates[index]!;
    if (
      existingCandidate.sourceDocumentFingerprint !== documentFingerprint ||
      incomingCandidateIds.has(existingCandidate.candidateId)
    ) {
      continue;
    }

    nextSession.candidates[index] = {
      ...existingCandidate,
      reviewFreshness: "stale",
      specifications: existingCandidate.specifications.map((specification) => ({
        ...specification,
        confirmed: false,
        superseded: true,
      })),
      duplicateGroupId: undefined,
      superseded: true,
      revision: existingCandidate.revision + 1,
    };
    staleCandidateIds.push(existingCandidate.candidateId);
    supersededCandidateIds.push(existingCandidate.candidateId);
  }

  const activeCandidateIds: string[] = [];
  for (const incomingCandidate of upload.candidates) {
    const candidateId = candidateIdFor(
      documentFingerprint,
      incomingCandidate.localCandidateId,
    );
    activeCandidateIds.push(candidateId);
    const candidateIndex = nextSession.candidates.findIndex(
      (candidate) => candidate.candidateId === candidateId,
    );

    if (candidateIndex < 0) {
      nextSession.candidates.push(
        createCandidate(documentFingerprint, incomingCandidate),
      );
      addedCandidateIds.push(candidateId);
      continue;
    }

    const previous = nextSession.candidates[candidateIndex]!;
    const identityChanged =
      previous.assetType !== incomingCandidate.assetType ||
      normalized(previous.identityFingerprint) !==
        normalized(incomingCandidate.identityFingerprint);
    const reconciliation = reconcileSpecifications(
      previous,
      incomingCandidate,
      identityChanged,
    );
    const candidateChanged =
      identityChanged ||
      previous.reviewFingerprint !==
        normalized(incomingCandidate.reviewFingerprint) ||
      previous.superseded ||
      reconciliation.changed;

    if (!candidateChanged) continue;

    nextSession.candidates[candidateIndex] = {
      ...previous,
      assetType: incomingCandidate.assetType,
      identityFingerprint: normalized(incomingCandidate.identityFingerprint),
      reviewFingerprint: normalized(incomingCandidate.reviewFingerprint),
      decision: identityChanged ? "pending" : previous.decision,
      existingEntityId: identityChanged ? undefined : previous.existingEntityId,
      reviewFreshness: "stale",
      specifications: reconciliation.specifications,
      superseded: false,
      revision: previous.revision + 1,
    };
    updatedCandidateIds.push(candidateId);
    staleCandidateIds.push(candidateId);
  }

  nextSession.documents[documentIndex] = {
    documentFingerprint,
    latestUploadId: normalized(upload.uploadId),
    extractionRevision: normalized(upload.extractionRevision),
    snapshotFingerprint,
    candidateIds: activeCandidateIds,
  };
  nextSession.revision += 1;

  const grouped = assignDuplicateGroups(nextSession.candidates);
  nextSession.candidates = grouped.candidates;

  return {
    accepted: true,
    outcome: "document_reprocessed_changed",
    session: nextSession,
    blockers: [],
    addedCandidateIds,
    updatedCandidateIds,
    staleCandidateIds,
    supersededCandidateIds,
    duplicateGroups: grouped.duplicateGroups,
    warnings: warningsFor(
      grouped.duplicateGroups,
      staleCandidateIds,
      supersededCandidateIds,
    ),
  };
}
