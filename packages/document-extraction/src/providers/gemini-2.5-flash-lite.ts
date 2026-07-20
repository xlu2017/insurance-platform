import {
  type NativeDocumentAnalysisProvider,
  type NativeDocumentAnalysisRequest,
  type OriginalFileInput,
  type ProviderFileDeletionResult,
  type ProviderFileHandle,
  type ProviderUploadResult,
  type ResolvedDocumentModel,
  type ResolvedInputCapability,
} from "./native-document-analysis.ts";

export interface GeminiFlashLiteProviderOptions {
  apiKey: string;
  baseUrl?: string;
  requestedModel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface GeminiContent {
  role?: "user" | "model";
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
}

const DEFAULT_MODEL = "gemini-2.5-flash";
const FALLBACK_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash"];
const CONTEXT_LENGTH = 1_048_576;

function isGeminiModel(modelId: string): boolean {
  return modelId.toLowerCase().includes("gemini") || modelId.toLowerCase().includes("flash");
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 65536;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function parseMoneyToCents(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Number.isInteger(value) ? value : Math.round(value * 100);
  }
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const [dollars, cents = "00"] = normalized.split(".");
  const whole = parseInt(dollars || "0", 10);
  const fraction = parseInt((cents + "00").slice(0, 2), 10);
  return whole * 100 + fraction;
}

function parseDate(value: unknown): string | null {
  if (typeof value === "string") {
    const iso = value.replace(/\//g, "-").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.start_date === "string") return parseDate(obj.start_date);
  }
  return null;
}

function extractCurrentValue(
  raw: unknown,
): { status: string; value: unknown; confidence: number } | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") {
    const typed = raw as Record<string, unknown>;
    if (typeof typed.status === "string") {
      return {
        status: typed.status,
        value: Object.prototype.hasOwnProperty.call(typed, "value") ? typed.value : null,
        confidence: typeof typed.confidence === "number" ? typed.confidence : 0.85,
      };
    }
  }
  return { status: "known", value: raw, confidence: 0.85 };
}

function transformGeminiResponse(raw: unknown, documentIds: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    throw new Error("Gemini response is not a JSON object");
  }
  const typed = raw as Record<string, unknown>;
  const firstDocId = documentIds[0] ?? "doc-1";
  const allowedDocIds = new Set(documentIds);

  const transformEntity = (entity: unknown, index: number): Record<string, unknown> => {
    if (!entity || typeof entity !== "object") {
      throw new Error(`detectedEntities[${index}] is not an object`);
    }
    const e = entity as Record<string, unknown>;
    const identity = (
      typeof e.identity === "object" && e.identity !== null ? e.identity : {}
    ) as Record<string, unknown>;
    const currentPolicyRaw = (
      typeof e.currentPolicy === "object" && e.currentPolicy !== null ? e.currentPolicy : {}
    ) as Record<string, unknown>;

    const annualPremiumCents = parseMoneyToCents(
      currentPolicyRaw.annualPremiumCents ??
        currentPolicyRaw.premium_cents ??
        currentPolicyRaw.total_annual_amount,
    );

    const currentPolicy: Record<string, unknown> = {
      insurer: currentPolicyRaw.insurer ?? null,
      policyNumber: currentPolicyRaw.policyNumber ?? currentPolicyRaw.policy_number ?? null,
      effectiveDate: parseDate(
        currentPolicyRaw.effectiveDate ??
          currentPolicyRaw.effective_date ??
          currentPolicyRaw.term_of_coverage,
      ),
      expiryDate: parseDate(
        currentPolicyRaw.expiryDate ??
          currentPolicyRaw.expiry_date ??
          currentPolicyRaw.renewal_term,
      ),
      annualPremiumCents,
    };

    const rawCoverage = (
      typeof e.currentCoverage === "object" && e.currentCoverage !== null
        ? e.currentCoverage
        : typeof e.coverage === "object" && e.coverage !== null
          ? e.coverage
          : {}
    ) as Record<string, unknown>;
    const currentCoverage: Record<string, unknown> = {};
    for (const [fieldPath, rawValue] of Object.entries(rawCoverage)) {
      const parsed = extractCurrentValue(rawValue);
      if (parsed) currentCoverage[fieldPath] = parsed;
    }

    const sanitizeEvidence = (item: unknown): Record<string, unknown> | null => {
      if (!item || typeof item !== "object") return null;
      const ref = item as Record<string, unknown>;
      const docId =
        typeof ref.documentId === "string" && allowedDocIds.has(ref.documentId)
          ? ref.documentId
          : firstDocId;
      const pageNumber = typeof ref.pageNumber === "number" ? ref.pageNumber : 1;
      const quotedLabel =
        typeof ref.quotedLabel === "string" && ref.quotedLabel.length > 0
          ? ref.quotedLabel
          : "Extracted from document";
      const evidenceSummary =
        typeof ref.evidenceSummary === "string" && ref.evidenceSummary.length > 0
          ? ref.evidenceSummary
          : "Document analysis";
      return { documentId: docId, pageNumber, quotedLabel, evidenceSummary };
    };

    const evidenceArray = Array.isArray(e.evidence) ? e.evidence : [];
    let evidence = evidenceArray
      .map(sanitizeEvidence)
      .filter((x): x is Record<string, unknown> => x !== null);
    if (evidence.length === 0) {
      evidence = [
        {
          documentId: firstDocId,
          pageNumber: 1,
          quotedLabel: "Document analysis",
          evidenceSummary: "Extracted from uploaded PDF",
        },
      ];
    }

    const rawResolution = (
      typeof e.resolution === "object" && e.resolution !== null ? e.resolution : {}
    ) as Record<string, unknown>;
    const resolution = {
      status: [
        "new",
        "matches_existing",
        "matches_pending_candidate",
        "possible_match_requires_confirmation",
      ].includes(String(rawResolution.status))
        ? String(rawResolution.status)
        : "new",
      confidence: typeof rawResolution.confidence === "number" ? rawResolution.confidence : 0.85,
      reasoning:
        typeof rawResolution.reasoning === "string" && rawResolution.reasoning.length > 0
          ? rawResolution.reasoning
          : "Extracted from uploaded documents",
    };

    const displayLabel =
      typeof e.displayLabel === "string" && e.displayLabel.length > 0
        ? e.displayLabel
        : identity.year && identity.make && identity.model
          ? `${identity.year} ${identity.make} ${identity.model}`
          : String(identity.fullAddress ?? identity.postalCode ?? `entity-${index}`);

    const temporaryId =
      typeof e.temporaryId === "string" && e.temporaryId.length > 0
        ? e.temporaryId
        : crypto.randomUUID();

    return {
      temporaryId,
      entityType:
        e.entityType === "vehicle" || e.entityType === "property" ? e.entityType : "property",
      displayLabel,
      identity: {
        fullAddress: identity.fullAddress ?? null,
        city: identity.city ?? null,
        province: identity.province ?? null,
        postalCode: identity.postalCode ?? null,
        occupancy: ["principal_residence", "rental", "other", "unknown"].includes(
          String(identity.occupancy),
        )
          ? identity.occupancy
          : null,
        vin: identity.vin ?? null,
        year: typeof identity.year === "number" ? identity.year : null,
        make: identity.make ?? null,
        model: identity.model ?? null,
        trim: identity.trim ?? null,
        vehicleUse: identity.vehicleUse ?? null,
      },
      resolution,
      currentPolicy,
      currentCoverage,
      mandateSuggestions:
        typeof e.mandateSuggestions === "object" && e.mandateSuggestions !== null
          ? e.mandateSuggestions
          : {},
      evidence,
      requiredConfirmations: Array.isArray(e.requiredConfirmations)
        ? e.requiredConfirmations.filter((x): x is string => typeof x === "string" && x.length > 0)
        : [],
    };
  };

  const detectedEntities = Array.isArray(typed.detectedEntities)
    ? typed.detectedEntities.map(transformEntity)
    : [];

  const unresolvedConflicts = Array.isArray(typed.unresolvedConflicts)
    ? typed.unresolvedConflicts.filter((x) => typeof x === "object" && x !== null)
    : [];

  const warnings = Array.isArray(typed.warnings)
    ? typed.warnings.filter((x) => typeof x === "object" && x !== null)
    : [];

  return {
    ...typed,
    detectedEntities,
    unresolvedConflicts,
    warnings,
  };
}

export class GeminiFlashLiteProvider implements NativeDocumentAnalysisProvider {
  readonly providerId = "gemini";
  readonly baseUrl: string;
  private apiKey: string;
  private requestedModel?: string;
  private resolvedModel: ResolvedDocumentModel | null = null;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: GeminiFlashLiteProviderOptions) {
    this.baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/+$/,
      "",
    );
    this.apiKey = options.apiKey;
    this.requestedModel = options.requestedModel;
    this.timeoutMs = options.timeoutMs ?? 1_200_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private fetch(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    return this.fetchImpl(...args);
  }

  async resolveModel(): Promise<ResolvedDocumentModel> {
    if (this.resolvedModel) return this.resolvedModel;
    const modelId =
      this.requestedModel && isGeminiModel(this.requestedModel)
        ? this.requestedModel
        : DEFAULT_MODEL;
    this.resolvedModel = {
      modelId,
      supportsImageInput: true,
      supportsVideoInput: false,
      supportsGenericFileInput: true,
      supportedReferenceSchemes: ["gemini://"],
      providerMetadata: {
        context_length: CONTEXT_LENGTH,
        owned_by: "google",
      },
    };
    return this.resolvedModel;
  }

  async resolveInputMode(input: OriginalFileInput): Promise<ResolvedInputCapability> {
    const mime = (input.mimeType || "").toLowerCase().trim();
    if (mime === "application/pdf" || mime.startsWith("image/")) {
      return { mimeType: input.mimeType, mode: "provider_extracted_text", supported: true };
    }
    return {
      mimeType: input.mimeType,
      mode: "unsupported",
      supported: false,
      reason: "Gemini only supports PDF and image inputs in this integration",
    };
  }

  async assertBatchFits(inputs: OriginalFileInput[]): Promise<void> {
    const estimatedInputTokens = inputs.reduce((total, input) => {
      if (input.mimeType.toLowerCase() === "application/pdf") {
        return total + Math.ceil(input.bytes.length / 4);
      }
      if (input.mimeType.toLowerCase().startsWith("image/")) return total + 4_096;
      return total + Math.ceil(input.bytes.length / 4);
    }, 8_000);
    const outputReserve = 12_000;
    if (estimatedInputTokens + outputReserve > Math.floor(CONTEXT_LENGTH * 0.9)) {
      throw new Error("Document batch exceeds the resolved model context capacity");
    }
  }

  async uploadOriginalFile(input: OriginalFileInput): Promise<ProviderUploadResult> {
    const capability = await this.resolveInputMode(input);
    if (!capability.supported) {
      return { status: "rejected", errorCategory: capability.reason ?? "unsupported_file_type" };
    }
    const base64 = bytesToBase64(input.bytes);
    const providerFileId = crypto.randomUUID();
    const handle: ProviderFileHandle = {
      providerFileId,
      documentId: input.documentId,
      filename: input.filename,
      mimeType: input.mimeType,
      bytes: input.bytes.length,
      mode: capability.mode,
      reference: `gemini://${providerFileId}`,
      status: "ready",
      providerMetadata: {
        base64,
        originalMimeType: input.mimeType,
      },
      transientExtractedContent: base64,
    };
    return { status: "ready", handle };
  }

  async analyze(input: NativeDocumentAnalysisRequest): Promise<unknown> {
    await this.resolveModel();
    const models = [input.model, ...FALLBACK_MODELS];
    let lastError: unknown;

    for (const modelId of models) {
      try {
        return await this.tryAnalyzeWithModel(input, modelId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes("503") ||
          message.includes("429") ||
          message.includes("high demand") ||
          message.includes("temporarily unavailable") ||
          message.includes("UNAVAILABLE") ||
          message.includes("overloaded") ||
          message.includes("not found") ||
          message.includes("404") ||
          message.includes("no longer available")
        ) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw lastError ?? new Error("Document analysis failed on all Gemini models");
  }

  private async tryAnalyzeWithModel(
    input: NativeDocumentAnalysisRequest,
    modelId: string,
  ): Promise<unknown> {
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: input.userPrompt },
    ];
    for (const file of input.files) {
      const base64 =
        typeof file.transientExtractedContent === "string"
          ? file.transientExtractedContent
          : typeof file.providerMetadata?.base64 === "string"
            ? file.providerMetadata.base64
            : undefined;
      if (!base64) {
        throw new Error("Gemini provider missing inline data for file");
      }
      parts.push({ inlineData: { mimeType: file.mimeType, data: base64 } });
    }
    const contents: GeminiContent[] = [{ role: "user", parts }];
    const body: Record<string, unknown> = {
      model: modelId,
      contents,
      systemInstruction: { parts: [{ text: input.systemPrompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 12_000,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(
        `${this.baseUrl}/models/${modelId}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Document analysis request failed: ${response.status} ${text.slice(0, 200)}`,
        );
      }
      const completion = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
        error?: { message?: string };
      };
      const text = completion.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string") {
        throw new Error("Document analysis response did not contain text content");
      }
      let parsed: unknown;
      const trimmed = text.trim();
      if (trimmed.startsWith("```")) {
        const lines = trimmed.split("\n");
        if (lines.length > 1 && lines[0].trim().toLowerCase().startsWith("```")) {
          parsed = JSON.parse(lines.slice(1, -1).join("\n").trim());
        } else {
          parsed = JSON.parse(trimmed);
        }
      } else {
        parsed = JSON.parse(trimmed);
      }
      const documentIds = input.files.map((f) => f.documentId);
      return transformGeminiResponse(parsed, documentIds);
    } finally {
      clearTimeout(timeout);
    }
  }

  async deleteFile(): Promise<ProviderFileDeletionResult> {
    return { deleted: true, attempts: 1 };
  }
}
