import { describe, expect, it } from "vitest";
import {
  buildNormalizationPersistencePayload,
  projectNormalizationForCandidateDerivation,
  type NormalizationPersistenceInput,
  type CandidateDerivationProjectionInput,
} from "../src/normalization-projection.ts";

function makeCandidateReviewEntity(): Record<string, unknown> {
  return {
    temporaryId: "entity-1",
    canonicalFingerprint: "fp-1",
    candidateIdentity: {
      exactIdentityFingerprint: "fp-1",
      provisionalCandidateKey: "key-1",
      identityStrength: "exact",
    },
    entityType: "vehicle",
    displayLabel: "2019 Honda Civic",
    identity: { vin: "1234567890ABCDEFG" },
    resolution: { status: "new", confidence: 0.95, reasoning: "New vehicle" },
    currentPolicy: { insurer: "Acme" },
    currentCoverage: {},
    mandateSuggestions: {},
    evidence: [
      {
        documentId: "doc-1",
        pageNumber: 1,
        quotedLabel: "VIN",
        evidenceSummary: "VIN 1234567890ABCDEFG",
      },
    ],
    requiredConfirmations: [],
    draftDecision: "approve_new",
    draftIdentityConfirmed: true,
    customerCorrection: { value: "fixed" },
  };
}

function makeAnalysisResult(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    analysisVersion: "1",
    modelProvider: "gemini",
    modelId: "2.5-flash-lite",
    documents: [
      {
        documentId: "doc-1",
        fileDigest: "a".repeat(64),
        classification: "auto_policy_renewal",
        parserId: "llm:gemini:2.5-flash-lite",
        parserVersion: "schema-1:prompt-1:projection-1:model-1",
        pageCount: 1,
        extractedEntityCount: 1,
      },
    ],
    detectedEntities: [makeCandidateReviewEntity()],
    unresolvedConflicts: [
      {
        fieldPath: "vehicle.vin",
        entityRef: "entity-1",
        assertionIds: ["assert-1", "assert-2"],
        explanation: "Two VIN values found",
        requiresHumanResolution: true,
      },
    ],
    warnings: [],
    ...overrides,
  };
}

describe("buildNormalizationPersistencePayload", () => {
  it("splits an analysis result into normalized JSON fields", () => {
    const input: NormalizationPersistenceInput = {
      policyDocumentId: "policy-1",
      contentSha256: "a".repeat(64),
      normalizationSchemaVersion: "1.0.0",
      analyzerVersion: "gemini-2.5-flash-lite:1.0.0",
      analysisResult: makeAnalysisResult(),
    };

    const payload = buildNormalizationPersistencePayload(input);

    expect(payload.normalizedEntitiesJson).toHaveLength(1);
    expect(payload.conflictsJson).toHaveLength(1);
    expect(payload.evidenceJson).toHaveLength(1);
    expect(payload.classification).toBe("auto_policy_renewal");
    expect(payload.normalizedOutputJson).not.toHaveProperty("detectedEntities");
    expect(payload.normalizedOutputJson).not.toHaveProperty("unresolvedConflicts");
    expect(payload.normalizedOutputJson).toHaveProperty("analysisVersion");
    expect(payload.normalizedOutputJson).toHaveProperty("documents");
  });

  it("strips candidate-review fields before persistence", () => {
    const input: NormalizationPersistenceInput = {
      policyDocumentId: "policy-1",
      contentSha256: "a".repeat(64),
      normalizationSchemaVersion: "1.0.0",
      analyzerVersion: "gemini-2.5-flash-lite:1.0.0",
      analysisResult: makeAnalysisResult(),
    };

    const payload = buildNormalizationPersistencePayload(input);
    const entity = payload.normalizedEntitiesJson[0] as Record<string, unknown>;
    expect(entity).not.toHaveProperty("draftDecision");
    expect(entity).not.toHaveProperty("draftIdentityConfirmed");
    expect(entity).not.toHaveProperty("customerCorrection");
    expect(entity).toHaveProperty("temporaryId");
    expect(entity).toHaveProperty("evidence");
  });

  it("uses an explicit classification when provided", () => {
    const input: NormalizationPersistenceInput = {
      policyDocumentId: "policy-1",
      contentSha256: "a".repeat(64),
      normalizationSchemaVersion: "1.0.0",
      analyzerVersion: "gemini-2.5-flash-lite:1.0.0",
      classification: "home_policy_renewal",
      analysisResult: makeAnalysisResult({ classification: "ignored" } as Record<string, unknown>),
    };
    const payload = buildNormalizationPersistencePayload(input);
    expect(payload.classification).toBe("home_policy_renewal");
  });

  it("does not mutate the input analysis result", () => {
    const analysisResult = makeAnalysisResult();
    const before = JSON.stringify(analysisResult);
    const input: NormalizationPersistenceInput = {
      policyDocumentId: "policy-1",
      contentSha256: "a".repeat(64),
      normalizationSchemaVersion: "1.0.0",
      analyzerVersion: "gemini-2.5-flash-lite:1.0.0",
      analysisResult,
    };
    buildNormalizationPersistencePayload(input);
    expect(JSON.stringify(analysisResult)).toBe(before);
  });
});

describe("projectNormalizationForCandidateDerivation", () => {
  it("projects stored normalization fields for candidate derivation", () => {
    const entity = makeCandidateReviewEntity();
    const input: CandidateDerivationProjectionInput = {
      normalization: {
        normalizedOutput: { analysisVersion: "1" },
        normalizedEntities: [entity],
        conflicts: [{ fieldPath: "vehicle.vin" }],
        evidence: entity.evidence as unknown[],
      },
    };

    const projection = projectNormalizationForCandidateDerivation(input);
    expect(projection.detectedEntities).toHaveLength(1);
    expect(projection.conflicts).toHaveLength(1);
    expect(projection.evidence).toHaveLength(1);
  });

  it("removes candidate-review fields from the normalized projection", () => {
    const entity = makeCandidateReviewEntity();
    const input: CandidateDerivationProjectionInput = {
      normalization: {
        normalizedOutput: {},
        normalizedEntities: [entity],
        conflicts: [],
        evidence: [],
      },
    };

    const projection = projectNormalizationForCandidateDerivation(input);
    const projectedEntity = projection.detectedEntities[0] as Record<string, unknown>;
    expect(projectedEntity).not.toHaveProperty("draftDecision");
    expect(projectedEntity).not.toHaveProperty("draftIdentityConfirmed");
    expect(projectedEntity).not.toHaveProperty("customerCorrection");
    expect(projectedEntity).toHaveProperty("temporaryId");
    expect(projectedEntity).toHaveProperty("evidence");
  });

  it("does not mutate the stored normalization object", () => {
    const entity = makeCandidateReviewEntity();
    const normalization = {
      normalizedOutput: { analysisVersion: "1" },
      normalizedEntities: [entity],
      conflicts: [{ fieldPath: "vehicle.vin" }],
      evidence: [...(entity.evidence as unknown[])],
    };
    const before = JSON.stringify(normalization);

    const projection = projectNormalizationForCandidateDerivation({ normalization });

    expect(JSON.stringify(normalization)).toBe(before);
    projection.detectedEntities[0] = { mutated: true };
    expect(JSON.stringify(normalization)).toBe(before);
  });
});
