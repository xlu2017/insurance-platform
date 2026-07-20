import React from "react";
import { render } from "@testing-library/react-native";
import Welcome from "../app/welcome";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));

describe("Welcome screen", () => {
  it("shows the value proposition and demo disclaimer", () => {
    const { getByText, getByTestId } = render(<Welcome />);
    expect(getByText(/Insurance handled for you/)).toBeTruthy();
    expect(getByText(/Upload your current policies once/)).toBeTruthy();
    expect(getByText(/demonstration and workflow platform/)).toBeTruthy();
    expect(getByTestId("get-started")).toBeTruthy();
    expect(getByTestId("go-sign-in")).toBeTruthy();
  });
});
