import { describe, expect, it, vi } from "vitest";
import { KimiK3Provider } from "../src/providers/kimi-k3.ts";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("KimiK3Provider", () => {
  it("fails before file upload when the configured model is not the intended K3 model", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new KimiK3Provider({
      apiKey: "test-key",
      requestedModel: "different-model",
      fetchImpl,
    });

    await expect(provider.resolveModel()).rejects.toThrow(/intended K3 model/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails before file upload when the configured K3 model is absent", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ data: [] }));
    const provider = new KimiK3Provider({
      apiKey: "test-key",
      requestedModel: "kimi-k3-missing",
      fetchImpl,
    });

    await expect(provider.resolveModel()).rejects.toThrow(/model unavailable/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/\/models$/);
  });

  it("retrieves PDF content transiently and includes all files in one deterministic request", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/models")) {
        return jsonResponse({
          data: [
            {
              id: "kimi-k3-test",
              object: "model",
              created: 1,
              owned_by: "test",
              context_length: 262_144,
              supports_image_in: true,
            },
          ],
        });
      }
      if (url.endsWith("/files") && init?.method === "POST") {
        return jsonResponse({
          id: "provider-file-1",
          object: "file",
          bytes: 1200,
          created_at: 1,
          filename: "policy.pdf",
          purpose: "file-extract",
          status: "ok",
        });
      }
      if (url.endsWith("/files/provider-file-1") && init?.method === "GET") {
        return jsonResponse({
          id: "provider-file-1",
          object: "file",
          bytes: 1200,
          created_at: 1,
          filename: "policy.pdf",
          purpose: "file-extract",
          status: "ok",
        });
      }
      if (url.endsWith("/files/provider-file-1/content")) {
        return new Response("Policy liability limit is $2,000,000", {
          headers: { "content-type": "text/plain" },
        });
      }
      if (url.endsWith("/chat/completions")) {
        return jsonResponse({ choices: [{ message: { content: '{"valid":true}' } }] });
      }
      if (url.endsWith("/files/provider-file-1") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    });

    const provider = new KimiK3Provider({
      apiKey: "test-key",
      requestedModel: "kimi-k3-test",
      fetchImpl,
    });
    const original = {
      documentId: "document-1",
      filename: "policy.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array(1200),
    };

    await provider.assertBatchFits([original]);
    const uploaded = await provider.uploadOriginalFile(original);
    expect(uploaded.status).toBe("ready");
    expect(uploaded.handle?.transientExtractedContent).toContain("liability limit");

    const result = await provider.analyze({
      model: "kimi-k3-test",
      systemPrompt: "Return JSON",
      userPrompt: "Analyze all documents",
      files: [uploaded.handle!],
      responseFormat: { type: "json_object" },
    });
    expect(result).toEqual({ valid: true });

    const inferenceCalls = calls.filter((call) => call.url.endsWith("/chat/completions"));
    expect(inferenceCalls).toHaveLength(1);
    const requestBody = JSON.parse(String(inferenceCalls[0].init?.body)) as {
      temperature?: number;
      max_completion_tokens: number;
      reasoning_effort: string;
      messages: { content: { type: string; text?: string }[] }[];
    };
    // K3 has fixed sampling parameters; the official API requires callers to
    // omit temperature and use its fixed reasoning effort.
    expect(requestBody.temperature).toBeUndefined();
    expect(requestBody.max_completion_tokens).toBe(12_000);
    expect(requestBody.reasoning_effort).toBe("low");
    expect(requestBody.messages[1].content.some((part) => part.text?.includes("document-1"))).toBe(
      true,
    );
  });

  it("fails context preflight before any file transmission", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({
        data: [
          {
            id: "kimi-k3-small",
            object: "model",
            created: 1,
            owned_by: "test",
            context_length: 16_000,
          },
        ],
      }),
    );
    const provider = new KimiK3Provider({
      apiKey: "test-key",
      requestedModel: "kimi-k3-small",
      fetchImpl,
    });

    await expect(
      provider.assertBatchFits([
        {
          documentId: "document-1",
          filename: "large.pdf",
          mimeType: "application/pdf",
          bytes: new Uint8Array(10 * 1024 * 1024),
        },
      ]),
    ).rejects.toThrow(/context capacity/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/\/models$/);
  });
});
