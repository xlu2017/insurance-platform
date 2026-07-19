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

export interface KimiK3ProviderOptions {
  apiKey: string;
  baseUrl?: string;
  requestedModel?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface KimiFileObject {
  id: string;
  object: string;
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
  status: string;
  status_details?: string;
  file_type?: string;
}

interface KimiModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
  context_length: number;
  supports_image_in?: boolean;
  supports_video_in?: boolean;
  supports_file_in?: boolean;
  supports_reasoning?: boolean;
  supports_dynamic_tools?: boolean;
  think_efforts?: { support: boolean; valid_efforts: string[]; default_effort: string };
  reasoning_efforts?: { support: boolean; valid_efforts: string[]; default_effort: string };
  supports_thinking_type?: string;
  [key: string]: unknown;
}

export class KimiK3Provider implements NativeDocumentAnalysisProvider {
  readonly providerId = "kimi-k3";
  readonly baseUrl: string;
  private apiKey: string;
  private requestedModel?: string;
  private resolvedModel: ResolvedDocumentModel | null = null;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: KimiK3ProviderOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.moonshot.ai/v1").replace(/\/+$/, "");
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

    if (this.requestedModel) {
      const model = await this.fetchModel(this.requestedModel);
      if (model) {
        this.resolvedModel = this.toResolvedModel(model);
        return this.resolvedModel;
      }
      throw new Error("Document model unavailable");
    }

    const models = await this.listModels();
    const k3 = models.find((m) => m.id.toLowerCase().includes("kimi-k3"));
    if (!k3) {
      throw new Error("Document model unavailable");
    }

    this.resolvedModel = this.toResolvedModel(k3);
    return this.resolvedModel;
  }

  private toResolvedModel(model: KimiModel): ResolvedDocumentModel {
    return {
      modelId: model.id,
      supportsImageInput: !!model.supports_image_in,
      supportsVideoInput: !!model.supports_video_in,
      supportsGenericFileInput: false,
      supportedReferenceSchemes: ["ms://"],
      providerMetadata: {
        owned_by: model.owned_by,
        context_length: model.context_length,
        supports_reasoning: model.supports_reasoning,
        supports_dynamic_tools: model.supports_dynamic_tools,
        reasoning_efforts: model.reasoning_efforts,
        supports_thinking_type: model.supports_thinking_type,
      },
    };
  }

  private async listModels(): Promise<KimiModel[]> {
    const response = await this.fetch(`${this.baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Document model list failed: ${response.status} ${text.slice(0, 200)}`);
    }
    const body = (await response.json()) as { data?: KimiModel[] };
    return body.data ?? [];
  }

  private async fetchModel(modelId: string): Promise<KimiModel | undefined> {
    const models = await this.listModels();
    return models.find((m) => m.id === modelId);
  }

  async resolveInputMode(input: OriginalFileInput): Promise<ResolvedInputCapability> {
    const model = await this.resolveModel();
    const mime = (input.mimeType || "").toLowerCase().trim();

    if (mime.startsWith("image/") && model.supportsImageInput) {
      return { mimeType: input.mimeType, mode: "native_image_reference", supported: true };
    }
    if (mime.startsWith("video/") && model.supportsVideoInput) {
      return { mimeType: input.mimeType, mode: "native_video_reference", supported: true };
    }
    if (mime.startsWith("image/")) {
      return {
        mimeType: input.mimeType,
        mode: "unsupported",
        supported: false,
        reason: "Image input is not supported by the resolved document model",
      };
    }
    if (mime.startsWith("video/")) {
      return {
        mimeType: input.mimeType,
        mode: "unsupported",
        supported: false,
        reason: "Video input is not supported by the resolved document model",
      };
    }
    // Generic native file references are not implemented and tested for this provider.
    return {
      mimeType: input.mimeType,
      mode: "unsupported",
      supported: false,
      reason: "Native file reference is not supported for this file type",
    };
  }

  async uploadOriginalFile(input: OriginalFileInput): Promise<ProviderUploadResult> {
    const capability = await this.resolveInputMode(input);

    if (!capability.supported) {
      return {
        status: "rejected",
        errorCategory: capability.reason ?? "unsupported_file_type",
      };
    }

    const purpose =
      capability.mode === "native_image_reference"
        ? "image"
        : capability.mode === "native_video_reference"
          ? "video"
          : "file";

    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", new Blob([input.bytes], { type: input.mimeType }), input.filename);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(`${this.baseUrl}/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          status: "failed",
          errorCategory: `upload_failed_${response.status}`,
        };
      }
      const file = (await response.json()) as KimiFileObject;
      const referenceScheme = (await this.resolveModel()).supportedReferenceSchemes[0] ?? "ms://";
      const handle: ProviderFileHandle = {
        providerFileId: file.id,
        documentId: input.documentId,
        filename: file.filename ?? input.filename,
        mimeType: input.mimeType,
        bytes: file.bytes ?? input.bytes.length,
        mode: capability.mode,
        reference: `${referenceScheme}${file.id}`,
        status: file.status,
        statusDetails: file.status_details,
        providerMetadata: {
          file_type: file.file_type,
          created_at: file.created_at,
          purpose: file.purpose,
        },
      };

      const finalStatus = await this.pollFileStatus(file.id);
      if (finalStatus.status !== "ok" && finalStatus.status !== "processed") {
        return {
          status: finalStatus.status as ProviderUploadResult["status"],
          handle,
          errorCategory: finalStatus.errorCategory ?? "upload_processing_failed",
        };
      }

      return { status: "ready", handle };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async pollFileStatus(
    fileId: string,
  ): Promise<{ status: string; errorCategory?: string }> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const response = await this.fetch(`${this.baseUrl}/files/${fileId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) {
        return { status: "failed", errorCategory: `status_poll_${response.status}` };
      }
      const file = (await response.json()) as KimiFileObject;
      if (file.status === "ok" || file.status === "processed") {
        return { status: file.status };
      }
      if (file.status === "error") {
        return { status: "failed", errorCategory: file.status_details ?? "upload_error" };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { status: "timed_out", errorCategory: "status_poll_timeout" };
  }

  async analyze(input: NativeDocumentAnalysisRequest): Promise<unknown> {
    const userParts: unknown[] = [{ type: "text", text: input.userPrompt }];

    for (const file of input.files) {
      if (file.mode === "native_image_reference" && file.reference) {
        userParts.push({ type: "image_url", image_url: { url: file.reference } });
      } else if (file.mode === "native_video_reference" && file.reference) {
        userParts.push({ type: "video_url", video_url: { url: file.reference } });
      } else if (file.mode === "native_file_reference" && file.reference) {
        // A generic native file content part is not yet exposed by the documented API.
        throw new Error("Native file reference is not supported by the resolved document model");
      }
    }

    const messages = [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: userParts },
    ];

    const body: Record<string, unknown> = {
      model: input.model,
      messages,
      response_format: input.responseFormat ?? { type: "json_object" },
      max_tokens: 32000,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
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
      const completion = (await response.json()) as {
        id?: string;
        choices?: { message?: { content?: string; reasoning_content?: string } }[];
      };
      const content = completion.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("Document analysis response did not contain text content");
      }
      return JSON.parse(stripMarkdownJsonFence(content));
    } finally {
      clearTimeout(timeout);
    }
  }

  async deleteFile(handle: ProviderFileHandle): Promise<ProviderFileDeletionResult> {
    const maxAttempts = 3;
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const response = await this.fetch(`${this.baseUrl}/files/${handle.providerFileId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        if (response.ok) {
          return { deleted: true, attempts, statusCode: response.status };
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return {
            deleted: false,
            attempts,
            statusCode: response.status,
            failureCategory: `deletion_client_error_${response.status}`,
          };
        }
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
        }
      } catch (err) {
        if (attempts >= maxAttempts) {
          return {
            deleted: false,
            attempts,
            failureCategory: err instanceof Error ? err.message : "network_error",
          };
        }
      }
    }
    return { deleted: false, attempts, failureCategory: "deletion_failed_after_retries" };
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
