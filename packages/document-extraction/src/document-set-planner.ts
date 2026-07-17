import type { ParsedAssetAssertion, ParsedInsuranceDocument } from "./types.ts";

export type DocumentSetCandidateId = `${number}:${number}`;

export interface DocumentSetCandidate {
  candidateId: DocumentSetCandidateId;
  documentIndex: number;
  assetIndex: number;
  asset: ParsedAssetAssertion;
  requiresCustomerConfirmation: boolean;
  confirmationReasons: string[];
}

export interface PotentialDuplicateGroup {
  identityFingerprint: string;
  candidateIds: DocumentSetCandidateId[];
}

export interface DocumentSetPlan {
  candidates: DocumentSetCandidate[];
  potentialDuplicateGroups: PotentialDuplicateGroup[];
  unsupportedDocumentIndexes: number[];
  warnings: string[];
}

const CONFIRMATION_REQUIRED_CLASSIFICATIONS = new Set([
  "possible_existing_match",
  "new_identity_confirmation_required",
]);

/**
 * Builds a persistence-free review plan for a batch of parsed insurance documents.
 *
 * This function deliberately does not merge assets, select an existing entity,
 * create mandates, or write to storage. Equal fingerprints are reported only as
 * potential duplicate groups so deterministic identity logic and the customer
 * remain authoritative.
 */
export function planDocumentSetReview(
  documents: readonly ParsedInsuranceDocument[],
): DocumentSetPlan {
  const candidates: DocumentSetCandidate[] = [];
  const unsupportedDocumentIndexes: number[] = [];
  const candidatesByFingerprint = new Map<string, DocumentSetCandidateId[]>();

  documents.forEach((document, documentIndex) => {
    if (document.classification === "unsupported") {
      unsupportedDocumentIndexes.push(documentIndex);
    }

    document.assetAssertions.forEach((asset, assetIndex) => {
      const candidateId = `${documentIndex}:${assetIndex}` as const;
      const confirmationReasons: string[] = [];

      if (!asset.identityFingerprint.trim()) {
        confirmationReasons.push("missing_identity_fingerprint");
      }

      if (
        asset.matchClassification &&
        CONFIRMATION_REQUIRED_CLASSIFICATIONS.has(asset.matchClassification)
      ) {
        confirmationReasons.push(asset.matchClassification);
      }

      if (!asset.matchClassification) {
        confirmationReasons.push("match_classification_missing");
      }

      const candidate: DocumentSetCandidate = {
        candidateId,
        documentIndex,
        assetIndex,
        asset,
        requiresCustomerConfirmation: confirmationReasons.length > 0,
        confirmationReasons,
      };

      candidates.push(candidate);

      const fingerprint = asset.identityFingerprint.trim();
      if (fingerprint) {
        const group = candidatesByFingerprint.get(fingerprint) ?? [];
        group.push(candidateId);
        candidatesByFingerprint.set(fingerprint, group);
      }
    });
  });

  const potentialDuplicateGroups = [...candidatesByFingerprint.entries()]
    .filter(([, candidateIds]) => candidateIds.length > 1)
    .map(([identityFingerprint, candidateIds]) => ({
      identityFingerprint,
      candidateIds,
    }));

  const duplicateCandidateIds = new Set(
    potentialDuplicateGroups.flatMap((group) => group.candidateIds),
  );

  for (const candidate of candidates) {
    if (duplicateCandidateIds.has(candidate.candidateId)) {
      candidate.requiresCustomerConfirmation = true;
      candidate.confirmationReasons.push("potential_duplicate_in_upload_set");
    }
  }

  const warnings: string[] = [];
  if (unsupportedDocumentIndexes.length > 0) {
    warnings.push("unsupported_documents_present");
  }
  if (candidates.length === 0) {
    warnings.push("no_asset_candidates_found");
  }
  if (potentialDuplicateGroups.length > 0) {
    warnings.push("potential_duplicate_assets_present");
  }

  return {
    candidates,
    potentialDuplicateGroups,
    unsupportedDocumentIndexes,
    warnings,
  };
}
