import { describe, expect, it } from "vitest";
import {
  createNativeDocumentAnalyzer,
  buildCandidateContext,
  sanitizeProviderError,
  ConfigAndConsentPrivacyPreparation,
  MemoryAuthorizationStore,
  MemoryExternalFileLifecycleStore,
  type DocumentProcessingAuthorization,
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
  analyzeSequence: unknown[] = [];
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

  async uploadOriginalFile(
    input: OriginalFileInput,
    callbacks?: { onHandleCreated?: (handle: ProviderFileHandle) => void | Promise<void> },
  ): Promise<ProviderUploadResult> {
    this.uploadCalls += 1;
    const result = this.uploadResult ?? {
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
    };
    if (result.handle && callbacks?.onHandleCreated) {
      await callbacks.onHandleCreated(result.handle);
    }
    return result;
  }

  async analyze(input: NativeDocumentAnalysisRequest): Promise<unknown> {
    this.analyzeCalls += 1;
    if (this.analyzeSequence.length > 0) {
      const next = this.analyzeSequence.shift();
      if (next instanceof Error) throw next;
      return next;
    }
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

async function createAuthorization(
  overrides: Partial<DocumentProcessingAuthorization> = {},
): Promise<DocumentProcessingAuthorization> {
  const store = new MemoryAuthorizationStore();
  return store.createAuthorization({
    householdId: "household-1",
    actorProfileId: "profile-1",
    purpose: "insurance_policy_extraction",
    privacyNoticeVersion: "v1",
    processorContractVersion: "v1",
    foreignProcessingAcknowledged: true,
    automatedProcessingAcknowledged: true,
    rawProcessingApproved: true,
    externalProcessingEnabled: true,
    authorizationResult: "authorized",
    ...overrides,
  });
}

async function authorizedAnalyzer(
  provider: FakeNativeProvider,
  options: {
    bytes?: Uint8Array;
    requireNativeInput?: boolean;
    authorization?: DocumentProcessingAuthorization;
    preTransmissionCheck?: () => Promise<void>;
  } = {},
) {
  const authorization = options.authorization ?? (await createAuthorization());
  return createNativeDocumentAnalyzer({
    provider,
    bytesLoader: new MemoryBytesLoader(options.bytes ?? new Uint8Array([1, 2, 3])),
    requireNativeInput: options.requireNativeInput,
    authorization,
    fileLifecycleStore: new MemoryExternalFileLifecycleStore(),
    preTransmissionCheck: options.preTransmissionCheck,
  });
}

describe("NativeDocumentAnalyzer", () => {
  it("accepts PDFs through provider-file extraction", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["application/pdf"] = {
      mimeType: "application/pdf",
      mode: "provider_extracted_text",
      supported: true,
    };
    provider.uploadResult = {
      status: "ready",
      handle: {
        providerFileId: "file-pdf",
        documentId: "doc-1",
        filename: "policy.pdf",
        mimeType: "application/pdf",
        bytes: 3,
        mode: "provider_extracted_text",
        status: "ok",
        providerMetadata: {},
        transientExtractedContent: "Extracted policy content",
      },
    };

    const analyzer = await authorizedAnalyzer(provider, { requireNativeInput: true });

    await analyzer.analyze(baseInput("application/pdf"));
    expect(provider.uploadCalls).toBe(1);
    expect(provider.analyzeCalls).toBe(1);
  });

  it("accepts native image references and sends them to the provider", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "native_image_reference",
      supported: true,
    };

    const analyzer = await authorizedAnalyzer(provider);

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

    const analyzer = await authorizedAnalyzer(provider);

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

    const analyzer = await authorizedAnalyzer(provider);

    await expect(analyzer.analyze(baseInput("image/png"))).rejects.toThrow();
    expect(provider.analyzeCalls).toBe(0);
  });

  it("revalidates live consent immediately before upload", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "native_image_reference",
      supported: true,
    };
    let checks = 0;
    const analyzer = await authorizedAnalyzer(provider, {
      preTransmissionCheck: async () => {
        checks += 1;
        throw new Error("Document processing authorization is no longer valid");
      },
    });

    await expect(analyzer.analyze(baseInput("image/png"))).rejects.toThrow(
      /authorization is no longer valid/,
    );
    expect(checks).toBe(1);
    expect(provider.uploadCalls).toBe(0);
    expect(provider.analyzeCalls).toBe(0);
  });

  it("rechecks authorization for every file before external upload", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["application/pdf"] = {
      mimeType: "application/pdf",
      mode: "provider_extracted_text",
      supported: true,
    };
    let checks = 0;
    const analyzer = await authorizedAnalyzer(provider, {
      preTransmissionCheck: async () => {
        checks += 1;
      },
    });
    const input = baseInput("application/pdf");
    input.uploadedDocuments = Array.from({ length: 4 }, (_, index) => ({
      documentId: `doc-${index + 1}`,
      filename: `policy-${index + 1}.pdf`,
      mimeType: "application/pdf",
      fileReference: `doc-${index + 1}`,
    }));

    await analyzer.analyze(input);

    expect(checks).toBe(5);
    expect(provider.uploadCalls).toBe(4);
  });

  it("aborts with zero provider transmissions when the batch generation check fails", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["application/pdf"] = {
      mimeType: "application/pdf",
      mode: "provider_extracted_text",
      supported: true,
    };
    const analyzer = await authorizedAnalyzer(provider, {
      preTransmissionCheck: async () => {
        throw new Error("DOCUMENT_BATCH_GENERATION_MISMATCH: stale generation");
      },
    });

    await expect(analyzer.analyze(baseInput("application/pdf"))).rejects.toThrow(
      /DOCUMENT_BATCH_GENERATION_MISMATCH/,
    );
    expect(provider.uploadCalls).toBe(0);
    expect(provider.analyzeCalls).toBe(0);
  });

  it("stops further provider transmissions when the generation check fails mid-batch", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["application/pdf"] = {
      mimeType: "application/pdf",
      mode: "provider_extracted_text",
      supported: true,
    };
    let checks = 0;
    const analyzer = await authorizedAnalyzer(provider, {
      preTransmissionCheck: async () => {
        checks += 1;
        if (checks === 3) {
          throw new Error("DOCUMENT_BATCH_GENERATION_MISMATCH: generation changed");
        }
      },
    });
    const input = baseInput("application/pdf");
    input.uploadedDocuments = [
      {
        documentId: "doc-a",
        filename: "policy-a.pdf",
        mimeType: "application/pdf",
        fileReference: "doc-a",
      },
      {
        documentId: "doc-b",
        filename: "policy-b.pdf",
        mimeType: "application/pdf",
        fileReference: "doc-b",
      },
    ];

    await expect(analyzer.analyze(input)).rejects.toThrow(/DOCUMENT_BATCH_GENERATION_MISMATCH/);
    expect(provider.uploadCalls).toBe(1);
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

    const analyzer = await authorizedAnalyzer(provider);

    const result = await analyzer.analyze(baseInput("image/png"));
    expect(provider.deleteCalls).toBe(1);
    expect(result.providerMetadata).toEqual(
      expect.objectContaining({
        deletionResults: [{ deleted: true, attempts: 1, statusCode: 200 }],
      }),
    );
  });

  it("processes every file in a four-document batch with one inference request", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["application/pdf"] = {
      mimeType: "application/pdf",
      mode: "provider_extracted_text",
      supported: true,
    };

    const analyzer = await authorizedAnalyzer(provider, { requireNativeInput: true });
    const input = baseInput("application/pdf");
    input.uploadedDocuments = Array.from({ length: 4 }, (_, index) => ({
      documentId: `doc-${index + 1}`,
      filename: `policy-${index + 1}.pdf`,
      mimeType: "application/pdf",
      fileReference: `doc-${index + 1}`,
    }));

    await analyzer.analyze(input);

    expect(provider.uploadCalls).toBe(4);
    expect(provider.analyzeCalls).toBe(1);
    expect(provider.deleteCalls).toBe(4);
  });

  it("makes exactly one repair inference after invalid provider JSON", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "native_image_reference",
      supported: true,
    };
    provider.analyzeSequence = [new Error("Provider response was not valid JSON")];

    const analyzer = await authorizedAnalyzer(provider);
    await analyzer.analyze(baseInput("image/png"));

    expect(provider.analyzeCalls).toBe(2);
    expect(provider.deleteCalls).toBe(1);
  });

  it("rejects an invalid repaired result without returning partial candidates", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "native_image_reference",
      supported: true,
    };
    provider.analyzeSequence = [
      new Error("Provider response was not valid JSON"),
      { documents: [], detectedEntities: [{ temporaryId: "partial" }] },
    ];

    const analyzer = await authorizedAnalyzer(provider);
    await expect(analyzer.analyze(baseInput("image/png"))).rejects.toThrow();

    expect(provider.analyzeCalls).toBe(2);
    expect(provider.deleteCalls).toBe(1);
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

  it("rejects stale privacy notice versions", async () => {
    const prep = new ConfigAndConsentPrivacyPreparation(
      {
        externalDocumentProcessingEnabled: true,
        rawExternalDocumentProcessingApproved: true,
        privacyNoticeVersion: "v2",
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
    ).rejects.toThrow(/out of date/);
  });

  it("creates an authorization snapshot before analysis", async () => {
    const prep = new ConfigAndConsentPrivacyPreparation(
      {
        externalDocumentProcessingEnabled: true,
        rawExternalDocumentProcessingApproved: true,
        privacyNoticeVersion: "v1",
        processorContractVersion: "v1",
        cleanupReadinessCheck: async () => true,
      },
      {
        id: "consent-1",
        householdId: "hh-1",
        profileId: "profile-1",
        purpose: "insurance_policy_extraction",
        privacyNoticeVersion: "v1",
        processorContractVersion: "v1",
        foreignProcessingAcknowledged: true,
        automatedProcessingAcknowledged: true,
        rawProcessingApproved: true,
      },
    );

    const store = new MemoryAuthorizationStore();
    const authorization = await prep.authorize("profile-1", store);
    expect(authorization.householdId).toBe("hh-1");
    expect(authorization.consentId).toBe("consent-1");
    expect(authorization.authorizationResult).toBe("authorized");
    expect(store.get(authorization.id)).toBeDefined();
  });
});

describe("NativeDocumentAnalyzer lifecycle", () => {
  it("allows only one external transmission claim per canonical document", async () => {
    const lifecycle = new MemoryExternalFileLifecycleStore();
    const upload = {
      authorizationId: "authorization-1",
      analysisRequestId: "analysis-1",
      policyDocumentId: "canonical-document-1",
      providerFileId: "pending",
      uploadStatus: "started" as const,
    };

    await lifecycle.recordUpload(upload);
    await expect(lifecycle.recordUpload(upload)).rejects.toThrow(/already been transmitted/);
    expect(lifecycle.getRecords()).toHaveLength(1);
  });

  it("persists an authorization snapshot before any upload", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "native_image_reference",
      supported: true,
    };

    const authStore = new MemoryAuthorizationStore();
    const authorization = await authStore.createAuthorization({
      householdId: "household-1",
      actorProfileId: "profile-1",
      purpose: "insurance_policy_extraction",
      privacyNoticeVersion: "v1",
      processorContractVersion: "v1",
      foreignProcessingAcknowledged: true,
      automatedProcessingAcknowledged: true,
      rawProcessingApproved: true,
      externalProcessingEnabled: true,
      authorizationResult: "authorized",
    });

    const lifecycle = new MemoryExternalFileLifecycleStore();
    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
      authorization,
      fileLifecycleStore: lifecycle,
    });

    await analyzer.analyze(baseInput("image/png"));
    expect(authorization.id).toBeDefined();
    expect(provider.uploadCalls).toBe(1);
    expect(lifecycle.getRecords().length).toBe(1);
    expect(lifecycle.getRecords()[0].authorizationId).toBe(authorization.id);
  });

  it("requires a valid authorization to run analysis", async () => {
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

    await expect(analyzer.analyze(baseInput("image/png"))).rejects.toThrow(/not authorized/);
    expect(provider.uploadCalls).toBe(0);
    expect(provider.analyzeCalls).toBe(0);
  });

  it("fails closed when one selected file is unsupported", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "native_image_reference",
      supported: true,
    };
    provider.modes["application/pdf"] = {
      mimeType: "application/pdf",
      mode: "unsupported",
      supported: false,
      reason: "Native file reference is not supported",
    };

    const analyzer = await authorizedAnalyzer(provider, { requireNativeInput: true });

    const input = {
      ...baseInput("image/png"),
      uploadedDocuments: [
        ...baseInput("image/png").uploadedDocuments,
        {
          documentId: "doc-2",
          filename: "policy.pdf",
          mimeType: "application/pdf",
          fileReference: "doc-2",
        },
      ],
    };

    await expect(analyzer.analyze(input)).rejects.toThrow(/Unsupported file/);
    expect(provider.uploadCalls).toBe(0);
    expect(provider.analyzeCalls).toBe(0);
  });

  it("deletes any successfully uploaded files when a parallel upload fails", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "native_image_reference",
      supported: true,
    };

    let callCount = 0;
    provider.uploadOriginalFile = async (input) => {
      callCount++;
      if (input.documentId === "doc-2") {
        throw new Error("Network error");
      }
      return {
        status: "ready" as const,
        handle: {
          providerFileId: `file-${callCount}`,
          documentId: input.documentId,
          filename: input.filename,
          mimeType: input.mimeType,
          bytes: input.bytes.length,
          mode: "native_image_reference" as const,
          reference: `test://file-${callCount}`,
          status: "ok" as const,
          providerMetadata: {},
        },
      };
    };
    provider.deletionResult = { deleted: true, attempts: 1, statusCode: 200 };

    const lifecycle = new MemoryExternalFileLifecycleStore();
    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
      authorization: await createAuthorization(),
      fileLifecycleStore: lifecycle,
    });

    const input = {
      ...baseInput("image/png"),
      uploadedDocuments: [
        { documentId: "doc-1", filename: "a.png", mimeType: "image/png", fileReference: "doc-1" },
        { documentId: "doc-2", filename: "b.png", mimeType: "image/png", fileReference: "doc-2" },
      ],
    };

    await expect(analyzer.analyze(input)).rejects.toThrow();
    expect(callCount).toBe(2);
    expect(provider.deleteCalls).toBe(1);
    const records = lifecycle.getRecords();
    expect(records.length).toBe(2);
    expect(
      records.every((r) => r.providerFileId !== "pending" || r.uploadStatus === "failed"),
    ).toBe(true);
  });

  it("records every deletion attempt and queues cleanup after transient failures", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "native_image_reference",
      supported: true,
    };
    let attempts = 0;
    provider.deleteFile = async () => {
      attempts++;
      return { deleted: false, attempts, statusCode: 503, failureCategory: "transient" };
    };

    const lifecycle = new MemoryExternalFileLifecycleStore();
    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
      authorization: await createAuthorization(),
      fileLifecycleStore: lifecycle,
    });

    await analyzer.analyze(baseInput("image/png"));
    expect(attempts).toBeGreaterThanOrEqual(1);
    const record = lifecycle.getRecords()[0];
    expect(record.deletionAttempts).toBeGreaterThanOrEqual(1);
    expect(record.deletionStatus).toBe("queued");
  });

  it("records the provider file id and deletes when polling times out", async () => {
    const provider = new FakeNativeProvider();
    provider.modes["image/png"] = {
      mimeType: "image/png",
      mode: "native_image_reference",
      supported: true,
    };
    provider.uploadResult = {
      status: "timed_out" as const,
      handle: {
        providerFileId: "file-poll-timeout",
        documentId: "doc-1",
        filename: "a.png",
        mimeType: "image/png",
        bytes: 3,
        mode: "native_image_reference" as const,
        reference: "test://file-poll-timeout",
        status: "processing",
        providerMetadata: {},
      },
      errorCategory: "status_poll_timeout",
    };

    let deleteCalls = 0;
    provider.deleteFile = async (handle) => {
      deleteCalls++;
      expect(handle.providerFileId).toBe("file-poll-timeout");
      return { deleted: true, attempts: 1, statusCode: 200 };
    };

    const lifecycle = new MemoryExternalFileLifecycleStore();
    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
      authorization: await createAuthorization(),
      fileLifecycleStore: lifecycle,
    });

    await expect(analyzer.analyze(baseInput("image/png"))).rejects.toThrow();
    expect(deleteCalls).toBe(1);
    const record = lifecycle.getRecords()[0];
    expect(record.providerFileId).toBe("file-poll-timeout");
    expect(record.uploadStatus).toBe("completed");
    expect(record.processingStatus).toBe("timed_out");
  });
});

describe("NativeDocumentAnalyzer deleteAll compound failures", () => {
  function makeHandle(providerFileId: string): ProviderFileHandle {
    return {
      providerFileId,
      documentId: "doc-1",
      filename: "a.png",
      mimeType: "image/png",
      bytes: 3,
      mode: "native_image_reference",
      status: "ok",
      providerMetadata: {},
    };
  }

  async function analyzerWithLifecycle(
    lifecycle: MemoryExternalFileLifecycleStore,
    authorization: DocumentProcessingAuthorization,
  ) {
    const provider = new FakeNativeProvider();
    provider.deletionResult = {
      deleted: false,
      attempts: 1,
      statusCode: 503,
      failureCategory: "transient",
    };
    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
      authorization,
      fileLifecycleStore: lifecycle,
    });
    const record = await lifecycle.recordUpload({
      authorizationId: authorization.id,
      analysisRequestId: undefined,
      policyDocumentId: "doc-1",
      providerFileId: "pending",
      uploadStatus: "started",
    });
    (analyzer as unknown as { lifecycleRecords: Map<string, string> }).lifecycleRecords.set(
      "doc-1",
      record.id,
    );
    return analyzer;
  }

  it("queues cleanup when recordDeletionAttempt fails", async () => {
    const lifecycle = new MemoryExternalFileLifecycleStore();
    lifecycle.recordDeletionAttempt = async () => {
      throw new Error("database unavailable");
    };

    const analyzer = await analyzerWithLifecycle(lifecycle, await createAuthorization());
    await (
      analyzer as unknown as {
        deleteAll(handles: ProviderFileHandle[]): Promise<ProviderFileDeletionResult[]>;
      }
    ).deleteAll([makeHandle("file-1")]);

    const records = lifecycle.getRecords();
    expect(records.length).toBe(1);
    expect(records[0].providerFileId).toBe("file-1");
    expect(records[0].deletionStatus).toBe("queued");
  });

  it("falls back to emergency cleanup when both ledger updates fail", async () => {
    const lifecycle = new MemoryExternalFileLifecycleStore();
    lifecycle.recordDeletionAttempt = async () => {
      throw new Error("database unavailable");
    };
    lifecycle.queueCleanup = async () => {
      throw new Error("queue unavailable");
    };

    const analyzer = await analyzerWithLifecycle(lifecycle, await createAuthorization());
    await (
      analyzer as unknown as {
        deleteAll(handles: ProviderFileHandle[]): Promise<ProviderFileDeletionResult[]>;
      }
    ).deleteAll([makeHandle("file-2")]);

    const emergency = lifecycle.getEmergencyCleanup();
    expect(emergency.length).toBe(1);
    expect(emergency[0].providerFileId).toBe("file-2");
    expect(emergency[0].failureCategory).toMatch(/transient/);
  });

  it("throws with a support reference when all cleanup persistence fails", async () => {
    const lifecycle = new MemoryExternalFileLifecycleStore();
    lifecycle.recordDeletionAttempt = async () => {
      throw new Error("database unavailable");
    };
    lifecycle.queueCleanup = async () => {
      throw new Error("queue unavailable");
    };
    lifecycle.recordEmergencyCleanup = async () => {
      throw new Error("emergency ledger unavailable");
    };

    const analyzer = await analyzerWithLifecycle(lifecycle, await createAuthorization());
    await expect(
      (
        analyzer as unknown as {
          deleteAll(handles: ProviderFileHandle[]): Promise<ProviderFileDeletionResult[]>;
        }
      ).deleteAll([makeHandle("file-3")]),
    ).rejects.toThrow(/Support reference/);
  });

  it("wraps an initial deleteFile throw and still attempts cleanup persistence", async () => {
    const lifecycle = new MemoryExternalFileLifecycleStore();
    const authorization = await createAuthorization();
    const provider = new FakeNativeProvider();
    let calls = 0;
    provider.deleteFile = async () => {
      calls++;
      if (calls === 1) {
        throw new Error("network timeout");
      }
      return { deleted: true, attempts: calls, statusCode: 200 };
    };

    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader: new MemoryBytesLoader(new Uint8Array([1, 2, 3])),
      authorization,
      fileLifecycleStore: lifecycle,
    });
    const record = await lifecycle.recordUpload({
      authorizationId: authorization.id,
      analysisRequestId: undefined,
      policyDocumentId: "doc-1",
      providerFileId: "pending",
      uploadStatus: "started",
    });
    (analyzer as unknown as { lifecycleRecords: Map<string, string> }).lifecycleRecords.set(
      "doc-1",
      record.id,
    );

    const results = await (
      analyzer as unknown as {
        deleteAll(handles: ProviderFileHandle[]): Promise<ProviderFileDeletionResult[]>;
      }
    ).deleteAll([makeHandle("file-4")]);

    expect(calls).toBe(2);
    expect(results[0].deleted).toBe(true);
    expect(lifecycle.getRecords().length).toBe(1);
    expect(lifecycle.getRecords()[0].deletionStatus).toBe("deleted");
  });
});
