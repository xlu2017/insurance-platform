import { describe, expect, it } from "vitest";
import {
  buildNormalizationPersistencePayload,
  NormalizationProjectionError,
  projectNormalizationForCandidateDerivation,
  type CandidateDerivationProjection,
  type DocumentNormalizationProjectionInput,
  type NormalizationPersistencePayload,
} from "../src/normalization-projection.ts";
import type {
  AnalyzedDocument,
  DetectedConflict,
  DetectedInsuranceEntity,
  EvidenceReference,
} from "../src/document-analyzer.ts";

function digest(character: string): string {
  return character.repeat(64);
}

const POLICY_DOCUMENT_ID = "doc-policy-1";
const CONTENT_SHA256 = digest("a");

function analyzedDocument(overrides?: Partial<AnalyzedDocument>): AnalyzedDocument {
  return {
    documentId: POLICY_DOCUMENT_ID,
    fileDigest: CONTENT_SHA256,
    classification: "auto_policy_renewal",
    parserId: "llm:gemini:2.5-flash-lite",
    parserVersion: "schema-1:prompt-1:projection-1:model-1",
    pageCount: 1,
    extractedEntityCount: 1,
    ...overrides,
  };
}

function evidenceReference(overrides?: Partial<EvidenceReference>): EvidenceReference {
  return {
    documentId: POLICY_DOCUMENT_ID,
    pageNumber: 1,
    quotedLabel: "VIN",
    evidenceSummary: "VIN 1234567890ABCDEFG",
    ...overrides,
  };
}

function detectedEntity(overrides?: Partial<DetectedInsuranceEntity>): DetectedInsuranceEntity {
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
    identity: {
      vin: "1234567890ABCDEFG",
      year: 2019,
      make: "Honda",
      model: "Civic",
      trim: null,
      vehicleUse: null,
    },
    resolution: {
      status: "new",
      confidence: 0.95,
      reasoning: "New vehicle",
    },
    currentPolicy: { insurer: "Acme" },
    currentCoverage: {},
    mandateSuggestions: {},
    evidence: [evidenceReference()],
    requiredConfirmations: [],
    ...overrides,
  };
}

function detectedConflict(overrides?: Partial<DetectedConflict>): DetectedConflict {
  return {
    fieldPath: "vehicle.vin",
    entityRef: "entity-1",
    assertionIds: ["assert-1", "assert-2"],
    explanation: "Two VIN values found",
    requiresHumanResolution: true,
    ...overrides,
  };
}

function buildInput(
  overrides?: Partial<DocumentNormalizationProjectionInput>,
): DocumentNormalizationProjectionInput {
  return {
    policyDocumentId: POLICY_DOCUMENT_ID,
    contentSha256: CONTENT_SHA256,
    document: analyzedDocument(),
    detectedEntities: [detectedEntity()],
    unresolvedConflicts: [],
    warnings: [],
    modelProvider: "gemini",
    modelId: "2.5-flash-lite",
    ...overrides,
  };
}

function buildPayload(
  overrides?: Partial<DocumentNormalizationProjectionInput>,
): NormalizationPersistencePayload {
  return buildNormalizationPersistencePayload({
    projection: buildInput(overrides),
    normalizationSchemaVersion: "schema-v1",
    analyzerVersion: "analyzer-v1",
  });
}

describe("buildNormalizationPersistencePayload", () => {
  it("rejects a wholesale batch-level analysis result", () => {
    const entity = detectedEntity();
    const secondEntity = {
      ...entity,
      temporaryId: "entity-2",
      evidence: [evidenceReference({ documentId: "doc-policy-2" })],
    };
    expect(() =>
      buildNormalizationPersistencePayload({
        projection: {
          ...buildInput({
            detectedEntities: [entity, secondEntity],
            document: analyzedDocument({ extractedEntityCount: 2 }),
          }),
          policyDocumentId: POLICY_DOCUMENT_ID,
          contentSha256: CONTENT_SHA256,
        },
        normalizationSchemaVersion: "schema-v1",
        analyzerVersion: "analyzer-v1",
      }),
    ).toThrow(NormalizationProjectionError);
  });

  it("rejects a target document that receives entities evidenced by another document", () => {
    const entity = detectedEntity({
      evidence: [evidenceReference({ documentId: "other-document" })],
    });
    expect(() => buildPayload({ detectedEntities: [entity] })).toThrow(
      NormalizationProjectionError,
    );
  });

  it("rejects a policyDocumentId mismatch", () => {
    expect(() =>
      buildPayload({
        policyDocumentId: "wrong-document",
        document: analyzedDocument({ documentId: POLICY_DOCUMENT_ID }),
      }),
    ).toThrow(NormalizationProjectionError);
  });

  it("rejects a contentSha256 mismatch", () => {
    expect(() => buildPayload({ contentSha256: digest("b") })).toThrow(
      NormalizationProjectionError,
    );
  });

  it("rejects an invalid contentSha256", () => {
    expect(() =>
      buildPayload({
        contentSha256: "not-a-digest",
        document: analyzedDocument({ fileDigest: "not-a-digest" }),
      }),
    ).toThrow(NormalizationProjectionError);
  });

  it("rejects a conflict whose entityRef is not in the scoped entities", () => {
    expect(() =>
      buildPayload({ unresolvedConflicts: [detectedConflict({ entityRef: "missing" })] }),
    ).toThrow(NormalizationProjectionError);
  });

  it("rejects malformed entities instead of converting to empty arrays", () => {
    const entity = detectedEntity() as Record<string, unknown>;
    delete entity.displayLabel;
    expect(() =>
      buildNormalizationPersistencePayload({
        projection: buildInput({ detectedEntities: [entity as DetectedInsuranceEntity] }),
        normalizationSchemaVersion: "schema-v1",
        analyzerVersion: "analyzer-v1",
      }),
    ).toThrow(NormalizationProjectionError);
  });

  it("rejects malformed conflicts instead of converting to empty arrays", () => {
    expect(() =>
      buildNormalizationPersistencePayload({
        projection: buildInput({
          unresolvedConflicts: [{ fieldPath: "vehicle.vin" } as DetectedConflict],
        }),
        normalizationSchemaVersion: "schema-v1",
        analyzerVersion: "analyzer-v1",
      }),
    ).toThrow(NormalizationProjectionError);
  });

  it("accepts a canonical InsuranceDocumentAnalysisResult-scoped projection", () => {
    const payload = buildPayload();
    expect(payload.policyDocumentId).toBe(POLICY_DOCUMENT_ID);
    expect(payload.contentSha256).toBe(CONTENT_SHA256);
    expect(payload.normalizationSchemaVersion).toBe("schema-v1");
    expect(payload.analyzerVersion).toBe("analyzer-v1");
    expect(payload.modelProvider).toBe("gemini");
    expect(payload.modelId).toBe("2.5-flash-lite");
    expect(payload.classification).toBe("auto_policy_renewal");
    expect(payload.normalizedOutputJson.document).toEqual(analyzedDocument());
    expect(payload.normalizedEntitiesJson).toHaveLength(1);
    expect(payload.conflictsJson).toEqual([]);
    expect(payload.evidenceJson).toEqual([evidenceReference()]);
  });

  it("retains top-level entity evidence", () => {
    const entityEvidence = evidenceReference({ pageNumber: 2, quotedLabel: "VIN" });
    const payload = buildPayload({
      detectedEntities: [detectedEntity({ evidence: [entityEvidence] })],
    });
    expect(payload.evidenceJson).toEqual([entityEvidence]);
  });

  it("retains coverage-field evidence", () => {
    const coverageEvidence = evidenceReference({ pageNumber: 3, quotedLabel: "Liability limit" });
    const entity = detectedEntity({
      evidence: [],
      currentCoverage: {
        liabilityLimitCents: {
          status: "known",
          value: 1_000_000,
          confidence: 0.9,
          evidence: [coverageEvidence],
        },
      },
    });
    const payload = buildPayload({ detectedEntities: [entity] });
    expect(payload.evidenceJson).toEqual([coverageEvidence]);
  });

  it("retains alternative conflicting-value evidence", () => {
    const altEvidence = evidenceReference({ pageNumber: 4, quotedLabel: "Deductible" });
    const entity = detectedEntity({
      evidence: [],
      currentCoverage: {
        collisionDeductibleCents: {
          status: "conflicting",
          value: null,
          confidence: 0.8,
          alternatives: [
            { value: 500, evidence: [altEvidence], explanation: "First value" },
            { value: 1000, evidence: [altEvidence], explanation: "Second value" },
          ],
        },
      },
    });
    const payload = buildPayload({ detectedEntities: [entity] });
    expect(payload.evidenceJson).toEqual([altEvidence]);
  });

  it("deduplicates evidence deterministically regardless of object-key order", () => {
    const evidence1 = { evidenceSummary: "Value A", documentId: POLICY_DOCUMENT_ID, pageNumber: 1 };
    const evidence2 = { pageNumber: 1, documentId: POLICY_DOCUMENT_ID, evidenceSummary: "Value A" };
    const entity = detectedEntity({
      evidence: [evidence1 as EvidenceReference, evidence2 as EvidenceReference],
      currentCoverage: {},
    });
    const payload = buildPayload({ detectedEntities: [entity] });
    expect(payload.evidenceJson).toHaveLength(1);
  });

  it("does not mutate input objects", () => {
    const input = buildInput();
    const before = JSON.stringify(input);
    buildNormalizationPersistencePayload({
      projection: input,
      normalizationSchemaVersion: "schema-v1",
      analyzerVersion: "analyzer-v1",
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it("rejects candidate-review fields in the input rather than persisting them", () => {
    const entity = detectedEntity({ evidence: [evidenceReference()] });
    (entity as Record<string, unknown>).draftDecision = "approve_new";
    (entity as Record<string, unknown>).customerCorrection = { value: "fixed" };

    expect(() => buildPayload({ detectedEntities: [entity] })).toThrow(
      NormalizationProjectionError,
    );
  });
});

describe("projectNormalizationForCandidateDerivation", () => {
  it("projects stored normalization fields into typed candidate derivation inputs", () => {
    const entity = detectedEntity({ evidence: [evidenceReference()] });
    const conflict = detectedConflict();
    const payload = buildPayload({
      detectedEntities: [entity],
      unresolvedConflicts: [conflict],
    });

    const projection = projectNormalizationForCandidateDerivation({
      normalization: {
        normalizedOutput: payload.normalizedOutputJson,
        normalizedEntities: payload.normalizedEntitiesJson,
        conflicts: payload.conflictsJson,
        evidence: payload.evidenceJson,
      },
    });

    expect(projection.detectedEntities).toHaveLength(1);
    expect(projection.conflicts).toHaveLength(1);
    expect(projection.evidence).toHaveLength(1);
  });

  it("does not mutate the stored normalization object", () => {
    const entity = detectedEntity({ evidence: [evidenceReference()] });
    const payload = buildPayload({ detectedEntities: [entity] });
    const stored = {
      normalizedOutput: payload.normalizedOutputJson,
      normalizedEntities: payload.normalizedEntitiesJson,
      conflicts: payload.conflictsJson,
      evidence: payload.evidenceJson,
    };
    const before = JSON.stringify(stored);

    const projection = projectNormalizationForCandidateDerivation({ normalization: stored });
    (projection as CandidateDerivationProjection).detectedEntities = [];

    expect(JSON.stringify(stored)).toBe(before);
  });

  it("rejects malformed normalized entities instead of coercing to empty arrays", () => {
    expect(() =>
      projectNormalizationForCandidateDerivation({
        normalization: {
          normalizedOutput: {},
          normalizedEntities: [{ notAnEntity: true }],
          conflicts: [],
          evidence: [],
        },
      }),
    ).toThrow(NormalizationProjectionError);
  });

  it("rejects malformed conflicts instead of coercing to empty arrays", () => {
    expect(() =>
      projectNormalizationForCandidateDerivation({
        normalization: {
          normalizedOutput: {},
          normalizedEntities: [],
          conflicts: [{ fieldPath: "vehicle.vin" }],
          evidence: [],
        },
      }),
    ).toThrow(NormalizationProjectionError);
  });

  it("rejects malformed evidence instead of coercing to empty arrays", () => {
    expect(() =>
      projectNormalizationForCandidateDerivation({
        normalization: {
          normalizedOutput: {},
          normalizedEntities: [],
          conflicts: [],
          evidence: [{ documentId: "doc-1" }],
        },
      }),
    ).toThrow(NormalizationProjectionError);
  });
});
