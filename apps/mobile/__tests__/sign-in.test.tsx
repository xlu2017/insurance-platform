import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import SignIn from "../app/sign-in";
import { signInWithOAuthProvider, signInWithPassword } from "../lib/auth";
import { useAuth } from "../lib/auth-context";

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), back: jest.fn() },
  Redirect: () => null,
  useLocalSearchParams: () => ({}),
}));

jest.mock("../lib/auth", () => ({
  signInWithPassword: jest.fn(),
  signInWithOAuthProvider: jest.fn(),
}));

jest.mock("../lib/auth-context", () => ({
  useAuth: jest.fn(),
}));

jest.mock("../lib/config", () => ({
  getDemoCredentials: () => ({ email: "demo@example.com", password: "demo-password" }),
  loadRemoteConfig: jest.fn(),
}));

const mockSignIn = signInWithPassword as jest.MockedFunction<typeof signInWithPassword>;
const mockSSO = signInWithOAuthProvider as jest.MockedFunction<typeof signInWithOAuthProvider>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

async function fillCredentials(
  getByTestId: ReturnType<typeof render>["getByTestId"],
  email: string,
  password: string,
) {
  fireEvent.changeText(getByTestId("email-input"), email);
  fireEvent.changeText(getByTestId("password-input"), password);
}

describe("SignIn screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      session: null,
      status: "unauthenticated",
      isAuthenticated: false,
      isUnauthenticated: true,
    } as any);
  });

  it("signs in and navigates home on success", async () => {
    mockSignIn.mockResolvedValueOnce({ user: { id: "user-1" } as any });

    const { getByTestId } = render(<SignIn />);
    await fillCredentials(getByTestId, "test@example.com", "password");
    fireEvent.press(getByTestId("sign-in-button"));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
    expect(mockSignIn).toHaveBeenCalledWith(
      { email: "test@example.com", password: "password" },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("shows invalid credentials without offering a retry", async () => {
    mockSignIn.mockResolvedValueOnce({
      error: {
        category: "invalid_credentials",
        message: "Invalid email or password.",
        retryable: false,
      },
    });

    const { getByTestId, queryByTestId } = render(<SignIn />);
    await fillCredentials(getByTestId, "test@example.com", "password");
    fireEvent.press(getByTestId("sign-in-button"));

    await waitFor(() => expect(getByTestId("sign-in-error")).toBeTruthy());
    expect(getByTestId("sign-in-error").children[0]).toBe("Invalid email or password.");
    expect(queryByTestId("retry-button")).toBeNull();
  });

  it("shows service unavailable and offers a retry", async () => {
    mockSignIn.mockResolvedValueOnce({
      error: {
        category: "service_unavailable",
        message:
          "The sign-in service is temporarily unavailable. Check your connection and try again.",
        retryable: true,
      },
    });

    const { getByTestId } = render(<SignIn />);
    await fillCredentials(getByTestId, "test@example.com", "password");
    fireEvent.press(getByTestId("sign-in-button"));

    await waitFor(() => expect(getByTestId("sign-in-error")).toBeTruthy());
    expect(getByTestId("retry-button")).toBeTruthy();

    mockSignIn.mockResolvedValueOnce({ user: { id: "user-1" } as any });
    fireEvent.press(getByTestId("retry-button"));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });

  it("hides raw response objects from the UI", async () => {
    mockSignIn.mockResolvedValueOnce({
      error: {
        category: "service_unavailable",
        message:
          "The sign-in service is temporarily unavailable. Check your connection and try again.",
        retryable: true,
      },
    });

    const { getByTestId } = render(<SignIn />);
    await fillCredentials(getByTestId, "test@example.com", "password");
    fireEvent.press(getByTestId("sign-in-button"));

    await waitFor(() => expect(getByTestId("sign-in-error")).toBeTruthy());
    const errorText = String(getByTestId("sign-in-error").children[0] ?? "");
    expect(errorText).not.toMatch(/x-localtunnel-status/i);
    expect(errorText).not.toMatch(/object/i);
    expect(errorText).not.toMatch(/503/);
  });

  it("does not submit again while loading", async () => {
    let resolve: (value: { user?: any; error?: any }) => void = () => {};
    mockSignIn.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolve = res;
        }),
    );

    const { getByTestId } = render(<SignIn />);
    await fillCredentials(getByTestId, "test@example.com", "password");
    fireEvent.press(getByTestId("sign-in-button"));
    fireEvent.press(getByTestId("sign-in-button"));

    expect(mockSignIn).toHaveBeenCalledTimes(1);

    resolve({ user: { id: "user-1" } as any });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/home"));
  });
});
