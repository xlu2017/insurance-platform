import React from "react";
import { render } from "@testing-library/react-native";
import Welcome from "../app/welcome";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Redirect: () => null,
}));

jest.mock("@/lib/auth-context", () => ({
  useAuth: jest.fn(),
}));

import { useAuth } from "@/lib/auth-context";

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe("Welcome screen", () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({
      session: null,
      status: "unauthenticated",
      isAuthenticated: false,
      isUnauthenticated: true,
    } as any);
  });

  it("shows the value proposition and sign-in buttons", async () => {
    const { findByText, getByTestId } = render(<Welcome />);
    expect(await findByText(/Insurance handled for you/)).toBeTruthy();
    expect(await findByText(/Upload your current policies once/)).toBeTruthy();
    expect(getByTestId("get-started")).toBeTruthy();
    expect(getByTestId("go-sign-in")).toBeTruthy();
  });

  it("redirects authenticated users to Home", () => {
    mockedUseAuth.mockReturnValue({
      session: { user: { id: "user-1" } } as any,
      status: "authenticated",
      isAuthenticated: true,
      isUnauthenticated: false,
    } as any);
    const { queryByText } = render(<Welcome />);
    expect(queryByText(/Insurance handled for you/)).toBeNull();
  });
});
