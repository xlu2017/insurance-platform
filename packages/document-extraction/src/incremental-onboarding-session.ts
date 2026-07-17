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
  /** Change whenever the selected assertion or normalized current value changes. */
  extractionFingerprint: string;
  currentValue: unknown | undefined;
  /** Defaults to currentValue. */
  defaultMandatedValue?: unknown;
}

export interface IncomingOnboardingCandidate {
  /** Stable within this document, such as an extracted asset assertion ID. */
  localCandidateId: string;
  assetType: "property" | "vehicle";
  identityFingerprint: string;
  /** Change whenever customer-visible identity or review evidence changes. */
  reviewFingerprint: string;
  specifications: readonly IncomingSpecificationReview[];
}

export interface IncrementalOnboardingUpload {
  uploadId: string;
  /** Content hash of the PDF bytes. */
  documentFingerprint: string;
  /** Parser/model/prompt revision used for this attempt. */
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
  /** Stable across upload order and repeated ingestion of identical bytes. */
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
  /** Active candidates in the document's latest extraction. */
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

function clean(value: string): string {
  return value.trim();
}

function keyPart(value: string): string {
  return encodeURIComponent(clean(value));
}

function candidateIdFor(documentFingerprint: string, localCandidateId: string): string {
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
    clean(left.fieldPath).localeCompare(clean(right.fieldPath)),
  );
}

function documentSnapshotFingerprint(upload: IncrementalOnboardingUpload): string {
  return [...upload.candidates]
    .sort((left, right) =>
      clean(left.localCandidateId).localeCompare(clean(right.localCandidateId)),
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

function validateUpload(upload: IncrementalOnboardingUpload): IncrementalUploadBlocker[] {
  const blockers: IncrementalUploadBlocker[] = [];
  if (!clean(upload.uploadId)) {
    blockers.push({
      code: "missing_upload_id",
      message: "Incremental uploads require a non-empty upload ID.",
    });
  }
  if (!clean(upload.documentFingerprint)) {
    blockers.push({
      code: "missing_document_fingerprint",
      message: "Incremental uploads require a document content fingerprint.",
    });
  }
  if (!clean(upload.extractionRevision)) {
    blockers.push({
      code: "missing_extraction_revision",
      message: "Incremental uploads require an extraction revision.",
    });
  }

  const seenCandidates = new Set<string>();
  for (const candidate of upload.candidates) {
    const localCandidateId = clean(candidate.localCandidateId);
    if (!localCandidateId) {
      blockers.push({
        code: "missing_local_candidate_id",
        localCandidateId,
        message: "Every extracted asset requires a stable document-local ID.",
      });
    } else if (seenCandidates.has(localCandidateId)) {
      blockers.push({
        code: "duplicate_local_candidate_id",
        localCandidateId,
        message: "Document-local candidate IDs must be unique.",
      });
    }
    seenCandidates.add(localCandidateId);

    if (!clean(candidate.reviewFingerprint)) {
      blockers.push({
        code: "missing_candidate_review_fingerprint",
        localCandidateId,
        message: "Every candidate requires a semantic review fingerprint.",
      });
    }

    const seenFields = new Set<string>();
    for (const specification of candidate.specifications) {
      const fieldPath = clean(specification.fieldPath);
      if (!fieldPath) {
        blockers.push({
          code: "missing_specification_field_path",
          localCandidateId,
          fieldPath,
          message: "Every specification requires a field path.",
        });
      } else if (seenFields.has(fieldPath)) {
        blockers.push({
          code: "duplicate_specification_field_path",
          localCandidateId,
          fieldPath,
          message: "A candidate may contain each specification only once.",
        });
      }
      seenFields.add(fieldPath);

      if (!clean(specification.extractionFingerprint)) {
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

function cloneSession(session: IncrementalOnboardingSession): IncrementalOnboardingSession {
  return {
    ...session,
    documents: session.documents.map((document) => ({
      ...document,
      candidateIds: [...document.candidateIds],
    })),
    candidates: session.candidates.map((candidate) => ({
      ...candidate,
      specifications: candidate.specifications.map((specification) => ({
        ...specification,
      })),
    })),
  };
}

function createCandidate(
  documentFingerprint: string,
  candidate: IncomingOnboardingCandidate,
): IncrementalOnboardingCandidateState {
  return {
    candidateId: candidateIdFor(documentFingerprint, candidate.localCandidateId),
    sourceDocumentFingerprint: clean(documentFingerprint),
    localCandidateId: clean(candidate.localCandidateId),
    assetType: candidate.assetType,
    identityFingerprint: clean(candidate.identityFingerprint),
    reviewFingerprint: clean(candidate.reviewFingerprint),
    decision: "pending",
    existingEntityId: undefined,
    reviewFreshness: "unreviewed",
    specifications: sortedSpecifications(candidate.specifications).map(
      (specification) => ({
        fieldPath: clean(specification.fieldPath),
        extractionFingerprint: clean(specification.extractionFingerprint),
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
  previous: IncrementalOnboardingCandidateState,
  incoming: IncomingOnboardingCandidate,
  forceUnconfirmed: boolean,
): SpecificationReconciliation {
  const previousByField = new Map(
    previous.specifications.map((specification) => [
      clean(specification.fieldPath),
      specification,
    ]),
  );
  const incomingFields = new Set<string>();
  const specifications: OnboardingSpecificationDraft[] = [];
  let changed = false;

  for (const incomingSpecification of sortedSpecifications(incoming.specifications)) {
    const fieldPath = clean(incomingSpecification.fieldPath);
    incomingFields.add(fieldPath);
    const existing = previousByField.get(fieldPath);

    if (!existing) {
      changed = true;
      specifications.push({
        fieldPath,
        extractionFingerprint: clean(incomingSpecification.extractionFingerprint),
        currentValue: incomingSpecification.currentValue,
        mandatedValue: defaultMandatedValue(incomingSpecification),
        mandatedValueOrigin: "defaulted_from_current",
        confirmed: false,
        superseded: false,
      });
      continue;
    }

    const specificationChanged =
      existing.extractionFingerprint !==
        clean(incomingSpecification.extractionFingerprint) || existing.superseded;
    if (specificationChanged) changed = true;

    specifications.push({
      fieldPath,
      extractionFingerprint: clean(incomingSpecification.extractionFingerprint),
      currentValue: incomingSpecification.currentValue,
      mandatedValue:
        existing.mandatedValueOrigin === "customer_customized"
          ? existing.mandatedValue
          : defaultMandatedValue(incomingSpecification),
      mandatedValueOrigin: existing.mandatedValueOrigin,
      confirmed:
        forceUnconfirmed || specificationChanged ? false : existing.confirmed,
      superseded: false,
    });
  }

  for (const existing of previous.specifications) {
    if (incomingFields.has(clean(existing.fieldPath))) continue;
    changed = true;
    specifications.push({ ...existing, confirmed: false, superseded: true });
  }

  specifications.sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));
  return { specifications, changed };
}

function duplicateGroupsFor(
  candidates: readonly IncrementalOnboardingCandidateState[],
): IncrementalDuplicateGroup[] {
  const byFingerprint = new Map<string, string[]>();
  for (const candidate of candidates) {
    const fingerprint = clean(candidate.identityFingerprint);
    if (candidate.superseded || !fingerprint) continue;
    const candidateIds = byFingerprint.get(fingerprint) ?? [];
    candidateIds.push(candidate.candidateId);
    byFingerprint.set(fingerprint, candidateIds);
  }

  return [...byFingerprint.entries()]
    .filter(([, candidateIds]) => candidateIds.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([identityFingerprint, candidateIds]) => ({
      duplicateGroupId: duplicateGroupIdFor(identityFingerprint),
      identityFingerprint,
      candidateIds: [...candidateIds].sort((left, right) => left.localeCompare(right)),
    }));
}

function assignDuplicateGroups(
  candidates: readonly IncrementalOnboardingCandidateState[],
): {
  candidates: IncrementalOnboardingCandidateState[];
  duplicateGroups: IncrementalDuplicateGroup[];
} {
  const duplicateGroups = duplicateGroupsFor(candidates);
  const groupByCandidate = new Map<string, string>();
  for (const group of duplicateGroups) {
    for (const candidateId of group.candidateIds) {
      groupByCandidate.set(candidateId, group.duplicateGroupId);
    }
  }
  return {
    candidates: candidates.map((candidate) => ({
      ...candidate,
      duplicateGroupId: groupByCandidate.get(candidate.candidateId),
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
  if (duplicateGroups.length > 0) warnings.push("potential_duplicate_assets_present");
  if (staleCandidateIds.length > 0) warnings.push("customer_review_became_stale");
  if (supersededCandidateIds.length > 0) {
    warnings.push("candidates_removed_by_reprocessing");
  }
  return warnings;
}

function result(
  outcome: IncrementalMergeOutcome,
  session: IncrementalOnboardingSession,
  duplicateGroups: IncrementalDuplicateGroup[],
  values: Partial<
    Pick<
      IncrementalUploadMergeResult,
      | "blockers"
      | "addedCandidateIds"
      | "updatedCandidateIds"
      | "staleCandidateIds"
      | "supersededCandidateIds"
      | "warnings"
    >
  > = {},
): IncrementalUploadMergeResult {
  return {
    accepted: outcome !== "blocked",
    outcome,
    session,
    blockers: values.blockers ?? [],
    addedCandidateIds: values.addedCandidateIds ?? [],
    updatedCandidateIds: values.updatedCandidateIds ?? [],
    staleCandidateIds: values.staleCandidateIds ?? [],
    supersededCandidateIds: values.supersededCandidateIds ?? [],
    duplicateGroups,
    warnings: values.warnings ?? [],
  };
}

export function createEmptyIncrementalOnboardingSession(): IncrementalOnboardingSession {
  return { version: 1, revision: 0, documents: [], candidates: [] };
}

/**
 * Accumulates documents uploaded together or separately into one review draft.
 * It never merges entities or writes persistence records.
 */
export function mergeIncrementalOnboardingUpload(
  session: IncrementalOnboardingSession,
  upload: IncrementalOnboardingUpload,
): IncrementalUploadMergeResult {
  const blockers = validateUpload(upload);
  const currentGroups = duplicateGroupsFor(session.candidates);
  if (blockers.length > 0) {
    return result("blocked", session, currentGroups, { blockers });
  }

  const documentFingerprint = clean(upload.documentFingerprint);
  const extractionRevision = clean(upload.extractionRevision);
  const snapshotFingerprint = documentSnapshotFingerprint(upload);
  const existingDocument = session.documents.find(
    (document) => document.documentFingerprint === documentFingerprint,
  );

  if (
    existingDocument?.snapshotFingerprint === snapshotFingerprint &&
    existingDocument.extractionRevision === extractionRevision
  ) {
    return result("duplicate_document", session, currentGroups, {
      warnings: warningsFor(currentGroups, [], []),
    });
  }

  const next = cloneSession(session);
  const addedCandidateIds: string[] = [];
  const updatedCandidateIds: string[] = [];
  const staleCandidateIds: string[] = [];
  const supersededCandidateIds: string[] = [];

  if (!existingDocument) {
    const candidateIds = upload.candidates.map((incoming) => {
      const candidate = createCandidate(documentFingerprint, incoming);
      next.candidates.push(candidate);
      addedCandidateIds.push(candidate.candidateId);
      return candidate.candidateId;
    });
    next.documents.push({
      documentFingerprint,
      latestUploadId: clean(upload.uploadId),
      extractionRevision,
      snapshotFingerprint,
      candidateIds,
    });
    next.revision += 1;
    const grouped = assignDuplicateGroups(next.candidates);
    next.candidates = grouped.candidates;
    return result("document_added", next, grouped.duplicateGroups, {
      addedCandidateIds,
      warnings: warningsFor(grouped.duplicateGroups, [], []),
    });
  }

  const documentIndex = next.documents.findIndex(
    (document) => document.documentFingerprint === documentFingerprint,
  );

  if (existingDocument.snapshotFingerprint === snapshotFingerprint) {
    next.documents[documentIndex] = {
      ...next.documents[documentIndex]!,
      latestUploadId: clean(upload.uploadId),
      extractionRevision,
    };
    next.revision += 1;
    const grouped = assignDuplicateGroups(next.candidates);
    next.candidates = grouped.candidates;
    return result("document_reprocessed_unchanged", next, grouped.duplicateGroups, {
      warnings: warningsFor(grouped.duplicateGroups, [], []),
    });
  }

  const incomingIds = new Set(
    upload.candidates.map((candidate) =>
      candidateIdFor(documentFingerprint, candidate.localCandidateId),
    ),
  );

  for (let index = 0; index < next.candidates.length; index += 1) {
    const candidate = next.candidates[index]!;
    if (
      candidate.sourceDocumentFingerprint !== documentFingerprint ||
      incomingIds.has(candidate.candidateId)
    ) {
      continue;
    }
    next.candidates[index] = {
      ...candidate,
      reviewFreshness: "stale",
      specifications: candidate.specifications.map((specification) => ({
        ...specification,
        confirmed: false,
        superseded: true,
      })),
      duplicateGroupId: undefined,
      superseded: true,
      revision: candidate.revision + 1,
    };
    staleCandidateIds.push(candidate.candidateId);
    supersededCandidateIds.push(candidate.candidateId);
  }

  const activeCandidateIds: string[] = [];
  for (const incoming of upload.candidates) {
    const candidateId = candidateIdFor(documentFingerprint, incoming.localCandidateId);
    activeCandidateIds.push(candidateId);
    const index = next.candidates.findIndex(
      (candidate) => candidate.candidateId === candidateId,
    );

    if (index < 0) {
      next.candidates.push(createCandidate(documentFingerprint, incoming));
      addedCandidateIds.push(candidateId);
      continue;
    }

    const previous = next.candidates[index]!;
    const identityChanged =
      previous.assetType !== incoming.assetType ||
      clean(previous.identityFingerprint) !== clean(incoming.identityFingerprint);
    const reviewFingerprintChanged =
      previous.reviewFingerprint !== clean(incoming.reviewFingerprint);
    const reconciled = reconcileSpecifications(
      previous,
      incoming,
      identityChanged || reviewFingerprintChanged,
    );
    const candidateChanged =
      identityChanged ||
      reviewFingerprintChanged ||
      previous.superseded ||
      reconciled.changed;
    if (!candidateChanged) continue;

    next.candidates[index] = {
      ...previous,
      assetType: incoming.assetType,
      identityFingerprint: clean(incoming.identityFingerprint),
      reviewFingerprint: clean(incoming.reviewFingerprint),
      decision: identityChanged ? "pending" : previous.decision,
      existingEntityId: identityChanged ? undefined : previous.existingEntityId,
      reviewFreshness: "stale",
      specifications: reconciled.specifications,
      superseded: false,
      revision: previous.revision + 1,
    };
    updatedCandidateIds.push(candidateId);
    staleCandidateIds.push(candidateId);
  }

  next.documents[documentIndex] = {
    documentFingerprint,
    latestUploadId: clean(upload.uploadId),
    extractionRevision,
    snapshotFingerprint,
    candidateIds: activeCandidateIds,
  };
  next.revision += 1;

  const grouped = assignDuplicateGroups(next.candidates);
  next.candidates = grouped.candidates;
  return result("document_reprocessed_changed", next, grouped.duplicateGroups, {
    addedCandidateIds,
    updatedCandidateIds,
    staleCandidateIds,
    supersededCandidateIds,
    warnings: warningsFor(
      grouped.duplicateGroups,
      staleCandidateIds,
      supersededCandidateIds,
    ),
  });
}
