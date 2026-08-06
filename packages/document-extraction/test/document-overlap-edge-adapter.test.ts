import { describe, expect, it } from "vitest";
import {
  classifyDocumentAssetOverlap,
  entityResolutionFromOverlap,
  recordDocumentAssetOverlapArgs,
  type ClassifyDocumentAssetOverlapContext,
} from "../src/document-overlap-edge-adapter.ts";

const SCHEMA = "1.0.0";
const ANALYZER = "gemini-2.5-flash-lite-v1";

function makeAsset(overrides: Record<string, unknown> = {}) {
  const canonical = "vehicle:vin:1HGCM82633A123456";
  return {
    id: "asset-1",
    assetType: "vehicle" as const,
    identityFingerprint: canonical,
    candidateIdentity: {
      exactIdentityFingerprint: canonical,
      provisionalCandidateKey: canonical,
      identityStrength: "exact" as const,
    },
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<ClassifyDocumentAssetOverlapContext> = {},
): ClassifyDocumentAssetOverlapContext {
  return {
    existingAssets: [],
    existingPolicies: [],
    pendingCandidates: [],
    priorNormalizations: [],
    documentType: "declarations_page",
    digestByDocId: { doc1: "aa".repeat(32) },
    compatibleNormalizationByDocId: new Map(),
    ...overrides,
  };
}

function makeEntity(overrides: Record<string, unknown> = {}) {
  return {
    temporaryId: "entity-1",
    entityType: "vehicle",
    canonicalFingerprint: "vehicle:vin:1HGCM82633A123456",
    candidateIdentity: {},
    currentPolicy: {
      insurer: "Test Insurer",
      policyNumber: "POL-123",
      effectiveDate: "2025-01-01",
      expiryDate: "2025-12-31",
    },
    evidence: [{ documentId: "doc1" }],
    ...overrides,
  };
}

describe("document-overlap-edge-adapter", () => {
  it("classifies an exact file duplicate when a compatible normalization is selected", () => {
    const compatible = {
      normalizationId: "norm-1",
      contentDigest: "aa".repeat(32),
      normalizationSchemaVersion: SCHEMA,
      analyzerVersion: ANALYZER,
      status: "complete" as const,
    };
    const context = makeContext({
      compatibleNormalizationByDocId: new Map([["doc1", compatible]]),
    });

    const result = classifyDocumentAssetOverlap(makeEntity(), context);

    expect(result.classification).toBe("exact_file_duplicate");
    expect(result.disposition).toBe("reuse_existing_normalization");
    expect(result.skipCandidateDerivation).toBe(true);
    expect(result.normalizedEntityKey).toBe("vehicle:vin:1HGCM82633A123456");
    expect(result.comparedFields).toMatchObject({
      contentDigest: "aa".repeat(32),
      normalizationId: "norm-1",
      normalizationSchemaVersion: SCHEMA,
      analyzerVersion: ANALYZER,
      status: "complete",
    });
  });

  it("does not derive a candidate from a supporting-evidence disposition", () => {
    const existingAsset = makeAsset();
    const existingPolicy = {
      id: "policy-1",
      assetId: "asset-1",
      assetType: "vehicle" as const,
      insurerName: "Test Insurer",
      policyNumber: "POL-123",
      effectiveDate: "2025-01-01",
      expiryDate: "2025-12-31",
      isCurrent: true,
    };
    const context = makeContext({
      existingAssets: [existingAsset],
      existingPolicies: [existingPolicy],
      documentType: "endorsement",
    });
    const entity = makeEntity({
      documentCategory: "endorsement",
      currentPolicy: {
        insurer: "Test Insurer",
        policyNumber: "POL-123",
        effectiveDate: "2025-01-01",
        expiryDate: "2025-12-31",
      },
    });

    const result = classifyDocumentAssetOverlap(entity, context);

    expect(result.classification).toBe("same_asset_supporting_document");
    expect(result.disposition).toBe("attach_supporting_evidence");
    expect(result.skipCandidateDerivation).toBe(true);
    expect(result.assetId).toBe("asset-1");
    expect(result.assetType).toBe("vehicle");
  });

  it("maps a renewal disposition to a matches-existing resolution", () => {
    const existingAsset = makeAsset();
    const existingPolicy = {
      id: "policy-1",
      assetId: "asset-1",
      assetType: "vehicle" as const,
      insurerName: "Test Insurer",
      policyNumber: "POL-123",
      effectiveDate: "2024-01-01",
      expiryDate: "2024-12-31",
      isCurrent: true,
    };
    const context = makeContext({
      existingAssets: [existingAsset],
      existingPolicies: [existingPolicy],
    });
    const entity = makeEntity({
      currentPolicy: {
        insurer: "Test Insurer",
        policyNumber: "POL-123",
        effectiveDate: "2025-01-01",
        expiryDate: "2025-12-31",
      },
    });

    const result = classifyDocumentAssetOverlap(entity, context);

    expect(result.classification).toBe("same_asset_newer_policy_term");
    expect(result.disposition).toBe("create_renewal_candidate");
    expect(result.skipCandidateDerivation).toBe(false);
    expect(result.assetId).toBe("asset-1");

    const resolution = entityResolutionFromOverlap(result);
    expect(resolution).not.toBeNull();
    expect(resolution?.status).toBe("matches_existing");
    expect(resolution?.matchedExistingEntityId).toBe("asset-1");
  });

  it("maps a new asset disposition to a new resolution", () => {
    const context = makeContext();
    const entity = makeEntity({ canonicalFingerprint: null, provisionalFingerprint: null });

    const result = classifyDocumentAssetOverlap(entity, context);

    expect(result.classification).toBe("new_asset");
    expect(result.disposition).toBe("create_new_asset_candidate");
    expect(result.skipCandidateDerivation).toBe(false);

    const resolution = entityResolutionFromOverlap(result);
    expect(resolution?.status).toBe("new");
    expect(resolution?.matchedExistingEntityId).toBeNull();
  });

  it("records the normalization ID and batch ID for overlap persistence", () => {
    const compatible = {
      normalizationId: "norm-1",
      contentDigest: "aa".repeat(32),
      normalizationSchemaVersion: SCHEMA,
      analyzerVersion: ANALYZER,
      status: "complete" as const,
    };
    const context = makeContext({
      compatibleNormalizationByDocId: new Map([["doc1", compatible]]),
    });
    const result = classifyDocumentAssetOverlap(makeEntity(), context);

    const args = recordDocumentAssetOverlapArgs(result, {
      batchId: "batch-1",
      normalizationId: "norm-1",
    });

    expect(args.p_batch_id).toBe("batch-1");
    expect(args.p_normalization_id).toBe("norm-1");
    expect(args.p_classification).toBe("exact_file_duplicate");
    expect(args.p_normalized_entity_key).toBe("vehicle:vin:1HGCM82633A123456");
  });
});
