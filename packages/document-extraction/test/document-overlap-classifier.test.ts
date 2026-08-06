import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  classifyDocumentOverlap,
  adaptNormalizedEntityToOverlapCandidate,
  adaptPolicyRowToExistingPolicy,
  toRecordDocumentAssetOverlapArgs,
  type CompatibleNormalization,
  type ExistingAsset,
  type ExistingPolicy,
  type NormalizedEntityPayload,
  type OverlapCandidate,
  type PolicyRow,
  OVERLAP_CLASSIFICATIONS,
} from "../src/document-overlap-classifier.ts";

const VEHICLE_ASSET_ID = "22000000-0000-0000-0000-000000000001";
const VEHICLE_FINGERPRINT = "vehicle:vin:JTMB1RFV8MD067001";
const VEHICLE_PROVISIONAL = "vehicle-hint:2020|TOYOTA|RAV4|";
const VEHICLE2_FINGERPRINT = "vehicle:vin:2HGFC2F59HH567002";
const VEHICLE_POLICY_ID = "vehicle-policy-001";
const VEHICLE_HISTORICAL_POLICY_ID = "vehicle-policy-historical";

const PROPERTY_ASSET_ID = "23000000-0000-0000-0000-000000000001";
const PROPERTY_FINGERPRINT = "property:|128 LARCHWOOD CRES NW|CALGARY|AB|T3B0C4";
const PROPERTY_PROVISIONAL = "property-hint:T3B0C4:principal_residence";
const PROPERTY2_FINGERPRINT = "property:|999 OTHER ST|CALGARY|AB|T3B0C4";
const PROPERTY_POLICY_ID = "property-policy-001";

const INSURER = "TD Insurance";
const POLICY_NUMBER = "POL-12345";
const EFFECTIVE_DATE = "2025-01-01";
const EXPIRY_DATE = "2026-01-01";

function known<T extends string | number | boolean>(value: T) {
  return { status: "known" as const, value };
}

function unknown() {
  return { status: "unknown" as const, value: null };
}

function notIncluded() {
  return { status: "not_included" as const, value: null };
}

function conflicting(value: unknown = null) {
  return { status: "conflicting" as const, value };
}

function makeAsset(overrides: Partial<ExistingAsset> = {}): ExistingAsset {
  return {
    id: VEHICLE_ASSET_ID,
    assetType: "vehicle",
    canonicalFingerprint: VEHICLE_FINGERPRINT,
    provisionalFingerprint: null,
    ...overrides,
  };
}

function makePolicy(overrides: Partial<ExistingPolicy> = {}): ExistingPolicy {
  return {
    id: VEHICLE_POLICY_ID,
    assetId: VEHICLE_ASSET_ID,
    assetType: "vehicle",
    insurerName: INSURER,
    policyNumber: POLICY_NUMBER,
    effectiveDate: EFFECTIVE_DATE,
    expiryDate: EXPIRY_DATE,
    isCurrent: true,
    annualPremiumCents: 120000,
    coverageFacts: {
      "policy.annualPremiumCents": known(120000),
      "vehicle.thirdPartyLiabilityLimitCents": known(200000000),
      "vehicle.comprehensiveIncluded": known(true),
      "vehicle.collisionIncluded": known(true),
    },
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<OverlapCandidate> = {}): OverlapCandidate {
  return {
    contentDigest: "digest-candidate",
    normalizationSchemaVersion: "1",
    analyzerVersion: "1",
    assetType: "vehicle",
    canonicalFingerprint: VEHICLE_FINGERPRINT,
    provisionalFingerprint: null,
    insurer: INSURER,
    policyNumber: POLICY_NUMBER,
    effectiveDate: EFFECTIVE_DATE,
    expiryDate: EXPIRY_DATE,
    documentType: "current_auto_policy",
    coverageFacts: {
      "policy.annualPremiumCents": known(120000),
      "vehicle.thirdPartyLiabilityLimitCents": known(200000000),
      "vehicle.comprehensiveIncluded": known(true),
      "vehicle.collisionIncluded": known(true),
    },
    ...overrides,
  };
}

function classify(
  candidate: OverlapCandidate,
  options: {
    existingAssets?: ExistingAsset[];
    existingPolicies?: ExistingPolicy[];
    compatibleNormalization?: CompatibleNormalization;
    compatibleNormalizationAlreadySelected?: boolean;
  } = {},
) {
  return classifyDocumentOverlap({
    candidate,
    existingAssets: options.existingAssets ?? [
      makeAsset({ canonicalFingerprint: candidate.canonicalFingerprint ?? VEHICLE_FINGERPRINT }),
    ],
    existingPolicies: options.existingPolicies ?? [makePolicy()],
    compatibleNormalization: options.compatibleNormalization,
    compatibleNormalizationAlreadySelected: options.compatibleNormalizationAlreadySelected,
  });
}

describe("classifyDocumentOverlap", () => {
  describe("exact file duplicate", () => {
    it("classifies an exact file duplicate via compatible normalization already selected", () => {
      const result = classify(makeCandidate(), {
        compatibleNormalizationAlreadySelected: true,
        existingPolicies: [],
      });
      expect(result.classification).toBe("exact_file_duplicate");
      expect(result.disposition).toBe("reuse_existing_normalization");
      expect(result.normalizedEntityKey).toBe(VEHICLE_FINGERPRINT);
      expect(result.assetId).toBe(VEHICLE_ASSET_ID);
      expect(result.requiresCustomerDecision).toBe(false);
    });

    it("classifies an exact file duplicate when a complete compatible normalization is provided", () => {
      const result = classify(makeCandidate(), {
        existingPolicies: [],
        compatibleNormalization: {
          normalizationId: "norm-001",
          contentDigest: "digest-candidate",
          normalizationSchemaVersion: "1",
          analyzerVersion: "1",
          status: "complete",
        },
      });
      expect(result.classification).toBe("exact_file_duplicate");
      expect(result.comparedFields).toMatchObject({
        contentDigest: "digest-candidate",
        normalizationSchemaVersion: "1",
        analyzerVersion: "1",
        status: "complete",
      });
    });

    it("does not classify as exact file duplicate when schema version differs", () => {
      const result = classify(makeCandidate(), {
        compatibleNormalization: {
          normalizationId: "norm-001",
          contentDigest: "digest-candidate",
          normalizationSchemaVersion: "2",
          analyzerVersion: "1",
          status: "complete",
        },
      });
      expect(result.classification).toBe("same_asset_same_policy_term");
    });

    it("does not classify as exact file duplicate when status is not complete", () => {
      const result = classify(makeCandidate(), {
        compatibleNormalization: {
          normalizationId: "norm-001",
          contentDigest: "digest-candidate",
          normalizationSchemaVersion: "1",
          analyzerVersion: "1",
          status: "processing",
        },
      });
      expect(result.classification).toBe("same_asset_same_policy_term");
    });
  });

  describe("same asset, same policy term", () => {
    it("classifies a vehicle with the same policy term", () => {
      const result = classify(makeCandidate());
      expect(result.classification).toBe("same_asset_same_policy_term");
      expect(result.disposition).toBe("attach_supporting_evidence");
      expect(result.assetId).toBe(VEHICLE_ASSET_ID);
      expect(result.assetType).toBe("vehicle");
      expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
      expect(result.normalizedEntityKey).toBe(VEHICLE_FINGERPRINT);
      expect(result.requiresCustomerDecision).toBe(false);
    });

    it("classifies a property with the same policy term", () => {
      const result = classify(
        makeCandidate({
          assetType: "property",
          canonicalFingerprint: PROPERTY_FINGERPRINT,
          documentType: "current_property_policy",
          coverageFacts: {
            "policy.annualPremiumCents": known(90000),
            "property.dwellingLimitCents": known(45000000),
            "property.personalLiabilityLimitCents": known(100000000),
            "property.baseDeductibleCents": known(100000),
          },
        }),
        {
          existingAssets: [
            makeAsset({
              id: PROPERTY_ASSET_ID,
              assetType: "property",
              canonicalFingerprint: PROPERTY_FINGERPRINT,
            }),
          ],
          existingPolicies: [
            makePolicy({
              id: PROPERTY_POLICY_ID,
              assetId: PROPERTY_ASSET_ID,
              assetType: "property",
              annualPremiumCents: 90000,
              coverageFacts: {
                "policy.annualPremiumCents": known(90000),
                "property.dwellingLimitCents": known(45000000),
                "property.personalLiabilityLimitCents": known(100000000),
                "property.baseDeductibleCents": known(100000),
              },
            }),
          ],
        },
      );
      expect(result.classification).toBe("same_asset_same_policy_term");
      expect(result.disposition).toBe("attach_supporting_evidence");
      expect(result.assetId).toBe(PROPERTY_ASSET_ID);
      expect(result.normalizedEntityKey).toBe(PROPERTY_FINGERPRINT);
    });

    it("does not classify a principal document as supporting evidence", () => {
      const result = classify(makeCandidate());
      expect(result.classification).not.toBe("same_asset_supporting_document");
    });
  });

  describe("renewal (same_asset_newer_policy_term)", () => {
    it("classifies a later vehicle policy term as a renewal", () => {
      const result = classify(
        makeCandidate({ effectiveDate: "2026-01-01", expiryDate: "2027-01-01" }),
        {
          existingPolicies: [makePolicy({ effectiveDate: "2025-01-01", expiryDate: "2026-01-01" })],
        },
      );
      expect(result.classification).toBe("same_asset_newer_policy_term");
      expect(result.disposition).toBe("create_renewal_candidate");
      expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
      expect(result.assetId).toBe(VEHICLE_ASSET_ID);
    });

    it("classifies a later property policy term as a renewal", () => {
      const result = classify(
        makeCandidate({
          assetType: "property",
          canonicalFingerprint: PROPERTY_FINGERPRINT,
          documentType: "current_property_policy",
          effectiveDate: "2026-01-01",
          expiryDate: "2027-01-01",
          coverageFacts: {
            "policy.annualPremiumCents": known(90000),
            "property.dwellingLimitCents": known(45000000),
          },
        }),
        {
          existingAssets: [
            makeAsset({
              id: PROPERTY_ASSET_ID,
              assetType: "property",
              canonicalFingerprint: PROPERTY_FINGERPRINT,
            }),
          ],
          existingPolicies: [
            makePolicy({
              id: PROPERTY_POLICY_ID,
              assetId: PROPERTY_ASSET_ID,
              assetType: "property",
              effectiveDate: "2025-01-01",
              expiryDate: "2026-01-01",
              annualPremiumCents: 90000,
              coverageFacts: {
                "policy.annualPremiumCents": known(90000),
                "property.dwellingLimitCents": known(45000000),
              },
            }),
          ],
        },
      );
      expect(result.classification).toBe("same_asset_newer_policy_term");
      expect(result.disposition).toBe("create_renewal_candidate");
      expect(result.assetId).toBe(PROPERTY_ASSET_ID);
      expect(result.existingPolicyId).toBe(PROPERTY_POLICY_ID);
    });
  });

  describe("supporting document", () => {
    it("classifies a vehicle proof of insurance as supporting evidence", () => {
      const result = classify(makeCandidate({ documentType: "proof_of_insurance" }));
      expect(result.classification).toBe("same_asset_supporting_document");
      expect(result.disposition).toBe("attach_supporting_evidence");
      expect(result.assetId).toBe(VEHICLE_ASSET_ID);
      expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
      expect(result.requiresCustomerDecision).toBe(false);
    });

    it("classifies a property signed authorization as supporting evidence", () => {
      const result = classify(
        makeCandidate({
          assetType: "property",
          canonicalFingerprint: PROPERTY_FINGERPRINT,
          documentType: "signed_authorization",
          coverageFacts: {
            "policy.annualPremiumCents": known(90000),
          },
        }),
        {
          existingAssets: [
            makeAsset({
              id: PROPERTY_ASSET_ID,
              assetType: "property",
              canonicalFingerprint: PROPERTY_FINGERPRINT,
            }),
          ],
          existingPolicies: [
            makePolicy({
              id: PROPERTY_POLICY_ID,
              assetId: PROPERTY_ASSET_ID,
              assetType: "property",
              annualPremiumCents: 90000,
              coverageFacts: {
                "policy.annualPremiumCents": known(90000),
              },
            }),
          ],
        },
      );
      expect(result.classification).toBe("same_asset_supporting_document");
      expect(result.assetId).toBe(PROPERTY_ASSET_ID);
    });

    it("supports a supporting document for an exact asset with no prior policy", () => {
      const result = classify(makeCandidate({ documentType: "proof_of_insurance" }), {
        existingPolicies: [],
      });
      expect(result.classification).toBe("same_asset_supporting_document");
      expect(result.assetId).toBe(VEHICLE_ASSET_ID);
      expect(result.existingPolicyId).toBeUndefined();
    });
  });

  describe("conflicting information", () => {
    it("classifies a premium conflict as a conflict review", () => {
      const result = classify(
        makeCandidate({
          coverageFacts: {
            "policy.annualPremiumCents": known(130000),
            "vehicle.thirdPartyLiabilityLimitCents": known(200000000),
            "vehicle.comprehensiveIncluded": known(true),
            "vehicle.collisionIncluded": known(true),
          },
        }),
        {
          existingPolicies: [makePolicy()],
        },
      );
      expect(result.classification).toBe("same_asset_conflicting_information");
      expect(result.disposition).toBe("create_conflict_review");
      expect(result.requiresCustomerDecision).toBe(true);
      expect(result.assetId).toBe(VEHICLE_ASSET_ID);
      expect(
        Object.keys((result.comparedFields as { conflicts: Record<string, unknown> }).conflicts),
      ).toContain("policy.annualPremiumCents");
    });

    it("classifies a vehicle coverage limit conflict as a conflict review", () => {
      const result = classify(
        makeCandidate({
          coverageFacts: {
            "policy.annualPremiumCents": known(120000),
            "vehicle.thirdPartyLiabilityLimitCents": known(1000000000),
            "vehicle.comprehensiveIncluded": known(true),
            "vehicle.collisionIncluded": known(true),
          },
        }),
        {
          existingPolicies: [makePolicy()],
        },
      );
      expect(result.classification).toBe("same_asset_conflicting_information");
      expect(
        Object.keys((result.comparedFields as { conflicts: Record<string, unknown> }).conflicts),
      ).toContain("vehicle.thirdPartyLiabilityLimitCents");
    });

    it("classifies same VIN with different insurer and policy number as conflict review", () => {
      const result = classify(
        makeCandidate({ insurer: "Intact Insurance", policyNumber: "POL-99999" }),
      );
      expect(result.classification).toBe("same_asset_conflicting_information");
      expect(result.disposition).toBe("create_conflict_review");
      expect(result.assetId).toBe(VEHICLE_ASSET_ID);
      expect(result.requiresCustomerDecision).toBe(true);
    });

    it("classifies same property with a changed insurer as conflict review", () => {
      const result = classify(
        makeCandidate({
          assetType: "property",
          canonicalFingerprint: PROPERTY_FINGERPRINT,
          documentType: "current_property_policy",
          insurer: "Intact Insurance",
          policyNumber: "PROPERTY-999",
          coverageFacts: {
            "policy.annualPremiumCents": known(90000),
          },
        }),
        {
          existingAssets: [
            makeAsset({
              id: PROPERTY_ASSET_ID,
              assetType: "property",
              canonicalFingerprint: PROPERTY_FINGERPRINT,
            }),
          ],
          existingPolicies: [
            makePolicy({
              id: PROPERTY_POLICY_ID,
              assetId: PROPERTY_ASSET_ID,
              assetType: "property",
              annualPremiumCents: 90000,
              coverageFacts: {
                "policy.annualPremiumCents": known(90000),
              },
            }),
          ],
        },
      );
      expect(result.classification).toBe("same_asset_conflicting_information");
      expect(result.assetId).toBe(PROPERTY_ASSET_ID);
    });

    it("classifies same asset with missing policy number as conflict review", () => {
      const result = classify(makeCandidate({ policyNumber: null }));
      expect(result.classification).toBe("same_asset_conflicting_information");
      expect(result.disposition).toBe("create_conflict_review");
      expect(result.assetId).toBe(VEHICLE_ASSET_ID);
      expect(result.requiresCustomerDecision).toBe(true);
    });

    it("classifies same asset with invalid policy dates as conflict review", () => {
      const result = classify(
        makeCandidate({ effectiveDate: "not-a-date", expiryDate: "2025-01-01" }),
        {
          existingPolicies: [],
        },
      );
      expect(result.classification).toBe("same_asset_conflicting_information");
      expect(result.assetId).toBe(VEHICLE_ASSET_ID);
      expect(result.requiresCustomerDecision).toBe(true);
    });

    it("classifies same asset with expiry before effective as conflict review", () => {
      const result = classify(
        makeCandidate({ effectiveDate: "2025-01-01", expiryDate: "2024-01-01" }),
      );
      expect(result.classification).toBe("same_asset_conflicting_information");
      expect(result.requiresCustomerDecision).toBe(true);
    });
  });

  describe("canonical value state comparison", () => {
    it("does not conflict when both facts are known and equal", () => {
      const result = classify(makeCandidate());
      expect(result.classification).toBe("same_asset_same_policy_term");
    });

    it("treats known versus not_included as a material conflict", () => {
      const result = classify(
        makeCandidate({
          coverageFacts: {
            "policy.annualPremiumCents": known(120000),
            "vehicle.comprehensiveIncluded": known(true),
          },
        }),
        {
          existingPolicies: [
            makePolicy({
              coverageFacts: {
                "policy.annualPremiumCents": known(120000),
                "vehicle.comprehensiveIncluded": notIncluded(),
              },
            }),
          ],
        },
      );
      expect(result.classification).toBe("same_asset_conflicting_information");
      expect(
        Object.keys((result.comparedFields as { conflicts: Record<string, unknown> }).conflicts),
      ).toContain("vehicle.comprehensiveIncluded");
    });

    it("does not treat known versus unknown as a material conflict", () => {
      const result = classify(
        makeCandidate({
          coverageFacts: {
            "policy.annualPremiumCents": known(120000),
            "vehicle.comprehensiveIncluded": known(true),
          },
        }),
        {
          existingPolicies: [
            makePolicy({
              coverageFacts: {
                "policy.annualPremiumCents": known(120000),
                "vehicle.comprehensiveIncluded": unknown(),
              },
            }),
          ],
        },
      );
      expect(result.classification).toBe("same_asset_same_policy_term");
    });

    it("requires review when the candidate fact state is conflicting", () => {
      const result = classify(
        makeCandidate({
          coverageFacts: {
            "policy.annualPremiumCents": known(120000),
            "vehicle.comprehensiveIncluded": conflicting(),
          },
        }),
      );
      expect(result.classification).toBe("same_asset_conflicting_information");
      expect(result.requiresCustomerDecision).toBe(true);
    });

    it("requires review when the existing fact state is conflicting", () => {
      const result = classify(
        makeCandidate({
          coverageFacts: {
            "policy.annualPremiumCents": known(120000),
            "vehicle.comprehensiveIncluded": known(true),
          },
        }),
        {
          existingPolicies: [
            makePolicy({
              coverageFacts: {
                "policy.annualPremiumCents": known(120000),
                "vehicle.comprehensiveIncluded": conflicting(),
              },
            }),
          ],
        },
      );
      expect(result.classification).toBe("same_asset_conflicting_information");
      expect(result.requiresCustomerDecision).toBe(true);
    });
  });

  describe("possible asset match and new asset", () => {
    it("classifies a provisional fingerprint match as possible match", () => {
      const result = classify(
        makeCandidate({ canonicalFingerprint: null, provisionalFingerprint: VEHICLE_PROVISIONAL }),
        {
          existingAssets: [
            makeAsset({ canonicalFingerprint: null, provisionalFingerprint: VEHICLE_PROVISIONAL }),
          ],
        },
      );
      expect(result.classification).toBe("possible_asset_match");
      expect(result.disposition).toBe("require_asset_match_confirmation");
      expect(result.assetId).toBe(VEHICLE_ASSET_ID);
      expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
      expect(result.normalizedEntityKey).toBe(VEHICLE_PROVISIONAL);
      expect(result.requiresCustomerDecision).toBe(true);
    });

    it("classifies a new asset with no credible match", () => {
      const result = classify(
        makeCandidate({ canonicalFingerprint: VEHICLE2_FINGERPRINT, policyNumber: "NEW-99999" }),
        {
          existingAssets: [],
          existingPolicies: [],
        },
      );
      expect(result.classification).toBe("new_asset");
      expect(result.disposition).toBe("create_new_asset_candidate");
      expect(result.assetId).toBeUndefined();
      expect(result.normalizedEntityKey).toBe(VEHICLE2_FINGERPRINT);
    });

    it("classifies a policy number match on a different asset as possible match", () => {
      const result = classify(
        makeCandidate({
          canonicalFingerprint: VEHICLE2_FINGERPRINT,
          policyNumber: POLICY_NUMBER,
        }),
        {
          existingAssets: [makeAsset()],
          existingPolicies: [makePolicy()],
        },
      );
      expect(result.classification).toBe("possible_asset_match");
      expect(result.disposition).toBe("require_asset_match_confirmation");
      expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
      expect(result.assetId).toBeUndefined();
    });
  });

  describe("deterministic policy ranking", () => {
    it("selects the same policy regardless of input order (renewal)", () => {
      const historical = makePolicy({
        id: VEHICLE_HISTORICAL_POLICY_ID,
        effectiveDate: "2024-01-01",
        expiryDate: "2025-01-01",
        isCurrent: false,
      });
      const current = makePolicy({
        id: VEHICLE_POLICY_ID,
        effectiveDate: "2025-01-01",
        expiryDate: "2026-01-01",
        isCurrent: true,
      });
      const renewal = makeCandidate({ effectiveDate: "2026-01-01", expiryDate: "2027-01-01" });

      const resultA = classify(renewal, { existingPolicies: [historical, current] });
      const resultB = classify(renewal, { existingPolicies: [current, historical] });

      expect(resultA.existingPolicyId).toBe(VEHICLE_POLICY_ID);
      expect(resultB.existingPolicyId).toBe(VEHICLE_POLICY_ID);
      expect(resultA.classification).toBe("same_asset_newer_policy_term");
      expect(resultB.classification).toBe("same_asset_newer_policy_term");
    });

    it("ranks an exact historical term above a non-exact current term", () => {
      const historical = makePolicy({
        id: VEHICLE_HISTORICAL_POLICY_ID,
        effectiveDate: "2024-01-01",
        expiryDate: "2025-01-01",
        isCurrent: false,
      });
      const current = makePolicy({
        id: VEHICLE_POLICY_ID,
        effectiveDate: "2025-01-01",
        expiryDate: "2026-01-01",
        isCurrent: true,
      });
      const exactHistoricalCandidate = makeCandidate({
        effectiveDate: "2024-01-01",
        expiryDate: "2025-01-01",
      });

      const resultA = classify(exactHistoricalCandidate, {
        existingPolicies: [historical, current],
      });
      const resultB = classify(exactHistoricalCandidate, {
        existingPolicies: [current, historical],
      });

      expect(resultA.existingPolicyId).toBe(VEHICLE_HISTORICAL_POLICY_ID);
      expect(resultB.existingPolicyId).toBe(VEHICLE_HISTORICAL_POLICY_ID);
      expect(resultA.classification).toBe("same_asset_same_policy_term");
      expect(resultB.classification).toBe("same_asset_same_policy_term");
    });
  });

  describe("normalized entity key stability", () => {
    it("uses the canonical fingerprint without prepending the asset type", () => {
      const result = classify(makeCandidate({ assetType: "vehicle" }));
      expect(result.normalizedEntityKey).toBe(VEHICLE_FINGERPRINT);
      expect(result.normalizedEntityKey.startsWith("vehicle:vehicle:")).toBe(false);
    });

    it("produces stable keys when the content digest changes", () => {
      const a = classify(makeCandidate({ contentDigest: "digest-a" }), { existingPolicies: [] });
      const b = classify(makeCandidate({ contentDigest: "digest-b" }), { existingPolicies: [] });
      expect(a.normalizedEntityKey).toBe(VEHICLE_FINGERPRINT);
      expect(b.normalizedEntityKey).toBe(VEHICLE_FINGERPRINT);
    });

    it("produces stable classification when coverage fact order changes", () => {
      const ordered = makeCandidate({
        coverageFacts: {
          "policy.annualPremiumCents": known(120000),
          "vehicle.thirdPartyLiabilityLimitCents": known(200000000),
          "vehicle.comprehensiveIncluded": known(true),
          "vehicle.collisionIncluded": known(true),
        },
      });
      const reversed = makeCandidate({
        coverageFacts: {
          "vehicle.collisionIncluded": known(true),
          "vehicle.comprehensiveIncluded": known(true),
          "vehicle.thirdPartyLiabilityLimitCents": known(200000000),
          "policy.annualPremiumCents": known(120000),
        },
      });

      const resultA = classify(ordered);
      const resultB = classify(reversed);
      expect(resultA.classification).toBe(resultB.classification);
      expect(resultA.normalizedEntityKey).toBe(resultB.normalizedEntityKey);
    });

    it("treats equivalent insurer formatting as the same identity", () => {
      const result = classify(makeCandidate({ insurer: "td insurance" }));
      expect(result.classification).toBe("same_asset_same_policy_term");
    });
  });

  describe("integration-shaped contract tests", () => {
    it("adapts a PR #22 vehicle normalized entity payload into an OverlapCandidate", () => {
      const payload: NormalizedEntityPayload = {
        temporaryId: "entity-temp-1",
        canonicalFingerprint: VEHICLE_FINGERPRINT,
        candidateIdentity: {
          exactIdentityFingerprint: VEHICLE_FINGERPRINT,
          provisionalCandidateKey: VEHICLE_PROVISIONAL,
        },
        identity: {
          vin: "JTMB1RFV8MD067001",
          year: 2020,
          make: "TOYOTA",
          model: "RAV4",
        },
        currentPolicy: {
          insurer: INSURER,
          policyNumber: POLICY_NUMBER,
          effectiveDate: EFFECTIVE_DATE,
          expiryDate: EXPIRY_DATE,
          annualPremiumCents: 120000,
        },
        currentCoverage: {
          "vehicle.thirdPartyLiabilityLimitCents": known(200000000),
          "vehicle.comprehensiveIncluded": known(true),
          "vehicle.collisionIncluded": known(true),
        },
        resolution: { status: "new" },
        mandateSuggestions: {},
        evidence: [],
        entityType: "vehicle",
        documentCategory: "current_auto_policy",
      };

      const candidate = adaptNormalizedEntityToOverlapCandidate("digest-vehicle", payload);
      expect(candidate.assetType).toBe("vehicle");
      expect(candidate.canonicalFingerprint).toBe(VEHICLE_FINGERPRINT);
      expect(candidate.documentType).toBe("current_auto_policy");
      expect(candidate.coverageFacts!["vehicle.thirdPartyLiabilityLimitCents"]).toEqual(
        known(200000000),
      );
      expect(candidate.coverageFacts!["policy.annualPremiumCents"]).toEqual(known(120000));
    });

    it("adapts a PR #22 property normalized entity payload into an OverlapCandidate", () => {
      const payload: NormalizedEntityPayload = {
        canonicalFingerprint: PROPERTY_FINGERPRINT,
        identity: {
          fullAddress: "128 LARCHWOOD CRES NW",
          city: "CALGARY",
          province: "AB",
          postalCode: "T3B0C4",
          occupancy: "principal_residence",
        },
        currentPolicy: {
          insurer: INSURER,
          policyNumber: POLICY_NUMBER,
          effectiveDate: EFFECTIVE_DATE,
          expiryDate: EXPIRY_DATE,
          annualPremiumCents: 90000,
        },
        currentCoverage: {
          "property.dwellingLimitCents": known(45000000),
          "property.personalLiabilityLimitCents": known(100000000),
          "property.baseDeductibleCents": known(100000),
        },
        entityType: "property",
        documentCategory: "current_property_policy",
      };

      const candidate = adaptNormalizedEntityToOverlapCandidate("digest-property", payload);
      expect(candidate.assetType).toBe("property");
      expect(candidate.canonicalFingerprint).toBe(PROPERTY_FINGERPRINT);
      expect(candidate.documentType).toBe("current_property_policy");
      expect(candidate.coverageFacts!["property.dwellingLimitCents"]).toEqual(known(45000000));
      expect(candidate.coverageFacts!["policy.annualPremiumCents"]).toEqual(known(90000));
    });

    it("adapts current and historical policy rows into ExistingPolicy", () => {
      const historical: PolicyRow = {
        id: VEHICLE_HISTORICAL_POLICY_ID,
        asset_id: VEHICLE_ASSET_ID,
        asset_type: "vehicle",
        is_current: false,
        effective_from: "2024-01-01",
        effective_to: "2025-01-01",
        insurer_name: INSURER,
        policy_number: POLICY_NUMBER,
        annual_premium_cents: 110000,
        coverage_details: {
          "vehicle.thirdPartyLiabilityLimitCents": known(200000000),
        },
      };
      const adapted = adaptPolicyRowToExistingPolicy(historical);
      expect(adapted.id).toBe(VEHICLE_HISTORICAL_POLICY_ID);
      expect(adapted.assetId).toBe(VEHICLE_ASSET_ID);
      expect(adapted.assetType).toBe("vehicle");
      expect(adapted.isCurrent).toBe(false);
      expect(adapted.effectiveDate).toBe("2024-01-01");
      expect(adapted.expiryDate).toBe("2025-01-01");
      expect(adapted.annualPremiumCents).toBe(110000);
      expect(adapted.coverageFacts!["policy.annualPremiumCents"]).toEqual(known(110000));
    });

    it("produces args that can be passed to record_document_asset_overlap_v1", () => {
      const result = classify(makeCandidate());
      const args = toRecordDocumentAssetOverlapArgs(result, {
        batchId: "batch-001",
        normalizationId: "norm-001",
      });

      expect(args.p_batch_id).toBe("batch-001");
      expect(args.p_normalization_id).toBe("norm-001");
      expect(args.p_normalized_entity_key).toBe(VEHICLE_FINGERPRINT);
      expect(args.p_asset_id).toBe(VEHICLE_ASSET_ID);
      expect(args.p_asset_type).toBe("vehicle");
      expect(args.p_existing_policy_id).toBe(VEHICLE_POLICY_ID);
      expect(args.p_classification).toBe(result.classification);
      expect(typeof args.p_confidence).toBe("number");
      expect(args.p_details_json).toEqual(result.comparedFields);
      expect(Object.keys(args).sort()).toEqual(
        [
          "p_asset_id",
          "p_asset_type",
          "p_batch_id",
          "p_classification",
          "p_confidence",
          "p_details_json",
          "p_existing_policy_id",
          "p_normalization_id",
          "p_normalized_entity_key",
        ].sort(),
      );
    });

    it("overlap classifications exactly match the database enum", () => {
      const migrationPath = new URL(
        "../../../supabase/migrations/20260804200016_document_normalizations_batch_supersession_and_overlap.sql",
        import.meta.url,
      );
      const migration = readFileSync(migrationPath, "utf8");
      const match = migration.match(
        /create type document_asset_overlap_classification as enum\s*\(([\s\S]*?)\)/i,
      );
      expect(match).toBeTruthy();
      const values = (match![1] as string).match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
      expect(values.slice().sort()).toEqual([...OVERLAP_CLASSIFICATIONS].sort());
    });

    it("does not leak candidate state or customer correction into normalized truth", () => {
      const payload: NormalizedEntityPayload = {
        temporaryId: "temp-1",
        canonicalFingerprint: VEHICLE_FINGERPRINT,
        candidateIdentity: {
          exactIdentityFingerprint: "vehicle:vin:WRONG",
          provisionalCandidateKey: "wrong-hint",
        },
        currentPolicy: {
          insurer: INSURER,
          policyNumber: POLICY_NUMBER,
          effectiveDate: EFFECTIVE_DATE,
          expiryDate: EXPIRY_DATE,
          annualPremiumCents: 120000,
        },
        currentCoverage: {
          "vehicle.thirdPartyLiabilityLimitCents": known(200000000),
        },
        resolution: { status: "matches_existing", matchedExistingEntityId: "other-asset" },
        draftDecision: "approve_new",
        mandateSuggestions: {},
        evidence: [],
        entityType: "vehicle",
        documentCategory: "current_auto_policy",
      };

      const candidate = adaptNormalizedEntityToOverlapCandidate("digest", payload);
      expect(candidate).not.toHaveProperty("candidateIdentity");
      expect(candidate).not.toHaveProperty("resolution");
      expect(candidate).not.toHaveProperty("draftDecision");
      expect(candidate.canonicalFingerprint).toBe(VEHICLE_FINGERPRINT);
      expect(candidate.documentType).toBe("current_auto_policy");
    });
  });
});
