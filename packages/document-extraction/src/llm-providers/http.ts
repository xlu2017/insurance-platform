import type { InsuranceLlmProvider } from "../llm-contract.ts";
import type { LlmContentPart } from "../document-analyzer.ts";

export interface HttpLlmProviderOptions {
  apiUrl: string;
  apiKey: string;
  model: string;
  providerId?: string;
  supportsNativePdfInput?: boolean;
  supportsImageInput?: boolean;
}

interface ChatMessage {
  role: "system" | "user";
  content: string | LlmContentPart[];
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

/**
 * Minimal OpenAI-compatible chat-completions provider for the insurance document
 * extraction contract. The caller is responsible for any retry, rate-limit, or
 * fallback policy outside this class.
 */
export class HttpLlmProvider implements InsuranceLlmProvider {
  readonly providerId: string;
  readonly modelId: string;
  readonly supportsNativePdfInput: boolean;
  readonly supportsImageInput: boolean;
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(options: HttpLlmProviderOptions) {
    const url = options.apiUrl.replace(/\/+$/, "");
    this.apiUrl = `${url}/chat/completions`;
    this.apiKey = options.apiKey;
    this.modelId = options.model;
    this.providerId = options.providerId ?? "http-llm-provider";
    this.supportsNativePdfInput = options.supportsNativePdfInput ?? false;
    this.supportsImageInput = options.supportsImageInput ?? false;
  }

  async extract(request: unknown, systemPrompt: string): Promise<unknown> {
    let messages: ChatMessage[];
    if (
      typeof request === "object" &&
      request !== null &&
      "content" in request &&
      Array.isArray((request as { content: unknown }).content)
    ) {
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: (request as { content: LlmContentPart[] }).content },
      ];
    } else {
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(request) },
      ];
    }

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelId,
        temperature: 0,
        messages,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`LLM request failed: ${response.status} ${text.slice(0, 200)}`);
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("LLM response did not contain a text completion");
    }

    const jsonText = stripMarkdownJsonFence(content);
    return JSON.parse(jsonText);
  }
}
