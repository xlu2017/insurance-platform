import {
  buildCandidateMandateValues,
  initialCurrentMandateValue,
  parseEditableMandateValue,
  visibleMandateItems,
} from "../lib/mandate-reconciliation";
import {
  createDefaultHouseholdCoverageMandateV2,
  updateVehicleOverrideV2,
} from "@autopilot/schemas";
import type { CandidateFieldReview } from "../lib/extraction";

function review(overrides: Partial<CandidateFieldReview>): CandidateFieldReview {
  return {
    id: "review-1",
    candidate_id: "candidate-1",
    household_id: "household-1",
    field_path: "currentCoverage.vehicle.thirdPartyLiabilityLimitCents",
    action: "pending",
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("mobile mandate reconciliation", () => {
  it("counts only document-informed values and omits unknown specifications", () => {
    const items = visibleMandateItems([
      review({ id: "known", value_state: "known" }),
      review({ id: "absent", value_state: "absent" }),
      review({ id: "not-applicable", value_state: "not_applicable" }),
      review({ id: "conflicting", value_state: "conflicting" }),
      review({ id: "unknown", value_state: "unknown" }),
    ]);
    expect(items.map((item) => item.id)).toEqual([
      "known",
      "absent",
      "not-applicable",
      "conflicting",
    ]);
  });

  it("keeps a saved current mandate and otherwise initializes a known value from the document", () => {
    const mandate = createDefaultHouseholdCoverageMandateV2();
    const item = review({
      value_state: "known",
      mandate_path: "liability",
      document_implied_mandate_value: { rule: "minimum", amountCents: 300_000_000 },
      asset_candidate: { id: "candidate-1", asset_type: "vehicle", display_label: "Vehicle" },
    });
    expect(initialCurrentMandateValue(item, mandate, 1)).toEqual(
      mandate.householdAutoDefaults.liability,
    );
    expect(initialCurrentMandateValue(item, mandate, 0)).toEqual({
      rule: "minimum",
      amountCents: 300_000_000,
    });
  });

  it("retains the effective saved override when the candidate links an existing asset", () => {
    const vehicleId = "11111111-1111-4111-8111-111111111111";
    const mandate = updateVehicleOverrideV2(createDefaultHouseholdCoverageMandateV2(), vehicleId, {
      liability: { rule: "minimum", amountCents: 250_000_000 },
    });
    const item = review({
      value_state: "known",
      mandate_path: "liability",
      document_implied_mandate_value: { rule: "minimum", amountCents: 300_000_000 },
      asset_candidate: {
        id: "candidate-1",
        asset_type: "vehicle",
        display_label: "Vehicle",
        draft_decision: "link_existing",
        draft_existing_asset_id: vehicleId,
        draft_existing_asset_type: "vehicle",
      },
    });

    expect(initialCurrentMandateValue(item, mandate, 2)).toEqual({
      rule: "minimum",
      amountCents: 250_000_000,
    });
  });

  it("editing or correcting a document value does not change current until explicitly copied", () => {
    const current = { rule: "minimum", amountCents: 100_000_000 };
    const corrected = parseEditableMandateValue("2500000", current);
    expect(corrected).toEqual({ rule: "minimum", amountCents: 250_000_000 });
    expect(current).toEqual({ rule: "minimum", amountCents: 100_000_000 });
  });

  it("blocks an unresolved material conflict from final values", () => {
    expect(() =>
      buildCandidateMandateValues([
        review({
          is_complete: true,
          material_conflict: true,
          action: "unresolved",
          mandate_path: "liability",
          current_mandate_value: { rule: "minimum", amountCents: 100_000_000 },
        }),
      ]),
    ).toThrow(/must be resolved/);
  });
});
