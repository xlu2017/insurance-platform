import { describe, expect, it } from "vitest";
import { autoComponent, demoMandate, makeQuote, propertyComponent } from "@autopilot/test-fixtures";
import { evaluateHousehold } from "../src";
import type { EngineInput } from "../src";

function scenario(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    mandate: structuredClone(demoMandate),
    quotes: [],
    incumbentAuto: {
      quote: makeQuote({
        id: "quote-incumbent-auto",
        insurerId: "ins-inc",
        insurerName: "Inc",
        isIncumbent: true,
        components: [autoComponent(0)],
      }),
      component: autoComponent(0) as EngineInput["incumbentAuto"]["component"],
    },
    incumbentProperty: {
      quote: makeQuote({
        id: "quote-incumbent-property",
        insurerId: "ins-inc",
        insurerName: "Inc",
        isIncumbent: true,
        components: [propertyComponent(120_000)],
      }),
      component: propertyComponent(120_000) as EngineInput["incumbentProperty"]["component"],
    },
    ...overrides,
  };
}

describe("property monetary rule outcomes", () => {
  it("rejects contents above maximum", () => {
    const mandate = structuredClone(demoMandate);
    mandate.property.contentsLimit = { rule: "maximum", cents: 25_000_000 };
    const quote = makeQuote({
      id: "q-contents-max",
      insurerId: "ins-max",
      insurerName: "Max Co",
      components: [propertyComponent(100_000, { contentsLimitCents: 30_000_000 })],
    });
    const result = evaluateHousehold(scenario({ mandate, quotes: [quote] }));
    const cfg = result.evaluated.find(
      (e) => e.configuration.property.quoteId === "q-contents-max",
    )!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("PROPERTY_CONTENTS_LIMIT_EXCEEDS_MAXIMUM");
  });

  it("rejects contents not exact", () => {
    const mandate = structuredClone(demoMandate);
    mandate.property.contentsLimit = { rule: "exact", cents: 30_000_000 };
    const quote = makeQuote({
      id: "q-contents-exact",
      insurerId: "ins-exact",
      insurerName: "Exact Co",
      components: [propertyComponent(100_000, { contentsLimitCents: 29_000_000 })],
    });
    const result = evaluateHousehold(scenario({ mandate, quotes: [quote] }));
    const cfg = result.evaluated.find(
      (e) => e.configuration.property.quoteId === "q-contents-exact",
    )!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("PROPERTY_CONTENTS_LIMIT_NOT_EXACT");
  });

  it("rejects personal liability below minimum", () => {
    const mandate = structuredClone(demoMandate);
    mandate.property.personalLiabilityLimit = { rule: "minimum", cents: 1_000_000_000 };
    const quote = makeQuote({
      id: "q-liab",
      insurerId: "ins-liab",
      insurerName: "Liab Co",
      components: [propertyComponent(100_000, { personalLiabilityLimitCents: 500_000_000 })],
    });
    const result = evaluateHousehold(scenario({ mandate, quotes: [quote] }));
    const cfg = result.evaluated.find((e) => e.configuration.property.quoteId === "q-liab")!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("PROPERTY_PERSONAL_LIABILITY_BELOW_MINIMUM");
  });

  it("rejects base deductible above maximum", () => {
    const mandate = structuredClone(demoMandate);
    mandate.property.baseDeductible = { rule: "maximum", cents: 50_000 };
    const quote = makeQuote({
      id: "q-base-ded",
      insurerId: "ins-ded",
      insurerName: "Ded Co",
      components: [propertyComponent(100_000, { baseDeductibleCents: 100_000 })],
    });
    const result = evaluateHousehold(scenario({ mandate, quotes: [quote] }));
    const cfg = result.evaluated.find((e) => e.configuration.property.quoteId === "q-base-ded")!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("PROPERTY_BASE_DEDUCTIBLE_TOO_HIGH");
  });

  it("rejects base deductible not exact", () => {
    const mandate = structuredClone(demoMandate);
    mandate.property.baseDeductible = { rule: "exact", cents: 50_000 };
    const quote = makeQuote({
      id: "q-base-exact",
      insurerId: "ins-ded",
      insurerName: "Ded Co",
      components: [propertyComponent(100_000, { baseDeductibleCents: 75_000 })],
    });
    const result = evaluateHousehold(scenario({ mandate, quotes: [quote] }));
    const cfg = result.evaluated.find((e) => e.configuration.property.quoteId === "q-base-exact")!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("PROPERTY_BASE_DEDUCTIBLE_NOT_EXACT");
  });

  it("rejects wind/hail deductible above maximum", () => {
    const mandate = structuredClone(demoMandate);
    mandate.property.windHailDeductible = { rule: "maximum", cents: 1_000 };
    const quote = makeQuote({
      id: "q-wind",
      insurerId: "ins-wind",
      insurerName: "Wind Co",
      components: [
        propertyComponent(100_000, { windHailIncluded: true, windHailDeductibleCents: 2_500 }),
      ],
    });
    const result = evaluateHousehold(scenario({ mandate, quotes: [quote] }));
    const cfg = result.evaluated.find((e) => e.configuration.property.quoteId === "q-wind")!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("PROPERTY_WIND_HAIL_DEDUCTIBLE_TOO_HIGH");
  });

  it("rejects sewer backup limit not exact", () => {
    const mandate = structuredClone(demoMandate);
    mandate.property.sewerBackup = {
      preference: "required",
      limit: { rule: "exact", cents: 50_000_000 },
      deductible: { rule: "any", cents: 0 },
    };
    const quote = makeQuote({
      id: "q-sewer",
      insurerId: "ins-sewer",
      insurerName: "Sewer Co",
      components: [
        propertyComponent(100_000, {
          sewerBackupIncluded: true,
          sewerBackupLimitCents: 45_000_000,
        }),
      ],
    });
    const result = evaluateHousehold(scenario({ mandate, quotes: [quote] }));
    const cfg = result.evaluated.find((e) => e.configuration.property.quoteId === "q-sewer")!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("PROPERTY_SEWER_BACKUP_LIMIT_NOT_EXACT");
  });

  it("ranks preferred payment frequency and billing higher", () => {
    const mandate = structuredClone(demoMandate);
    mandate.switching.minNetAnnualSavingsCents = 0;
    mandate.switching.preferredPaymentFrequency = "annual";
    mandate.switching.preferredBillingMethod = "automatic_bank";
    const preferred = makeQuote({
      id: "q-preferred",
      insurerId: "ins-pref",
      insurerName: "Pref Co",
      paymentFrequency: "annual",
      billingMethod: "automatic_bank",
      components: [propertyComponent(110_000)],
    });
    const nonPreferred = makeQuote({
      id: "q-non-preferred",
      insurerId: "ins-non",
      insurerName: "Non Co",
      paymentFrequency: "monthly",
      billingMethod: "mail",
      components: [propertyComponent(110_000)],
    });
    const result = evaluateHousehold(scenario({ mandate, quotes: [preferred, nonPreferred] }));
    expect(result.recommended?.configuration.property.quoteId).toBe("q-preferred");
    const rec = result.recommended!;
    expect(rec.preferenceAlignment.missed_count).toBe(0);
    expect(rec.preferenceAlignment.details.some((d) => d.scope === "switching")).toBe(true);
  });

  it("fails closed when insurer rating is unknown and a minimum is required", () => {
    const mandate = structuredClone(demoMandate);
    mandate.switching.minimumInsurerFinancialRating = "A";
    const quote = makeQuote({
      id: "q-unknown-rating",
      insurerId: "ins-unknown",
      insurerName: "Unknown Co",
      // No insurerFinancialRating => unknown
      components: [propertyComponent(100_000)],
    });
    const result = evaluateHousehold(scenario({ mandate, quotes: [quote] }));
    const cfg = result.evaluated.find(
      (e) => e.configuration.property.quoteId === "q-unknown-rating",
    )!;
    expect(cfg.eligible).toBe(false);
    expect(cfg.reasonCodes).toContain("INSURER_RATING_UNKNOWN");
  });
});
