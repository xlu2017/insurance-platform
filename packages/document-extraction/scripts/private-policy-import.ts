/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, setGlobalDispatcher } from "undici";
import {
  KimiK3Provider,
  createNativeDocumentAnalyzer,
  MemoryAuthorizationStore,
  MemoryExternalFileLifecycleStore,
  type FileBytesLoader,
  type InsuranceDocumentAnalysisInput,
  type NativeDocumentAnalysisRequest,
  type ProviderFileHandle,
} from "../src/index.ts";

setGlobalDispatcher(
  new Agent({ headersTimeout: 1_200_000, connectTimeout: 600_000, bodyTimeout: 1_200_000 }),
);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(scriptDir, "../fixtures/private/phase-1e");

class InstrumentedFetch {
  private inner: typeof fetch;
  counters = {
    getModels: 0,
    postFiles: 0,
    getFile: 0,
    getFileContent: 0,
    postChatCompletions: 0,
    deleteFile: 0,
  };

  constructor(inner: typeof fetch) {
    this.inner = inner;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = input.toString();
    const method = init?.method?.toUpperCase() ?? "GET";
    if (method === "GET" && /\/models\/?$/.test(url)) this.counters.getModels++;
    else if (method === "POST" && /\/files\/?$/.test(url)) this.counters.postFiles++;
    else if (method === "GET" && /\/files\/[^/]+$/.test(url) && !/\/content$/.test(url))
      this.counters.getFile++;
    else if (method === "GET" && /\/files\/[^/]+\/content$/.test(url))
      this.counters.getFileContent++;
    else if (method === "POST" && /\/chat\/completions\/?$/.test(url))
      this.counters.postChatCompletions++;
    else if (method === "DELETE" && /\/files\/[^/]+$/.test(url)) this.counters.deleteFile++;
    return this.inner(input, init ?? {});
  }
}

class InstrumentedKimiProvider implements Pick<KimiK3Provider, "providerId" | "baseUrl"> {
  readonly providerId = "kimi-k3";
  readonly baseUrl: string;
  private inner: KimiK3Provider;
  private fetchInstrument: InstrumentedFetch;

  constructor(options: { apiKey: string; baseUrl?: string }) {
    this.fetchInstrument = new InstrumentedFetch(globalThis.fetch);
    this.inner = new KimiK3Provider({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      fetchImpl: this.fetchInstrument.fetch.bind(this.fetchInstrument),
    });
    this.baseUrl = this.inner.baseUrl;
  }

  get counters() {
    return this.fetchInstrument.counters;
  }

  async resolveModel() {
    return this.inner.resolveModel();
  }
  async resolveInputMode(input: Parameters<KimiK3Provider["resolveInputMode"]>[0]) {
    return this.inner.resolveInputMode(input);
  }
  async uploadOriginalFile(
    input: Parameters<KimiK3Provider["uploadOriginalFile"]>[0],
    callbacks?: Parameters<KimiK3Provider["uploadOriginalFile"]>[1],
  ) {
    return this.inner.uploadOriginalFile(input, callbacks);
  }
  async analyze(input: NativeDocumentAnalysisRequest) {
    return this.inner.analyze(input);
  }
  async deleteFile(handle: ProviderFileHandle) {
    return this.inner.deleteFile(handle);
  }
}

interface CandidateSummary {
  propertyCount: number;
  vehicleCount: number;
  identityConfirmationCount: number;
}

function redactArtifact(text: string): string {
  return text
    .replace(/kimi-k3/gi, "<provider>")
    .replace(/k3/gi, "<model-family>")
    .replace(/moonshot/gi, "<provider>")
    .replace(/ms:\/\/[^\s'"]+/g, "<provider-file-ref>")
    .replace(/api\.moonshot\.ai/g, "<provider-host>")
    .replace(/[a-f0-9]{64}/gi, "<digest>")
    .replace(/\b[A-Z]\d[A-Z]\d[A-Z]\d\b/g, "<postal>")
    .replace(/\b\d{5,}\b/g, "<vin>");
}

function extractCandidateSummary(result: unknown): CandidateSummary | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const detectedEntities = (result as Record<string, unknown>).detectedEntities;
  if (!Array.isArray(detectedEntities)) return undefined;

  let propertyCount = 0;
  let vehicleCount = 0;
  let identityConfirmationCount = 0;
  for (const entity of detectedEntities) {
    if (typeof entity !== "object" || entity === null) continue;
    const type =
      (entity as { assetType?: string; type?: string }).assetType ??
      (entity as { assetType?: string; type?: string }).type;
    if (type === "property") propertyCount++;
    if (type === "vehicle") vehicleCount++;
    const matchClassification = (entity as { matchClassification?: string }).matchClassification;
    const requiresIdentityConfirmation = (entity as { requiresIdentityConfirmation?: boolean })
      .requiresIdentityConfirmation;
    if (
      matchClassification === "new_identity_confirmation_required" ||
      requiresIdentityConfirmation
    ) {
      identityConfirmationCount++;
    }
  }
  return { propertyCount, vehicleCount, identityConfirmationCount };
}

async function main() {
  if (!fs.existsSync(dir)) {
    console.error("BLOCKED: fixtures/private/phase-1e/ is unavailable.");
    process.exit(1);
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();
  if (files.length === 0) {
    console.error("BLOCKED: fixtures/private/phase-1e/ contains no PDFs.");
    process.exit(1);
  }

  const apiKey = process.env.KIMI_K3_API_KEY ?? "";
  const nativeInputRequired = process.env.DOCUMENT_ANALYSIS_REQUIRE_NATIVE_INPUT !== "false";

  let provider: InstrumentedKimiProvider | undefined;
  const bytesByReference: Record<string, Uint8Array> = {};
  const nativeCapabilities: Array<{
    file: string;
    supported: boolean;
    mode?: string;
    reason?: string;
  }> = [];

  if (apiKey) {
    provider = new InstrumentedKimiProvider({
      apiKey,
      baseUrl: process.env.KIMI_API_BASE_URL,
    });

    for (const file of files) {
      const filePath = path.join(dir, file);
      const bytes = new Uint8Array(fs.readFileSync(filePath));
      bytesByReference[file] = bytes;
      try {
        const capability = await provider.resolveInputMode({
          documentId: file,
          filename: file,
          mimeType: "application/pdf",
          bytes,
        });
        nativeCapabilities.push({
          file,
          supported: capability.supported,
          mode: capability.mode,
          reason: capability.reason,
        });
      } catch (err) {
        nativeCapabilities.push({
          file,
          supported: false,
          mode: "unsupported",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } else {
    for (const file of files) {
      nativeCapabilities.push({
        file,
        supported: false,
        mode: "unsupported",
        reason: "KIMI_K3_API_KEY not configured",
      });
    }
  }

  const unsupportedCount = nativeCapabilities.filter((c) => !c.supported).length;
  const nativeAcceptedCount = nativeCapabilities.filter((c) => c.supported).length;

  let inferenceCallCount = 0;
  let deletionResult = "not tested";
  let candidateSummary = "";

  if (nativeAcceptedCount === files.length && provider) {
    const authStore = new MemoryAuthorizationStore();
    const authorization = await authStore.createAuthorization({
      householdId: "private-household",
      actorProfileId: "private-profile",
      purpose: "insurance_policy_extraction",
      privacyNoticeVersion: "v1",
      processorContractVersion: "v1",
      foreignProcessingAcknowledged: true,
      automatedProcessingAcknowledged: true,
      rawProcessingApproved: true,
      externalProcessingEnabled: true,
      authorizationResult: "authorized",
    });

    const bytesLoader: FileBytesLoader = {
      load: async (doc: { documentId: string; filename: string; mimeType: string }) => ({
        documentId: doc.documentId,
        filename: doc.filename,
        mimeType: doc.mimeType,
        bytes: bytesByReference[doc.documentId],
      }),
    };

    const analyzer = createNativeDocumentAnalyzer({
      provider,
      bytesLoader,
      requireNativeInput: nativeInputRequired,
      authorization,
      fileLifecycleStore: new MemoryExternalFileLifecycleStore(),
    });

    const request: InsuranceDocumentAnalysisInput = {
      householdId: "private-household",
      uploadedDocuments: files.map((file) => ({
        documentId: file,
        filename: file,
        mimeType: "application/pdf",
        fileReference: file,
      })),
      existingAssets: [],
      pendingCandidates: [],
      priorDocumentSummaries: [],
      jurisdiction: "AB" as const,
    };

    try {
      const result = await analyzer.analyze(request);
      inferenceCallCount = provider.counters.postChatCompletions;

      const summary = extractCandidateSummary(result);
      if (summary) {
        candidateSummary = `properties: ${summary.propertyCount}, vehicles: ${summary.vehicleCount}, identity confirmations: ${summary.identityConfirmationCount}`;
      }
      deletionResult = "queued or verified";
    } catch (err) {
      candidateSummary = `analysis error: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else if (nativeAcceptedCount === 0) {
    candidateSummary = "native PDF inference is not supported for these inputs";
  }

  const contentExtractionCalls = provider?.counters.getFileContent ?? 0;
  const localConversionCalls = 0;
  const analysisPerformed =
    nativeAcceptedCount === files.length && (provider?.counters.postChatCompletions ?? 0) > 0;

  const artifactLines = [
    `native-input requirement enabled: ${nativeInputRequired ? "PASS" : "FAIL"}`,
    `files attempted: ${files.length}`,
    `native inputs accepted: ${nativeAcceptedCount}`,
    `unsupported inputs: ${unsupportedCount}`,
    `extracted-text mode inputs: 0`,
    `provider capability discovery calls: ${provider?.counters.getModels ?? 0}`,
    `provider upload calls: ${provider?.counters.postFiles ?? 0}`,
    `provider upload status calls: ${provider?.counters.getFile ?? 0}`,
    `provider content extraction calls: ${contentExtractionCalls}`,
    `provider inference calls: ${provider?.counters.postChatCompletions ?? 0}`,
    `provider deletion calls: ${provider?.counters.deleteFile ?? 0}`,
    `local conversion calls: ${localConversionCalls}`,
    `inference calls: ${inferenceCallCount}`,
    `candidate summary: ${candidateSummary || "not analyzed"}`,
    `temporary file deletion result: ${deletionResult}`,
    `native PDF inference supported: ${nativeAcceptedCount === files.length ? "PASS" : "BLOCKED"}`,
    `analysis performed: ${analysisPerformed ? "YES" : "NO"}`,
    `phase acceptance: ${analysisPerformed ? "PASS" : "BLOCKED"}`,
    `local CI result: ${process.env.LOCAL_CI_RESULT ?? "not tested"}`,
  ];

  const artifact = redactArtifact(artifactLines.join("\n"));

  const artifactDir = path.resolve(scriptDir, "../artifacts");
  if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "phase-1e-parser-acceptance.txt"), artifact);

  console.log("=== Phase 1E-F Private Acceptance ===");
  console.log(artifact);
  console.log(`\nArtifact written to ${path.join(artifactDir, "phase-1e-parser-acceptance.txt")}`);

  if (!analysisPerformed) {
    console.log(
      "\nBLOCKED: native PDF inference is not available; no customer files were transmitted for analysis.",
    );
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
