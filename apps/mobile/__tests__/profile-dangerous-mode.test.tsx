import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider, type UseQueryResult } from "@tanstack/react-query";
import * as documentProcessing from "@/lib/document-processing";
import { useHousehold, type HouseholdSummary } from "@/lib/household";
import { supabase } from "@/lib/supabase";
import Profile from "../app/(tabs)/profile";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
}));

jest.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: jest.fn().mockResolvedValue(false),
  authenticateAsync: jest.fn().mockResolvedValue({ success: false }),
}));

jest.mock("@/lib/household");
jest.mock("@/lib/document-processing");

jest.mock("@/lib/supabase", () => {
  const fromResponses: Record<string, { data: unknown; error: null }> = {};
  function chainable(returnValue: { data: unknown; error: null }) {
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue(returnValue),
      maybeSingle: jest.fn().mockResolvedValue(returnValue),
    };
  }
  return {
    supabase: {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "test@example.com" } },
          error: null,
        }),
      },
      from: jest.fn((table: string) => {
        const response = fromResponses[table] ?? { data: null, error: null };
        return chainable(response);
      }),
      __setFromResponse: (table: string, response: { data: unknown; error: null }) => {
        fromResponses[table] = response;
      },
    },
  };
});

const mockLoad = jest.mocked(documentProcessing.loadDangerousModeSetting);
const mockUpdate = jest.mocked(documentProcessing.updateDangerousModeSetting);
const mockUseHousehold = jest.mocked(useHousehold);
const mockSupabase = supabase as any;

function renderWithQuery(element: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

afterEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

describe("Profile dangerous mode", () => {
  beforeEach(() => {
    mockUseHousehold.mockReturnValue({
      data: {
        id: "household-1",
        name: "Test Household",
        province: "AB",
        autopilot_active: false,
        onboarding_step: "complete",
      },
      isLoading: false,
    } as UseQueryResult<HouseholdSummary | null, Error>);

    mockSupabase.__setFromResponse("profiles", {
      data: { full_name: "Test User", role: "customer" },
      error: null,
    });
    mockSupabase.__setFromResponse("subscriptions", {
      data: { status: "active", current_period_end: null },
      error: null,
    });
    mockSupabase.__setFromResponse("consents", { data: [], error: null });

    let dangerousEnabled = false;
    mockLoad.mockImplementation(async () => ({
      enabled: dangerousEnabled,
      disclosure_version: "dangerous-mode-v1",
    }));
    mockUpdate.mockImplementation(async (input: { enabled: boolean }) => {
      dangerousEnabled = input.enabled;
      return { enabled: dangerousEnabled, disclosure_version: "dangerous-mode-v1" };
    });
  });

  it("turns dangerous mode on, off, and on again", async () => {
    const { getByLabelText, getByText, queryByText } = renderWithQuery(<Profile />);

    await waitFor(() => expect(getByLabelText("Instant AI review")).toBeTruthy());

    const dangerousSwitch = getByLabelText("Instant AI review");

    // Turn on
    await act(async () => {
      fireEvent(dangerousSwitch, "valueChange", true);
    });

    await waitFor(() => expect(getByText("Turn on instant AI review?")).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText("Turn on instant AI review"));
    });

    await waitFor(() => expect(queryByText("Turn on instant AI review?")).toBeNull());

    expect(mockUpdate).toHaveBeenNthCalledWith(1, {
      householdId: "household-1",
      enabled: true,
      explicitConfirmation: true,
      foreignProcessingAcknowledged: true,
      automatedProcessingAcknowledged: true,
      rawProcessingApproved: true,
      disclosureVersion: "dangerous-mode-v1",
    });

    // Turn off
    await act(async () => {
      fireEvent(dangerousSwitch, "valueChange", false);
    });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));

    expect(mockUpdate).toHaveBeenNthCalledWith(2, {
      householdId: "household-1",
      enabled: false,
      explicitConfirmation: false,
      foreignProcessingAcknowledged: false,
      automatedProcessingAcknowledged: false,
      rawProcessingApproved: false,
      disclosureVersion: "dangerous-mode-v1",
    });

    // Turn on again
    await act(async () => {
      fireEvent(dangerousSwitch, "valueChange", true);
    });

    await waitFor(() => expect(getByText("Turn on instant AI review?")).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText("Turn on instant AI review"));
    });

    await waitFor(() => expect(queryByText("Turn on instant AI review?")).toBeNull());
    expect(mockUpdate).toHaveBeenCalledTimes(3);
  });
});
