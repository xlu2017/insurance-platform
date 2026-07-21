import React from "react";
import { render } from "@testing-library/react-native";
import Autopilot from "../app/(tabs)/autopilot";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

jest.mock("@/lib/household", () => ({
  useHousehold: jest.fn().mockReturnValue({ data: { id: "h1" }, isLoading: false }),
  useOptimizationCases: jest.fn(),
}));

jest.mock("@/lib/document-processing", () => ({
  useReviewSessions: jest.fn().mockReturnValue({ data: [], isLoading: false }),
}));

jest.mock("@/lib/autopilot", () => ({
  useAutopilotSessions: jest.fn().mockReturnValue({
    current: {
      id: "c1",
      name: "2027 Renewal Review",
      startedAt: "Started July 20, 2026 at 2:14 PM",
      status: "Waiting for your decision",
      statusTone: "accent",
      isCurrent: true,
      steps: [
        { key: "awaiting_documents", label: "Upload your documents", state: "completed" },
        { key: "extracting_information", label: "Extract policy information", state: "completed" },
        {
          key: "awaiting_customer_confirmation",
          label: "Confirm your details",
          state: "completed",
        },
        { key: "recommendation_ready", label: "Recommendation ready", state: "current" },
        { key: "completed", label: "Switch completed", state: "upcoming" },
      ],
      currentStepIndex: 3,
      action: { label: "View details", route: "/recommendation" },
    },
    past: [
      {
        id: "p1",
        name: "2026 Renewal Review",
        startedAt: "Started July 20, 2025 at 2:14 PM",
        status: "Completed",
        statusTone: "success",
        isCurrent: false,
        steps: [
          { key: "awaiting_documents", label: "Upload your documents", state: "completed" },
          { key: "completed", label: "Switch completed", state: "completed" },
        ],
        currentStepIndex: 1,
      },
    ],
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  }),
  AutopilotSession: undefined,
  SessionStep: undefined,
}));

describe("Autopilot screen", () => {
  it("renders the current session, workflow steps, and past sessions", async () => {
    const { findByText, getByTestId, getAllByText } = render(<Autopilot />);
    expect(await findByText(/2027 Renewal Review/)).toBeTruthy();
    expect(await findByText(/Waiting for your decision/)).toBeTruthy();
    expect(getAllByText(/View details/).length).toBeGreaterThan(0);
    expect(await findByText(/Past Sessions/)).toBeTruthy();
    expect(await findByText(/2026 Renewal Review/)).toBeTruthy();
    expect(getByTestId("current-session")).toBeTruthy();
    expect(getByTestId("past-sessions-section")).toBeTruthy();
  });
});
