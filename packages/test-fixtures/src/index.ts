import type {
  AutoCoverageDetails,
  EngineQuote,
  HouseholdMandate,
  PropertyCoverageDetails,
  QuoteComponent,
} from "@autopilot/schemas";
import { defaultAutoEndorsements, defaultPropertyOptionalCoverages } from "@autopilot/schemas";

export const standardAutoCoverage: AutoCoverageDetails = {
  thirdPartyLiabilityCents: 200_000_000, // C$2,000,000
  coverageForm: "comprehensive",
  collisionIncluded: true,
  collisionDeductibleCents: 50_000, // C$500
  comprehensiveIncluded: true,
  comprehensiveDeductibleCents: 50_000,
  glassDeductibleCents: null,
  accidentForgivenessIncluded: true,
  rentalVehicleCoverageIncluded: true,
  nonOwnedAutomobileIncluded: false,
  familyProtectionIncluded: false,
  depreciationWaiverIncluded: false,
  oemPartsIncluded: false,
  roadsideAssistanceIncluded: false,
  disappearingDeductibleIncluded: false,
  glassCoverageIncluded: false,
  telematicsRequired: false,
  vehicleClass: "personal",
  financingStatus: "owned",
};

export const standardPropertyCoverage: PropertyCoverageDetails = {
  propertyType: "homeowner",
  coverageForm: "comprehensive",
  settlementBasis: "replacement_cost",
  dwellingLimitCents: 45_000_000, // C$450,000
  contentsLimitCents: 30_000_000,
  detachedStructuresLimitCents: 5_000_000,
  personalLiabilityLimitCents: 2_000_000_000,
  additionalLivingExpenseLimitCents: 20_000_000,
  baseDeductibleCents: 100_000, // C$1,000
  waterDeductibleCents: 200_000, // C$2,000
  windHailIncluded: false,
  windHailDeductibleCents: null,
  earthquakeIncluded: false,
  earthquakeDeductibleCents: null,
  sewerBackupIncluded: true,
  sewerBackupLimitCents: null,
  sewerBackupDeductibleCents: null,
  overlandWaterIncluded: true,
  overlandWaterLimitCents: null,
  overlandWaterDeductibleCents: null,
  groundwaterIncluded: false,
  iceDamIncluded: false,
  equipmentBreakdownIncluded: false,
  serviceLineIncluded: false,
  bylawCoverageIncluded: false,
  homeSystemsIncluded: false,
  cyberCoverageIncluded: false,
  scheduledValuablesIncluded: false,
  homeBusinessIncluded: false,
  shortTermRentalPermissionIncluded: false,
  claimsForgivenessIncluded: false,
};

export const demoMandate: HouseholdMandate = {
  auto: {
    coverageForm: { preference: "required", value: "comprehensive" },
    liability: { rule: "minimum", cents: 200_000_000 },
    collisionDeductible: { rule: "maximum", cents: 100_000 },
    comprehensiveDeductible: { rule: "maximum", cents: 100_000 },
    glassDeductible: { rule: "any", cents: 0 },
    endorsements: { ...defaultAutoEndorsements, telematics: "prohibited" as const },
  },
  property: {
    propertyType: undefined,
    coverageForm: { preference: "required", value: "comprehensive" },
    settlementBasis: { preference: "required", value: "replacement_cost" },
    dwellingLimit: { rule: "minimum", cents: 45_000_000 },
    contentsLimit: { rule: "any", cents: 0 },
    detachedStructuresLimit: { rule: "any", cents: 0 },
    personalLiabilityLimit: { rule: "any", cents: 0 },
    additionalLivingExpenseLimit: { rule: "any", cents: 0 },
    baseDeductible: { rule: "maximum", cents: 200_000 },
    waterDeductible: { rule: "any", cents: 0 },
    windHailDeductible: { rule: "any", cents: 0 },
    earthquakeDeductible: { rule: "any", cents: 0 },
    sewerBackup: {
      preference: "required",
      limit: { rule: "any", cents: 0 },
      deductible: { rule: "any", cents: 0 },
    },
    overlandWater: {
      preference: "indifferent",
      limit: { rule: "any", cents: 0 },
      deductible: { rule: "any", cents: 0 },
    },
    optionalCoverages: defaultPropertyOptionalCoverages,
  },
  switching: {
    minNetAnnualSavingsCents: 20_000, // C$200
    maxPremiumIncreaseCents: 0,
    maxDeductibleIncreaseCents: 0,
    renewalOnlySwitching: true,
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
  },
  vehicleOverrides: {},
  propertyOverrides: {},
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

export function makeQuote(
  overrides: Partial<EngineQuote> &
    Pick<EngineQuote, "id" | "insurerId" | "insurerName" | "components">,
): EngineQuote {
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
