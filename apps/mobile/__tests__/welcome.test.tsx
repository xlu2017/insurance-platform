import React from "react";
import { render } from "@testing-library/react-native";
import Welcome from "../app/welcome";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Redirect: () => null,
}));

jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
    },
  },
}));

describe("Welcome screen", () => {
  it("shows the value proposition and sign-in buttons", async () => {
    const { findByText, getByTestId } = render(<Welcome />);
    expect(await findByText(/Insurance handled for you/)).toBeTruthy();
    expect(await findByText(/Upload your current policies once/)).toBeTruthy();
    expect(getByTestId("get-started")).toBeTruthy();
    expect(getByTestId("go-sign-in")).toBeTruthy();
  });
});
