import type {
  AutoCoverageDetails,
  EngineQuote,
  HouseholdMandate,
  PropertyCoverageDetails,
  QuoteComponent,
} from "@autopilot/schemas";

export const standardAutoCoverage: AutoCoverageDetails = {
  thirdPartyLiabilityCents: 200_000_000, // C$2,000,000
  collisionIncluded: true,
  collisionDeductibleCents: 50_000, // C$500
  comprehensiveIncluded: true,
  comprehensiveDeductibleCents: 50_000,
  accidentForgivenessIncluded: true,
  rentalVehicleCoverageIncluded: true,
  telematicsRequired: false,
};

export const standardPropertyCoverage: PropertyCoverageDetails = {
  dwellingLimitCents: 45_000_000, // C$450,000
  replacementCostIncluded: true,
  sewerBackupIncluded: true,
  overlandWaterIncluded: true,
  baseDeductibleCents: 100_000, // C$1,000
  waterDeductibleCents: 200_000, // C$2,000
  additionalLivingExpensesIncluded: true,
  equipmentBreakdownIncluded: false,
};

export const demoMandate: HouseholdMandate = {
  auto: {
    minThirdPartyLiabilityCents: 200_000_000,
    collisionRequired: true,
    comprehensiveRequired: true,
    maxCollisionDeductibleCents: 100_000,
    maxComprehensiveDeductibleCents: 100_000,
    accidentForgivenessRequired: false,
    rentalVehicleCoverageRequired: false,
    telematicsAllowed: false,
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
    minNetAnnualSavingsCents: 20_000, // C$200
    renewalOnlySwitching: true,
    householdOptimizationEnabled: true,
    splitInsurersAllowed: true,
    excludedInsurerIds: [],
    deductibleIncreasesAllowed: false,
    materialCoverageReductionsAllowed: false,
    customerApprovalRequired: true,
  },
};

export function autoComponent(
  annualPremiumCents: number,
  overrides: Partial<AutoCoverageDetails> = {},
): QuoteComponent {
  return {
    productLine: "auto",
    annualPremiumCents,
    auto: { ...standardAutoCoverage, ...overrides },
    property: null,
  };
}

export function propertyComponent(
  annualPremiumCents: number,
  overrides: Partial<PropertyCoverageDetails> = {},
): QuoteComponent {
  return {
    productLine: "property",
    annualPremiumCents,
    auto: null,
    property: { ...standardPropertyCoverage, ...overrides },
  };
}

export function makeQuote(overrides: Partial<EngineQuote> & Pick<EngineQuote, "id" | "insurerId" | "insurerName" | "components">): EngineQuote {
  return {
    state: "bindable",
    isIncumbent: false,
    policyFeesCents: 0,
    paymentFeesCents: 0,
    bundleDiscountCents: 0,
    cancellationChargeCents: 0,
    underwritingConditions: [],
    expiresAt: null,
    ...overrides,
  };
}

/**
 * The exact bundle-loss scenario required by the specification.
 *
 * Incumbent: auto C$2,000 + property C$1,200 - bundle C$250 = C$2,950.
 * Alternative A: new auto C$1,700 but incumbent property rises to C$1,350 after
 * bundle loss -> combined C$3,050. Must not be recommended.
 * Alternative B: bundled auto+property C$2,700, all hard requirements satisfied,
 * net savings C$250 -> eligible when threshold <= C$200.
 */
export function bundleLossScenario() {
  const incumbent = makeQuote({
    id: "quote-incumbent",
    insurerId: "insurer-incumbent",
    insurerName: "Prairie Shield Insurance",
    isIncumbent: true,
    bundleDiscountCents: 25_000, // C$250 bundle discount when both lines stay
    components: [autoComponent(200_000), propertyComponent(120_000)],
  });

  // Alternative A: competitor auto-only quote. Losing the incumbent bundle means
  // the incumbent property line is re-priced at C$1,350 (represented as the
  // property premium without the bundle discount).
  const altAAuto = makeQuote({
    id: "quote-alt-a-auto",
    insurerId: "insurer-north-anchor",
    insurerName: "North Anchor Mutual",
    components: [autoComponent(170_000)],
  });
  const incumbentPropertyUnbundled = makeQuote({
    id: "quote-incumbent-property-unbundled",
    insurerId: "insurer-incumbent",
    insurerName: "Prairie Shield Insurance",
    components: [propertyComponent(135_000)],
  });

  // Alternative B: bundled auto+property at C$2,700 total.
  const altBBundle = makeQuote({
    id: "quote-alt-b-bundle",
    insurerId: "insurer-bow-river",
    insurerName: "Bow River Assurance",
    bundleDiscountCents: 0,
    components: [autoComponent(160_000), propertyComponent(110_000)],
  });

  return {
    incumbent,
    incumbentAuto: {
      quote: incumbent,
      component: autoComponent(200_000) as QuoteComponent & {
        auto: AutoCoverageDetails;
      },
    },
    incumbentProperty: {
      quote: incumbent,
      component: propertyComponent(120_000) as QuoteComponent & {
        property: PropertyCoverageDetails;
      },
    },
    altAAuto,
    incumbentPropertyUnbundled,
    altBBundle,
  };
}
