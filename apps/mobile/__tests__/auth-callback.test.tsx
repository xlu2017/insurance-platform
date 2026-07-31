import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { router, useLocalSearchParams } from "expo-router";
import AuthCallback from "../app/auth/callback";
import { exchangeOAuthCode, parseOAuthReturnUrl } from "../lib/auth";
import { useAuth } from "../lib/auth-context";

let mockParams: Record<string, string | string[]> = {};
let mockUrl: string | null = null;
let mockInitialUrl: string | null = null;

jest.mock("expo-router", () => {
  const routerMock = {
    replace: jest.fn(),
    dismissAll: jest.fn(),
    back: jest.fn(),
    push: jest.fn(),
  };
  return {
    router: routerMock,
    useLocalSearchParams: () => mockParams,
    useRouter: () => routerMock,
    Redirect: () => null,
  };
});

jest.mock("expo-linking", () => ({
  useURL: () => mockUrl,
  getInitialURL: jest.fn().mockImplementation(() => Promise.resolve(mockInitialUrl)),
}));

jest.mock("expo-web-browser", () => ({
  dismissBrowser: jest.fn().mockResolvedValue(undefined),
  maybeCompleteAuthSession: jest.fn(),
}));

jest.mock("../lib/auth", () => ({
  parseOAuthReturnUrl: jest.fn(),
  exchangeOAuthCode: jest.fn(),
}));

jest.mock("../lib/auth-context");

const mockParse = parseOAuthReturnUrl as jest.MockedFunction<typeof parseOAuthReturnUrl>;
const mockExchange = exchangeOAuthCode as jest.MockedFunction<typeof exchangeOAuthCode>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

function defaultParseImplementation(url: string) {
  const parsed = new URL(url);
  const search = new URLSearchParams(parsed.search);
  const hashParams = new URLSearchParams(
    parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash,
  );
  return {
    code: search.get("code") ?? undefined,
    accessToken:
      search.get("access_token") ?? hashParams.get("access_token") ?? undefined,
    refreshToken:
      search.get("refresh_token") ?? hashParams.get("refresh_token") ?? undefined,
    error: search.get("error") ?? hashParams.get("error") ?? undefined,
    errorDescription:
      search.get("error_description") ?? hashParams.get("error_description") ?? undefined,
  };
}

function defaultAuthValue(overrides?: Partial<ReturnType<typeof useAuth>>) {
  return {
    session: null,
    status: "unauthenticated",
    isAuthenticated: false,
    isUnauthenticated: true,
    error: null,
    retry: jest.fn(),
    ...overrides,
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockUrl = null;
  mockInitialUrl = null;
  mockParse.mockImplementation(defaultParseImplementation);
  mockExchange.mockResolvedValue({ user: { id: "user-1" } } as any);
  mockUseAuth.mockReturnValue(defaultAuthValue());
  (Linking.getInitialURL as jest.Mock).mockImplementation(() =>
    Promise.resolve(mockInitialUrl),
  );
});

describe("AuthCallback screen", () => {
  it("navigates home when already authenticated", async () => {
    mockUseAuth.mockReturnValue(defaultAuthValue({ isAuthenticated: true, status: "authenticated" }));
    render(<AuthCallback />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });

  it("exchanges a query authorization code and navigates home", async () => {
    mockParams = { code: "auth-code-123" };
    render(<AuthCallback />);
    await waitFor(() =>
      expect(mockExchange).toHaveBeenCalledWith("auth-code-123", undefined, undefined),
    );
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });

  it("exchanges hash-fragment access and refresh tokens", async () => {
    mockUrl = "insurance-autopilot://auth/callback#access_token=abc&refresh_token=xyz";
    render(<AuthCallback />);
    await waitFor(() => expect(mockExchange).toHaveBeenCalledWith(undefined, "abc", "xyz"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });

  it("reads the cold-start initial URL before deciding there is no payload", async () => {
    mockParams = {};
    mockInitialUrl = "insurance-autopilot://auth/callback?code=cold-start-code";
    render(<AuthCallback />);
    await waitFor(() => expect(mockExchange).toHaveBeenCalledWith("cold-start-code", undefined, undefined));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });

  it("does not redirect before the initial URL is resolved", async () => {
    mockParams = {};
    (Linking.getInitialURL as jest.Mock).mockImplementation(() => new Promise(() => {}));
    render(<AuthCallback />);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("displays an OAuth error from the callback", async () => {
    mockParams = { error: "access_denied", error_description: "User cancelled" };
    const { getByText } = render(<AuthCallback />);
    await waitFor(() => expect(getByText("User cancelled")).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalledWith("/home");
  });

  it("returns to welcome when the callback contains no OAuth payload", async () => {
    mockParams = {};
    render(<AuthCallback />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/welcome"));
  });

  it("displays an exchange error and offers a back-to-welcome action", async () => {
    mockParams = { code: "bad-code" };
    mockExchange.mockResolvedValueOnce({ error: { message: "Invalid or expired code" } } as any);
    const { getByText } = render(<AuthCallback />);
    await waitFor(() => expect(getByText("Invalid or expired code")).toBeTruthy());
    fireEvent.press(getByText("Back to sign in"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/welcome"));
  });

  it("navigates home when the auth state becomes authenticated during processing", async () => {
    mockParams = { code: "deferred-code" };
    mockExchange.mockImplementation(() => new Promise(() => {}));
    mockUseAuth.mockReturnValue(defaultAuthValue({ isAuthenticated: true, status: "authenticated" }));
    render(<AuthCallback />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });

  it("dismisses the browser after a successful exchange", async () => {
    mockParams = { code: "auth-code-123" };
    const dismissSpy = jest.spyOn(WebBrowser, "dismissBrowser").mockResolvedValueOnce(undefined as any);
    render(<AuthCallback />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
    expect(dismissSpy).toHaveBeenCalled();
  });
});
