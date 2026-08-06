import { describe, expect, it } from "vitest";
import type { InsuranceDocumentAnalysisResult } from "../src/document-analyzer.ts";
import {
  buildNormalizationPersistencePayload,
  combineAnalysisWithProjectedNormalizations,
  projectNormalizationForCandidateDerivation,
} from "../src/normalization-projection.ts";

const SCHEMA = "1.0.0";
const ANALYZER = "default-v1";

function makeAnalysis(
  overrides: Partial<InsuranceDocumentAnalysisResult> = {},
): InsuranceDocumentAnalysisResult {
  return {
    analysisVersion: "1",
    modelProvider: "test-provider",
    modelId: "test-model",
    promptVersion: "1.0.0",
    outputSchemaVersion: "1.0.0",
    attemptCount: 1,
    providerMetadata: {},
    warnings: [],
    documents: [
      {
        documentId: "pd-1",
        fileDigest: "aa".repeat(32),
        classification: "auto_policy",
        parserId: "test",
        parserVersion: "1",
        pageCount: 1,
        extractedEntityCount: 1,
      },
      {
        documentId: "pd-2",
        fileDigest: "bb".repeat(32),
        classification: "home_policy",
        parserId: "test",
        parserVersion: "1",
        pageCount: 1,
        extractedEntityCount: 1,
      },
    ],
    detectedEntities: [
      {
        temporaryId: "entity-1",
        canonicalFingerprint: "vehicle:vin:1HGCM82633A123456",
        entityType: "vehicle",
        displayLabel: "2018 Honda Civic",
        identity: { vin: "1HGCM82633A123456" },
        candidateIdentity: {
          exactIdentityFingerprint: "vehicle:vin:1HGCM82633A123456",
          provisionalCandidateKey: "vehicle:1HGCM82633A123456",
          identityStrength: "exact",
        },
        currentPolicy: {
          insurer: "Test Insurer",
          policyNumber: "POL-123",
          effectiveDate: "2024-01-01",
          expiryDate: "2025-01-01",
        },
        currentCoverage: {},
        mandateSuggestions: {},
        requiredConfirmations: [],
        resolution: { status: "new", confidence: 0.95, reasoning: "test" },
        evidence: [{ documentId: "pd-1", pageNumber: 1, evidenceSummary: "test" }],
      },
      {
        temporaryId: "entity-2",
        canonicalFingerprint: "property:123 MAIN ST|CALGARY|AB|T1A2B3",
        entityType: "property",
        displayLabel: "123 Main St",
        identity: {
          fullAddress: "123 Main St",
          city: "Calgary",
          province: "AB",
          postalCode: "T1A2B3",
        },
        candidateIdentity: {
          exactIdentityFingerprint: "property:123 Main St|Calgary|AB|T1A2B3",
          provisionalCandidateKey: "property:123-main-st-calgary",
          identityStrength: "exact",
        },
        currentPolicy: {
          insurer: "Test Insurer",
          policyNumber: "POL-456",
          effectiveDate: "2024-02-01",
          expiryDate: "2025-02-01",
        },
        currentCoverage: {},
        mandateSuggestions: {},
        requiredConfirmations: [],
        resolution: { status: "new", confidence: 0.95, reasoning: "test" },
        evidence: [{ documentId: "pd-2", pageNumber: 1, evidenceSummary: "test" }],
      },
    ],
    unresolvedConflicts: [],
    ...overrides,
  };
}

describe("buildNormalizationPersistencePayload", () => {
  it("scopes entities, conflicts, and evidence to the requested document", () => {
    const analysis = makeAnalysis();

    const payload = buildNormalizationPersistencePayload(
      analysis,
      { policyDocumentId: "pd-1", contentSha256: "aa".repeat(32), batchItemId: "bi-1" },
      {
        modelProvider: "test-provider",
        modelId: "test-model",
        promptVersion: "1.0.0",
        schemaVersion: SCHEMA,
        analyzerVersion: ANALYZER,
      },
    );

    expect(payload.policyDocumentId).toBe("pd-1");
    expect(payload.batchItemId).toBe("bi-1");
    expect(payload.contentSha256).toBe("aa".repeat(32));
    expect(payload.normalizedEntitiesJson).toHaveLength(1);
    expect(payload.normalizedEntitiesJson[0].temporaryId).toBe("entity-1");
    expect(payload.normalizedOutputJson.classification).toBe("auto_policy");
    expect((payload.normalizedOutputJson as any).policy.policyNumber).toBe("POL-123");
  });
});

describe("projectNormalizationForCandidateDerivation", () => {
  it("merges multiple normalizations and rewrites evidence to the current document", () => {
    const normalizations = [
      {
        id: "n1",
        policy_document_id: "pd-1",
        policyDocumentId: "pd-1",
        content_sha256: "aa".repeat(32),
        classification: "auto_policy",
        model_provider: "test-provider",
        model_id: "test-model",
        prompt_version: "1.0.0",
        analyzer_version: ANALYZER,
        normalization_schema_version: SCHEMA,
        normalized_output_json: { documentId: "pd-1", policy: { policyNumber: "POL-123" } },
        normalized_entities_json: [
          {
            temporaryId: "entity-1",
            entityType: "vehicle",
            evidence: [{ documentId: "pd-1" }],
          },
        ],
        conflicts_json: [],
        evidence_json: [{ documentId: "pd-1" }],
      },
      {
        id: "n2",
        policy_document_id: "pd-2",
        policyDocumentId: "pd-2",
        content_sha256: "bb".repeat(32),
        classification: "home_policy",
        model_provider: "test-provider",
        model_id: "test-model",
        prompt_version: "1.0.0",
        analyzer_version: ANALYZER,
        normalization_schema_version: SCHEMA,
        normalized_output_json: { documentId: "pd-2", policy: { policyNumber: "POL-456" } },
        normalized_entities_json: [
          {
            temporaryId: "entity-2",
            entityType: "property",
            evidence: [{ documentId: "pd-2" }],
          },
        ],
        conflicts_json: [],
        evidence_json: [{ documentId: "pd-2" }],
      },
    ];

    const projected = projectNormalizationForCandidateDerivation(normalizations as any);

    expect(projected.documents).toHaveLength(2);
    expect(projected.detectedEntities).toHaveLength(2);
    expect(new Set(projected.detectedEntities.map((e) => e.temporaryId)).size).toBe(2);
    expect(projected.detectedEntities[0].evidence[0].documentId).toBe("pd-1");
    expect(projected.detectedEntities[1].evidence[0].documentId).toBe("pd-2");
  });
});

describe("combineAnalysisWithProjectedNormalizations", () => {
  it("merges disjoint provider and projected outputs without duplication", () => {
    const providerAnalysis = makeAnalysis({
      documents: [
        {
          documentId: "pd-provider",
          fileDigest: "cc".repeat(32),
          classification: "auto_policy",
          parserId: "test",
          parserVersion: "1",
          pageCount: 1,
          extractedEntityCount: 1,
        },
      ],
      detectedEntities: [
        {
          temporaryId: "entity-provider",
          canonicalFingerprint: "vehicle:vin:PROVIDER123456789",
          entityType: "vehicle",
          displayLabel: "2019 Honda Accord",
          identity: { vin: "PROVIDER123456789" },
          candidateIdentity: {
            exactIdentityFingerprint: "vehicle:vin:PROVIDER123456789",
            provisionalCandidateKey: "vehicle:PROVIDER123456789",
            identityStrength: "exact",
          },
          currentPolicy: {
            insurer: "Provider Insurer",
            policyNumber: "POL-PROVIDER",
            effectiveDate: "2024-01-01",
            expiryDate: "2025-01-01",
          },
          currentCoverage: {},
          mandateSuggestions: {},
          requiredConfirmations: [],
          resolution: { status: "new", confidence: 0.95, reasoning: "test" },
          evidence: [{ documentId: "pd-provider", pageNumber: 1, evidenceSummary: "test" }],
        },
      ],
    });

    const projected = projectNormalizationForCandidateDerivation([
      {
        id: "n-reused",
        policy_document_id: "pd-reused",
        policyDocumentId: "pd-reused",
        content_sha256: "aa".repeat(32),
        classification: "home_policy",
        model_provider: "test-provider",
        model_id: "test-model",
        prompt_version: "1.0.0",
        analyzer_version: ANALYZER,
        normalization_schema_version: SCHEMA,
        normalized_output_json: { documentId: "pd-reused" },
        normalized_entities_json: [
          {
            temporaryId: "entity-reused",
            entityType: "property",
            displayLabel: "456 Oak Ave",
            identity: {
              fullAddress: "456 Oak Ave",
              city: "Edmonton",
              province: "AB",
              postalCode: "T4E5F6",
            },
            candidateIdentity: {
              exactIdentityFingerprint: "property:456 OAK AVE|EDMONTON|AB|T4E5F6",
              provisionalCandidateKey: "property:456-oak-ave-edmonton",
              identityStrength: "exact",
            },
            currentPolicy: { insurer: "Reused Insurer", policyNumber: "POL-REUSED" },
            currentCoverage: {},
            evidence: [{ documentId: "pd-reused" }],
          },
        ],
        conflicts_json: [],
        evidence_json: [{ documentId: "pd-reused" }],
      } as any,
    ]);

    const combined = combineAnalysisWithProjectedNormalizations(providerAnalysis, projected);

    expect(combined.documents).toHaveLength(2);
    expect(combined.detectedEntities).toHaveLength(2);
  });
});
