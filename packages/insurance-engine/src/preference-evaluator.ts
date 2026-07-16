import type {
  AutoCoverageDetails,
  CoveragePreference,
  PreferenceAlignment,
  PreferenceAlignmentDetail,
  PropertyCoverageDetails,
} from "@autopilot/schemas";
import type { EngineInput, HouseholdConfiguration } from "./types.ts";
import { autoFormMeetsOrExceeds, propertyFormMeetsOrExceeds } from "./coverage-capabilities.ts";

const settlementRank: Record<PropertyCoverageDetails["settlementBasis"], number> = {
  unknown: 0,
  actual_cash_value: 1,
  replacement_cost: 2,
  extended_replacement_cost: 3,
  guaranteed_replacement_cost: 4,
};

function settlementMeetsOrExceeds(
  actual: PropertyCoverageDetails["settlementBasis"],
  preferred: PropertyCoverageDetails["settlementBasis"],
): boolean {
  return settlementRank[actual] >= settlementRank[preferred];
}

function evaluatePreferredBoolean(
  scope: string,
  item: string,
  preference: CoveragePreference,
  actual: boolean | undefined | null,
): { outcome: PreferenceAlignmentDetail["outcome"]; detail?: PreferenceAlignmentDetail } {
  if (preference !== "preferred") return { outcome: "not_applicable" };
  if (actual === undefined || actual === null) {
    return { outcome: "unknown", detail: { scope, item, outcome: "unknown" } };
  }
  if (actual) {
    return { outcome: "satisfied", detail: { scope, item, outcome: "satisfied" } };
  }
  return { outcome: "missed", detail: { scope, item, outcome: "missed" } };
}

export function evaluatePreferenceAlignment(
  input: EngineInput,
  config: HouseholdConfiguration,
): PreferenceAlignment {
  const details: PreferenceAlignmentDetail[] = [];
  let satisfiedCount = 0;
  let missedCount = 0;
  let notEvaluableCount = 0;

  const auto = config.auto.component.auto;
  const property = config.property.component.property;
  const autoMandate = input.mandate.auto;
  const propertyMandate = input.mandate.property;
  const switching = input.mandate.switching;
  const autoQuote =
    input.quotes.find((q) => q.id === config.auto.quoteId) ?? input.incumbentAuto.quote;
  const propertyQuote =
    input.quotes.find((q) => q.id === config.property.quoteId) ?? input.incumbentProperty.quote;

  function record(
    detail: PreferenceAlignmentDetail | undefined,
    outcome: PreferenceAlignmentDetail["outcome"],
  ) {
    if (!detail) return;
    details.push(detail);
    if (outcome === "satisfied") satisfiedCount++;
    if (outcome === "missed") missedCount++;
    if (outcome === "unknown") notEvaluableCount++;
  }

  // Auto coverage form (preferred)
  if (auto && autoMandate.coverageForm.preference === "preferred") {
    if (autoFormMeetsOrExceeds(auto.coverageForm, autoMandate.coverageForm.value)) {
      details.push({ scope: "auto", item: "coverageForm", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "auto", item: "coverageForm", outcome: "missed" });
      missedCount++;
    }
  }

  // Auto endorsements (preferred)
  for (const [key, value] of Object.entries(autoMandate.endorsements)) {
    if (value === "preferred" && auto) {
      const field = key as keyof AutoCoverageDetails;
      const actual = auto[field] as boolean | undefined | null;
      const { outcome, detail } = evaluatePreferredBoolean(
        "auto_endorsement",
        key,
        "preferred",
        actual,
      );
      record(detail, outcome);
    }
  }

  // Property coverage form (preferred)
  if (property && propertyMandate.coverageForm.preference === "preferred") {
    if (propertyFormMeetsOrExceeds(property.coverageForm, propertyMandate.coverageForm.value)) {
      details.push({ scope: "property", item: "coverageForm", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "property", item: "coverageForm", outcome: "missed" });
      missedCount++;
    }
  }

  // Property settlement (preferred)
  if (property && propertyMandate.settlementBasis.preference === "preferred") {
    if (settlementMeetsOrExceeds(property.settlementBasis, propertyMandate.settlementBasis.value)) {
      details.push({ scope: "property", item: "settlementBasis", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "property", item: "settlementBasis", outcome: "missed" });
      missedCount++;
    }
  }

  // Water coverages (preferred)
  for (const name of ["sewerBackup", "overlandWater"] as const) {
    const requirement = propertyMandate[name];
    if (requirement.preference === "preferred" && property) {
      const included =
        name === "sewerBackup" ? property.sewerBackupIncluded : property.overlandWaterIncluded;
      const { outcome, detail } = evaluatePreferredBoolean(
        "property_water",
        name,
        "preferred",
        included,
      );
      record(detail, outcome);
    }
  }

  // Property optional coverages (preferred)
  for (const [key, value] of Object.entries(propertyMandate.optionalCoverages)) {
    if (value === "preferred" && property) {
      const field = key as keyof PropertyCoverageDetails;
      const actual = property[field] as boolean | undefined | null;
      const { outcome, detail } = evaluatePreferredBoolean(
        "property_optional",
        key,
        "preferred",
        actual,
      );
      record(detail, outcome);
    }
  }

  // Payment frequency (preferred)
  const paymentFreq = autoQuote.paymentFrequency ?? propertyQuote.paymentFrequency;
  if (switching.preferredPaymentFrequency && paymentFreq !== undefined && paymentFreq !== null) {
    if (paymentFreq === switching.preferredPaymentFrequency) {
      details.push({ scope: "switching", item: "paymentFrequency", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "switching", item: "paymentFrequency", outcome: "missed" });
      missedCount++;
    }
  } else if (switching.preferredPaymentFrequency) {
    details.push({ scope: "switching", item: "paymentFrequency", outcome: "unknown" });
    notEvaluableCount++;
  }

  // Billing method (preferred)
  const billingMethod = autoQuote.billingMethod ?? propertyQuote.billingMethod;
  if (switching.preferredBillingMethod && billingMethod !== undefined && billingMethod !== null) {
    if (billingMethod === switching.preferredBillingMethod) {
      details.push({ scope: "switching", item: "billingMethod", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "switching", item: "billingMethod", outcome: "missed" });
      missedCount++;
    }
  } else if (switching.preferredBillingMethod) {
    details.push({ scope: "switching", item: "billingMethod", outcome: "unknown" });
    notEvaluableCount++;
  }

  // Broker / direct preference
  if (switching.brokerDirectPreference && switching.brokerDirectPreference !== "indifferent") {
    const distribution = autoQuote.distributionChannel ?? propertyQuote.distributionChannel;
    if (distribution === undefined || distribution === null) {
      details.push({ scope: "switching", item: "brokerDirectPreference", outcome: "unknown" });
      notEvaluableCount++;
    } else if (distribution === switching.brokerDirectPreference) {
      details.push({ scope: "switching", item: "brokerDirectPreference", outcome: "satisfied" });
      satisfiedCount++;
    } else {
      details.push({ scope: "switching", item: "brokerDirectPreference", outcome: "missed" });
      missedCount++;
    }
  }

  return {
    satisfied_count: satisfiedCount,
    missed_count: missedCount,
    not_evaluable_count: notEvaluableCount,
    details,
  };
}
