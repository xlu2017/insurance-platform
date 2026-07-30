import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Profile from "../app/(tabs)/profile";
import { useAuthGate } from "@/lib/auth-gate";

const mockReplace = jest.fn();
const mockDismissAll = jest.fn();

let mockPathname = "/profile";
let authCallback: ((event: string, session: unknown) => void) | null = null;
let mockSignOut = jest.fn();
let mockGetSession = jest.fn();

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

jest.mock("@/lib/config", () => ({
  loadRemoteConfig: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(() => ({
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        authCallback = cb;
        return {
          data: { subscription: { unsubscribe: jest.fn() } },
        };
      },
    },
  })),
  resetSupabaseClient: jest.fn(),
  supabase: {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null } }),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

jest.mock("@/lib/household");
jest.mock("@/lib/document-processing");

import { useHousehold } from "@/lib/household";
import * as documentProcessing from "@/lib/document-processing";

const mockedUseHousehold = useHousehold as jest.MockedFunction<typeof useHousehold>;
const mockLoadDangerous = documentProcessing.loadDangerousModeSetting as jest.MockedFunction<
  typeof documentProcessing.loadDangerousModeSetting
>;

function GateInspector() {
  const { status } = useAuthGate();
  return <Text testID="auth-status">{status}</Text>;
}

function renderWithQuery(element: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    client,
    ...render(<QueryClientProvider client={client}>{element}</QueryClientProvider>),
  };
}

afterEach(() => {
  jest.clearAllMocks();
  authCallback = null;
});

describe("useAuthGate", () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: "user-1" } } } });
  });

  it("sets status to unauthenticated and clears caches when SIGNED_OUT fires", async () => {
    const { client, getByTestId } = renderWithQuery(<GateInspector />);
    const clearSpy = jest.spyOn(client, "clear");

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    expect(authCallback).toBeTruthy();

    act(() => authCallback!("SIGNED_OUT", null));

    await waitFor(() => {
      expect(clearSpy).toHaveBeenCalled();
      expect(getByTestId("auth-status").props.children).toBe("unauthenticated");
    });
  });

  it("does not navigate when signed out on a public path", async () => {
    mockPathname = "/welcome";
    const { getByTestId } = renderWithQuery(<GateInspector />);

    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    act(() => authCallback!("SIGNED_OUT", null));

    await waitFor(() => expect(getByTestId("auth-status").props.children).toBe("unauthenticated"));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockDismissAll).not.toHaveBeenCalled();
  });
});

describe("Profile sign out", () => {
  beforeEach(() => {
    mockedUseHousehold.mockReturnValue({
      data: {
        id: "household-1",
        name: "Test Household",
        province: "AB",
        autopilot_active: false,
        onboarding_step: "complete",
      },
      isLoading: false,
    } as any);
    mockLoadDangerous.mockResolvedValue({
      enabled: false,
      disclosure_version: "dangerous-mode-v1",
    });
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("calls supabase signOut once and clears the query cache on success", async () => {
    const { client, getByTestId } = renderWithQuery(<Profile />);
    const clearSpy = jest.spyOn(client, "clear");

    await waitFor(() => expect(getByTestId("sign-out")).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId("sign-out"));
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(clearSpy).toHaveBeenCalled());
  });

  it("shows an error and keeps the user signed in when signOut fails", async () => {
    mockSignOut.mockResolvedValue({ error: { message: "Network error" } });
    const { getByTestId, findByText } = renderWithQuery(<Profile />);

    await waitFor(() => expect(getByTestId("sign-out")).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByTestId("sign-out"));
    });

    expect(await findByText(/Network error/)).toBeTruthy();
  });
});
