import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Text } from "react-native";
import { useAuthGate } from "@/lib/auth-gate";

const mockReplace = jest.fn();
const mockDismissAll = jest.fn();

let mockPathname = "/home";
let authCallback: ((event: string, session: unknown) => void) | null = null;
let mockGetSession = jest.fn();
let mockGetSupabaseClient = jest.fn();
let mockResetSupabaseClient = jest.fn();

// Module-level mutable config so beforeEach can toggle between valid and missing values.
var mockSupabaseUrl = "";
var mockSupabaseAnonKey = "";
var mockLoadRemoteConfig = jest.fn();

jest.mock("expo-router", () => ({
  Redirect: () => null,
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
  usePathname: () => mockPathname,
  useRouter: () => ({
    replace: mockReplace,
    dismissAll: mockDismissAll,
    back: jest.fn(),
    push: jest.fn(),
  }),
}));

jest.mock("../lib/config", () => ({
  loadRemoteConfig: (...args: unknown[]) => mockLoadRemoteConfig(...args),
  getSupabaseUrl: () => mockSupabaseUrl,
  getSupabaseAnonKey: () => mockSupabaseAnonKey,
}));

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: (...args: unknown[]) => mockGetSupabaseClient(...args),
  resetSupabaseClient: (...args: unknown[]) => mockResetSupabaseClient(...args),
  supabase: {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

function GateInspector() {
  const { status, error } = useAuthGate();
  return (
    <>
      <Text testID="status">{status}</Text>
      {error ? <Text testID="error">{error.message}</Text> : null}
    </>
  );
}

function renderWithQuery(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, ...render(<QueryClientProvider client={client}>{element}</QueryClientProvider>) };
}

function createMockClient(session: unknown) {
  return {
    auth: {
      getSession: mockGetSession.mockResolvedValue({ data: { session } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authCallback = cb;
        return {
          data: { subscription: { unsubscribe: jest.fn() } },
        };
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  authCallback = null;
  mockPathname = "/home";
  mockGetSession = jest.fn();
  mockGetSupabaseClient = jest.fn(() => createMockClient(null));
  mockResetSupabaseClient = jest.fn();
  mockSupabaseUrl = "";
  mockSupabaseAnonKey = "";
  mockLoadRemoteConfig = jest.fn().mockImplementation(async () => {
    mockSupabaseUrl = "https://test-project.supabase.co";
    mockSupabaseAnonKey = "test-anon-key";
    return null;
  });
});

afterEach(() => {
  mockSupabaseUrl = "";
  mockSupabaseAnonKey = "";
});

describe("useAuthGate", () => {
  it("loads remote config before creating the client (remote-config-only startup)", async () => {
    mockSupabaseUrl = "";
    mockSupabaseAnonKey = "";
    const client = createMockClient({ user: { id: "user-1" } });
    mockGetSupabaseClient.mockReturnValue(client);

    renderWithQuery(<GateInspector />);

    await waitFor(() => expect(mockLoadRemoteConfig).toHaveBeenCalled());
    await waitFor(() => expect(mockResetSupabaseClient).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetSupabaseClient).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.auth.getSession).toHaveBeenCalledTimes(1));
  });

  it("creates one client and uses it for both getSession and onAuthStateChange", async () => {
    const client = createMockClient({ user: { id: "user-1" } });
    mockGetSupabaseClient.mockReturnValue(client);

    renderWithQuery(<GateInspector />);

    await waitFor(() => expect(mockResetSupabaseClient).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetSupabaseClient).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.auth.getSession).toHaveBeenCalledTimes(1));
    expect(authCallback).toBeTruthy();
  });

  it("shows a configuration error when Supabase URL and remote config are missing", async () => {
    mockLoadRemoteConfig = jest.fn().mockResolvedValue(null);
    mockSupabaseUrl = "";
    mockSupabaseAnonKey = "";

    const { getByTestId } = renderWithQuery(<GateInspector />);
    await waitFor(() => expect(getByTestId("status").children[0]).toBe("configuration_error"));
  });

  it("shows a network error when getSession throws", async () => {
    const client = createMockClient(null);
    client.auth.getSession.mockRejectedValue(new Error("Network failure"));
    mockGetSupabaseClient.mockReturnValue(client);

    const { getByTestId } = renderWithQuery(<GateInspector />);
    await waitFor(() => expect(getByTestId("status").children[0]).toBe("network_error"));
  });

  it("redirects to welcome when signed out on a protected route", async () => {
    const client = createMockClient(null);
    mockGetSupabaseClient.mockReturnValue(client);

    renderWithQuery(<GateInspector />);
    await waitFor(() => expect(client.auth.getSession).toHaveBeenCalled());

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/welcome"));
  });

  it("does not redirect when signed out on the welcome screen", async () => {
    mockPathname = "/welcome";
    const client = createMockClient(null);
    mockGetSupabaseClient.mockReturnValue(client);

    renderWithQuery(<GateInspector />);
    await waitFor(() => expect(client.auth.getSession).toHaveBeenCalled());

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects authenticated users away from sign-in", async () => {
    mockPathname = "/sign-in";
    const client = createMockClient({ user: { id: "user-1" } });
    mockGetSupabaseClient.mockReturnValue(client);

    renderWithQuery(<GateInspector />);
    await waitFor(() => expect(client.auth.getSession).toHaveBeenCalled());

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/home"));
  });

  it("updates status to authenticated on SIGNED_IN", async () => {
    mockPathname = "/welcome";
    const client = createMockClient(null);
    mockGetSupabaseClient.mockReturnValue(client);

    const { getByTestId } = renderWithQuery(<GateInspector />);
    await waitFor(() => expect(getByTestId("status").children[0]).toBe("unauthenticated"));

    act(() => authCallback!("SIGNED_IN", { user: { id: "user-1" } }));

    await waitFor(() => expect(getByTestId("status").children[0]).toBe("authenticated"));
  });

  it("clears the query cache and redirects when SIGNED_OUT fires", async () => {
    const { client, getByTestId } = renderWithQuery(<GateInspector />);
    const clearSpy = jest.spyOn(client, "clear");

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    expect(authCallback).toBeTruthy();

    act(() => authCallback!("SIGNED_OUT", null));

    await waitFor(() => expect(clearSpy).toHaveBeenCalled());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/welcome"));
  });

  it("transitions to unauthenticated and redirects when the session expires", async () => {
    const client = createMockClient({ user: { id: "user-1" } });
    mockGetSupabaseClient.mockReturnValue(client);

    const { getByTestId } = renderWithQuery(<GateInspector />);
    await waitFor(() => expect(getByTestId("status").children[0]).toBe("authenticated"));

    act(() => authCallback!("SIGNED_OUT", null));

    await waitFor(() => expect(getByTestId("status").children[0]).toBe("unauthenticated"));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/welcome"));
  });

  it("reuses the same client after sign-out without creating a new listener target", async () => {
    const client = createMockClient({ user: { id: "user-1" } });
    mockGetSupabaseClient.mockReturnValue(client);

    renderWithQuery(<GateInspector />);
    await waitFor(() => expect(client.auth.getSession).toHaveBeenCalled());

    act(() => authCallback!("SIGNED_OUT", null));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/welcome"));
    expect(mockResetSupabaseClient).toHaveBeenCalledTimes(1);
  });
});
