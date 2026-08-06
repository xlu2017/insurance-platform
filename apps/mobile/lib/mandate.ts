import { formatCad } from "@autopilot/schemas";
import {
  autoCoverageFormOptions,
  coveragePreferenceOptions,
  deductibleRuleOptions,
  limitRuleOptions,
  propertyCoverageFormOptions,
  propertySettlementOptions,
} from "@autopilot/schemas";
import type {
  AutoEndorsementKey,
  BillingMethod,
  BrokerDirectPreference,
  FinancialRating,
  FinancingStatus,
  PaymentFrequency,
  PropertyOptionalCoverageKey,
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

export { coveragePreferenceOptions, limitRuleOptions, deductibleRuleOptions };
export { autoCoverageFormOptions, propertyCoverageFormOptions, propertySettlementOptions };

export const propertyTypeOptions: { value: PropertyType; label: string }[] = [
  { value: "homeowner", label: "Homeowner" },
  { value: "condo", label: "Condo" },
  { value: "tenant", label: "Tenant" },
  { value: "landlord", label: "Landlord" },
  { value: "seasonal", label: "Seasonal" },
  { value: "secondary_residence", label: "Secondary residence" },
  { value: "unknown", label: "Unknown" },
];

export const vehicleUseClassOptions: { value: VehicleUseClass; label: string }[] = [
  { value: "personal", label: "Personal" },
  { value: "commercial", label: "Commercial" },
  { value: "classic", label: "Classic" },
  { value: "modified", label: "Modified" },
  { value: "unknown", label: "Unknown" },
];

export const financingStatusOptions: { value: FinancingStatus; label: string }[] = [
  { value: "owned", label: "Owned" },
  { value: "financed", label: "Financed" },
  { value: "leased", label: "Leased" },
  { value: "unknown", label: "Unknown" },
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
