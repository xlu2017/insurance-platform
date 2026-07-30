import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { router, useLocalSearchParams } from "expo-router";
import AuthCallback from "../app/auth/callback";
import { exchangeOAuthCode } from "../lib/auth";
import { useAuth } from "../lib/auth-context";

let mockParams: Record<string, string | string[]> = {};
let mockUrl: string | null = null;

jest.mock("expo-router", () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock("expo-linking", () => ({
  useURL: () => mockUrl,
}));

jest.mock("../lib/auth");
jest.mock("../lib/auth-context");

const mockExchange = exchangeOAuthCode as jest.MockedFunction<typeof exchangeOAuthCode>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockUrl = null;
  mockUseAuth.mockReturnValue({
    session: null,
    status: "unauthenticated",
    isAuthenticated: false,
    isUnauthenticated: true,
    error: null,
    retry: jest.fn(),
  } as any);
});

describe("AuthCallback screen", () => {
  it("navigates home when already authenticated", async () => {
    mockUseAuth.mockReturnValue({
      session: { user: { id: "user-1" } },
      status: "authenticated",
      isAuthenticated: true,
      isUnauthenticated: false,
      error: null,
      retry: jest.fn(),
    } as any);

    render(<AuthCallback />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });

  it("exchanges an authorization code and dismisses the browser", async () => {
    mockParams = { code: "auth-code-123" };
    mockExchange.mockResolvedValueOnce({ error: null } as any);
    const dismissSpy = jest.spyOn(WebBrowser, "dismissBrowser").mockResolvedValueOnce(undefined as any);

    render(<AuthCallback />);
    await waitFor(() => expect(mockExchange).toHaveBeenCalledWith("auth-code-123", undefined, undefined));
    await waitFor(() => expect(dismissSpy).toHaveBeenCalled());
  });

  it("displays an OAuth error from the callback", async () => {
    mockParams = { error: "access_denied", error_description: "User cancelled" };

    const { getByText } = render(<AuthCallback />);
    await waitFor(() => expect(getByText("User cancelled")).toBeTruthy());
  });

  it("returns to welcome when the callback contains no code", async () => {
    mockParams = {};

    render(<AuthCallback />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/welcome"));
  });

  it("displays an exchange error when code exchange fails", async () => {
    mockParams = { code: "bad-code" };
    mockExchange.mockResolvedValueOnce({ error: { message: "Invalid or expired code" } } as any);

    const { getByText } = render(<AuthCallback />);
    await waitFor(() => expect(getByText("Invalid or expired code")).toBeTruthy());
  });
});
