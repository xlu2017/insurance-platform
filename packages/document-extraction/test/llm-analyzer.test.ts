import { describe, expect, it } from "vitest";
import {
  createLlmFirstAnalyzer,
  type InsuranceDocumentAnalysisInput,
  type InsuranceDocumentAnalysisResult,
} from "../src/document-analyzer";
import { type InsuranceLlmProvider } from "../src/llm-contract";
import type { ExtractedPdf } from "../src/types";

class FakeDocumentLoader {
  async load(): Promise<ExtractedPdf> {
    return {
      documentId: "doc-1",
      fileDigest: "a".repeat(64),
      pageCount: 1,
      pages: [{ pageNumber: 1, text: "Sample policy text", items: [] }],
    };
  }
}

function validLlmResponse(): InsuranceDocumentAnalysisResult {
  return {
    analysisVersion: "1",
    modelProvider: "mock-provider",
    modelId: "mock-model",
    documents: [
      {
        documentId: "doc-1",
        fileDigest: "a".repeat(64),
        classification: "auto_policy_renewal",
        parserId: "mock-provider",
        parserVersion: "mock-model",
        pageCount: 1,
        extractedEntityCount: 1,
      },
    ],
    detectedEntities: [
      {
        temporaryId: "vehicle:vin:1HGBH41JXMN109186",
        canonicalFingerprint: "vehicle:vin:1HGBH41JXMN109186",
        entityType: "vehicle",
        displayLabel: "2021 Honda Civic",
        identity: {
          vin: "1HGBH41JXMN109186",
          year: 2021,
          make: "Honda",
          model: "Civic",
          trim: null,
          vehicleUse: null,
        },
        resolution: {
          status: "new",
          confidence: 0.95,
          reasoning: "No existing or pending asset matches.",
        },
        currentPolicy: {
          insurer: null,
          policyNumber: null,
          effectiveDate: null,
          expiryDate: null,
          annualPremiumCents: null,
        },
        currentCoverage: {
          "vehicle.thirdPartyLiabilityLimitCents": {
            status: "known",
            value: 1000000,
            confidence: 0.95,
            evidence: [
              { documentId: "doc-1", pageNumber: 1, evidenceSummary: "liability limit $1,000,000" },
            ],
          },
        },
        mandateSuggestions: {
          "vehicle.thirdPartyLiabilityLimitCents": { rule: "minimum", amountCents: 1000000 },
        },
        evidence: [{ documentId: "doc-1", pageNumber: 1, evidenceSummary: "policy document" }],
        requiredConfirmations: [],
      },
    ],
    unresolvedConflicts: [],
    warnings: [],
  };
}

function invalidLlmResponseWithZeroAmount(): Record<string, unknown> {
  const valid = validLlmResponse();
  return {
    ...valid,
    detectedEntities: [
      {
        ...valid.detectedEntities[0],
        mandateSuggestions: {
          "vehicle.thirdPartyLiabilityLimitCents": { rule: "minimum", amountCents: 0 },
        },
      },
    ],
  };
}

class SuccessMockProvider implements InsuranceLlmProvider {
  readonly providerId = "mock-provider";
  readonly modelId = "mock-model";

  async extract(): Promise<unknown> {
    return validLlmResponse();
  }
}

class RepairMockProvider implements InsuranceLlmProvider {
  readonly providerId = "mock-provider";
  readonly modelId = "mock-model";
  private attempt = 0;

  async extract(): Promise<unknown> {
    this.attempt++;
    if (this.attempt === 1) {
      return invalidLlmResponseWithZeroAmount();
    }
    return validLlmResponse();
  }
}

class FailClosedMockProvider implements InsuranceLlmProvider {
  readonly providerId = "mock-provider";
  readonly modelId = "mock-model";

  async extract(): Promise<unknown> {
    throw new Error("LLM service unavailable");
  }
}

function baseInput(): InsuranceDocumentAnalysisInput {
  return {
    householdId: "household-1",
    uploadedDocuments: [
      {
        documentId: "doc-1",
        filename: "policy.pdf",
        mimeType: "application/pdf",
        fileReference: "doc-1",
      },
    ],
    existingAssets: [],
    pendingCandidates: [],
    priorDocumentSummaries: [],
    jurisdiction: "AB",
  };
}

describe("LlmFirstDocumentAnalyzer", () => {
  it("returns LLM result when provider returns a valid response", async () => {
    const analyzer = createLlmFirstAnalyzer({
      provider: new SuccessMockProvider(),
      loader: new FakeDocumentLoader(),
      fallbackToDeterministic: true,
    });
    const result = await analyzer.analyze(baseInput());
    expect(result.modelProvider).toBe("mock-provider");
    expect(result.modelId).toBe("mock-model");
    expect(result.documents[0].classification).toBe("auto_policy_renewal");
    expect(result.detectedEntities).toHaveLength(1);
    expect(result.detectedEntities[0].temporaryId).toEqual(expect.any(String));
    expect(result.detectedEntities[0].canonicalFingerprint).toBe("vehicle:vin:1HGBH41JXMN109186");
    expect(
      result.detectedEntities[0].mandateSuggestions["vehicle.thirdPartyLiabilityLimitCents"],
    ).toEqual({
      rule: "minimum",
      amountCents: 1000000,
    });
  });

  it("repairs a zero-amount mandate with one retry", async () => {
    const provider = new RepairMockProvider();
    const analyzer = createLlmFirstAnalyzer({
      provider,
      loader: new FakeDocumentLoader(),
      fallbackToDeterministic: false,
    });
    const result = await analyzer.analyze(baseInput());
    expect(provider).toBeDefined();
    expect(result.modelProvider).toBe("mock-provider");
    expect(
      result.detectedEntities[0].mandateSuggestions["vehicle.thirdPartyLiabilityLimitCents"],
    ).toEqual({
      rule: "minimum",
      amountCents: 1000000,
    });
  });

  it("fails closed when LLM fails and deterministic fallback is disabled", async () => {
    const analyzer = createLlmFirstAnalyzer({
      provider: new FailClosedMockProvider(),
      loader: new FakeDocumentLoader(),
      fallbackToDeterministic: false,
    });
    await expect(analyzer.analyze(baseInput())).rejects.toThrow(/LLM analysis failed/);
  });

  it("records attempted LLM provenance when falling back to deterministic", async () => {
    const analyzer = createLlmFirstAnalyzer({
      provider: new FailClosedMockProvider(),
      loader: new FakeDocumentLoader(),
      fallbackToDeterministic: true,
    });
    const result = await analyzer.analyze(baseInput());
    expect(result.modelProvider).toBe("deterministic");
    expect(result.modelId).toBe("pdfjs-fallback");
    expect(result.attemptedModelProvider).toBe("mock-provider");
    expect(result.attemptedModelId).toBe("mock-model");
    expect(result.fallbackReason).toMatch(/LLM analysis failed/);
  });
});
