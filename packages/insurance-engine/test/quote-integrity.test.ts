import { describe, expect, it } from "vitest";
import type { EngineQuote, QuoteComponent } from "@autopilot/schemas";
import {
  TEST_PROPERTY_ID,
  TEST_VEHICLE_ID,
  autoComponent,
  makeQuote,
  propertyComponent,
} from "@autopilot/test-fixtures";
import { createDefaultHouseholdCoverageMandateV2 } from "@autopilot/schemas";
import { buildEngineInputFromSnapshot, evaluateHousehold } from "../src";

const DEFAULT_QUOTES = () => [
  makeQuote({
    id: "quote-auto",
    insurerId: "insurer-a",
    insurerName: "Auto Insurer",
    insurerFinancialRating: "A",
    components: [autoComponent(200_000)],
  }),
  makeQuote({
    id: "quote-property",
    insurerId: "insurer-p",
    insurerName: "Property Insurer",
    insurerFinancialRating: "A",
    components: [propertyComponent(120_000)],
  }),
  makeQuote({
    id: "quote-incumbent",
    insurerId: "insurer-inc",
    insurerName: "Incumbent",
    insurerFinancialRating: "A",
    isIncumbent: true,
    components: [autoComponent(200_000), propertyComponent(120_000)],
  }),
];

function validSnapshot(overrides: { quotes?: EngineQuote[] } = {}) {
  const mandate = createDefaultHouseholdCoverageMandateV2();
  const switching = {
    minNetAnnualSavingsCents: 0,
    maxPremiumIncreaseCents: 0,
    maxDeductibleIncreaseCents: 0,
    renewalOnlySwitching: false,
    householdOptimizationEnabled: true,
    splitInsurersAllowed: true,
    allowBundleBreakup: true,
    excludedInsurerIds: [],
    deductibleIncreasesAllowed: false,
    materialCoverageReductionsAllowed: false,
    customerApprovalRequired: true,
    switchOnlyAfterCustomerApproval: true,
    preferredPaymentFrequency: "annual",
    preferredBillingMethod: "automatic_bank",
    brokerDirectPreference: "indifferent",
    minimumInsurerFinancialRating: "any",
  };
  return {
    mandate,
    switching,
    assets: { vehicles: [{ id: TEST_VEHICLE_ID }], properties: [{ id: TEST_PROPERTY_ID }] },
    quotes: overrides.quotes ?? DEFAULT_QUOTES(),
  };
}

describe("quote validation status filtering", () => {
  it("rejects an incomplete component before engine evaluation", () => {
    const incompleteAuto: QuoteComponent = {
      ...autoComponent(200_000),
      validationStatus: "incomplete",
      validationErrors: [
        { path: ["thirdPartyLiabilityCents"], code: "required", message: "Required" },
      ],
    };
    const quote = makeQuote({
      id: "quote-incomplete",
      insurerId: "insurer-x",
      insurerName: "Incomplete Insurer",
      components: [incompleteAuto],
    });
    const result = buildEngineInputFromSnapshot(validSnapshot({ quotes: [quote] }));
    if (!("code" in result)) throw new Error("Expected error");
    expect(result.code).toBe("QUOTE_NOT_USABLE");
    expect(result.message).toContain("incomplete");
  });

  it("allows a valid component to reach the engine", () => {
    const result = buildEngineInputFromSnapshot(validSnapshot());
    if ("code" in result) throw new Error(`Unexpected error: ${result.message}`);
    expect(result.quotes).toHaveLength(3);
  });
});

describe("unknown insurer metadata fail-closed", () => {
  function ratedSnapshot(rating: "A_plus" | "B_plus" | undefined) {
    const quote = makeQuote({
      id: "quote-rated",
      insurerId: "insurer-rated",
      insurerName: "Rated Insurer",
      insurerFinancialRating: rating,
      isIncumbent: true,
      components: [autoComponent(100_000), propertyComponent(50_000)],
    });
    return buildEngineInputFromSnapshot(validSnapshot({ quotes: [quote] }));
  }

  it("marks an unknown financial rating ineligible when a minimum is required", () => {
    const input = ratedSnapshot(undefined);
    if ("code" in input) throw new Error(`Unexpected error: ${input.message}`);
    const mandate = {
      ...input.mandate,
      switching: { ...input.mandate.switching, minimumInsurerFinancialRating: "A" as const },
    };
    const result = evaluateHousehold({ ...input, mandate });
    const evaluated = result.evaluated.find((e) => e.configuration.auto.quoteId === "quote-rated")!;
    expect(evaluated.eligible).toBe(false);
    expect(evaluated.reasonCodes).toContain("INSURER_RATING_UNKNOWN");
  });

  it("allows a known A+ rating when minimum is A", () => {
    const input = ratedSnapshot("A_plus");
    if ("code" in input) throw new Error(`Unexpected error: ${input.message}`);
    const mandate = {
      ...input.mandate,
      switching: { ...input.mandate.switching, minimumInsurerFinancialRating: "A" as const },
    };
    const result = evaluateHousehold({ ...input, mandate });
    const evaluated = result.evaluated.find((e) => e.configuration.auto.quoteId === "quote-rated")!;
    expect(evaluated.reasonCodes).not.toContain("INSURER_RATING_UNKNOWN");
    expect(evaluated.reasonCodes).not.toContain("INSURER_RATING_BELOW_MINIMUM");
  });

  it("rejects a known B+ rating when minimum is A", () => {
    const input = ratedSnapshot("B_plus");
    if ("code" in input) throw new Error(`Unexpected error: ${input.message}`);
    const mandate = {
      ...input.mandate,
      switching: { ...input.mandate.switching, minimumInsurerFinancialRating: "A" as const },
    };
    const result = evaluateHousehold({ ...input, mandate });
    const evaluated = result.evaluated.find((e) => e.configuration.auto.quoteId === "quote-rated")!;
    expect(evaluated.eligible).toBe(false);
    expect(evaluated.reasonCodes).toContain("INSURER_RATING_BELOW_MINIMUM");
  });
});
