import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  caseTransitions,
  quoteRequestTransitions,
  quoteTransitions,
  switchTransitions,
  HouseholdMandate,
  EngineQuote,
  formatCad,
} from "../src";

describe("case state machine", () => {
  it("allows the golden path", () => {
    const path = [
      "draft",
      "awaiting_documents",
      "extracting_information",
      "awaiting_customer_confirmation",
      "ready_for_market_search",
      "requesting_quotes",
      "awaiting_quotes",
      "comparing_quotes",
      "licensed_review",
      "recommendation_ready",
      "customer_decision",
      "switching",
      "completed",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(caseTransitions, path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("rejects skipping licensed review", () => {
    expect(canTransition(caseTransitions, "comparing_quotes", "recommendation_ready")).toBe(false);
    expect(() =>
      assertTransition(caseTransitions, "comparing_quotes", "recommendation_ready"),
    ).toThrow();
  });

  it("terminal states have no outgoing transitions", () => {
    expect(caseTransitions.completed).toHaveLength(0);
    expect(caseTransitions.cancelled).toHaveLength(0);
    expect(caseTransitions.retained_incumbent).toHaveLength(0);
  });
});

describe("switch state machine", () => {
  it("never allows incumbent cancellation before replacement confirmation", () => {
    expect(
      canTransition(switchTransitions, "customer_approved", "incumbent_cancellation_pending"),
    ).toBe(false);
    expect(
      canTransition(switchTransitions, "replacement_pending", "incumbent_cancellation_pending"),
    ).toBe(false);
    expect(canTransition(switchTransitions, "replacement_pending", "incumbent_cancelled")).toBe(
      false,
    );
    expect(
      canTransition(switchTransitions, "replacement_confirmed", "incumbent_cancellation_pending"),
    ).toBe(true);
  });
});

describe("quote request state machine", () => {
  it("supports the additional information loop", () => {
    expect(canTransition(quoteRequestTransitions, "sent", "additional_information_required")).toBe(
      true,
    );
    expect(canTransition(quoteRequestTransitions, "additional_information_required", "sent")).toBe(
      true,
    );
  });
});

describe("quote state machine", () => {
  it("only bindable quotes can be selected", () => {
    expect(canTransition(quoteTransitions, "bindable", "selected")).toBe(true);
    expect(canTransition(quoteTransitions, "estimate", "selected")).toBe(false);
    expect(canTransition(quoteTransitions, "conditional", "selected")).toBe(false);
  });
});

describe("schemas", () => {
  it("mandate schema enforces customer approval always required", () => {
    const result = HouseholdMandate.safeParse({
      auto: {
        minThirdPartyLiabilityCents: 200_000_000,
        collisionRequired: true,
        comprehensiveRequired: true,
        maxCollisionDeductibleCents: 100_000,
        maxComprehensiveDeductibleCents: 100_000,
        accidentForgivenessRequired: false,
        rentalVehicleCoverageRequired: false,
        telematicsAllowed: true,
      },
      property: {
        minDwellingLimitCents: 45_000_000,
        replacementCostRequired: true,
        sewerBackupRequired: true,
        overlandWaterRequired: false,
        maxBaseDeductibleCents: 200_000,
        maxWaterDeductibleCents: 500_000,
        additionalLivingExpensesRequired: true,
        equipmentBreakdownRequired: false,
      },
      switching: {
        minNetAnnualSavingsCents: 20_000,
        renewalOnlySwitching: true,
        householdOptimizationEnabled: true,
        splitInsurersAllowed: true,
        excludedInsurerIds: [],
        deductibleIncreasesAllowed: false,
        materialCoverageReductionsAllowed: false,
        customerApprovalRequired: false,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer cents", () => {
    const quote = EngineQuote.safeParse({
      id: "q",
      insurerId: "i",
      insurerName: "Insurer",
      state: "bindable",
      isIncumbent: false,
      policyFeesCents: 10.5,
      paymentFeesCents: 0,
      bundleDiscountCents: 0,
      cancellationChargeCents: 0,
      underwritingConditions: [],
      components: [
        {
          productLine: "auto",
          annualPremiumCents: 100_000,
          auto: {
            thirdPartyLiabilityCents: 200_000_000,
            collisionIncluded: true,
            collisionDeductibleCents: 50_000,
            comprehensiveIncluded: true,
            comprehensiveDeductibleCents: 50_000,
            accidentForgivenessIncluded: true,
            rentalVehicleCoverageIncluded: true,
            telematicsRequired: false,
          },
          property: null,
        },
      ],
      expiresAt: null,
    });
    expect(quote.success).toBe(false);
  });

  it("formats cents as CAD", () => {
    expect(formatCad(295_000)).toContain("2,950");
  });
});
