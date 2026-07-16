import { formatCad } from "@/lib/utils";
import type {
  AutoCoverageForm,
  BillingMethod,
  BrokerDirectPreference,
  CoveragePreference,
  DeductibleRule,
  FinancialRating,
  LimitRule,
  MonetaryRule,
  PaymentFrequency,
  PropertyCoverageForm,
  PropertySettlement,
  PropertyType,
  VehicleUseClass,
  FinancingStatus,
  AutoEndorsementKey,
  PropertyOptionalCoverageKey,
} from "@autopilot/schemas";

export const coveragePreferenceLabels: Record<CoveragePreference, string> = {
  required: "Required",
  preferred: "Preferred",
  indifferent: "Indifferent",
  prohibited: "Prohibited",
};

export const limitRuleLabels: Record<LimitRule, string> = {
  minimum: "At least",
  maximum: "At most",
  exact: "Exactly",
  match_current_or_better: "Match current or better",
  any: "Any",
};

export const deductibleRuleLabels: Record<DeductibleRule, string> = {
  maximum: "At most",
  exact: "Exactly",
  match_current_or_better: "Match current or better",
  any: "Any",
};

export const autoCoverageFormLabels: Record<AutoCoverageForm, string> = {
  unknown: "Unknown",
  liability_only: "Liability only",
  collision: "Collision",
  comprehensive: "Comprehensive",
  specified_perils: "Specified perils",
  all_perils: "All perils",
};

export const propertyCoverageFormLabels: Record<PropertyCoverageForm, string> = {
  unknown: "Unknown",
  comprehensive: "Comprehensive",
  broad: "Broad",
  named_perils: "Named perils",
  basic: "Basic",
};

export const propertySettlementLabels: Record<PropertySettlement, string> = {
  unknown: "Unknown",
  replacement_cost: "Replacement cost",
  guaranteed_replacement_cost: "Guaranteed replacement cost",
  extended_replacement_cost: "Extended replacement cost",
  actual_cash_value: "Actual cash value",
};

export const propertyTypeLabels: Record<PropertyType, string> = {
  homeowner: "Homeowner",
  condo: "Condo",
  tenant: "Tenant",
  landlord: "Landlord",
  seasonal: "Seasonal",
  secondary_residence: "Secondary residence",
  unknown: "Unknown",
};

export const vehicleUseClassLabels: Record<VehicleUseClass, string> = {
  personal: "Personal",
  commercial: "Commercial",
  classic: "Classic",
  modified: "Modified",
  unknown: "Unknown",
};

export const financingStatusLabels: Record<FinancingStatus, string> = {
  owned: "Owned",
  financed: "Financed",
  leased: "Leased",
  unknown: "Unknown",
};

export const paymentFrequencyLabels: Record<PaymentFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annual: "Semi-annual",
  annual: "Annual",
};

export const billingMethodLabels: Record<BillingMethod, string> = {
  automatic_bank: "Automatic bank",
  credit_card: "Credit card",
  mail: "Mail",
};

export const brokerDirectLabels: Record<BrokerDirectPreference, string> = {
  broker: "Broker",
  direct: "Direct",
  indifferent: "Indifferent",
};

export const financialRatingLabels: Record<FinancialRating, string> = {
  A_plus: "A+",
  A: "A",
  A_minus: "A-",
  B_plus: "B+",
  B_or_lower: "B or lower",
  any: "Any",
};

export const autoEndorsementLabels: Record<AutoEndorsementKey, string> = {
  accident_forgiveness: "Accident forgiveness",
  rental_vehicle_coverage: "Rental/loss-of-use",
  non_owned_automobile: "Non-owned automobile",
  family_protection: "Family protection",
  depreciation_waiver: "Depreciation waiver / new vehicle",
  oem_parts: "OEM parts preference",
  roadside_assistance: "Roadside assistance",
  disappearing_deductible: "Disappearing deductible",
  glass_coverage: "Glass coverage",
  telematics: "Telematics",
};

export const propertyOptionalCoverageLabels: Record<PropertyOptionalCoverageKey, string> = {
  equipment_breakdown: "Equipment breakdown",
  service_line: "Service line",
  bylaw_coverage: "Bylaw coverage",
  home_systems: "Home systems",
  cyber: "Cyber",
  scheduled_valuables: "Scheduled valuables",
  home_business: "Home business",
  short_term_rental_permission: "Short-term rental permission",
  claims_forgiveness: "Claims forgiveness",
  groundwater_seepage: "Groundwater / seepage",
  ice_dam: "Roof ice dam",
  earthquake: "Earthquake",
};

export function labelForPreference(value?: CoveragePreference): string {
  return value ? coveragePreferenceLabels[value] : "—";
}

function monetaryAmount(rule: MonetaryRule): number | undefined {
  return "amountCents" in rule ? (rule as { amountCents: number }).amountCents : undefined;
}

export function labelForLimit(rule?: MonetaryRule | LimitRule): string {
  if (!rule) return "—";
  if (typeof rule === "string") {
    if (rule === "any") return "Any";
    return limitRuleLabels[rule];
  }
  if (rule.rule === "any") return "Any";
  if (rule.rule === "match_current_or_better") return limitRuleLabels[rule.rule];
  return `${limitRuleLabels[rule.rule]} ${formatCad(monetaryAmount(rule) ?? 0)}`;
}

export function labelForDeductible(rule?: MonetaryRule | DeductibleRule): string {
  if (!rule) return "—";
  if (typeof rule === "string") {
    if (rule === "any") return "Any";
    return deductibleRuleLabels[rule];
  }
  if (rule.rule === "any") return "Any";
  if (rule.rule === "match_current_or_better") return deductibleRuleLabels[rule.rule];
  const label =
    (deductibleRuleLabels as Record<string, string>)[rule.rule] ??
    limitRuleLabels[rule.rule as LimitRule];
  return `${label} ${formatCad(monetaryAmount(rule) ?? 0)}`;
}

export function labelForAutoForm(value?: AutoCoverageForm): string {
  return value ? autoCoverageFormLabels[value] : "—";
}

export function labelForPropertyForm(value?: PropertyCoverageForm): string {
  return value ? propertyCoverageFormLabels[value] : "—";
}

export function labelForSettlement(value?: PropertySettlement): string {
  return value ? propertySettlementLabels[value] : "—";
}

export function labelForPropertyType(value?: PropertyType): string {
  return value ? propertyTypeLabels[value] : "—";
}

export function labelForVehicleUseClass(value?: VehicleUseClass): string {
  return value ? vehicleUseClassLabels[value] : "—";
}

export function labelForFinancingStatus(value?: FinancingStatus): string {
  return value ? financingStatusLabels[value] : "—";
}

export function labelForPaymentFrequency(value?: PaymentFrequency): string {
  return value ? paymentFrequencyLabels[value] : "—";
}

export function labelForBillingMethod(value?: BillingMethod): string {
  return value ? billingMethodLabels[value] : "—";
}

export function labelForBrokerDirect(value?: BrokerDirectPreference): string {
  return value ? brokerDirectLabels[value] : "—";
}

export function labelForFinancialRating(value?: FinancialRating): string {
  return value ? financialRatingLabels[value] : "—";
}
