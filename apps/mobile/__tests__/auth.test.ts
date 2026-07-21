import { getSupabaseConfigError, signInWithPassword } from "../lib/auth";

const mockSetSession = jest.fn().mockResolvedValue({ error: null });
const mockUrl = "https://test-project.example.com";
const mockKey = "test-anon-key-with-enough-length";

jest.mock("../lib/config", () => ({
  getSupabaseUrl: () => mockUrl,
  getSupabaseAnonKey: () => mockKey,
  getBypassHeaders: () => undefined,
  getDemoCredentials: () => ({}),
  getConfig: () => null,
  setConfig: jest.fn(),
  loadRemoteConfig: jest.fn().mockResolvedValue(null),
}));

jest.mock("../lib/supabase", () => ({
  getSupabaseClient: () => ({
    auth: {
      setSession: (...args: unknown[]) => mockSetSession(...args),
    },
  }),
  resetSupabaseClient: jest.fn(),
}));

describe("getSupabaseConfigError", () => {
  it("accepts a valid https base URL and key", () => {
    expect(getSupabaseConfigError("https://test.example.com", "a".repeat(40))).toBeNull();
  });

  it("rejects missing URL", () => {
    const error = getSupabaseConfigError("", "a".repeat(40));
    expect(error?.category).toBe("invalid_config");
    expect(error?.message).toMatch(/missing/i);
  });

  it("rejects missing key", () => {
    const error = getSupabaseConfigError("https://test.example.com", "");
    expect(error?.category).toBe("invalid_config");
    expect(error?.message).toMatch(/missing/i);
  });

  it("rejects malformed URL", () => {
    const error = getSupabaseConfigError("not-a-url", "a".repeat(40));
    expect(error?.category).toBe("invalid_config");
    expect(error?.message).toMatch(/not valid/i);
  });

  it("rejects localhost", () => {
    const error = getSupabaseConfigError("http://localhost:54321", "a".repeat(40));
    expect(error?.category).toBe("invalid_config");
    expect(error?.message).toMatch(/localhost/i);
  });

  it("rejects 127.0.0.1", () => {
    const error = getSupabaseConfigError("http://127.0.0.1:54321", "a".repeat(40));
    expect(error?.category).toBe("invalid_config");
    expect(error?.message).toMatch(/127\.0\.0\.1/i);
  });

  it("rejects URL with /auth/v1 path", () => {
    const error = getSupabaseConfigError("https://test.example.com/auth/v1", "a".repeat(40));
    expect(error?.category).toBe("invalid_config");
    expect(error?.message).toMatch(/root/i);
  });

  it("rejects placeholder URL", () => {
    const error = getSupabaseConfigError("https://YOUR_PROJECT.supabase.co", "a".repeat(40));
    expect(error?.category).toBe("invalid_config");
    expect(error?.message).toMatch(/placeholder/i);
  });

  it("rejects short key", () => {
    const error = getSupabaseConfigError("https://test.example.com", "short");
    expect(error?.category).toBe("invalid_config");
    expect(error?.message).toMatch(/incomplete/i);
  });
});

describe("signInWithPassword", () => {
  const fetchMock = jest.fn() as jest.Mock<any, any>;
  (global as any).fetch = fetchMock;

  const headers = (value: string | null) => ({ get: jest.fn().mockReturnValue(value) }) as any;

  beforeEach(() => {
    fetchMock.mockReset();
    mockSetSession.mockReset().mockResolvedValue({ error: null });
  });

  it("returns a user on successful sign-in", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: headers(null),
      json: jest.fn().mockResolvedValueOnce({
        access_token: "access",
        refresh_token: "refresh",
        user: { id: "user-1", email: "test@example.com" },
      }),
    });

    const { user, error } = await signInWithPassword({
      email: "test@example.com",
      password: "password",
    });

    expect(error).toBeUndefined();
    expect(user?.id).toBe("user-1");
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: "access",
      refresh_token: "refresh",
    });
  });

  it("returns invalid_credentials on 400", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: headers(null),
      text: jest.fn().mockResolvedValueOnce(
        JSON.stringify({
          code: 400,
          error_code: "invalid_credentials",
          msg: "Invalid login credentials",
        }),
      ),
    });

    const { error } = await signInWithPassword({
      email: "bad@example.com",
      password: "wrong",
    });

    expect(error?.category).toBe("invalid_credentials");
    expect(error?.message).toMatch(/invalid email or password/i);
    expect(error?.retryable).toBe(false);
  });

  it("returns service_unavailable on 503", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: headers(null),
      text: jest.fn().mockResolvedValueOnce("Service Unavailable"),
    });

    const { error } = await signInWithPassword({
      email: "test@example.com",
      password: "password",
    });

    expect(error?.category).toBe("service_unavailable");
    expect(error?.retryable).toBe(true);
  });

  it("returns service_unavailable when x-localtunnel-status says unavailable", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 200,
      headers: headers("Tunnel Unavailable"),
      text: jest.fn().mockResolvedValueOnce("Tunnel Unavailable"),
    });

    const { error } = await signInWithPassword({
      email: "test@example.com",
      password: "password",
    });

    expect(error?.category).toBe("service_unavailable");
    expect(error?.retryable).toBe(true);
  });

  it("returns offline on fetch network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network request failed"));

    const { error } = await signInWithPassword({
      email: "test@example.com",
      password: "password",
    });

    expect(error?.category).toBe("offline");
    expect(error?.message).toMatch(/offline/i);
    expect(error?.retryable).toBe(true);
  });

  it("returns timeout when the request is aborted", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    fetchMock.mockRejectedValueOnce(abortError);

    const { error } = await signInWithPassword({
      email: "test@example.com",
      password: "password",
    });

    expect(error?.category).toBe("timeout");
    expect(error?.message).toMatch(/timed out/i);
    expect(error?.retryable).toBe(true);
  });

  it("returns malformed_response for a non-JSON success body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: headers(null),
      json: jest.fn().mockRejectedValueOnce(new Error("Invalid JSON")),
    });

    const { error } = await signInWithPassword({
      email: "test@example.com",
      password: "password",
    });

    expect(error?.category).toBe("malformed_response");
    expect(error?.retryable).toBe(true);
  });

  it("signs in with the hardcoded demo account", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: headers(null),
      json: jest.fn().mockResolvedValueOnce({
        access_token: "access",
        refresh_token: "refresh",
        user: { id: "demo-user", email: "customer@example.com" },
      }),
    });

    const { user, error } = await signInWithPassword({
      email: "customer@example.com",
      password: "DemoCustomer123!",
    });

    expect(error).toBeUndefined();
    expect(user?.email).toBe("customer@example.com");
    expect(mockSetSession).toHaveBeenCalledWith({
      access_token: "access",
      refresh_token: "refresh",
    });
  });
});
