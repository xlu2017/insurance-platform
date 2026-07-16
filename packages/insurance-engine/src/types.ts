import type {
  AutoCoverageDetails,
  EngineQuote as EngineQuoteSchema,
  HouseholdMandate,
  PropertyCoverageDetails,
  QuoteComponent as QuoteComponentSchema,
} from "@autopilot/schemas";

export type { AutoCoverageDetails, PropertyCoverageDetails } from "@autopilot/schemas";
export type {
  AutoRequirements,
  PropertyRequirements,
  SwitchingPreferences,
  HouseholdMandate,
} from "@autopilot/schemas";

export type ProductLine = "auto" | "property";

export type QuoteComponent = QuoteComponentSchema;
export type EngineQuote = EngineQuoteSchema;

export interface LineSelection {
  quoteId: string;
  insurerId: string;
  insurerName: string;
  component: QuoteComponent;
  isIncumbent: boolean;
}

export interface HouseholdConfiguration {
  id: string;
  auto: LineSelection;
  property: LineSelection;
  bundled: boolean;
  isIncumbentConfiguration: boolean;
}

export interface CostBreakdown {
  autoPremiumCents: number;
  propertyPremiumCents: number;
  policyFeesCents: number;
  paymentFeesCents: number;
  bundleDiscountCents: number;
  cancellationChargesCents: number;
  totalCents: number;
}

export type ReasonCode =
  | "INCUMBENT_CONFIGURATION"
  | "BUNDLED_CONFIGURATION"
  | "SPLIT_CONFIGURATION"
  | "SPLIT_INSURERS_PROHIBITED"
  | "BUNDLE_BREAKUP_PROHIBITED"
  | "EXCLUDED_INSURER"
  | "INSURER_RATING_BELOW_MINIMUM"
  | "AUTO_LIABILITY_BELOW_MINIMUM"
  | "AUTO_LIABILITY_EXCEEDS_MAXIMUM"
  | "AUTO_LIABILITY_NOT_EXACT"
  | "AUTO_COVERAGE_FORM_INSUFFICIENT"
  | "AUTO_COVERAGE_FORM_PROHIBITED"
  | "AUTO_COLLISION_DEDUCTIBLE_TOO_HIGH"
  | "AUTO_COLLISION_DEDUCTIBLE_NOT_EXACT"
  | "AUTO_COMPREHENSIVE_DEDUCTIBLE_TOO_HIGH"
  | "AUTO_COMPREHENSIVE_DEDUCTIBLE_NOT_EXACT"
  | "AUTO_GLASS_DEDUCTIBLE_TOO_HIGH"
  | "AUTO_ENDORSEMENT_MISSING"
  | "AUTO_ENDORSEMENT_PROHIBITED"
  | "AUTO_TELEMATICS_PROHIBITED"
  | "AUTO_TELEMATICS_REQUIRED"
  | "AUTO_VEHICLE_CLASS_MISMATCH"
  | "AUTO_FINANCING_STATUS_MISMATCH"
  | "PROPERTY_DWELLING_LIMIT_BELOW_MINIMUM"
  | "PROPERTY_DWELLING_LIMIT_EXCEEDS_MAXIMUM"
  | "PROPERTY_DWELLING_LIMIT_NOT_EXACT"
  | "PROPERTY_TYPE_MISMATCH"
  | "PROPERTY_COVERAGE_FORM_INSUFFICIENT"
  | "PROPERTY_COVERAGE_FORM_PROHIBITED"
  | "PROPERTY_SETTLEMENT_BELOW_REQUIRED"
  | "PROPERTY_SETTLEMENT_PROHIBITED"
  | "PROPERTY_BASE_DEDUCTIBLE_TOO_HIGH"
  | "PROPERTY_BASE_DEDUCTIBLE_NOT_EXACT"
  | "PROPERTY_WATER_DEDUCTIBLE_TOO_HIGH"
  | "PROPERTY_WIND_HAIL_DEDUCTIBLE_TOO_HIGH"
  | "PROPERTY_EARTHQUAKE_DEDUCTIBLE_TOO_HIGH"
  | "PROPERTY_SEWER_BACKUP_MISSING"
  | "PROPERTY_SEWER_BACKUP_PROHIBITED"
  | "PROPERTY_SEWER_BACKUP_LIMIT_TOO_LOW"
  | "PROPERTY_SEWER_BACKUP_DEDUCTIBLE_TOO_HIGH"
  | "PROPERTY_OVERLAND_WATER_MISSING"
  | "PROPERTY_OVERLAND_WATER_PROHIBITED"
  | "PROPERTY_OVERLAND_WATER_LIMIT_TOO_LOW"
  | "PROPERTY_OVERLAND_WATER_DEDUCTIBLE_TOO_HIGH"
  | "PROPERTY_CONTENTS_LIMIT_TOO_LOW"
  | "PROPERTY_DETACHED_STRUCTURES_LIMIT_TOO_LOW"
  | "PROPERTY_PERSONAL_LIABILITY_LIMIT_TOO_LOW"
  | "PROPERTY_ADDITIONAL_LIVING_EXPENSE_LIMIT_TOO_LOW"
  | "PROPERTY_OPTIONAL_COVERAGE_MISSING"
  | "PROPERTY_OPTIONAL_COVERAGE_PROHIBITED"
  | "DEDUCTIBLE_INCREASE_PROHIBITED"
  | "PREMIUM_INCREASE_TOO_HIGH"
  | "COVERAGE_REDUCTION_VS_INCUMBENT"
  | "BELOW_SAVINGS_THRESHOLD"
  | "MEETS_ALL_HARD_REQUIREMENTS"
  | "MEETS_SAVINGS_THRESHOLD"
  | "QUOTE_NOT_USABLE";

export interface EvaluatedConfiguration {
  configuration: HouseholdConfiguration;
  cost: CostBreakdown;
  netSavingsCents: number;
  eligible: boolean;
  reasonCodes: ReasonCode[];
  coverageReductions: string[];
  deductibleTotalCents: number;
  underwritingConditionCount: number;
}

export interface EngineInput {
  mandate: HouseholdMandate;
  quotes: EngineQuote[];
  incumbentAuto: { quote: EngineQuote; component: QuoteComponent & { auto: AutoCoverageDetails } };
  incumbentProperty: {
    quote: EngineQuote;
    component: QuoteComponent & { property: PropertyCoverageDetails };
  };
}

export interface EngineResult {
  incumbentTotalCents: number;
  evaluated: EvaluatedConfiguration[];
  eligible: EvaluatedConfiguration[];
  recommended: EvaluatedConfiguration | null;
}
