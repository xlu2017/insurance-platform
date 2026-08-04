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

jest.mock("@/lib/autopilot", () => ({
  useAutopilotSessions: jest.fn().mockReturnValue({
    current: {
      id: "c1",
      state: "recommendation_ready",
      name: "2027 Renewal Review",
      startedAt: "Started July 20, 2026 at 2:14 PM",
      status: "Recommendation ready",
      statusTone: "success",
      isCurrent: true,
      tooltip: "We have compared quotes and prepared a recommendation.",
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
      action: {
        type: "route",
        label: "View details",
        href: { pathname: "/recommendation", params: { caseId: "c1" } },
      },
    },
    past: [
      {
        id: "p1",
        name: "2026 Renewal Review",
        startedAt: "Started July 20, 2025 at 2:14 PM",
        status: "Completed",
        statusTone: "success",
        isCurrent: false,
        tooltip: "This review is complete. Your new policy is in place.",
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
    expect(getByTestId("session-action")).toBeTruthy();
    expect(getAllByText(/View details/).length).toBe(1);
    expect(await findByText(/Other sessions/)).toBeTruthy();
    expect(await findByText(/2026 Renewal Review/)).toBeTruthy();
    expect(getByTestId("current-session")).toBeTruthy();
    expect(getByTestId("past-sessions-section")).toBeTruthy();
  });

  it("exposes a single primary workflow action on the current session", async () => {
    const { getAllByText } = render(<Autopilot />);
    expect(getAllByText(/View details/).length).toBe(1);
  });
});
