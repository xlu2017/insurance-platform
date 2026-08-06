import {
  classifyDocumentOverlap,
  adaptNormalizedEntityToOverlapCandidate,
  toRecordDocumentAssetOverlapArgs,
  OVERLAP_DISPOSITIONS,
  type OverlapCandidate,
  type OverlapResult,
  type ExistingAsset,
  type ExistingPolicy,
  type CompatibleNormalization,
  type NormalizedEntityPayload,
  type AssetType,
} from "./document-overlap-classifier.ts";
import { isExactFingerprint } from "./pending-candidate-builder.ts";
import type { EntityResolution, ExistingHouseholdAsset } from "./document-analyzer.ts";

export type { OverlapCandidate, OverlapResult, ExistingAsset, ExistingPolicy };
export { OVERLAP_DISPOSITIONS };

export interface ClassifyDocumentAssetOverlapContext {
  existingAssets: ExistingHouseholdAsset[];
  existingPolicies: ExistingPolicy[];
  pendingCandidates: unknown[];
  priorNormalizations: unknown[];
  documentType: string;
  digestByDocId: Record<string, string>;
  compatibleNormalizationByDocId?: Map<string, CompatibleNormalization>;
}

export interface ClassifyDocumentAssetOverlapResult {
  classification: string;
  disposition: string;
  confidence: number;
  assetId?: string;
  assetType?: AssetType;
  existingPolicyId?: string;
  normalizedEntityKey: string;
  reasons: string[];
  comparedFields: Record<string, unknown>;
  requiresCustomerDecision: boolean;
  /** When true, no candidate or review should be derived from this entity. */
  skipCandidateDerivation: boolean;
  /** Stable normalized entity key to use for persistence. */
  normalizedEntityKeyForPersistence: string;
  details: Record<string, unknown>;
}

function normalizeEntityForAdapter(entity: unknown): NormalizedEntityPayload {
  return entity as NormalizedEntityPayload;
}

function toExistingAsset(asset: ExistingHouseholdAsset): ExistingAsset {
  const candidateIdentity =
    typeof asset.candidateIdentity === "object" && asset.candidateIdentity !== null
      ? (asset.candidateIdentity as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const canonicalFingerprint =
    typeof candidateIdentity.exactIdentityFingerprint === "string"
      ? candidateIdentity.exactIdentityFingerprint
      : isExactFingerprint(asset.identityFingerprint)
        ? asset.identityFingerprint
        : null;
  const provisionalFingerprint =
    typeof candidateIdentity.provisionalCandidateKey === "string"
      ? candidateIdentity.provisionalCandidateKey
      : !isExactFingerprint(asset.identityFingerprint)
        ? asset.identityFingerprint
        : null;
  return {
    id: asset.id,
    assetType: asset.assetType,
    canonicalFingerprint,
    provisionalFingerprint,
  };
}

export function classifyDocumentAssetOverlap(
  entity: unknown,
  context: ClassifyDocumentAssetOverlapContext,
): ClassifyDocumentAssetOverlapResult {
  const entityPayload = normalizeEntityForAdapter(entity);
  const firstEvidence = Array.isArray(entityPayload.evidence)
    ? (entityPayload.evidence[0] as Record<string, unknown> | undefined)
    : undefined;
  const docId =
    (typeof firstEvidence?.documentId === "string"
      ? firstEvidence.documentId
      : entityPayload.temporaryId) ?? "";
  const contentDigest = context.digestByDocId[docId] ?? "";

  const payload: NormalizedEntityPayload = {
    ...entityPayload,
    documentCategory: context.documentType,
  };
  const candidate = adaptNormalizedEntityToOverlapCandidate(contentDigest, payload);

  const compatibleNormalization = context.compatibleNormalizationByDocId?.get(docId);
  const compatibleNormalizationAlreadySelected = !!compatibleNormalization;

  const result = classifyDocumentOverlap({
    candidate,
    existingAssets: context.existingAssets.map(toExistingAsset),
    existingPolicies: context.existingPolicies,
    compatibleNormalizationAlreadySelected,
    compatibleNormalization,
  });

  const skip =
    result.disposition === "reuse_existing_normalization" ||
    result.disposition === "attach_supporting_evidence";

  return {
    classification: result.classification,
    disposition: result.disposition,
    confidence: result.confidence,
    assetId: result.assetId,
    assetType: result.assetType,
    existingPolicyId: result.existingPolicyId,
    normalizedEntityKey: result.normalizedEntityKey,
    reasons: result.reasons,
    comparedFields: result.comparedFields,
    requiresCustomerDecision: result.requiresCustomerDecision,
    skipCandidateDerivation: skip,
    normalizedEntityKeyForPersistence: result.normalizedEntityKey,
    details: {
      disposition: result.disposition,
      ...result.comparedFields,
    },
  };
}

export function entityResolutionFromOverlap(
  overlap: ClassifyDocumentAssetOverlapResult,
): EntityResolution | null {
  if (overlap.skipCandidateDerivation) return null;

  const base: Omit<EntityResolution, "status"> = {
    confidence: overlap.confidence,
    reasoning: overlap.reasons[0] ?? "overlap classification derived",
    matchedExistingEntityId: overlap.assetId ?? null,
    matchedPendingCandidateId: null,
  };

  switch (overlap.disposition) {
    case "create_new_asset_candidate":
      return { ...base, status: "new", matchedExistingEntityId: null };
    case "create_renewal_candidate":
      return { ...base, status: "matches_existing" };
    case "create_conflict_review":
      return { ...base, status: "possible_match_requires_confirmation" };
    case "require_asset_match_confirmation":
      return { ...base, status: "possible_match_requires_confirmation" };
    default:
      return { ...base, status: "new", matchedExistingEntityId: null };
  }
}

export function recordDocumentAssetOverlapArgs(
  overlap: ClassifyDocumentAssetOverlapResult,
  context: { batchId: string; normalizationId: string },
): ReturnType<typeof toRecordDocumentAssetOverlapArgs> {
  const syntheticResult = {
    classification: overlap.classification,
    disposition: overlap.disposition,
    confidence: overlap.confidence,
    assetId: overlap.assetId,
    assetType: overlap.assetType,
    existingPolicyId: overlap.existingPolicyId,
    normalizedEntityKey: overlap.normalizedEntityKeyForPersistence,
    reasons: overlap.reasons,
    comparedFields: overlap.comparedFields,
    requiresCustomerDecision: overlap.requiresCustomerDecision,
  } as unknown as OverlapResult;
  return toRecordDocumentAssetOverlapArgs(syntheticResult, context);
}
