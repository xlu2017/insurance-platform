import {
  type NativeDocumentAnalysisProvider,
  type NativeDocumentAnalysisRequest,
  type OriginalFileInput,
  type ProviderFileHandle,
  type ResolvedDocumentModel,
} from "./native-document-analysis.ts";

export interface KimiK3ProviderOptions {
  apiKey: string;
  baseUrl?: string;
  requestedModel?: string;
  timeoutMs?: number;
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

  constructor(options: KimiK3ProviderOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.moonshot.ai/v1").replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.requestedModel = options.requestedModel;
    this.timeoutMs = options.timeoutMs ?? 1_200_000;
  }

  async resolveModel(): Promise<ResolvedDocumentModel> {
    if (this.resolvedModel) return this.resolvedModel;

    if (this.requestedModel) {
      const model = await this.fetchModel(this.requestedModel);
      if (model) {
        this.resolvedModel = this.toResolvedModel(model);
        return this.resolvedModel;
      }
      throw new Error(`Kimi configured model ${this.requestedModel} is not available`);
    }

    const models = await this.listModels();
    const k3 = models.find(
      (m) =>
        m.id.toLowerCase().includes("kimi-k3") &&
        (m.supports_image_in || m.supports_video_in || true),
    );
    if (!k3) {
      throw new Error("No Kimi K3 multimodal model is available");
    }

    this.resolvedModel = this.toResolvedModel(k3);
    return this.resolvedModel;
  }

  private toResolvedModel(model: KimiModel): ResolvedDocumentModel {
    return {
      modelId: model.id,
      supportsNativeFiles: true,
      supportsImages: !!model.supports_image_in,
      supportsVideo: !!model.supports_video_in,
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
    const response = await fetch(`${this.baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Kimi model list failed: ${response.status} ${text.slice(0, 200)}`);
    }
    const body = (await response.json()) as { data?: KimiModel[] };
    return body.data ?? [];
  }

  private async fetchModel(modelId: string): Promise<KimiModel | undefined> {
    const models = await this.listModels();
    return models.find((m) => m.id === modelId);
  }

  async uploadOriginalFile(input: OriginalFileInput): Promise<ProviderFileHandle> {
    const form = new FormData();
    form.append("purpose", "file-extract");
    form.append("file", new Blob([input.bytes], { type: input.mimeType }), input.filename);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Kimi file upload failed: ${response.status} ${text.slice(0, 200)}`);
      }
      const file = (await response.json()) as KimiFileObject;

      if (file.status !== "ok") {
        await this.pollFileStatus(file.id);
      }

      const contentResponse = await fetch(`${this.baseUrl}/files/${file.id}/content`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!contentResponse.ok) {
        const text = await contentResponse.text().catch(() => "");
        throw new Error(
          `Kimi file content retrieval failed: ${contentResponse.status} ${text.slice(0, 200)}`,
        );
      }
      const contentBody = (await contentResponse.json()) as {
        content?: string;
        file_type?: string;
        filename?: string;
      };

      return {
        providerFileId: file.id,
        documentId: input.documentId,
        filename: file.filename ?? input.filename,
        mimeType: input.mimeType,
        bytes: file.bytes,
        status: file.status,
        statusDetails: file.status_details,
        extractedText: contentBody.content ?? "",
        providerMetadata: {
          file_type: contentBody.file_type,
          created_at: file.created_at,
          purpose: file.purpose,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async pollFileStatus(fileId: string): Promise<void> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${this.baseUrl}/files/${fileId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!response.ok) break;
      const file = (await response.json()) as KimiFileObject;
      if (file.status === "ok" || file.status === "processed") break;
      if (file.status === "error") {
        throw new Error(`Kimi file processing failed: ${file.status_details ?? file.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async analyze(input: NativeDocumentAnalysisRequest): Promise<unknown> {
    const model = await this.resolveModel();
    const parts: Array<{ type: "text"; text: string }> = [];

    for (const file of input.files) {
      const label = `--- File ${file.documentId} (${file.filename}) ---`;
      parts.push({ type: "text", text: `${label}\n${file.extractedText ?? ""}` });
    }

    const userContent = `${input.userPrompt}\n\n${parts.map((p) => p.text).join("\n\n")}`;

    const messages = [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: userContent },
    ];

    const body: Record<string, unknown> = {
      model: input.model || model.modelId,
      messages,
      response_format: input.responseFormat ?? { type: "json_object" },
      max_tokens: 32000,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
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
        throw new Error(`Kimi chat completion failed: ${response.status} ${text.slice(0, 200)}`);
      }
      const completion = (await response.json()) as {
        choices?: { message?: { content?: string; reasoning_content?: string } }[];
      };
      const content = completion.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("Kimi response did not contain text content");
      }
      return JSON.parse(stripMarkdownJsonFence(content));
    } finally {
      clearTimeout(timeout);
    }
  }

  async deleteFile(handle: ProviderFileHandle): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/files/${handle.providerFileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch {
      // Deletion best-effort; the provider retention policy will clean up.
    }
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
