import { Platform } from "react-native";
import { stagePolicyDocument, createStagingRequestId } from "@/lib/upload";

const mockGetSession = jest.fn();

jest.mock("@/lib/supabase", () => ({
  getSupabaseUrlString: () => "https://test.supabase.co",
  getSupabaseAnonKeyString: () => "test-anon-key",
  getBypassTunnelHeaders: () => ({ "x-bypass": "1" }),
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

describe("stagePolicyDocument", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (Platform as { OS: string }).OS = "web";
  });

  function mockFileResponse() {
    return {
      blob: jest.fn().mockResolvedValue(new Blob(["fake-image-bytes"], { type: "image/png" })),
    } as unknown as Response;
  }

  function mockApiResponse(status: number, body: Record<string, unknown>) {
    return {
      status,
      text: jest.fn().mockResolvedValue(JSON.stringify(body)),
    } as unknown as Response;
  }

  function mockFetchWithStagedResponse(id: string, contentSha256: string) {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.startsWith("file:")) return Promise.resolve(mockFileResponse());
      return Promise.resolve(
        mockApiResponse(200, {
          id,
          path: `household/${id}.png`,
          content_sha256: contentSha256,
          file_name: "policy.png",
          staged: true,
        }),
      );
    });
  }

  it("returns the staged policy document id and digest", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
    });
    mockFetchWithStagedResponse("doc-1", "sha256-abc");

    const file = {
      uri: "file:///policy.png",
      name: "policy.png",
      mimeType: "image/png",
      size: 1024,
    };
    const result = await stagePolicyDocument("household-1", "auto_detect", file, "req-uuid");

    expect(result.id).toBe("doc-1");
    expect(result.path).toBe("household/doc-1.png");
    expect(result.content_sha256).toBe("sha256-abc");
    expect(result.file_name).toBe("policy.png");
    expect(result.staged).toBe(true);

    const fetchCalls = (global.fetch as jest.Mock).mock.calls;
    const edgeCall = fetchCalls.find((call) =>
      String(call[0]).includes("functions/v1/upload-document"),
    );
    const body = edgeCall?.[1]?.body as FormData;
    expect(body.get("mode")).toBe("staged");
    expect(body.get("householdId")).toBe("household-1");
    expect(body.get("category")).toBe("auto_detect");
    expect(body.get("stagingRequestId")).toBe("req-uuid");
  });

  it("uses a fresh staging request id when none is supplied", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
    });
    mockFetchWithStagedResponse("doc-2", "sha256-def");

    const file = { uri: "file:///policy.png", name: "policy.png", mimeType: "image/png" };
    await stagePolicyDocument("household-1", "auto_detect", file);

    const fetchCalls = (global.fetch as jest.Mock).mock.calls;
    const edgeCall = fetchCalls.find((call) =>
      String(call[0]).includes("functions/v1/upload-document"),
    );
    const body = edgeCall?.[1]?.body as FormData;
    const stagingRequestId = body.get("stagingRequestId");
    expect(typeof stagingRequestId).toBe("string");
    expect(stagingRequestId).toMatch(/^[0-9a-f]{8}-/i);
  });

  it("throws when the user is not authenticated", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    await expect(
      stagePolicyDocument("household-1", "auto_detect", {
        uri: "file:///policy.png",
        name: "policy.png",
        mimeType: "image/png",
      }),
    ).rejects.toThrow("signed in");
  });

  it("throws for disallowed file types", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
    });

    await expect(
      stagePolicyDocument("household-1", "auto_detect", {
        uri: "file:///policy.exe",
        name: "policy.exe",
        mimeType: "application/octet-stream",
      }),
    ).rejects.toThrow("Only PDF and PNG/JPEG");
  });

  it("throws for oversized files", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
    });

    await expect(
      stagePolicyDocument("household-1", "auto_detect", {
        uri: "file:///big.png",
        name: "big.png",
        mimeType: "image/png",
        size: 11 * 1024 * 1024,
      }),
    ).rejects.toThrow("too large");
  });

  it("passes through Edge function errors", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token" } },
    });
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.startsWith("file:")) return Promise.resolve(mockFileResponse());
      return Promise.resolve(mockApiResponse(415, { message: "Unsupported file type" }));
    });

    await expect(
      stagePolicyDocument("household-1", "auto_detect", {
        uri: "file:///policy.png",
        name: "policy.png",
        mimeType: "image/png",
      }),
    ).rejects.toThrow("Unsupported file type");
  });

  it("createStagingRequestId produces a valid UUID shape", () => {
    const id = createStagingRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
