import React from "react";
import { render, waitFor } from "@testing-library/react-native";
import ReconcileMandateItem from "../app/onboarding/reconcile-mandates/[reviewItemId]";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockHousehold = { id: "household-1" };
const mockRefetch = jest.fn();
const mockItems = [
  {
    id: "review-1",
    candidate_id: "candidate-1",
    household_id: "household-1",
    field_path: "currentCoverage.vehicle.thirdPartyLiabilityLimitCents",
    action: "pending",
    value_state: "known",
    specification_title: "Liability limit",
    mandate_path: "liability",
    document_implied_mandate_value: { rule: "minimum", amountCents: 200_000_000 },
    source_page_number: 4,
    confidence: 0.96,
    material_conflict: false,
    is_complete: false,
    asset_candidate: { id: "candidate-1", asset_type: "vehicle", display_label: "Vehicle" },
    source_document: { file_name: "Current policy.pdf" },
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
  },
  {
    id: "review-2",
    candidate_id: "candidate-1",
    household_id: "household-1",
    field_path: "currentCoverage.vehicle.collisionDeductibleCents",
    action: "pending",
    value_state: "known",
    specification_title: "Collision deductible",
    mandate_path: "collisionDeductible",
    created_at: "2026-07-20T00:00:01.000Z",
    updated_at: "2026-07-20T00:00:01.000Z",
  },
];

jest.mock("expo-router", () => ({
  router: mockRouter,
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ reviewItemId: "review-1" }),
}));

jest.mock("@/lib/household", () => ({
  useHousehold: () => ({ data: mockHousehold, isLoading: false }),
}));

const mockSaveMandateReviewItem = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/extraction", () => ({
  saveMandateReviewItem: (...args: unknown[]) => mockSaveMandateReviewItem(...args),
  useMandateReviewItems: () => ({ data: mockItems, isLoading: false, refetch: mockRefetch }),
}));

jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@autopilot/database", () => ({
  loadHouseholdMandateV2: jest.fn().mockResolvedValue({
    mandate: {
      householdAutoDefaults: { liability: { rule: "minimum", amountCents: 100_000_000 } },
      householdPropertyDefaults: {},
    },
    versions: { mandateVersion: 1, switchingVersion: 1 },
  }),
}));

describe("one specification per mandate screen", () => {
  it("shows progress, one editable current field, and a disabled document value", async () => {
    const view = render(<ReconcileMandateItem />);

    await waitFor(() => expect(view.getByText("1 of 2")).toBeTruthy());
    expect(view.getByText("Liability limit")).toBeTruthy();
    expect(view.queryByText("Collision deductible")).toBeNull();
    expect(view.getByLabelText("Liability limit (current)").props.editable).toBe(true);
    expect(view.getByLabelText("Document-implied value").props.editable).toBe(false);
  });
});
