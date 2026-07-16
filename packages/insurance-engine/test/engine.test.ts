import { describe, expect, it } from "vitest";
import {
  autoComponent,
  bundleLossScenario,
  demoMandate,
  makeQuote,
  propertyComponent,
} from "@autopilot/test-fixtures";
import { buildConfigurations, computeCost, evaluateHousehold } from "../src";
import type { EngineInput } from "../src";

function scenarioInput(overrides: Partial<EngineInput> = {}): EngineInput {
  const s = bundleLossScenario();
  return {
    mandate: demoMandate,
    quotes: [s.altAAuto, s.incumbentPropertyUnbundled, s.altBBundle],
    incumbentAuto: s.incumbentAuto,
    incumbentProperty: s.incumbentProperty,
    ...overrides,
  };
}

describe("cost calculation", () => {
  it("computes the incumbent combined cost as C$2,950 with bundle discount", () => {
    const input = scenarioInput();
    const result = evaluateHousehold(input);
    expect(result.incumbentTotalCents).toBe(295_000);
  });

  it("includes fees and cancellation charges in total cost", () => {
    const s = bundleLossScenario();
    const quote = makeQuote({
      id: "q-fees",
      insurerId: "insurer-fees",
      insurerName: "Fee Insurer",
      policyFeesCents: 5_000,
      paymentFeesCents: 2_000,
      cancellationChargeCents: 3_000,
      components: [autoComponent(150_000), propertyComponent(100_000)],
    });
    const input = scenarioInput({ quotes: [quote] });
    const configs = buildConfigurations(input);
    const bundled = configs.find(
      (c) => c.auto.quoteId === "q-fees" && c.property.quoteId === "q-fees",
    );
    expect(bundled).toBeDefined();
    const cost = computeCost(input, bundled!);
    expect(cost.totalCents).toBe(150_000 + 100_000 + 5_000 + 2_000 + 3_000);
    void s;
  });

  it("applies the bundle discount only when both lines share the insurer quote", () => {
    const input = scenarioInput();
    const configs = buildConfigurations(input);
    const incumbent = configs.find((c) => c.isIncumbentConfiguration)!;
    expect(computeCost(input, incumbent).bundleDiscountCents).toBe(25_000);

    const split = configs.find(
      (c) => c.auto.quoteId === "quote-alt-a-auto" && c.property.quoteId === "quote-incumbent",
    )!;
    expect(computeCost(input, split).bundleDiscountCents).toBe(0);
  });
});

describe("bundle-loss required scenario", () => {
  it("does not recommend Alternative A despite apparent C$300 auto savings", () => {
    const result = evaluateHousehold(scenarioInput());
    const altA = result.evaluated.find(
      (e) =>
        e.configuration.auto.quoteId === "quote-alt-a-auto" &&
        e.configuration.property.quoteId === "quote-incumbent-property-unbundled",
    )!;
    expect(altA.cost.totalCents).toBe(305_000);
    expect(altA.netSavingsCents).toBe(-10_000);
    expect(altA.eligible).toBe(false);
    expect(altA.reasonCodes).toContain("BELOW_SAVINGS_THRESHOLD");
    expect(result.recommended?.configuration.auto.quoteId).not.toBe("quote-alt-a-auto");
  });

  it("recommends Alternative B with C$250 net savings at a C$200 threshold", () => {
    const result = evaluateHousehold(scenarioInput());
    expect(result.recommended).not.toBeNull();
    const rec = result.recommended!;
    expect(rec.configuration.auto.quoteId).toBe("quote-alt-b-bundle");
    expect(rec.configuration.property.quoteId).toBe("quote-alt-b-bundle");
    expect(rec.cost.totalCents).toBe(270_000);
    expect(rec.netSavingsCents).toBe(25_000);
    expect(rec.reasonCodes).toContain("MEETS_ALL_HARD_REQUIREMENTS");
    expect(rec.reasonCodes).toContain("MEETS_SAVINGS_THRESHOLD");
  });

  it("rejects Alternative B when the savings threshold rises above C$250", () => {
    const mandate = structuredClone(demoMandate);
    mandate.switching.minNetAnnualSavingsCents = 30_000;
    const result = evaluateHousehold(scenarioInput({ mandate }));
    expect(result.recommended).toBeNull();
    const altB = result.evaluated.find(
      (e) => e.configuration.auto.quoteId === "quote-alt-b-bundle" && e.configuration.bundled,
    )!;
    expect(altB.reasonCodes).toContain("BELOW_SAVINGS_THRESHOLD");
  });
});

describe("hard constraint filtering", () => {
  it("rejects configurations violating minimum liability", () => {
    const s = bundleLossScenario();
    const weak = makeQuote({
      id: "q-weak",
      insurerId: "insurer-weak",
      insurerName: "Weak Cover Co",
      components: [
        autoComponent(100_000, { thirdPartyLiabilityCents: 100_000_000 }),
        propertyComponent(80_000),
      ],
    });
    const result = evaluateHousehold(scenarioInput({ quotes: [weak, s.altBBundle] }));
    const weakConfig = result.evaluated.find(
      (e) => e.configuration.auto.quoteId === "q-weak" && e.configuration.bundled,
    )!;
    expect(weakConfig.eligible).toBe(false);
    expect(weakConfig.reasonCodes).toContain("AUTO_LIABILITY_BELOW_MINIMUM");
  });

  it("rejects telematics quotes when telematics is prohibited", () => {
    const telematics = makeQuote({
      id: "q-telematics",
      insurerId: "insurer-telematics",
      insurerName: "Telematics Co",
      components: [autoComponent(120_000, { telematicsRequired: true }), propertyComponent(90_000)],
    });
    const result = evaluateHousehold(scenarioInput({ quotes: [telematics] }));
    const cfg = result.evaluated.find(
      (e) => e.configuration.auto.quoteId === "q-telematics" && e.configuration.bundled,
    )!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("AUTO_TELEMATICS_PROHIBITED");
  });

  it("rejects deductible increases when prohibited", () => {
    const higherDeductible = makeQuote({
      id: "q-high-deductible",
      insurerId: "insurer-hd",
      insurerName: "High Deductible Co",
      components: [
        autoComponent(120_000, { collisionDeductibleCents: 100_000 }),
        propertyComponent(90_000),
      ],
    });
    const result = evaluateHousehold(scenarioInput({ quotes: [higherDeductible] }));
    const cfg = result.evaluated.find(
      (e) => e.configuration.auto.quoteId === "q-high-deductible" && e.configuration.bundled,
    )!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("DEDUCTIBLE_INCREASE_PROHIBITED");
  });

  it("rejects material coverage reductions vs incumbent", () => {
    const reduced = makeQuote({
      id: "q-reduced",
      insurerId: "insurer-reduced",
      insurerName: "Reduced Co",
      components: [
        autoComponent(100_000, {
          rentalVehicleCoverageIncluded: false,
          accidentForgivenessIncluded: false,
        }),
        propertyComponent(80_000),
      ],
    });
    const result = evaluateHousehold(scenarioInput({ quotes: [reduced] }));
    const cfg = result.evaluated.find(
      (e) => e.configuration.auto.quoteId === "q-reduced" && e.configuration.bundled,
    )!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("COVERAGE_REDUCTION_VS_INCUMBENT");
    expect(cfg.coverageReductions).toContain("auto_rental_removed");
  });

  it("rejects excluded insurers", () => {
    const mandate = structuredClone(demoMandate);
    mandate.switching.excludedInsurerIds = ["insurer-bow-river"];
    const result = evaluateHousehold(scenarioInput({ mandate }));
    const cfg = result.evaluated.find(
      (e) => e.configuration.auto.quoteId === "quote-alt-b-bundle" && e.configuration.bundled,
    )!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("EXCLUDED_INSURER");
  });
});

describe("split-insurer handling", () => {
  it("rejects split configurations when split insurers are prohibited", () => {
    const mandate = structuredClone(demoMandate);
    mandate.switching.splitInsurersAllowed = false;
    const result = evaluateHousehold(scenarioInput({ mandate }));
    const splits = result.evaluated.filter(
      (e) => !e.configuration.bundled && !e.configuration.isIncumbentConfiguration,
    );
    expect(splits.length).toBeGreaterThan(0);
    for (const s of splits) {
      expect(s.eligible).toBe(false);
      expect(s.reasonCodes).toContain("SPLIT_INSURERS_PROHIBITED");
    }
  });

  it("always includes the incumbent configuration in evaluation", () => {
    const result = evaluateHousehold(scenarioInput({ quotes: [] }));
    const incumbent = result.evaluated.find((e) => e.configuration.isIncumbentConfiguration);
    expect(incumbent).toBeDefined();
    expect(incumbent!.reasonCodes).toContain("INCUMBENT_CONFIGURATION");
  });
});

describe("ranking", () => {
  it("prefers lower total cost, then fewer reductions, deductibles and conditions", () => {
    const s = bundleLossScenario();
    const cheaperWithConditions = makeQuote({
      id: "q-conditions",
      insurerId: "insurer-conditions",
      insurerName: "Conditions Co",
      underwritingConditions: ["inspection required", "alarm certificate"],
      components: [autoComponent(160_000), propertyComponent(110_000)],
    });
    const result = evaluateHousehold(
      scenarioInput({ quotes: [s.altBBundle, cheaperWithConditions] }),
    );
    // Same total cost (270,000): quote with fewer underwriting conditions wins.
    expect(result.recommended!.configuration.auto.quoteId).toBe("quote-alt-b-bundle");
  });
});

describe("asset-specific mandate inheritance", () => {
  it("uses a vehicle override when a quote component targets that asset", () => {
    const mandate = structuredClone(demoMandate);
    // Override requires a higher liability limit for this vehicle.
    mandate.vehicleOverrides["vehicle-1"] = {
      liability: { rule: "minimum", cents: 2_000_000_000 },
    };

    const assetQuote = makeQuote({
      id: "q-vehicle-1",
      insurerId: "insurer-asset",
      insurerName: "Asset Insurer",
      components: [
        {
          ...autoComponent(150_000, { thirdPartyLiabilityCents: 1_500_000_000 }),
          assetId: "vehicle-1",
        },
        propertyComponent(100_000),
      ],
    });
    const householdQuote = makeQuote({
      id: "q-household",
      insurerId: "insurer-household",
      insurerName: "Household Insurer",
      components: [
        autoComponent(150_000, { thirdPartyLiabilityCents: 2_000_000_000 }),
        propertyComponent(100_000),
      ],
    });

    const input = scenarioInput({
      mandate,
      quotes: [assetQuote, householdQuote],
    });
    const result = evaluateHousehold(input);

    const assetCfg = result.evaluated.find(
      (e) => e.configuration.auto.quoteId === "q-vehicle-1" && e.configuration.bundled,
    )!;
    expect(assetCfg.eligible).toBe(false);
    expect(assetCfg.reasonCodes).toContain("AUTO_LIABILITY_BELOW_MINIMUM");

    const householdCfg = result.evaluated.find(
      (e) => e.configuration.auto.quoteId === "q-household" && e.configuration.bundled,
    )!;
    expect(householdCfg.eligible).toBe(true);
    expect(householdCfg.reasonCodes).toContain("MEETS_ALL_HARD_REQUIREMENTS");
  });

  it("uses a property override when a quote component targets that property", () => {
    const mandate = structuredClone(demoMandate);
    mandate.propertyOverrides["property-1"] = {
      dwellingLimit: { rule: "minimum", cents: 600_000_000 },
    };

    const assetQuote = makeQuote({
      id: "q-asset-prop",
      insurerId: "insurer-asset-prop",
      insurerName: "Asset Prop Insurer",
      components: [
        autoComponent(150_000),
        {
          ...propertyComponent(100_000, { dwellingLimitCents: 500_000_000 }),
          assetId: "property-1",
        },
      ],
    });

    const input = scenarioInput({
      mandate,
      quotes: [assetQuote],
    });
    const result = evaluateHousehold(input);
    const cfg = result.evaluated.find((e) => e.configuration.property.quoteId === "q-asset-prop")!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("PROPERTY_DWELLING_LIMIT_BELOW_MINIMUM");
  });
});

describe("coverage reductions vs incumbent", () => {
  it("flags settlement basis reductions", () => {
    const reducedSettlement = makeQuote({
      id: "q-settlement",
      insurerId: "insurer-settlement",
      insurerName: "Settlement Co",
      components: [
        autoComponent(150_000),
        propertyComponent(100_000, { settlementBasis: "actual_cash_value" }),
      ],
    });
    const result = evaluateHousehold(scenarioInput({ quotes: [reducedSettlement] }));
    const cfg = result.evaluated.find((e) => e.configuration.property.quoteId === "q-settlement")!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("COVERAGE_REDUCTION_VS_INCUMBENT");
    expect(cfg.coverageReductions).toContain("property_settlement_reduced");
  });

  it("flags lowered property limits", () => {
    const loweredContents = makeQuote({
      id: "q-contents",
      insurerId: "insurer-contents",
      insurerName: "Contents Co",
      components: [
        autoComponent(150_000),
        propertyComponent(100_000, { contentsLimitCents: 5_000_000 }),
      ],
    });
    const result = evaluateHousehold(scenarioInput({ quotes: [loweredContents] }));
    const cfg = result.evaluated.find((e) => e.configuration.property.quoteId === "q-contents")!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("COVERAGE_REDUCTION_VS_INCUMBENT");
    expect(cfg.coverageReductions).toContain("property_contents_limit_reduced");
  });
});

describe("quote normalization and switching filters", () => {
  it("rejects insurers with a rating below the household minimum", () => {
    const mandate = structuredClone(demoMandate);
    mandate.switching.minimumInsurerFinancialRating = "A";

    const weakRated = makeQuote({
      id: "q-weak-rated",
      insurerId: "insurer-weak-rated",
      insurerName: "Weak Rated Co",
      insurerFinancialRating: "A_minus",
      components: [autoComponent(150_000), propertyComponent(100_000)],
    });

    const result = evaluateHousehold(scenarioInput({ mandate, quotes: [weakRated] }));
    const cfg = result.evaluated.find((e) => e.configuration.auto.quoteId === "q-weak-rated")!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("INSURER_RATING_BELOW_MINIMUM");
  });

  it("rejects a deductible increase when deductible increases are prohibited", () => {
    const mandate = structuredClone(demoMandate);
    mandate.switching.deductibleIncreasesAllowed = false;

    const higherDeductible = makeQuote({
      id: "q-deductible-increase",
      insurerId: "insurer-deductible",
      insurerName: "Deductible Co",
      components: [
        autoComponent(150_000, { collisionDeductibleCents: 1_000_000 }),
        propertyComponent(100_000),
      ],
    });

    const result = evaluateHousehold(scenarioInput({ mandate, quotes: [higherDeductible] }));
    const cfg = result.evaluated.find(
      (e) => e.configuration.auto.quoteId === "q-deductible-increase" && e.configuration.bundled,
    )!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("DEDUCTIBLE_INCREASE_PROHIBITED");
  });
});
