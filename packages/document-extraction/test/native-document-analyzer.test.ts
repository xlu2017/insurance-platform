import { describe, expect, it } from "vitest";
import {
  createNativeDocumentAnalyzer,
  buildCandidateContext,
  sanitizeProviderError,
  ConfigAndConsentPrivacyPreparation,
  type FileBytesLoader,
  type NativeDocumentAnalysisProvider,
  type NativeDocumentAnalysisRequest,
  type OriginalFileInput,
  type ProviderFileDeletionResult,
  type ProviderFileHandle,
  type ProviderUploadResult,
  type ResolvedDocumentModel,
  type ResolvedInputCapability,
} from "../src/index.ts";

class MemoryBytesLoader implements FileBytesLoader {
  constructor(private bytes: Uint8Array) {}
  async load(document: {
    documentId: string;
    filename: string;
    mimeType: string;
    fileReference: string;
  }) {
    return {
      documentId: document.documentId,
      filename: document.filename,
      mimeType: document.mimeType,
      bytes: this.bytes,
    };
  }
}

class FakeNativeProvider implements NativeDocumentAnalysisProvider {
  readonly providerId = "test-provider";
  readonly baseUrl = "https://example.com";

  caps: ResolvedDocumentModel = {
    modelId: "test-model",
    supportsImageInput: true,
    supportsVideoInput: true,
    supportsGenericFileInput: false,
    supportedReferenceSchemes: ["test://"],
    providerMetadata: {},
  };

  modes: Record<string, ResolvedInputCapability> = {};
  uploadResult?: ProviderUploadResult;
  analyzeResult?: unknown;
  deletionResult: ProviderFileDeletionResult = { deleted: true, attempts: 1 };

  resolveModelCalls = 0;
  resolveInputModeCalls = 0;
  uploadCalls = 0;
  analyzeCalls = 0;
  deleteCalls = 0;

  async resolveModel(): Promise<ResolvedDocumentModel> {
    this.resolveModelCalls += 1;
    return this.caps;
  }

  async resolveInputMode(input: OriginalFileInput): Promise<ResolvedInputCapability> {
    this.resolveInputModeCalls += 1;
    return (
      this.modes[input.mimeType] ?? {
        mimeType: input.mimeType,
        mode: "unsupported",
        supported: false,
        reason: "unsupported",
      }
    );
  }

  async uploadOriginalFile(input: OriginalFileInput): Promise<ProviderUploadResult> {
    this.uploadCalls += 1;
    return (
      this.uploadResult ?? {
        status: "ready",
        handle: {
          providerFileId: "file-1",
          documentId: input.documentId,
          filename: input.filename,
          mimeType: input.mimeType,
          bytes: input.bytes.length,
          mode: "native_image_reference",
          reference: "test://file-1",
          status: "ok",
          providerMetadata: {},
        },
      }
    );
  }

  async analyze(input: NativeDocumentAnalysisRequest): Promise<unknown> {
    this.analyzeCalls += 1;
    return (
      this.analyzeResult ?? {
        analysisVersion: "1",
        modelProvider: this.providerId,
        modelId: this.caps.modelId,
        documents: [
          {
            documentId: input.files[0]?.documentId ?? "doc-1",
            fileDigest: "a".repeat(64),
            classification: "auto_policy_renewal",
            parserId: "native-document-analysis",
            parserVersion: "1.0.0",
            pageCount: 0,
            extractedEntityCount: 0,
          },
        ],
        detectedEntities: [],
        unresolvedConflicts: [],
        warnings: [],
      }
    );
  }

  async deleteFile(_handle: ProviderFileHandle): Promise<ProviderFileDeletionResult> {
    this.deleteCalls += 1;
    return this.deletionResult;
  }
}

function baseInput(mimeType = "image/png") {
  return {
    householdId: "household-1",
    uploadedDocuments: [
      {
        documentId: "doc-1",
        filename: "policy.png",
        mimeType,
        fileReference: "doc-1",
      },
    ],
    existingAssets: [],
    pendingCandidates: [],
    priorDocumentSummaries: [],
    jurisdiction: "AB" as const,
  };
}

describe("NativeDocumentAnalyzer", () => {
  it("rejects PDFs in native-only mode without uploading", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["application/pdf"] = {
      mimeType: "application/pdf",
      mode: "provider_extracted_text",
      supported: false,
      reason: "Native file reference is not supported",
    };

    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
      requireNativeInput: true,
    });

    await expect(analyzer.analyze(baseInput("application/pdf"))).rejects.toThrow(
      /Unsupported file/,
    );
    expect(provider.uploadCalls).toBe(0);
    expect(provider.analyzeCalls).toBe(0);
  });

  it("accepts native image references and sends them to the provider", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "native_image_reference",
      supported: true,
    };

    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
    });

    const result = await analyzer.analyze(baseInput("image/png"));
    expect(provider.uploadCalls).toBe(1);
    expect(provider.analyzeCalls).toBe(1);
    expect(result.documents[0].parserId).toBe("native-document-analysis");
    expect(result.providerMetadata).toBeDefined();
    expect(provider.deleteCalls).toBe(1);
  });

  it("preserves actual stored MIME types through the transport", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["image/jpeg"] = {
      mimeType: "image/jpeg",
      mode: "native_image_reference",
      supported: true,
    };

    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
    });

    await analyzer.analyze(baseInput("image/jpeg"));
    expect(provider.uploadCalls).toBe(1);
  });

  it("fails closed when the model lacks required capabilities", async () => {
    const provider = new FakeNativeProvider();
    provider.caps.supportsImageInput = false;
    provider.caps.supportsVideoInput = false;
    provider.caps.supportsGenericFileInput = false;
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "unsupported",
      supported: false,
      reason: "Image input not supported by resolved model",
    };
    provider.uploadResult = {
      status: "rejected",
      errorCategory: "unsupported_mime_type",
    };

    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
    });

    await expect(analyzer.analyze(baseInput("image/png"))).rejects.toThrow();
    expect(provider.analyzeCalls).toBe(0);
  });

  it("verifies temporary file deletion is attempted and recorded", async () => {
    const provider = new FakeNativeProvider();
    provider.deletionResult = { deleted: true, attempts: 1, statusCode: 200 };
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "native_image_reference",
      supported: true,
    };

    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
    });

    const result = await analyzer.analyze(baseInput("image/png"));
    expect(provider.deleteCalls).toBe(1);
    expect(result.providerMetadata).toEqual(
      expect.objectContaining({
        deletionResults: [{ deleted: true, attempts: 1, statusCode: 200 }],
      }),
    );
  });

  it("does not call file-content extraction endpoints for PDFs", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["application/pdf"] = {
      mimeType: "application/pdf",
      mode: "provider_extracted_text",
      supported: false,
      reason: "Native file reference not supported",
    };

    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
      requireNativeInput: true,
    });

    try {
      await analyzer.analyze(baseInput("application/pdf"));
    } catch {
      // expected
    }

    expect(provider.uploadCalls).toBe(0);
    expect(provider.analyzeCalls).toBe(0);
  });

  it("returns provider-neutral public errors for unsupported files", () => {
    const error = sanitizeProviderError(
      new Error("Unsupported file type for native document analysis"),
    );
    expect(error.code).toBe("DOCUMENT_FILE_UNSUPPORTED");
    expect(error.message).not.toMatch(/kimi/i);
    expect(error.supportReference).toEqual(expect.stringMatching(/^doc-/));
  });
});

describe("buildCandidateContext", () => {
  it("produces rich comparison context with identity and current policy", () => {
    const candidate = {
      id: "asset-1",
      assetType: "vehicle" as const,
      identityFingerprint: "vehicle:vin:123",
      displayLabel: "2020 Honda Civic",
      candidateIdentity: {
        exactIdentityFingerprint: "vehicle:vin:123",
        provisionalCandidateKey: "vehicle:vin:123",
        identityStrength: "exact" as const,
      },
      identity: { vin: "123", year: 2020, make: "Honda", model: "Civic" },
      currentPolicy: {
        insurer: "Test Insurer",
        policyNumber: "P123",
        effectiveDate: "2026-01-01",
        expiryDate: "2027-01-01",
        annualPremiumCents: 100000,
      },
    };

    const context = buildCandidateContext(candidate);
    expect(context.id).toBe("asset-1");
    expect(context.identity).toEqual(expect.objectContaining({ vin: "123" }));
    expect(context.currentPolicy).toEqual(expect.objectContaining({ insurer: "Test Insurer" }));
    expect(context.exactIdentityFingerprint).toBe("vehicle:vin:123");
  });
});

describe("ConfigAndConsentPrivacyPreparation", () => {
  it("blocks raw external processing when consent is missing", async () => {
    const prep = new ConfigAndConsentPrivacyPreparation({
      externalDocumentProcessingEnabled: true,
      rawExternalDocumentProcessingApproved: true,
      privacyNoticeVersion: "v1",
      processorContractVersion: "v1",
    });

    await expect(
      prep.prepare({
        documentId: "doc-1",
        filename: "policy.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/consent is missing/);
  });

  it("blocks raw external processing when the operator has not approved raw processing", async () => {
    const prep = new ConfigAndConsentPrivacyPreparation(
      {
        externalDocumentProcessingEnabled: true,
        rawExternalDocumentProcessingApproved: false,
        privacyNoticeVersion: "v1",
        processorContractVersion: "v1",
      },
      {
        householdId: "hh-1",
        purpose: "insurance_policy_extraction",
        privacyNoticeVersion: "v1",
        processorContractVersion: "v1",
        foreignProcessingAcknowledged: true,
        automatedProcessingAcknowledged: true,
        rawProcessingApproved: true,
      },
    );

    await expect(
      prep.prepare({
        documentId: "doc-1",
        filename: "policy.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/not approved/);
  });
});
