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

export interface OpenAiGpt5MiniProviderOptions {
  apiKey: string;
  baseUrl?: string;
  requestedModel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface ResponseOutput {
  content?: Array<{ type?: string; text?: string }>;
}

interface ResponseCompletion {
  output?: ResponseOutput[];
  error?: { message?: string };
}

const CONTEXT_LENGTH = 400_000;

export function isGpt5MiniModel(modelId: string): boolean {
  return /gpt[-_]?5[-_]?mini/i.test(modelId);
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

export class OpenAiGpt5MiniProvider implements NativeDocumentAnalysisProvider {
  readonly providerId = "openai";
  readonly baseUrl: string;
  private apiKey: string;
  private requestedModel?: string;
  private resolvedModel: ResolvedDocumentModel | null = null;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: OpenAiGpt5MiniProviderOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
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
      this.requestedModel && isGpt5MiniModel(this.requestedModel)
        ? this.requestedModel
        : "gpt-5-mini";
    this.resolvedModel = {
      modelId,
      supportsImageInput: true,
      supportsVideoInput: false,
      supportsGenericFileInput: true,
      supportedReferenceSchemes: ["openai://"],
      providerMetadata: {
        context_length: CONTEXT_LENGTH,
        owned_by: "openai",
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
      reason: "GPT-5 mini only supports PDF and image inputs in this integration",
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

  async uploadOriginalFile(
    input: OriginalFileInput,
    callbacks?: { onHandleCreated?: (handle: ProviderFileHandle) => void | Promise<void> },
  ): Promise<ProviderUploadResult> {
    const capability = await this.resolveInputMode(input);
    if (!capability.supported) {
      return { status: "rejected", errorCategory: capability.reason ?? "unsupported_file_type" };
    }
    const providerFileId = crypto.randomUUID();
    const base64 = bytesToBase64(input.bytes);
    const handle: ProviderFileHandle = {
      providerFileId,
      documentId: input.documentId,
      filename: input.filename,
      mimeType: input.mimeType,
      bytes: input.bytes.length,
      mode: capability.mode,
      reference: `openai://${providerFileId}`,
      status: "ready",
      providerMetadata: {
        base64,
        originalMimeType: input.mimeType,
      },
    };
    if (callbacks?.onHandleCreated) {
      await callbacks.onHandleCreated(handle);
    }
    return { status: "ready", handle };
  }

  async analyze(input: NativeDocumentAnalysisRequest): Promise<unknown> {
    const model = input.model || (await this.resolveModel()).modelId;
    const contents: unknown[] = [];
    for (const file of input.files) {
      const base64 =
        typeof file.transientExtractedContent === "string"
          ? file.transientExtractedContent
          : typeof file.providerMetadata?.base64 === "string"
            ? file.providerMetadata.base64
            : undefined;
      if (!base64) {
        throw new Error("OpenAI provider missing base64 data for file");
      }
      contents.push({
        type: "input_file",
        filename: file.filename,
        file_data: `data:${file.mimeType};base64,${base64}`,
        detail: "auto",
      });
    }

    const body: Record<string, unknown> = {
      model,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: input.userPrompt }, ...contents],
        },
      ],
      instructions: input.systemPrompt,
      response_format: input.responseFormat ?? { type: "json_object" },
      max_output_tokens: 12_000,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Document analysis request failed: ${response.status} ${text.slice(0, 200)}`,
        );
      }
      const completion = (await response.json()) as ResponseCompletion;
      if (completion.error?.message) {
        throw new Error(`Document analysis failed: ${completion.error.message}`);
      }
      const text = completion.output?.[0]?.content?.[0]?.text;
      if (typeof text !== "string") {
        throw new Error("Document analysis response did not contain text content");
      }
      return JSON.parse(stripMarkdownJsonFence(text));
    } finally {
      clearTimeout(timeout);
    }
  }

  async deleteFile(): Promise<ProviderFileDeletionResult> {
    return { deleted: true, attempts: 1 };
  }
}

function stripMarkdownJsonFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    if (lines.length > 1 && lines[0].trim().toLowerCase().startsWith("```json")) {
      return lines.slice(1, -1).join("\n").trim();
    }
    if (lines.length > 1 && lines[0].trim().startsWith("```")) {
      return lines.slice(1, -1).join("\n").trim();
    }
  }
  return trimmed;
}
