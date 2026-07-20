import { describe, expect, it } from "vitest";
import {
  buildCandidateMandateValues,
  buildMandateReviewSeeds,
} from "../src/mandate-reconciliation.ts";

describe("mandate reconciliation", () => {
  it("creates one item for each document-informed specification and omits unknown values", () => {
    const seeds = buildMandateReviewSeeds([
      {
        id: "candidate-1",
        asset_type: "vehicle",
        selected_facts_json: {
          currentCoverage: {
            "vehicle.thirdPartyLiabilityLimitCents": {
              status: "known",
              value: 200_000_000,
              confidence: 0.96,
              evidence: [{ documentId: "document-1", pageNumber: 4 }],
            },
            "vehicle.collisionDeductibleCents": {
              status: "unknown",
              value: null,
              confidence: 0,
              evidence: [],
            },
            "vehicle.comprehensiveIncluded": {
              status: "not_included",
              value: null,
              confidence: 0.9,
              evidence: [{ documentId: "document-1", pageNumber: 6 }],
            },
          },
          mandateSuggestions: {
            "vehicle.thirdPartyLiabilityLimitCents": {
              rule: "minimum",
              amountCents: 200_000_000,
            },
          },
        },
      },
    ]);

    expect(seeds).toHaveLength(2);
    expect(seeds.map((seed) => seed.valueState)).toEqual(["absent", "known"]);
    expect(seeds.some((seed) => seed.fieldPath.includes("collisionDeductible"))).toBe(false);
    expect(seeds.find((seed) => seed.valueState === "known")).toMatchObject({
      specificationTitle: "Liability limit",
      sourceDocumentId: "document-1",
      sourcePageNumber: 4,
      documentImpliedMandateValue: { rule: "minimum", amountCents: 200_000_000 },
    });
  });

  it("creates a dedicated material conflict item", () => {
    const seeds = buildMandateReviewSeeds([
      {
        id: "candidate-1",
        asset_type: "property",
        selected_facts_json: {
          currentCoverage: {
            "property.baseDeductibleCents": {
              status: "conflicting",
              value: null,
              confidence: 0.8,
              alternatives: [
                {
                  value: 100_000,
                  evidence: [{ documentId: "document-1", pageNumber: 2 }],
                },
                {
                  value: 250_000,
                  evidence: [{ documentId: "document-2", pageNumber: 3 }],
                },
              ],
              evidence: [{ documentId: "document-1", pageNumber: 2 }],
            },
          },
          mandateSuggestions: {},
        },
        conflicts_json: [
          {
            fieldPath: "property.baseDeductibleCents",
            requiresHumanResolution: true,
            explanation: "Two policy terms show different deductibles.",
            assertionIds: ["a", "b"],
          },
        ],
      },
    ]);

    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({
      valueState: "conflicting",
      materialConflict: true,
      mandatePath: "baseDeductible",
    });
    expect(seeds[0].conflictValues).toHaveLength(2);
    expect(seeds[0].conflictValues[0]).toMatchObject({
      sourceDocumentId: "document-1",
      sourcePageNumber: 2,
      explanation: "Two policy terms show different deductibles.",
    });
  });

  it("builds canonical V2-shaped candidate overrides", () => {
    const values = buildCandidateMandateValues([
      {
        candidateId: "candidate-1",
        mandatePath: "liability",
        currentMandateValue: { rule: "minimum", amountCents: 200_000_000 },
        isComplete: true,
        materialConflict: false,
        action: "keep_current",
      },
      {
        candidateId: "candidate-1",
        mandatePath: "endorsements.family_protection",
        currentMandateValue: "required",
        isComplete: true,
        materialConflict: false,
        action: "use_document_value",
      },
    ]);

    expect(values.get("candidate-1")).toEqual({
      liability: { rule: "minimum", amountCents: 200_000_000 },
      endorsements: { family_protection: "required" },
    });
  });

  it("blocks unresolved material conflicts", () => {
    expect(() =>
      buildCandidateMandateValues([
        {
          candidateId: "candidate-1",
          mandatePath: "baseDeductible",
          currentMandateValue: null,
          isComplete: true,
          materialConflict: true,
          action: "unresolved",
        },
      ]),
    ).toThrow(/must be resolved/);
  });
});
