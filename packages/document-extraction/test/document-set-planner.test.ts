import { describe, expect, it } from "vitest";
import { planDocumentSetReview } from "../src/document-set-planner";
import type {
  ParsedAssetAssertion,
  ParsedInsuranceDocument,
} from "../src/types";

function asset(
  identityFingerprint: string,
  matchClassification?: ParsedAssetAssertion["matchClassification"],
  assetType: ParsedAssetAssertion["assetType"] = "property",
): ParsedAssetAssertion {
  return {
    assetType,
    identityFingerprint,
    displayLabel: identityFingerprint || "Unidentified asset",
    matchClassification,
    assertions: [],
  };
}

function document(
  assetAssertions: ParsedAssetAssertion[],
  classification: ParsedInsuranceDocument["classification"] =
    "home_policy_renewal",
): ParsedInsuranceDocument {
  return {
    classification,
    assetAssertions,
    policyTerms: [],
    coverageAssertions: [],
    notices: [],
    conflicts: [],
    parserId: "test-parser",
    parserVersion: "1.0.0",
  };
}

describe("planDocumentSetReview", () => {
  it("keeps four distinct uploaded assets independently reviewable", () => {
    const plan = planDocumentSetReview([
      document([asset("property:primary", "new")]),
      document([asset("property:rental-1", "new")]),
      document([asset("property:rental-2", "new")]),
      document(
        [asset("vehicle:vin:jm1cw2cl6d0150001", "new", "vehicle")],
        "auto_policy_renewal",
      ),
    ]);

    expect(plan.candidates.map((candidate) => candidate.candidateId)).toEqual([
      "0:0",
      "1:0",
      "2:0",
      "3:0",
    ]);
    expect(plan.candidates.every((candidate) => !candidate.requiresCustomerConfirmation)).toBe(
      true,
    );
    expect(plan.potentialDuplicateGroups).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it("flags repeated fingerprints without merging their candidates", () => {
    const plan = planDocumentSetReview([
      document([asset("property:123-main-st", "exact_existing_match")]),
      document([asset("property:123-main-st", "new")]),
    ]);

    expect(plan.candidates).toHaveLength(2);
    expect(plan.potentialDuplicateGroups).toEqual([
      {
        identityFingerprint: "property:123-main-st",
        candidateIds: ["0:0", "1:0"],
      },
    ]);
    expect(
      plan.candidates.every(
        (candidate) =>
          candidate.requiresCustomerConfirmation &&
          candidate.confirmationReasons.includes(
            "potential_duplicate_in_upload_set",
          ),
      ),
    ).toBe(true);
    expect(plan.warnings).toContain("potential_duplicate_assets_present");
  });

  it("requires confirmation when identity or match classification is unresolved", () => {
    const plan = planDocumentSetReview([
      document([
        asset("", undefined),
        asset("property:possible", "possible_existing_match"),
        asset(
          "vehicle:descriptive-only",
          "new_identity_confirmation_required",
          "vehicle",
        ),
      ]),
    ]);

    expect(plan.candidates[0]?.confirmationReasons).toEqual([
      "missing_identity_fingerprint",
      "match_classification_missing",
    ]);
    expect(plan.candidates[1]?.confirmationReasons).toEqual([
      "possible_existing_match",
    ]);
    expect(plan.candidates[2]?.confirmationReasons).toEqual([
      "new_identity_confirmation_required",
    ]);
    expect(plan.candidates.every((candidate) => candidate.requiresCustomerConfirmation)).toBe(
      true,
    );
  });

  it("reports unsupported documents and an empty extraction batch", () => {
    const plan = planDocumentSetReview([
      document([], "unsupported"),
      document([], "home_policy_renewal"),
    ]);

    expect(plan.unsupportedDocumentIndexes).toEqual([0]);
    expect(plan.candidates).toEqual([]);
    expect(plan.warnings).toEqual([
      "unsupported_documents_present",
      "no_asset_candidates_found",
    ]);
  });
});
