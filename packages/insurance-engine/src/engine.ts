import type {
  AutoCoverageDetails,
  AutoRequirements,
  CostBreakdown,
  EngineInput,
  EngineQuote,
  EngineResult,
  EvaluatedConfiguration,
  HouseholdConfiguration,
  HouseholdMandate,
  LineSelection,
  PropertyCoverageDetails,
  PropertyRequirements,
  QuoteComponent,
  ReasonCode,
} from "./types.ts";
import type {
  AutoEndorsementKey,
  CoveragePreference,
  PropertyOptionalCoverageKey,
  WaterCoverageRequirement,
} from "@autopilot/schemas";
import { evaluateMonetaryRule } from "./rule-evaluator.ts";
import { evaluatePreferenceAlignment } from "./preference-evaluator.ts";
import { autoFormMeetsOrExceeds, propertyFormMeetsOrExceeds } from "./coverage-capabilities.ts";

const USABLE_QUOTE_STATES = new Set(["estimate", "conditional", "bindable", "selected"]);

const financialRatingRank: Record<string, number> = {
  B_or_lower: 1,
  B_plus: 2,
  A_minus: 3,
  A: 4,
  A_plus: 5,
};

const autoEndorsementMap: Record<AutoEndorsementKey, keyof AutoCoverageDetails> = {
  accident_forgiveness: "accidentForgivenessIncluded",
  rental_vehicle_coverage: "rentalVehicleCoverageIncluded",
  non_owned_automobile: "nonOwnedAutomobileIncluded",
  family_protection: "familyProtectionIncluded",
  depreciation_waiver: "depreciationWaiverIncluded",
  oem_parts: "oemPartsIncluded",
  roadside_assistance: "roadsideAssistanceIncluded",
  disappearing_deductible: "disappearingDeductibleIncluded",
  glass_coverage: "glassCoverageIncluded",
  telematics: "telematicsRequired",
};

const propertyOptionalMap: Record<PropertyOptionalCoverageKey, keyof PropertyCoverageDetails> = {
  equipment_breakdown: "equipmentBreakdownIncluded",
  service_line: "serviceLineIncluded",
  bylaw_coverage: "bylawCoverageIncluded",
  home_systems: "homeSystemsIncluded",
  cyber: "cyberCoverageIncluded",
  scheduled_valuables: "scheduledValuablesIncluded",
  home_business: "homeBusinessIncluded",
  short_term_rental_permission: "shortTermRentalPermissionIncluded",
  claims_forgiveness: "claimsForgivenessIncluded",
  groundwater_seepage: "groundwaterIncluded",
  ice_dam: "iceDamIncluded",
  earthquake: "earthquakeIncluded",
};

const autoEndorsementReasonKey: Record<AutoEndorsementKey, string> = {
  accident_forgiveness: "accident_forgiveness",
  rental_vehicle_coverage: "rental",
  non_owned_automobile: "non_owned_auto",
  family_protection: "family_protection",
  depreciation_waiver: "depreciation_waiver",
  oem_parts: "oem_parts",
  roadside_assistance: "roadside_assistance",
  disappearing_deductible: "disappearing_deductible",
  glass_coverage: "glass_coverage",
  telematics: "telematics",
};

function componentsFor(quote: EngineQuote, line: "auto" | "property"): QuoteComponent[] {
  return quote.components.filter((c) => c.productLine === line);
}

function selection(quote: EngineQuote, component: QuoteComponent): LineSelection {
  return {
    quoteId: quote.id,
    insurerId: quote.insurer.id,
    insurerName: quote.insurer.name,
    component,
    isIncumbent: quote.isIncumbent,
  };
}

/** Build every valid household configuration from usable quotes, always including the incumbent. */
export function buildConfigurations(input: EngineInput): HouseholdConfiguration[] {
  const usable = input.quotes.filter((q) => USABLE_QUOTE_STATES.has(q.state));
  const autoOptions: Array<{ quote: EngineQuote; component: QuoteComponent }> = [];
  const propertyOptions: Array<{ quote: EngineQuote; component: QuoteComponent }> = [];

  for (const quote of usable) {
    for (const component of componentsFor(quote, "auto")) autoOptions.push({ quote, component });
    for (const component of componentsFor(quote, "property"))
      propertyOptions.push({ quote, component });
  }

  autoOptions.push({ quote: input.incumbentAuto.quote, component: input.incumbentAuto.component });
  propertyOptions.push({
    quote: input.incumbentProperty.quote,
    component: input.incumbentProperty.component,
  });

  const configurations: HouseholdConfiguration[] = [];
  const seen = new Set<string>();
  for (const auto of autoOptions) {
    for (const property of propertyOptions) {
      const id = `${auto.quote.id}:auto+${property.quote.id}:property`;
      if (seen.has(id)) continue;
      seen.add(id);
      configurations.push({
        id,
        auto: selection(auto.quote, auto.component),
        property: selection(property.quote, property.component),
        bundled: auto.quote.insurer.id === property.quote.insurer.id,
        isIncumbentConfiguration: auto.quote.isIncumbent && property.quote.isIncumbent,
      });
    }
  }
  return configurations;
}

function quoteById(input: EngineInput, id: string): EngineQuote {
  if (input.incumbentAuto.quote.id === id) return input.incumbentAuto.quote;
  if (input.incumbentProperty.quote.id === id) return input.incumbentProperty.quote;
  const found = input.quotes.find((q) => q.id === id);
  if (!found) throw new Error(`Unknown quote: ${id}`);
  return found;
}

function mergeAutoMandate(
  base: AutoRequirements,
  override?: Partial<AutoRequirements>,
): AutoRequirements {
  if (!override) return base;
  return {
    ...base,
    ...override,
    coverageForm: override.coverageForm
      ? { ...base.coverageForm, ...override.coverageForm }
      : base.coverageForm,
    liability: override.liability ? { ...base.liability, ...override.liability } : base.liability,
    collisionDeductible: override.collisionDeductible
      ? { ...base.collisionDeductible, ...override.collisionDeductible }
      : base.collisionDeductible,
    comprehensiveDeductible: override.comprehensiveDeductible
      ? { ...base.comprehensiveDeductible, ...override.comprehensiveDeductible }
      : base.comprehensiveDeductible,
    glassDeductible: override.glassDeductible
      ? { ...base.glassDeductible, ...override.glassDeductible }
      : base.glassDeductible,
    endorsements: override.endorsements
      ? { ...base.endorsements, ...override.endorsements }
      : base.endorsements,
  } as AutoRequirements;
}

function mergePropertyMandate(
  base: PropertyRequirements,
  override?: Partial<PropertyRequirements>,
): PropertyRequirements {
  if (!override) return base;
  return {
    ...base,
    ...override,
    coverageForm: override.coverageForm
      ? { ...base.coverageForm, ...override.coverageForm }
      : base.coverageForm,
    settlementBasis: override.settlementBasis
      ? { ...base.settlementBasis, ...override.settlementBasis }
      : base.settlementBasis,
    dwellingLimit: override.dwellingLimit
      ? { ...base.dwellingLimit, ...override.dwellingLimit }
      : base.dwellingLimit,
    contentsLimit: override.contentsLimit
      ? { ...base.contentsLimit, ...override.contentsLimit }
      : base.contentsLimit,
    detachedStructuresLimit: override.detachedStructuresLimit
      ? { ...base.detachedStructuresLimit, ...override.detachedStructuresLimit }
      : base.detachedStructuresLimit,
    personalLiabilityLimit: override.personalLiabilityLimit
      ? { ...base.personalLiabilityLimit, ...override.personalLiabilityLimit }
      : base.personalLiabilityLimit,
    additionalLivingExpenseLimit: override.additionalLivingExpenseLimit
      ? { ...base.additionalLivingExpenseLimit, ...override.additionalLivingExpenseLimit }
      : base.additionalLivingExpenseLimit,
    baseDeductible: override.baseDeductible
      ? { ...base.baseDeductible, ...override.baseDeductible }
      : base.baseDeductible,
    waterDeductible: override.waterDeductible
      ? { ...base.waterDeductible, ...override.waterDeductible }
      : base.waterDeductible,
    windHailDeductible: override.windHailDeductible
      ? { ...base.windHailDeductible, ...override.windHailDeductible }
      : base.windHailDeductible,
    earthquakeDeductible: override.earthquakeDeductible
      ? { ...base.earthquakeDeductible, ...override.earthquakeDeductible }
      : base.earthquakeDeductible,
    sewerBackup: override.sewerBackup
      ? { ...base.sewerBackup, ...override.sewerBackup }
      : base.sewerBackup,
    overlandWater: override.overlandWater
      ? { ...base.overlandWater, ...override.overlandWater }
      : base.overlandWater,
    optionalCoverages: override.optionalCoverages
      ? { ...base.optionalCoverages, ...override.optionalCoverages }
      : base.optionalCoverages,
  } as PropertyRequirements;
}

function effectiveAutoMandate(
  mandate: HouseholdMandate,
  component: QuoteComponent,
): AutoRequirements {
  const override = component.assetId ? mandate.vehicleOverrides[component.assetId] : undefined;
  return mergeAutoMandate(mandate.auto, override);
}

function effectivePropertyMandate(
  mandate: HouseholdMandate,
  component: QuoteComponent,
): PropertyRequirements {
  const override = component.assetId ? mandate.propertyOverrides[component.assetId] : undefined;
  return mergePropertyMandate(mandate.property, override);
}

/** Total annual household cost in integer cents. */
export function computeCost(input: EngineInput, config: HouseholdConfiguration): CostBreakdown {
  const autoQuote = quoteById(input, config.auto.quoteId);
  const propertyQuote = quoteById(input, config.property.quoteId);

  const autoPremiumCents = config.auto.component.annualPremiumCents;
  const propertyPremiumCents = config.property.component.annualPremiumCents;

  const distinctQuotes =
    autoQuote.id === propertyQuote.id ? [autoQuote] : [autoQuote, propertyQuote];

  let policyFeesCents = 0;
  let paymentFeesCents = 0;
  let cancellationChargesCents = 0;
  for (const q of distinctQuotes) {
    policyFeesCents += q.policyFeesCents;
    paymentFeesCents += q.paymentFeesCents;
    if (!q.isIncumbent) cancellationChargesCents += q.cancellationChargeCents;
  }

  let bundleDiscountCents = 0;
  if (config.bundled) {
    bundleDiscountCents = Math.max(...distinctQuotes.map((q) => q.bundleDiscountCents));
  }

  const totalCents =
    autoPremiumCents +
    propertyPremiumCents +
    policyFeesCents +
    paymentFeesCents +
    cancellationChargesCents -
    bundleDiscountCents;

  return {
    autoPremiumCents,
    propertyPremiumCents,
    policyFeesCents,
    paymentFeesCents,
    bundleDiscountCents,
    cancellationChargesCents,
    totalCents,
  };
}

// =============================================================================
// Monetary-rule evaluator (reusable, typed, unknown-aware)
// =============================================================================

function pushLimitViolations(
  result: ReturnType<typeof evaluateMonetaryRule>,
  reasonCodes: ReasonCode[],
  belowMinimum: ReasonCode,
  exceedsMaximum: ReasonCode,
  notExact: ReasonCode,
  unknown: ReasonCode,
) {
  switch (result.status) {
    case "below_minimum":
      reasonCodes.push(belowMinimum);
      break;
    case "above_maximum":
      reasonCodes.push(exceedsMaximum);
      break;
    case "not_exact":
      reasonCodes.push(notExact);
      break;
    case "unknown_actual":
    case "unknown_incumbent":
      reasonCodes.push(unknown);
      break;
    case "satisfied":
    case "below_incumbent":
    case "above_incumbent_deductible":
      break;
  }
}

function pushDeductibleViolations(
  result: ReturnType<typeof evaluateMonetaryRule>,
  reasonCodes: ReasonCode[],
  tooHigh: ReasonCode,
  notExact: ReasonCode,
  unknown: ReasonCode,
) {
  switch (result.status) {
    case "above_maximum":
    case "above_incumbent_deductible":
      reasonCodes.push(tooHigh);
      break;
    case "not_exact":
      reasonCodes.push(notExact);
      break;
    case "unknown_actual":
    case "unknown_incumbent":
      reasonCodes.push(unknown);
      break;
    case "satisfied":
    case "below_minimum":
    case "below_incumbent":
      break;
  }
}

function pushWaterLimitViolations(
  result: ReturnType<typeof evaluateMonetaryRule>,
  reasonCodes: ReasonCode[],
  belowMinimum: ReasonCode,
  exceedsMaximum: ReasonCode,
  notExact: ReasonCode,
  unknown: ReasonCode,
) {
  pushLimitViolations(result, reasonCodes, belowMinimum, exceedsMaximum, notExact, unknown);
}

function pushWaterDeductibleViolations(
  result: ReturnType<typeof evaluateMonetaryRule>,
  reasonCodes: ReasonCode[],
  tooHigh: ReasonCode,
  notExact: ReasonCode,
  unknown: ReasonCode,
) {
  pushDeductibleViolations(result, reasonCodes, tooHigh, notExact, unknown);
}

// =============================================================================
// Coverage-form compatibility (capability-based, not a single numeric rank)
// =============================================================================

const settlementRank: Record<PropertyCoverageDetails["settlementBasis"], number> = {
  unknown: 0,
  actual_cash_value: 1,
  replacement_cost: 2,
  extended_replacement_cost: 3,
  guaranteed_replacement_cost: 4,
};

function settlementMeetsOrExceeds(
  actual: PropertyCoverageDetails["settlementBasis"],
  required: PropertyCoverageDetails["settlementBasis"],
): boolean {
  return settlementRank[actual] >= settlementRank[required];
}

function autoFormSatisfies(
  preference: CoveragePreference,
  requiredForm: AutoCoverageDetails["coverageForm"],
  actualForm: AutoCoverageDetails["coverageForm"],
): boolean {
  if (preference === "indifferent" || preference === "preferred") return true;
  if (preference === "prohibited") return actualForm !== requiredForm;
  if (preference === "required") return autoFormMeetsOrExceeds(actualForm, requiredForm);
  return true;
}

function propertyFormSatisfies(
  preference: CoveragePreference,
  requiredForm: PropertyCoverageDetails["coverageForm"],
  actualForm: PropertyCoverageDetails["coverageForm"],
): boolean {
  if (preference === "indifferent" || preference === "preferred") return true;
  if (preference === "prohibited") return actualForm !== requiredForm;
  if (preference === "required") return propertyFormMeetsOrExceeds(actualForm, requiredForm);
  return true;
}

function settlementSatisfies(
  preference: CoveragePreference,
  requiredSettlement: PropertyCoverageDetails["settlementBasis"],
  actualSettlement: PropertyCoverageDetails["settlementBasis"],
): boolean {
  if (preference === "indifferent" || preference === "preferred") return true;
  if (preference === "prohibited") return actualSettlement !== requiredSettlement;
  if (preference === "required")
    return settlementMeetsOrExceeds(actualSettlement, requiredSettlement);
  return true;
}

// =============================================================================
// Hard-requirement checks
// =============================================================================

function checkAutoHardRequirements(
  mandate: AutoRequirements,
  auto: AutoCoverageDetails,
  incumbent: AutoCoverageDetails | undefined,
): ReasonCode[] {
  const violations: ReasonCode[] = [];

  const liability = evaluateMonetaryRule({
    rule: mandate.liability.rule,
    required: mandate.liability.cents,
    actual: auto.thirdPartyLiabilityCents,
    incumbent: incumbent?.thirdPartyLiabilityCents,
    fieldKind: "limit",
  });
  pushLimitViolations(
    liability,
    violations,
    "AUTO_LIABILITY_BELOW_MINIMUM",
    "AUTO_LIABILITY_EXCEEDS_MAXIMUM",
    "AUTO_LIABILITY_NOT_EXACT",
    "AUTO_LIABILITY_UNKNOWN",
  );

  if (
    !autoFormSatisfies(
      mandate.coverageForm.preference,
      mandate.coverageForm.value,
      auto.coverageForm,
    )
  )
    violations.push(
      mandate.coverageForm.preference === "prohibited"
        ? "AUTO_COVERAGE_FORM_PROHIBITED"
        : "AUTO_COVERAGE_FORM_INSUFFICIENT",
    );

  if (mandate.vehicleClass && auto.vehicleClass !== mandate.vehicleClass)
    violations.push("AUTO_VEHICLE_CLASS_MISMATCH");
  if (mandate.financingStatus && auto.financingStatus !== mandate.financingStatus)
    violations.push("AUTO_FINANCING_STATUS_MISMATCH");

  if (auto.collisionIncluded) {
    const collisionDed = evaluateMonetaryRule({
      rule: mandate.collisionDeductible.rule,
      required: mandate.collisionDeductible.cents,
      actual: auto.collisionDeductibleCents,
      incumbent: incumbent?.collisionDeductibleCents,
      fieldKind: "deductible",
    });
    pushDeductibleViolations(
      collisionDed,
      violations,
      "AUTO_COLLISION_DEDUCTIBLE_TOO_HIGH",
      "AUTO_COLLISION_DEDUCTIBLE_NOT_EXACT",
      "AUTO_COLLISION_DEDUCTIBLE_UNKNOWN",
    );
  }

  if (auto.comprehensiveIncluded) {
    const comprehensiveDed = evaluateMonetaryRule({
      rule: mandate.comprehensiveDeductible.rule,
      required: mandate.comprehensiveDeductible.cents,
      actual: auto.comprehensiveDeductibleCents,
      incumbent: incumbent?.comprehensiveDeductibleCents,
      fieldKind: "deductible",
    });
    pushDeductibleViolations(
      comprehensiveDed,
      violations,
      "AUTO_COMPREHENSIVE_DEDUCTIBLE_TOO_HIGH",
      "AUTO_COMPREHENSIVE_DEDUCTIBLE_NOT_EXACT",
      "AUTO_COMPREHENSIVE_DEDUCTIBLE_UNKNOWN",
    );
  }

  const hasGlassCoverage = auto.glassCoverageIncluded || auto.glassDeductibleCents !== null;
  if (hasGlassCoverage) {
    const glassDed = evaluateMonetaryRule({
      rule: mandate.glassDeductible.rule,
      required: mandate.glassDeductible.cents,
      actual: auto.glassDeductibleCents,
      incumbent: undefined,
      fieldKind: "deductible",
    });
    pushDeductibleViolations(
      glassDed,
      violations,
      "AUTO_GLASS_DEDUCTIBLE_TOO_HIGH",
      "AUTO_GLASS_DEDUCTIBLE_NOT_EXACT",
      "AUTO_GLASS_DEDUCTIBLE_UNKNOWN",
    );
  }

  const telematicsPreference = mandate.endorsements.telematics;
  if (telematicsPreference === "required" && !auto.telematicsRequired)
    violations.push("AUTO_TELEMATICS_REQUIRED");
  if (telematicsPreference === "prohibited" && auto.telematicsRequired)
    violations.push("AUTO_TELEMATICS_PROHIBITED");

  for (const [key, field] of Object.entries(autoEndorsementMap) as [
    AutoEndorsementKey,
    keyof AutoCoverageDetails,
  ][]) {
    if (key === "telematics") continue;
    const preference = mandate.endorsements[key];
    if (!preference || preference === "indifferent" || preference === "preferred") continue;
    const value = Boolean(auto[field]);
    if (preference === "required" && !value) violations.push("AUTO_ENDORSEMENT_MISSING");
    if (preference === "prohibited" && value) violations.push("AUTO_ENDORSEMENT_PROHIBITED");
  }

  return violations;
}

function checkWaterCoverage(
  name: "sewerBackup" | "overlandWater",
  requirement: WaterCoverageRequirement,
  actual: PropertyCoverageDetails,
  incumbent: PropertyCoverageDetails | undefined,
): ReasonCode[] {
  const violations: ReasonCode[] = [];
  const isSewer = name === "sewerBackup";
  const included = isSewer ? actual.sewerBackupIncluded : actual.overlandWaterIncluded;
  const limit = isSewer ? actual.sewerBackupLimitCents : actual.overlandWaterLimitCents;
  const deductible = isSewer
    ? actual.sewerBackupDeductibleCents
    : actual.overlandWaterDeductibleCents;
  const incumbentLimit = isSewer
    ? incumbent?.sewerBackupLimitCents
    : incumbent?.overlandWaterLimitCents;
  const incumbentDeductible = isSewer
    ? incumbent?.sewerBackupDeductibleCents
    : incumbent?.overlandWaterDeductibleCents;

  if (requirement.preference === "prohibited" && included) {
    violations.push(
      isSewer ? "PROPERTY_SEWER_BACKUP_PROHIBITED" : "PROPERTY_OVERLAND_WATER_PROHIBITED",
    );
  }
  if (requirement.preference === "required" && !included) {
    violations.push(isSewer ? "PROPERTY_SEWER_BACKUP_MISSING" : "PROPERTY_OVERLAND_WATER_MISSING");
  }

  if (
    (requirement.preference === "required" || requirement.preference === "preferred") &&
    included
  ) {
    if (limit !== null) {
      const limitCheck = evaluateMonetaryRule({
        rule: requirement.limit.rule,
        required: requirement.limit.cents,
        actual: limit,
        incumbent: incumbentLimit,
        fieldKind: "limit",
      });
      pushWaterLimitViolations(
        limitCheck,
        violations,
        isSewer
          ? "PROPERTY_SEWER_BACKUP_LIMIT_BELOW_MINIMUM"
          : "PROPERTY_OVERLAND_WATER_LIMIT_BELOW_MINIMUM",
        isSewer
          ? "PROPERTY_SEWER_BACKUP_LIMIT_EXCEEDS_MAXIMUM"
          : "PROPERTY_OVERLAND_WATER_LIMIT_EXCEEDS_MAXIMUM",
        isSewer
          ? "PROPERTY_SEWER_BACKUP_LIMIT_NOT_EXACT"
          : "PROPERTY_OVERLAND_WATER_LIMIT_NOT_EXACT",
        isSewer ? "PROPERTY_SEWER_BACKUP_LIMIT_UNKNOWN" : "PROPERTY_OVERLAND_WATER_LIMIT_UNKNOWN",
      );
    }
    if (deductible !== null) {
      const dedCheck = evaluateMonetaryRule({
        rule: requirement.deductible.rule,
        required: requirement.deductible.cents,
        actual: deductible,
        incumbent: incumbentDeductible,
        fieldKind: "deductible",
      });
      pushWaterDeductibleViolations(
        dedCheck,
        violations,
        isSewer
          ? "PROPERTY_SEWER_BACKUP_DEDUCTIBLE_TOO_HIGH"
          : "PROPERTY_OVERLAND_WATER_DEDUCTIBLE_TOO_HIGH",
        isSewer
          ? "PROPERTY_SEWER_BACKUP_DEDUCTIBLE_NOT_EXACT"
          : "PROPERTY_OVERLAND_WATER_DEDUCTIBLE_NOT_EXACT",
        isSewer
          ? "PROPERTY_SEWER_BACKUP_DEDUCTIBLE_UNKNOWN"
          : "PROPERTY_OVERLAND_WATER_DEDUCTIBLE_UNKNOWN",
      );
    }
  }

  return violations;
}

function checkPropertyHardRequirements(
  mandate: PropertyRequirements,
  property: PropertyCoverageDetails,
  incumbent: PropertyCoverageDetails | undefined,
): ReasonCode[] {
  const violations: ReasonCode[] = [];

  if (mandate.propertyType && mandate.propertyType !== property.propertyType)
    violations.push("PROPERTY_TYPE_MISMATCH");

  if (
    !propertyFormSatisfies(
      mandate.coverageForm.preference,
      mandate.coverageForm.value,
      property.coverageForm,
    )
  )
    violations.push(
      mandate.coverageForm.preference === "prohibited"
        ? "PROPERTY_COVERAGE_FORM_PROHIBITED"
        : "PROPERTY_COVERAGE_FORM_INSUFFICIENT",
    );

  if (
    !settlementSatisfies(
      mandate.settlementBasis.preference,
      mandate.settlementBasis.value,
      property.settlementBasis,
    )
  )
    violations.push(
      mandate.settlementBasis.preference === "prohibited"
        ? "PROPERTY_SETTLEMENT_PROHIBITED"
        : "PROPERTY_SETTLEMENT_BELOW_REQUIRED",
    );

  const dwelling = evaluateMonetaryRule({
    rule: mandate.dwellingLimit.rule,
    required: mandate.dwellingLimit.cents,
    actual: property.dwellingLimitCents,
    incumbent: incumbent?.dwellingLimitCents,
    fieldKind: "limit",
  });
  pushLimitViolations(
    dwelling,
    violations,
    "PROPERTY_DWELLING_LIMIT_BELOW_MINIMUM",
    "PROPERTY_DWELLING_LIMIT_EXCEEDS_MAXIMUM",
    "PROPERTY_DWELLING_LIMIT_NOT_EXACT",
    "PROPERTY_DWELLING_LIMIT_UNKNOWN",
  );

  const contents = evaluateMonetaryRule({
    rule: mandate.contentsLimit.rule,
    required: mandate.contentsLimit.cents,
    actual: property.contentsLimitCents,
    incumbent: incumbent?.contentsLimitCents,
    fieldKind: "limit",
  });
  pushLimitViolations(
    contents,
    violations,
    "PROPERTY_CONTENTS_LIMIT_BELOW_MINIMUM",
    "PROPERTY_CONTENTS_LIMIT_EXCEEDS_MAXIMUM",
    "PROPERTY_CONTENTS_LIMIT_NOT_EXACT",
    "PROPERTY_CONTENTS_LIMIT_UNKNOWN",
  );

  const detached = evaluateMonetaryRule({
    rule: mandate.detachedStructuresLimit.rule,
    required: mandate.detachedStructuresLimit.cents,
    actual: property.detachedStructuresLimitCents,
    incumbent: incumbent?.detachedStructuresLimitCents,
    fieldKind: "limit",
  });
  pushLimitViolations(
    detached,
    violations,
    "PROPERTY_DETACHED_STRUCTURES_LIMIT_BELOW_MINIMUM",
    "PROPERTY_DETACHED_STRUCTURES_LIMIT_EXCEEDS_MAXIMUM",
    "PROPERTY_DETACHED_STRUCTURES_LIMIT_NOT_EXACT",
    "PROPERTY_DETACHED_STRUCTURES_LIMIT_UNKNOWN",
  );

  const liability = evaluateMonetaryRule({
    rule: mandate.personalLiabilityLimit.rule,
    required: mandate.personalLiabilityLimit.cents,
    actual: property.personalLiabilityLimitCents,
    incumbent: incumbent?.personalLiabilityLimitCents,
    fieldKind: "limit",
  });
  pushLimitViolations(
    liability,
    violations,
    "PROPERTY_PERSONAL_LIABILITY_BELOW_MINIMUM",
    "PROPERTY_PERSONAL_LIABILITY_EXCEEDS_MAXIMUM",
    "PROPERTY_PERSONAL_LIABILITY_NOT_EXACT",
    "PROPERTY_PERSONAL_LIABILITY_UNKNOWN",
  );

  const ale = evaluateMonetaryRule({
    rule: mandate.additionalLivingExpenseLimit.rule,
    required: mandate.additionalLivingExpenseLimit.cents,
    actual: property.additionalLivingExpenseLimitCents,
    incumbent: incumbent?.additionalLivingExpenseLimitCents,
    fieldKind: "limit",
  });
  pushLimitViolations(
    ale,
    violations,
    "PROPERTY_ADDITIONAL_LIVING_EXPENSE_BELOW_MINIMUM",
    "PROPERTY_ADDITIONAL_LIVING_EXPENSE_EXCEEDS_MAXIMUM",
    "PROPERTY_ADDITIONAL_LIVING_EXPENSE_NOT_EXACT",
    "PROPERTY_ADDITIONAL_LIVING_EXPENSE_UNKNOWN",
  );

  const baseDed = evaluateMonetaryRule({
    rule: mandate.baseDeductible.rule,
    required: mandate.baseDeductible.cents,
    actual: property.baseDeductibleCents,
    incumbent: incumbent?.baseDeductibleCents,
    fieldKind: "deductible",
  });
  pushDeductibleViolations(
    baseDed,
    violations,
    "PROPERTY_BASE_DEDUCTIBLE_TOO_HIGH",
    "PROPERTY_BASE_DEDUCTIBLE_NOT_EXACT",
    "PROPERTY_BASE_DEDUCTIBLE_UNKNOWN",
  );

  const waterDed = evaluateMonetaryRule({
    rule: mandate.waterDeductible.rule,
    required: mandate.waterDeductible.cents,
    actual: property.waterDeductibleCents,
    incumbent: incumbent?.waterDeductibleCents,
    fieldKind: "deductible",
  });
  pushDeductibleViolations(
    waterDed,
    violations,
    "PROPERTY_WATER_DEDUCTIBLE_TOO_HIGH",
    "PROPERTY_WATER_DEDUCTIBLE_NOT_EXACT",
    "PROPERTY_WATER_DEDUCTIBLE_UNKNOWN",
  );

  if (property.windHailIncluded) {
    const windHailDed = evaluateMonetaryRule({
      rule: mandate.windHailDeductible.rule,
      required: mandate.windHailDeductible.cents,
      actual: property.windHailDeductibleCents,
      incumbent: incumbent?.windHailDeductibleCents,
      fieldKind: "deductible",
    });
    pushDeductibleViolations(
      windHailDed,
      violations,
      "PROPERTY_WIND_HAIL_DEDUCTIBLE_TOO_HIGH",
      "PROPERTY_WIND_HAIL_DEDUCTIBLE_NOT_EXACT",
      "PROPERTY_WIND_HAIL_DEDUCTIBLE_UNKNOWN",
    );
  }

  if (property.earthquakeIncluded) {
    const earthquakeDed = evaluateMonetaryRule({
      rule: mandate.earthquakeDeductible.rule,
      required: mandate.earthquakeDeductible.cents,
      actual: property.earthquakeDeductibleCents,
      incumbent: incumbent?.earthquakeDeductibleCents,
      fieldKind: "deductible",
    });
    pushDeductibleViolations(
      earthquakeDed,
      violations,
      "PROPERTY_EARTHQUAKE_DEDUCTIBLE_TOO_HIGH",
      "PROPERTY_EARTHQUAKE_DEDUCTIBLE_NOT_EXACT",
      "PROPERTY_EARTHQUAKE_DEDUCTIBLE_UNKNOWN",
    );
  }

  violations.push(...checkWaterCoverage("sewerBackup", mandate.sewerBackup, property, incumbent));
  violations.push(
    ...checkWaterCoverage("overlandWater", mandate.overlandWater, property, incumbent),
  );

  for (const [key, field] of Object.entries(propertyOptionalMap) as [
    PropertyOptionalCoverageKey,
    keyof PropertyCoverageDetails,
  ][]) {
    const preference = mandate.optionalCoverages[key];
    if (!preference || preference === "indifferent" || preference === "preferred") continue;
    const value = Boolean(property[field]);
    if (preference === "required" && !value) violations.push("PROPERTY_OPTIONAL_COVERAGE_MISSING");
    if (preference === "prohibited" && value)
      violations.push("PROPERTY_OPTIONAL_COVERAGE_PROHIBITED");
  }

  return violations;
}

function checkHardRequirements(input: EngineInput, config: HouseholdConfiguration): ReasonCode[] {
  const auto = config.auto.component.auto;
  const property = config.property.component.property;

  if (!auto || !property) return ["QUOTE_NOT_USABLE"];

  const autoMandate = effectiveAutoMandate(input.mandate, config.auto.component);
  const propertyMandate = effectivePropertyMandate(input.mandate, config.property.component);

  const incumbentAuto = input.incumbentAuto.component.auto;
  const incumbentProperty = input.incumbentProperty.component.property;

  return [
    ...checkAutoHardRequirements(autoMandate, auto, incumbentAuto),
    ...checkPropertyHardRequirements(propertyMandate, property, incumbentProperty),
  ];
}

function isCoverageReduced(actual: boolean | number, incumbent: boolean | number): boolean {
  if (typeof actual === "boolean" && typeof incumbent === "boolean") {
    return incumbent && !actual;
  }
  if (typeof actual === "number" && typeof incumbent === "number") {
    return actual < incumbent;
  }
  return false;
}

function coverageReductionsVsIncumbent(
  input: EngineInput,
  config: HouseholdConfiguration,
): string[] {
  const reductions: string[] = [];
  const incumbentAuto = input.incumbentAuto.component.auto;
  const incumbentProperty = input.incumbentProperty.component.property;
  const auto = config.auto.component.auto;
  const property = config.property.component.property;
  if (!auto || !property) return ["missing_coverage_details"];

  if (auto.thirdPartyLiabilityCents < incumbentAuto.thirdPartyLiabilityCents)
    reductions.push("auto_liability_reduced");
  if (!autoFormMeetsOrExceeds(auto.coverageForm, incumbentAuto.coverageForm))
    reductions.push("auto_coverage_form_reduced");
  if (incumbentAuto.collisionIncluded && !auto.collisionIncluded)
    reductions.push("auto_collision_removed");
  if (incumbentAuto.comprehensiveIncluded && !auto.comprehensiveIncluded)
    reductions.push("auto_comprehensive_removed");

  for (const [key, field] of Object.entries(autoEndorsementMap) as [
    AutoEndorsementKey,
    keyof AutoCoverageDetails,
  ][]) {
    if (isCoverageReduced(auto[field] as boolean, incumbentAuto[field] as boolean)) {
      reductions.push(`auto_${autoEndorsementReasonKey[key]}_removed`);
    }
  }

  if (property.dwellingLimitCents < incumbentProperty.dwellingLimitCents)
    reductions.push("property_dwelling_limit_reduced");
  if (!propertyFormMeetsOrExceeds(property.coverageForm, incumbentProperty.coverageForm))
    reductions.push("property_coverage_form_reduced");
  if (!settlementMeetsOrExceeds(property.settlementBasis, incumbentProperty.settlementBasis))
    reductions.push("property_settlement_reduced");
  if (property.contentsLimitCents < incumbentProperty.contentsLimitCents)
    reductions.push("property_contents_limit_reduced");
  if (property.detachedStructuresLimitCents < incumbentProperty.detachedStructuresLimitCents)
    reductions.push("property_detached_structures_limit_reduced");
  if (property.personalLiabilityLimitCents < incumbentProperty.personalLiabilityLimitCents)
    reductions.push("property_personal_liability_limit_reduced");
  if (
    property.additionalLivingExpenseLimitCents !== null &&
    property.additionalLivingExpenseLimitCents !== undefined &&
    incumbentProperty.additionalLivingExpenseLimitCents !== null &&
    incumbentProperty.additionalLivingExpenseLimitCents !== undefined &&
    property.additionalLivingExpenseLimitCents < incumbentProperty.additionalLivingExpenseLimitCents
  )
    reductions.push("property_ale_limit_reduced");

  if (isCoverageReduced(property.sewerBackupIncluded, incumbentProperty.sewerBackupIncluded))
    reductions.push("property_sewer_backup_removed");
  if (
    property.sewerBackupLimitCents !== null &&
    incumbentProperty.sewerBackupLimitCents !== null &&
    property.sewerBackupLimitCents < incumbentProperty.sewerBackupLimitCents
  )
    reductions.push("property_sewer_backup_limit_reduced");
  if (isCoverageReduced(property.overlandWaterIncluded, incumbentProperty.overlandWaterIncluded))
    reductions.push("property_overland_water_removed");
  if (
    property.overlandWaterLimitCents !== null &&
    incumbentProperty.overlandWaterLimitCents !== null &&
    property.overlandWaterLimitCents < incumbentProperty.overlandWaterLimitCents
  )
    reductions.push("property_overland_water_limit_reduced");

  for (const [key, field] of Object.entries(propertyOptionalMap) as [
    PropertyOptionalCoverageKey,
    keyof PropertyCoverageDetails,
  ][]) {
    if (isCoverageReduced(property[field] as boolean, incumbentProperty[field] as boolean)) {
      reductions.push(`property_${key}_removed`);
    }
  }

  return reductions;
}

function numOr(v: number | null | undefined, fallback: number): number {
  return v === null || v === undefined ? fallback : v;
}

function deductibleIncreasedVsIncumbent(
  input: EngineInput,
  config: HouseholdConfiguration,
): { increased: boolean; increaseCents: number } {
  const incumbentAuto = input.incumbentAuto.component.auto;
  const incumbentProperty = input.incumbentProperty.component.property;
  const auto = config.auto.component.auto;
  const property = config.property.component.property;
  if (!auto || !property) return { increased: false, increaseCents: 0 };

  let increaseCents = 0;

  if (auto.collisionIncluded && incumbentAuto.collisionIncluded) {
    const diff =
      numOr(auto.collisionDeductibleCents, 0) - numOr(incumbentAuto.collisionDeductibleCents, 0);
    if (diff > 0) increaseCents += diff;
  }
  if (auto.comprehensiveIncluded && incumbentAuto.comprehensiveIncluded) {
    const diff =
      numOr(auto.comprehensiveDeductibleCents, 0) -
      numOr(incumbentAuto.comprehensiveDeductibleCents, 0);
    if (diff > 0) increaseCents += diff;
  }
  if (numOr(auto.glassDeductibleCents, 0) > numOr(incumbentAuto.glassDeductibleCents, 0))
    increaseCents +=
      numOr(auto.glassDeductibleCents, 0) - numOr(incumbentAuto.glassDeductibleCents, 0);

  if (property.baseDeductibleCents > incumbentProperty.baseDeductibleCents)
    increaseCents += property.baseDeductibleCents - incumbentProperty.baseDeductibleCents;
  if (numOr(property.waterDeductibleCents, 0) > numOr(incumbentProperty.waterDeductibleCents, 0))
    increaseCents +=
      numOr(property.waterDeductibleCents, 0) - numOr(incumbentProperty.waterDeductibleCents, 0);
  if (property.windHailIncluded && incumbentProperty.windHailIncluded) {
    const diff =
      numOr(property.windHailDeductibleCents, 0) -
      numOr(incumbentProperty.windHailDeductibleCents, 0);
    if (diff > 0) increaseCents += diff;
  }
  if (property.earthquakeIncluded && incumbentProperty.earthquakeIncluded) {
    const diff =
      numOr(property.earthquakeDeductibleCents, 0) -
      numOr(incumbentProperty.earthquakeDeductibleCents, 0);
    if (diff > 0) increaseCents += diff;
  }

  return { increased: increaseCents > 0, increaseCents };
}

function totalDeductibles(config: HouseholdConfiguration): number {
  const auto = config.auto.component.auto;
  const property = config.property.component.property;
  let total = 0;
  if (auto) {
    total += auto.collisionIncluded ? numOr(auto.collisionDeductibleCents, 0) : 0;
    total += auto.comprehensiveIncluded ? numOr(auto.comprehensiveDeductibleCents, 0) : 0;
    total += numOr(auto.glassDeductibleCents, 0);
  }
  if (property) {
    total += property.baseDeductibleCents;
    total += numOr(property.waterDeductibleCents, 0);
    total += property.windHailIncluded ? numOr(property.windHailDeductibleCents, 0) : 0;
    total += property.earthquakeIncluded ? numOr(property.earthquakeDeductibleCents, 0) : 0;
  }
  return total;
}

function underwritingConditionCount(input: EngineInput, config: HouseholdConfiguration): number {
  const autoQuote = quoteById(input, config.auto.quoteId);
  const propertyQuote = quoteById(input, config.property.quoteId);
  const quotes = autoQuote.id === propertyQuote.id ? [autoQuote] : [autoQuote, propertyQuote];
  return quotes.reduce((n, q) => n + q.underwritingConditions.length, 0);
}

export function validateEngineInput(
  input: EngineInput,
): { code: ReasonCode; message: string } | null {
  const autoIds = new Set<string>();
  const propertyIds = new Set<string>();

  const allQuotes = [...input.quotes, input.incumbentAuto.quote, input.incumbentProperty.quote];
  for (const quote of allQuotes) {
    let autoSeen = false;
    let propertySeen = false;
    for (const component of quote.components) {
      if (component.productLine === "auto") {
        if (autoSeen) {
          return {
            code: "MULTI_ASSET_OPTIMIZATION_NOT_ENABLED",
            message: "Multi-asset optimization is not enabled in this release.",
          };
        }
        autoSeen = true;
        if (component.assetId) autoIds.add(component.assetId);
      }
      if (component.productLine === "property") {
        if (propertySeen) {
          return {
            code: "MULTI_ASSET_OPTIMIZATION_NOT_ENABLED",
            message: "Multi-asset optimization is not enabled in this release.",
          };
        }
        propertySeen = true;
        if (component.assetId) propertyIds.add(component.assetId);
      }
    }
  }

  if (autoIds.size > 1) {
    return {
      code: "MULTI_ASSET_OPTIMIZATION_NOT_ENABLED",
      message: "Multi-asset optimization is not enabled in this release.",
    };
  }
  if (propertyIds.size > 1) {
    return {
      code: "MULTI_ASSET_OPTIMIZATION_NOT_ENABLED",
      message: "Multi-asset optimization is not enabled in this release.",
    };
  }

  if (input.assets) {
    const vehicleIdSet = new Set(input.assets.vehicles.map((v) => v.id));
    const propertyIdSet = new Set(input.assets.properties.map((p) => p.id));

    for (const id of autoIds) {
      if (id && !vehicleIdSet.has(id)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `Auto component references unknown vehicle ${id}`,
        };
      }
    }
    for (const id of propertyIds) {
      if (id && !propertyIdSet.has(id)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `Property component references unknown property ${id}`,
        };
      }
    }

    for (const vehicle of input.assets.vehicles) {
      if (![...autoIds].some((id) => id === vehicle.id)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `No auto component matches the insured vehicle ${vehicle.id}`,
        };
      }
    }
    for (const property of input.assets.properties) {
      if (![...propertyIds].some((id) => id === property.id)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `No property component matches the insured property ${property.id}`,
        };
      }
    }

    for (const key of Object.keys(input.mandate.vehicleOverrides)) {
      if (!vehicleIdSet.has(key)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `Vehicle override without matching asset ${key}`,
        };
      }
    }
    for (const key of Object.keys(input.mandate.propertyOverrides)) {
      if (!propertyIdSet.has(key)) {
        return {
          code: "MISSING_INSURED_ASSET",
          message: `Property override without matching property ${key}`,
        };
      }
    }
  }

  return null;
}

/**
 * Deterministic household optimization.
 * Pure: same input always produces the same ranked output. No AI, no randomness.
 */
export function evaluateHousehold(input: EngineInput): EngineResult {
  const validation = validateEngineInput(input);
  if (validation) {
    return {
      incumbentTotalCents: 0,
      evaluated: [],
      eligible: [],
      recommended: null,
      rejection: validation,
    };
  }

  const mandate = input.mandate;
  const configurations = buildConfigurations(input);

  const incumbentConfig = configurations.find((c) => c.isIncumbentConfiguration);
  if (!incumbentConfig) throw new Error("Incumbent configuration missing");
  const incumbentTotalCents = computeCost(input, incumbentConfig).totalCents;

  const evaluated: EvaluatedConfiguration[] = configurations.map((config) => {
    const cost = computeCost(input, config);
    const netSavingsCents = incumbentTotalCents - cost.totalCents;
    const reasonCodes: ReasonCode[] = [];
    let eligible = true;

    reasonCodes.push(
      config.isIncumbentConfiguration
        ? "INCUMBENT_CONFIGURATION"
        : config.bundled
          ? "BUNDLED_CONFIGURATION"
          : "SPLIT_CONFIGURATION",
    );

    if (!config.bundled && !mandate.switching.splitInsurersAllowed) {
      eligible = false;
      reasonCodes.push("SPLIT_INSURERS_PROHIBITED");
    }

    const incumbentBundled =
      input.incumbentAuto.quote.insurer.id === input.incumbentProperty.quote.insurer.id;
    if (
      !config.isIncumbentConfiguration &&
      !mandate.switching.allowBundleBreakup &&
      incumbentBundled &&
      !config.bundled
    ) {
      eligible = false;
      reasonCodes.push("BUNDLE_BREAKUP_PROHIBITED");
    }

    const excluded = new Set(mandate.switching.excludedInsurerIds);
    if (
      !config.isIncumbentConfiguration &&
      (excluded.has(config.auto.insurerId) || excluded.has(config.property.insurerId))
    ) {
      eligible = false;
      reasonCodes.push("EXCLUDED_INSURER");
    }

    const autoQuote = quoteById(input, config.auto.quoteId);
    const propertyQuote = quoteById(input, config.property.quoteId);
    if (
      mandate.switching.minimumInsurerFinancialRating !== "any" &&
      mandate.switching.minimumInsurerFinancialRating !== undefined
    ) {
      const requiredRank = financialRatingRank[mandate.switching.minimumInsurerFinancialRating];
      if (requiredRank !== undefined) {
        for (const q of [autoQuote, propertyQuote]) {
          const quoteRating = q.insurer.financialStrengthRating;
          if (quoteRating === undefined || financialRatingRank[quoteRating] === undefined) {
            eligible = false;
            reasonCodes.push("INSURER_RATING_UNKNOWN");
            break;
          }
          if (financialRatingRank[quoteRating] < requiredRank) {
            eligible = false;
            reasonCodes.push("INSURER_RATING_BELOW_MINIMUM");
            break;
          }
        }
      }
    }

    const violations = checkHardRequirements(input, config);
    if (violations.length > 0) {
      eligible = false;
      reasonCodes.push(...violations);
    } else {
      reasonCodes.push("MEETS_ALL_HARD_REQUIREMENTS");
    }

    const coverageReductions = config.isIncumbentConfiguration
      ? []
      : coverageReductionsVsIncumbent(input, config);
    if (!config.isIncumbentConfiguration && coverageReductions.length > 0) {
      eligible = false;
      reasonCodes.push("COVERAGE_REDUCTION_VS_INCUMBENT");
    }

    const deductibleIncrease = deductibleIncreasedVsIncumbent(input, config);
    if (!config.isIncumbentConfiguration) {
      const allowedDeductibleIncreaseCents = mandate.switching.deductibleIncreasesAllowed
        ? (mandate.switching.maxDeductibleIncreaseCents ?? Number.MAX_SAFE_INTEGER)
        : 0;
      if (deductibleIncrease.increaseCents > allowedDeductibleIncreaseCents) {
        eligible = false;
        reasonCodes.push("DEDUCTIBLE_INCREASE_PROHIBITED");
      }
    }

    if (!config.isIncumbentConfiguration) {
      const premiumIncreaseCents = Math.max(0, cost.totalCents - incumbentTotalCents);
      const allowedPremiumIncreaseCents = mandate.switching.maxPremiumIncreaseCents ?? 0;
      if (premiumIncreaseCents > allowedPremiumIncreaseCents) {
        eligible = false;
        reasonCodes.push("PREMIUM_INCREASE_TOO_HIGH");
      }
    }

    if (!config.isIncumbentConfiguration) {
      if (netSavingsCents < mandate.switching.minNetAnnualSavingsCents) {
        eligible = false;
        reasonCodes.push("BELOW_SAVINGS_THRESHOLD");
      } else if (eligible) {
        reasonCodes.push("MEETS_SAVINGS_THRESHOLD");
      }
    }

    const preferenceAlignment = evaluatePreferenceAlignment(input, config);

    return {
      configuration: config,
      cost,
      netSavingsCents,
      eligible,
      reasonCodes,
      coverageReductions,
      deductibleTotalCents: totalDeductibles(config),
      underwritingConditionCount: underwritingConditionCount(input, config),
      preferenceAlignment,
    };
  });

  const eligibleConfigs = evaluated
    .filter((e) => e.eligible && !e.configuration.isIncumbentConfiguration)
    .sort(rankConfigurations);

  return {
    incumbentTotalCents,
    evaluated,
    eligible: eligibleConfigs,
    recommended: eligibleConfigs[0] ?? null,
  };
}

/** Rank by total cost, then fewer missed preferred requirements, then fewer unknown preferred requirements, then lower deductible exposure, then fewer underwriting conditions, then stable deterministic identifier. */
export function rankConfigurations(a: EvaluatedConfiguration, b: EvaluatedConfiguration): number {
  if (a.cost.totalCents !== b.cost.totalCents) return a.cost.totalCents - b.cost.totalCents;
  const aMissed = a.preferenceAlignment.missed_count;
  const bMissed = b.preferenceAlignment.missed_count;
  if (aMissed !== bMissed) return aMissed - bMissed;
  const aUnknown = a.preferenceAlignment.not_evaluable_count;
  const bUnknown = b.preferenceAlignment.not_evaluable_count;
  if (aUnknown !== bUnknown) return aUnknown - bUnknown;
  if (a.coverageReductions.length !== b.coverageReductions.length)
    return a.coverageReductions.length - b.coverageReductions.length;
  if (a.deductibleTotalCents !== b.deductibleTotalCents)
    return a.deductibleTotalCents - b.deductibleTotalCents;
  if (a.underwritingConditionCount !== b.underwritingConditionCount)
    return a.underwritingConditionCount - b.underwritingConditionCount;
  return a.configuration.id.localeCompare(b.configuration.id);
}
