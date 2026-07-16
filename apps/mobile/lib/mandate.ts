import { formatCad, HouseholdMandate, SwitchingPreferences } from "@autopilot/schemas";
import type {
  AutoCoverageForm,
  AutoEndorsementKey,
  AutoRequirements,
  BillingMethod,
  BrokerDirectPreference,
  CoveragePreference,
  DeductibleRule,
  FinancialRating,
  FinancingStatus,
  HouseholdMandate as HouseholdMandateType,
  LimitRule,
  PaymentFrequency,
  PropertyCoverageForm,
  PropertyOptionalCoverageKey,
  PropertyRequirements,
  PropertySettlement,
  PropertyType,
  VehicleUseClass,
} from "@autopilot/schemas";

export function centsFromDollars(value: string): number {
  const dollars = Number(value.replace(/,/g, ""));
  if (Number.isNaN(dollars)) return 0;
  return Math.round(dollars * 100);
}

export function dollarsFromCents(cents: number | undefined | null): string {
  if (cents === undefined || cents === null) return "";
  return (cents / 100).toFixed(2);
}

export { formatCad };

export const coveragePreferenceOptions: { value: CoveragePreference; label: string }[] = [
  { value: "required", label: "Required" },
  { value: "preferred", label: "Preferred" },
  { value: "indifferent", label: "Indifferent" },
  { value: "prohibited", label: "Prohibited" },
];

export const limitRuleOptions: { value: LimitRule; label: string }[] = [
  { value: "minimum", label: "At least" },
  { value: "maximum", label: "At most" },
  { value: "exact", label: "Exactly" },
  { value: "match_current_or_better", label: "Match current or better" },
  { value: "any", label: "Any" },
];

export const deductibleRuleOptions: { value: DeductibleRule; label: string }[] = [
  { value: "minimum", label: "At least" },
  { value: "maximum", label: "At most" },
  { value: "exact", label: "Exactly" },
  { value: "match_current_or_better", label: "Match current or better" },
  { value: "any", label: "Any" },
];

export const autoCoverageFormOptions: { value: AutoCoverageForm; label: string }[] = [
  { value: "liability_only", label: "Liability only" },
  { value: "collision", label: "Collision" },
  { value: "comprehensive", label: "Comprehensive" },
  { value: "specified_perils", label: "Specified perils" },
  { value: "all_perils", label: "All perils" },
];

export const propertyCoverageFormOptions: { value: PropertyCoverageForm; label: string }[] = [
  { value: "comprehensive", label: "Comprehensive" },
  { value: "broad", label: "Broad" },
  { value: "named_perils", label: "Named perils" },
  { value: "basic", label: "Basic" },
];

export const propertySettlementOptions: { value: PropertySettlement; label: string }[] = [
  { value: "replacement_cost", label: "Replacement cost" },
  { value: "guaranteed_replacement_cost", label: "Guaranteed replacement cost" },
  { value: "extended_replacement_cost", label: "Extended replacement cost" },
  { value: "actual_cash_value", label: "Actual cash value" },
];

export const propertyTypeOptions: { value: PropertyType; label: string }[] = [
  { value: "homeowner", label: "Homeowner" },
  { value: "condo", label: "Condo" },
  { value: "tenant", label: "Tenant" },
  { value: "landlord", label: "Landlord" },
  { value: "seasonal", label: "Seasonal" },
  { value: "secondary_residence", label: "Secondary residence" },
];

export const vehicleUseClassOptions: { value: VehicleUseClass; label: string }[] = [
  { value: "personal", label: "Personal" },
  { value: "commercial", label: "Commercial" },
  { value: "classic", label: "Classic" },
  { value: "modified", label: "Modified" },
];

export const financingStatusOptions: { value: FinancingStatus; label: string }[] = [
  { value: "owned", label: "Owned" },
  { value: "financed", label: "Financed" },
  { value: "leased", label: "Leased" },
];

export const paymentFrequencyOptions: { value: PaymentFrequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semi_annual", label: "Semi-annual" },
  { value: "annual", label: "Annual" },
];

export const billingMethodOptions: { value: BillingMethod; label: string }[] = [
  { value: "automatic_bank", label: "Automatic bank" },
  { value: "credit_card", label: "Credit card" },
  { value: "mail", label: "Mail" },
];

export const brokerDirectOptions: { value: BrokerDirectPreference; label: string }[] = [
  { value: "broker", label: "Broker" },
  { value: "direct", label: "Direct" },
  { value: "indifferent", label: "Indifferent" },
];

export const financialRatingOptions: { value: FinancialRating; label: string }[] = [
  { value: "A_plus", label: "A+ or higher" },
  { value: "A", label: "A" },
  { value: "A_minus", label: "A-" },
  { value: "B_plus", label: "B+" },
  { value: "B_or_lower", label: "B or lower" },
  { value: "any", label: "Any" },
];

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

export function defaultHouseholdMandate(): HouseholdMandateType {
  return HouseholdMandate.parse({}) as HouseholdMandateType;
}

export function parseHouseholdMandate(
  coverage: Record<string, unknown> | null | undefined,
  switching: Record<string, unknown> | null | undefined,
): HouseholdMandateType {
  const raw = {
    auto: coverage?.auto_requirements,
    property: coverage?.property_requirements,
    switching: switching,
    vehicleOverrides: coverage?.vehicle_mandates ?? {},
    propertyOverrides: coverage?.property_mandates ?? {},
  };
  try {
    return HouseholdMandate.parse(raw) as HouseholdMandateType;
  } catch {
    return defaultHouseholdMandate();
  }
}

export function parseSwitchingPreferences(
  row: Record<string, unknown> | null | undefined,
): NonNullable<HouseholdMandateType["switching"]> {
  if (!row) return defaultHouseholdMandate().switching;
  try {
    return SwitchingPreferences.parse(row);
  } catch {
    return defaultHouseholdMandate().switching;
  }
}

export function switchingRowFromMandate(
  switching: HouseholdMandateType["switching"],
): Record<string, unknown> {
  return switching;
}

export function mergeAutoRequirements(
  base: AutoRequirements,
  override: Partial<AutoRequirements> | undefined,
): AutoRequirements {
  if (!override) return base;
  return { ...base, ...override };
}

export function mergePropertyRequirements(
  base: PropertyRequirements,
  override: Partial<PropertyRequirements> | undefined,
): PropertyRequirements {
  if (!override) return base;
  return { ...base, ...override };
}
