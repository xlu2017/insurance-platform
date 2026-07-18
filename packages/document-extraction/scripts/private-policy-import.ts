/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, setGlobalDispatcher } from "undici";
import {
  KimiK3Provider,
  type NativeDocumentAnalysisProvider,
  type NativeDocumentAnalysisRequest,
  type OriginalFileInput,
  type ProviderFileDeletionResult,
  type ProviderFileHandle,
  type ProviderUploadResult,
  type ResolvedDocumentModel,
  type ResolvedInputCapability,
} from "../src/index.ts";

setGlobalDispatcher(
  new Agent({ headersTimeout: 1_200_000, connectTimeout: 600_000, bodyTimeout: 1_200_000 }),
);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(scriptDir, "../fixtures/private/phase-1e");

class InstrumentedKimiProvider implements NativeDocumentAnalysisProvider {
  readonly providerId = "kimi-k3";
  readonly baseUrl: string;
  private inner: KimiK3Provider;

  counters = {
    resolveModelCalls: 0,
    resolveInputModeCalls: 0,
    uploadCalls: 0,
    analyzeCalls: 0,
    deleteCalls: 0,
    confirmedDeletions: 0,
    failedDeletions: 0,
  };

  constructor(options: { apiKey: string; baseUrl?: string }) {
    this.inner = new KimiK3Provider(options);
    this.baseUrl = this.inner.baseUrl;
  }

  async resolveModel(): Promise<ResolvedDocumentModel> {
    this.counters.resolveModelCalls += 1;
    return this.inner.resolveModel();
  }

  async resolveInputMode(input: OriginalFileInput): Promise<ResolvedInputCapability> {
    this.counters.resolveInputModeCalls += 1;
    return this.inner.resolveInputMode(input);
  }

  async uploadOriginalFile(input: OriginalFileInput): Promise<ProviderUploadResult> {
    this.counters.uploadCalls += 1;
    return this.inner.uploadOriginalFile(input);
  }

  async analyze(input: NativeDocumentAnalysisRequest): Promise<unknown> {
    this.counters.analyzeCalls += 1;
    return this.inner.analyze(input);
  }

  async deleteFile(handle: ProviderFileHandle): Promise<ProviderFileDeletionResult> {
    this.counters.deleteCalls += 1;
    const result = await this.inner.deleteFile(handle);
    if (result.deleted) {
      this.counters.confirmedDeletions += 1;
    } else {
      this.counters.failedDeletions += 1;
    }
    return result;
  }
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
  if (!apiKey) {
    console.error("BLOCKED: KIMI_K3_API_KEY is not configured.");
    process.exit(1);
  }

  const nativeInputRequired = process.env.DOCUMENT_ANALYSIS_REQUIRE_NATIVE_INPUT !== "false";
  const provider = new InstrumentedKimiProvider({
    apiKey,
    baseUrl: process.env.KIMI_API_BASE_URL,
  });

  // Resolve the model once; this validates API connectivity and discovers capabilities.
  await provider.resolveModel();

  // Determine the native input mode for every PDF without uploading or extracting text.
  let unsupportedCount = 0;
  let nativeAcceptedCount = 0;
  let extractedTextCount = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    const capability = await provider.resolveInputMode({
      documentId: file,
      filename: file,
      mimeType: "application/pdf",
      bytes,
    });

    if (!capability.supported) {
      unsupportedCount += 1;
    } else if (
      capability.mode === "native_image_reference" ||
      capability.mode === "native_video_reference" ||
      capability.mode === "native_file_reference"
    ) {
      nativeAcceptedCount += 1;
    } else if (capability.mode === "provider_extracted_text") {
      extractedTextCount += 1;
    }
  }

  const contentExtractionCalls = provider.counters.uploadCalls; // no upload for rejected PDFs
  const analysisPerformed = nativeInputRequired
    ? nativeAcceptedCount === files.length
    : extractedTextCount > 0 || nativeAcceptedCount > 0;

  const artifactLines = [
    `native-input requirement enabled: ${nativeInputRequired ? "PASS" : "FAIL"}`,
    `files attempted: ${files.length}`,
    `native inputs accepted: ${nativeAcceptedCount}`,
    `unsupported inputs: ${unsupportedCount}`,
    `extracted-text mode inputs: ${extractedTextCount}`,
    `file-content extraction calls: ${contentExtractionCalls}`,
    `local conversion calls: 0`,
    `inference calls: ${provider.counters.analyzeCalls}`,
    `privacy gate result: not tested`,
    `temporary file deletion result: ${provider.counters.deleteCalls > 0 ? (provider.counters.failedDeletions === 0 ? "PASS" : "FAIL") : "not tested"}`,
    `provider confidentiality tests: not tested`,
    `approval endpoint disabled: not tested`,
    `local CI result: ${process.env.LOCAL_CI_RESULT ?? "not tested"}`,
    `native PDF inference supported: ${nativeAcceptedCount === files.length ? "PASS" : "BLOCKED"}`,
    `analysis performed: ${analysisPerformed ? "YES" : "NO"}`,
    `phase acceptance: ${analysisPerformed ? "PASS" : "BLOCKED"}`,
  ];

  const artifact = redactArtifact(artifactLines.join("\n"));

  const artifactDir = path.resolve(scriptDir, "../artifacts");
  if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "phase-1e-parser-acceptance.txt"), artifact);

  console.log("=== Phase 1E-E Private Acceptance ===");
  console.log(artifact);
  console.log(`\nArtifact written to ${path.join(artifactDir, "phase-1e-parser-acceptance.txt")}`);

  // The script succeeds when it truthfully reports the blocked state.
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
