import { describe, expect, it } from "vitest";
import {
  classifyDocumentOverlap,
  type CompletedNormalization,
  type ExistingAsset,
  type ExistingPolicy,
  type OverlapCandidate,
} from "../src/document-overlap-classifier.ts";

const VEHICLE_ASSET_ID = "22000000-0000-0000-0000-000000000001";
const VEHICLE_FINGERPRINT = "vehicle:vin:JTMB1RFV8MD067001";
const VEHICLE_PROVISIONAL = "vehicle-hint:2020|TOYOTA|RAV4|";
const VEHICLE2_FINGERPRINT = "vehicle:vin:2HGFC2F59HH567002";
const VEHICLE_POLICY_ID = "vehicle-policy-001";

const PROPERTY_ASSET_ID = "23000000-0000-0000-0000-000000000001";
const PROPERTY_FINGERPRINT = "property:|128 LARCHWOOD CRES NW|CALGARY|AB|T3B0C4";
const PROPERTY_PROVISIONAL = "property-hint:T3B0C4:principal_residence";
const PROPERTY2_FINGERPRINT = "property:|999 OTHER ST|CALGARY|AB|T3B0C4";
const PROPERTY_POLICY_ID = "property-policy-001";

const INSURER = "TD Insurance";
const POLICY_NUMBER = "POL-12345";
const EFFECTIVE_DATE = "2025-01-01";
const EXPIRY_DATE = "2026-01-01";

describe("vehicle overlap classifier", () => {
  const asset: ExistingAsset = {
    id: VEHICLE_ASSET_ID,
    assetType: "vehicle",
    canonicalFingerprint: VEHICLE_FINGERPRINT,
    provisionalFingerprint: VEHICLE_PROVISIONAL,
  };

  const basePolicy: ExistingPolicy = {
    id: VEHICLE_POLICY_ID,
    assetId: VEHICLE_ASSET_ID,
    assetType: "vehicle",
    insurerName: INSURER,
    policyNumber: POLICY_NUMBER,
    effectiveDate: EFFECTIVE_DATE,
    expiryDate: EXPIRY_DATE,
    annualPremiumCents: 120000,
    coverageFacts: {
      liability_limit_cents: 100000000,
      collision_deductible_cents: 50000,
      comprehensive_deductible_cents: 25000,
    },
  };

  function candidate(overrides: Partial<OverlapCandidate> = {}): OverlapCandidate {
    return {
      contentDigest: "digest-vehicle-001",
      assetType: "vehicle",
      canonicalFingerprint: VEHICLE_FINGERPRINT,
      provisionalFingerprint: null,
      insurer: INSURER,
      policyNumber: POLICY_NUMBER,
      effectiveDate: EFFECTIVE_DATE,
      expiryDate: EXPIRY_DATE,
      documentType: "insurance_certificate",
      coverageFacts: {
        liability_limit_cents: 100000000,
        collision_deductible_cents: 50000,
        comprehensive_deductible_cents: 25000,
        annual_premium_cents: 120000,
      },
      ...overrides,
    };
  }

  it("classifies exact file duplicate", () => {
    const prior: CompletedNormalization = {
      contentDigest: "digest-vehicle-001",
      normalizedEntityKey: `vehicle:${VEHICLE_FINGERPRINT}`,
      assetId: VEHICLE_ASSET_ID,
      assetType: "vehicle",
    };
    const result = classifyDocumentOverlap({
      candidate: candidate(),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
      priorCompletedNormalizations: [prior],
    });
    expect(result.classification).toBe("exact_file_duplicate");
    expect(result.normalizedEntityKey).toBe(prior.normalizedEntityKey);
    expect(result.assetId).toBe(VEHICLE_ASSET_ID);
    expect(result.requiresCustomerReview).toBe(false);
  });

  it("classifies same asset, same policy term", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate(),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_same_policy_term");
    expect(result.assetId).toBe(VEHICLE_ASSET_ID);
    expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.requiresCustomerReview).toBe(false);
  });

  it("classifies renewal with later expiry", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({ expiryDate: "2027-01-01" }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_newer_policy_term");
    expect(result.assetId).toBe(VEHICLE_ASSET_ID);
    expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
    expect(result.requiresCustomerReview).toBe(false);
  });

  it("classifies endorsement as supporting document", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({ documentType: "endorsement" }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_supporting_document");
    expect(result.assetId).toBe(VEHICLE_ASSET_ID);
    expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
    expect(result.requiresCustomerReview).toBe(false);
  });

  it("classifies premium conflict", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        coverageFacts: {
          liability_limit_cents: 100000000,
          collision_deductible_cents: 50000,
          comprehensive_deductible_cents: 25000,
          annual_premium_cents: 130000,
        },
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_conflicting_information");
    expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
    expect(result.comparedFields).toHaveProperty(["conflicts", "annual_premium_cents"]);
    expect(result.requiresCustomerReview).toBe(true);
  });

  it("classifies coverage-limit conflict", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        coverageFacts: {
          liability_limit_cents: 200000000,
          collision_deductible_cents: 50000,
          comprehensive_deductible_cents: 25000,
          annual_premium_cents: 120000,
        },
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_conflicting_information");
    expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
    expect(result.comparedFields).toHaveProperty(["conflicts", "liability_limit_cents"]);
    expect(result.requiresCustomerReview).toBe(true);
  });

  it("classifies possible identity match from provisional fingerprint", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        contentDigest: "digest-vehicle-007",
        canonicalFingerprint: null,
        provisionalFingerprint: VEHICLE_PROVISIONAL,
        policyNumber: "POL-UNKNOWN",
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("possible_asset_match");
    expect(result.assetId).toBe(VEHICLE_ASSET_ID);
    expect(result.requiresCustomerReview).toBe(true);
  });

  it("classifies new asset", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        contentDigest: "digest-vehicle-008",
        canonicalFingerprint: VEHICLE2_FINGERPRINT,
        policyNumber: "POL-NEW-999",
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("new_asset");
    expect(result.assetId).toBeUndefined();
    expect(result.requiresCustomerReview).toBe(false);
  });

  it("classifies invalid or missing dates as supporting evidence", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        effectiveDate: "not-a-date",
        expiryDate: null,
        documentType: "endorsement",
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_supporting_document");
    expect(result.assetId).toBe(VEHICLE_ASSET_ID);
    expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
  });

  it("classifies same policy number on a different asset as possible match", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        contentDigest: "digest-vehicle-010",
        canonicalFingerprint: VEHICLE2_FINGERPRINT,
        provisionalFingerprint: null,
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("possible_asset_match");
    expect(result.assetId).toBeUndefined();
    expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
    expect(result.requiresCustomerReview).toBe(true);
  });

  it("classifies same asset with a different insurer as conflicting information", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({ insurer: "Intact Insurance" }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_conflicting_information");
    expect(result.assetId).toBe(VEHICLE_ASSET_ID);
    expect(result.existingPolicyId).toBe(VEHICLE_POLICY_ID);
    expect(result.requiresCustomerReview).toBe(true);
  });
});

describe("property overlap classifier", () => {
  const asset: ExistingAsset = {
    id: PROPERTY_ASSET_ID,
    assetType: "property",
    canonicalFingerprint: PROPERTY_FINGERPRINT,
    provisionalFingerprint: PROPERTY_PROVISIONAL,
  };

  const basePolicy: ExistingPolicy = {
    id: PROPERTY_POLICY_ID,
    assetId: PROPERTY_ASSET_ID,
    assetType: "property",
    insurerName: INSURER,
    policyNumber: POLICY_NUMBER,
    effectiveDate: EFFECTIVE_DATE,
    expiryDate: EXPIRY_DATE,
    annualPremiumCents: 120000,
    coverageFacts: {
      dwelling_limit_cents: 350000000,
      liability_limit_cents: 100000000,
      base_deductible_cents: 25000,
    },
  };

  function candidate(overrides: Partial<OverlapCandidate> = {}): OverlapCandidate {
    return {
      contentDigest: "digest-property-001",
      assetType: "property",
      canonicalFingerprint: PROPERTY_FINGERPRINT,
      provisionalFingerprint: null,
      insurer: INSURER,
      policyNumber: POLICY_NUMBER,
      effectiveDate: EFFECTIVE_DATE,
      expiryDate: EXPIRY_DATE,
      documentType: "insurance_certificate",
      coverageFacts: {
        dwelling_limit_cents: 350000000,
        liability_limit_cents: 100000000,
        base_deductible_cents: 25000,
        annual_premium_cents: 120000,
      },
      ...overrides,
    };
  }

  it("classifies exact file duplicate", () => {
    const prior: CompletedNormalization = {
      contentDigest: "digest-property-001",
      normalizedEntityKey: `property:${PROPERTY_FINGERPRINT}`,
      assetId: PROPERTY_ASSET_ID,
      assetType: "property",
    };
    const result = classifyDocumentOverlap({
      candidate: candidate(),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
      priorCompletedNormalizations: [prior],
    });
    expect(result.classification).toBe("exact_file_duplicate");
    expect(result.normalizedEntityKey).toBe(prior.normalizedEntityKey);
    expect(result.assetId).toBe(PROPERTY_ASSET_ID);
    expect(result.requiresCustomerReview).toBe(false);
  });

  it("classifies same asset, same policy term", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate(),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_same_policy_term");
    expect(result.assetId).toBe(PROPERTY_ASSET_ID);
    expect(result.existingPolicyId).toBe(PROPERTY_POLICY_ID);
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.requiresCustomerReview).toBe(false);
  });

  it("classifies renewal with later expiry", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({ expiryDate: "2027-01-01" }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_newer_policy_term");
    expect(result.assetId).toBe(PROPERTY_ASSET_ID);
    expect(result.existingPolicyId).toBe(PROPERTY_POLICY_ID);
    expect(result.requiresCustomerReview).toBe(false);
  });

  it("classifies endorsement as supporting document", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({ documentType: "endorsement" }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_supporting_document");
    expect(result.assetId).toBe(PROPERTY_ASSET_ID);
    expect(result.existingPolicyId).toBe(PROPERTY_POLICY_ID);
    expect(result.requiresCustomerReview).toBe(false);
  });

  it("classifies premium conflict", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        coverageFacts: {
          dwelling_limit_cents: 350000000,
          liability_limit_cents: 100000000,
          base_deductible_cents: 25000,
          annual_premium_cents: 130000,
        },
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_conflicting_information");
    expect(result.existingPolicyId).toBe(PROPERTY_POLICY_ID);
    expect(result.comparedFields).toHaveProperty(["conflicts", "annual_premium_cents"]);
    expect(result.requiresCustomerReview).toBe(true);
  });

  it("classifies coverage-limit conflict", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        coverageFacts: {
          dwelling_limit_cents: 400000000,
          liability_limit_cents: 100000000,
          base_deductible_cents: 25000,
          annual_premium_cents: 120000,
        },
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_conflicting_information");
    expect(result.existingPolicyId).toBe(PROPERTY_POLICY_ID);
    expect(result.comparedFields).toHaveProperty(["conflicts", "dwelling_limit_cents"]);
    expect(result.requiresCustomerReview).toBe(true);
  });

  it("classifies possible identity match from provisional fingerprint", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        contentDigest: "digest-property-007",
        canonicalFingerprint: null,
        provisionalFingerprint: PROPERTY_PROVISIONAL,
        policyNumber: "POL-UNKNOWN",
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("possible_asset_match");
    expect(result.assetId).toBe(PROPERTY_ASSET_ID);
    expect(result.requiresCustomerReview).toBe(true);
  });

  it("classifies new asset", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        contentDigest: "digest-property-008",
        canonicalFingerprint: PROPERTY2_FINGERPRINT,
        policyNumber: "POL-NEW-999",
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("new_asset");
    expect(result.assetId).toBeUndefined();
    expect(result.requiresCustomerReview).toBe(false);
  });

  it("classifies invalid or missing dates as supporting evidence", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        effectiveDate: "not-a-date",
        expiryDate: null,
        documentType: "endorsement",
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_supporting_document");
    expect(result.assetId).toBe(PROPERTY_ASSET_ID);
    expect(result.existingPolicyId).toBe(PROPERTY_POLICY_ID);
  });

  it("classifies same policy number on a different asset as possible match", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({
        contentDigest: "digest-property-010",
        canonicalFingerprint: PROPERTY2_FINGERPRINT,
        provisionalFingerprint: null,
      }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("possible_asset_match");
    expect(result.assetId).toBeUndefined();
    expect(result.existingPolicyId).toBe(PROPERTY_POLICY_ID);
    expect(result.requiresCustomerReview).toBe(true);
  });

  it("classifies same asset with a different insurer as conflicting information", () => {
    const result = classifyDocumentOverlap({
      candidate: candidate({ insurer: "Intact Insurance" }),
      existingAssets: [asset],
      existingPolicies: [basePolicy],
    });
    expect(result.classification).toBe("same_asset_conflicting_information");
    expect(result.assetId).toBe(PROPERTY_ASSET_ID);
    expect(result.existingPolicyId).toBe(PROPERTY_POLICY_ID);
    expect(result.requiresCustomerReview).toBe(true);
  });
});
