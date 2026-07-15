import type { EngineQuote, HouseholdMandate, QuoteComponent } from "@autopilot/schemas";
import type {
  CostBreakdown,
  EngineInput,
  EngineResult,
  EvaluatedConfiguration,
  HouseholdConfiguration,
  LineSelection,
  ReasonCode,
} from "./types";

const USABLE_QUOTE_STATES = new Set(["estimate", "conditional", "bindable", "selected"]);

function componentsFor(quote: EngineQuote, line: "auto" | "property"): QuoteComponent[] {
  return quote.components.filter((c) => c.productLine === line);
}

function selection(quote: EngineQuote, component: QuoteComponent): LineSelection {
  return {
    quoteId: quote.id,
    insurerId: quote.insurerId,
    insurerName: quote.insurerName,
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
        bundled: auto.quote.insurerId === property.quote.insurerId,
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

function checkHardRequirements(
  mandate: HouseholdMandate,
  config: HouseholdConfiguration,
): ReasonCode[] {
  const violations: ReasonCode[] = [];
  const auto = config.auto.component.auto;
  const property = config.property.component.property;

  if (!auto || !property) {
    violations.push("QUOTE_NOT_USABLE");
    return violations;
  }

  const a = mandate.auto;
  if (auto.thirdPartyLiabilityCents < a.minThirdPartyLiabilityCents)
    violations.push("AUTO_LIABILITY_BELOW_MINIMUM");
  if (a.collisionRequired && !auto.collisionIncluded) violations.push("AUTO_COLLISION_MISSING");
  if (a.comprehensiveRequired && !auto.comprehensiveIncluded)
    violations.push("AUTO_COMPREHENSIVE_MISSING");
  if (
    auto.collisionIncluded &&
    auto.collisionDeductibleCents !== null &&
    auto.collisionDeductibleCents > a.maxCollisionDeductibleCents
  )
    violations.push("AUTO_COLLISION_DEDUCTIBLE_TOO_HIGH");
  if (
    auto.comprehensiveIncluded &&
    auto.comprehensiveDeductibleCents !== null &&
    auto.comprehensiveDeductibleCents > a.maxComprehensiveDeductibleCents
  )
    violations.push("AUTO_COMPREHENSIVE_DEDUCTIBLE_TOO_HIGH");
  if (a.accidentForgivenessRequired && !auto.accidentForgivenessIncluded)
    violations.push("AUTO_ACCIDENT_FORGIVENESS_MISSING");
  if (a.rentalVehicleCoverageRequired && !auto.rentalVehicleCoverageIncluded)
    violations.push("AUTO_RENTAL_COVERAGE_MISSING");
  if (!a.telematicsAllowed && auto.telematicsRequired)
    violations.push("AUTO_TELEMATICS_PROHIBITED");

  const p = mandate.property;
  if (property.dwellingLimitCents < p.minDwellingLimitCents)
    violations.push("PROPERTY_DWELLING_LIMIT_BELOW_MINIMUM");
  if (p.replacementCostRequired && !property.replacementCostIncluded)
    violations.push("PROPERTY_REPLACEMENT_COST_MISSING");
  if (p.sewerBackupRequired && !property.sewerBackupIncluded)
    violations.push("PROPERTY_SEWER_BACKUP_MISSING");
  if (p.overlandWaterRequired && !property.overlandWaterIncluded)
    violations.push("PROPERTY_OVERLAND_WATER_MISSING");
  if (property.baseDeductibleCents > p.maxBaseDeductibleCents)
    violations.push("PROPERTY_BASE_DEDUCTIBLE_TOO_HIGH");
  if (
    property.waterDeductibleCents !== null &&
    property.waterDeductibleCents > p.maxWaterDeductibleCents
  )
    violations.push("PROPERTY_WATER_DEDUCTIBLE_TOO_HIGH");
  if (p.additionalLivingExpensesRequired && !property.additionalLivingExpensesIncluded)
    violations.push("PROPERTY_ALE_MISSING");
  if (p.equipmentBreakdownRequired && !property.equipmentBreakdownIncluded)
    violations.push("PROPERTY_EQUIPMENT_BREAKDOWN_MISSING");

  return violations;
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
  if (incumbentAuto.collisionIncluded && !auto.collisionIncluded)
    reductions.push("auto_collision_removed");
  if (incumbentAuto.comprehensiveIncluded && !auto.comprehensiveIncluded)
    reductions.push("auto_comprehensive_removed");
  if (incumbentAuto.rentalVehicleCoverageIncluded && !auto.rentalVehicleCoverageIncluded)
    reductions.push("auto_rental_removed");
  if (incumbentAuto.accidentForgivenessIncluded && !auto.accidentForgivenessIncluded)
    reductions.push("auto_accident_forgiveness_removed");
  if (property.dwellingLimitCents < incumbentProperty.dwellingLimitCents)
    reductions.push("property_dwelling_limit_reduced");
  if (incumbentProperty.replacementCostIncluded && !property.replacementCostIncluded)
    reductions.push("property_replacement_cost_removed");
  if (incumbentProperty.sewerBackupIncluded && !property.sewerBackupIncluded)
    reductions.push("property_sewer_backup_removed");
  if (incumbentProperty.overlandWaterIncluded && !property.overlandWaterIncluded)
    reductions.push("property_overland_water_removed");
  if (
    incumbentProperty.additionalLivingExpensesIncluded &&
    !property.additionalLivingExpensesIncluded
  )
    reductions.push("property_ale_removed");
  if (incumbentProperty.equipmentBreakdownIncluded && !property.equipmentBreakdownIncluded)
    reductions.push("property_equipment_breakdown_removed");

  return reductions;
}

function deductibleIncreasedVsIncumbent(
  input: EngineInput,
  config: HouseholdConfiguration,
): boolean {
  const incumbentAuto = input.incumbentAuto.component.auto;
  const incumbentProperty = input.incumbentProperty.component.property;
  const auto = config.auto.component.auto;
  const property = config.property.component.property;
  if (!auto || !property) return false;

  const numOr = (v: number | null, fallback: number) => (v === null ? fallback : v);
  if (
    auto.collisionIncluded &&
    incumbentAuto.collisionIncluded &&
    numOr(auto.collisionDeductibleCents, 0) > numOr(incumbentAuto.collisionDeductibleCents, 0)
  )
    return true;
  if (
    auto.comprehensiveIncluded &&
    incumbentAuto.comprehensiveIncluded &&
    numOr(auto.comprehensiveDeductibleCents, 0) >
      numOr(incumbentAuto.comprehensiveDeductibleCents, 0)
  )
    return true;
  if (property.baseDeductibleCents > incumbentProperty.baseDeductibleCents) return true;
  if (numOr(property.waterDeductibleCents, 0) > numOr(incumbentProperty.waterDeductibleCents, 0))
    return true;
  return false;
}

function totalDeductibles(config: HouseholdConfiguration): number {
  const auto = config.auto.component.auto;
  const property = config.property.component.property;
  let total = 0;
  if (auto) {
    total += auto.collisionDeductibleCents ?? 0;
    total += auto.comprehensiveDeductibleCents ?? 0;
  }
  if (property) {
    total += property.baseDeductibleCents;
    total += property.waterDeductibleCents ?? 0;
  }
  return total;
}

function underwritingConditionCount(input: EngineInput, config: HouseholdConfiguration): number {
  const autoQuote = quoteById(input, config.auto.quoteId);
  const propertyQuote = quoteById(input, config.property.quoteId);
  const quotes = autoQuote.id === propertyQuote.id ? [autoQuote] : [autoQuote, propertyQuote];
  return quotes.reduce((n, q) => n + q.underwritingConditions.length, 0);
}

/**
 * Deterministic household optimization.
 * Pure: same input always produces the same ranked output. No AI, no randomness.
 */
export function evaluateHousehold(input: EngineInput): EngineResult {
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

    const excluded = new Set(mandate.switching.excludedInsurerIds);
    if (
      !config.isIncumbentConfiguration &&
      (excluded.has(config.auto.insurerId) || excluded.has(config.property.insurerId))
    ) {
      eligible = false;
      reasonCodes.push("EXCLUDED_INSURER");
    }

    const violations = checkHardRequirements(mandate, config);
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

    if (
      !config.isIncumbentConfiguration &&
      !mandate.switching.deductibleIncreasesAllowed &&
      deductibleIncreasedVsIncumbent(input, config)
    ) {
      eligible = false;
      reasonCodes.push("DEDUCTIBLE_INCREASE_PROHIBITED");
    }

    if (!config.isIncumbentConfiguration) {
      if (netSavingsCents < mandate.switching.minNetAnnualSavingsCents) {
        eligible = false;
        reasonCodes.push("BELOW_SAVINGS_THRESHOLD");
      } else if (eligible) {
        reasonCodes.push("MEETS_SAVINGS_THRESHOLD");
      }
    }

    return {
      configuration: config,
      cost,
      netSavingsCents,
      eligible,
      reasonCodes,
      coverageReductions,
      deductibleTotalCents: totalDeductibles(config),
      underwritingConditionCount: underwritingConditionCount(input, config),
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

/** Rank by total cost, then no coverage reductions, then lower deductibles, then fewer underwriting conditions. */
export function rankConfigurations(a: EvaluatedConfiguration, b: EvaluatedConfiguration): number {
  if (a.cost.totalCents !== b.cost.totalCents) return a.cost.totalCents - b.cost.totalCents;
  if (a.coverageReductions.length !== b.coverageReductions.length)
    return a.coverageReductions.length - b.coverageReductions.length;
  if (a.deductibleTotalCents !== b.deductibleTotalCents)
    return a.deductibleTotalCents - b.deductibleTotalCents;
  if (a.underwritingConditionCount !== b.underwritingConditionCount)
    return a.underwritingConditionCount - b.underwritingConditionCount;
  return a.configuration.id.localeCompare(b.configuration.id);
}
