import type {
  AutoCoverageDetails,
  EngineQuote,
  HouseholdMandate,
  PropertyCoverageDetails,
  QuoteComponent,
} from "@autopilot/schemas";

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
  | "EXCLUDED_INSURER"
  | "AUTO_LIABILITY_BELOW_MINIMUM"
  | "AUTO_COLLISION_MISSING"
  | "AUTO_COMPREHENSIVE_MISSING"
  | "AUTO_COLLISION_DEDUCTIBLE_TOO_HIGH"
  | "AUTO_COMPREHENSIVE_DEDUCTIBLE_TOO_HIGH"
  | "AUTO_ACCIDENT_FORGIVENESS_MISSING"
  | "AUTO_RENTAL_COVERAGE_MISSING"
  | "AUTO_TELEMATICS_PROHIBITED"
  | "PROPERTY_DWELLING_LIMIT_BELOW_MINIMUM"
  | "PROPERTY_REPLACEMENT_COST_MISSING"
  | "PROPERTY_SEWER_BACKUP_MISSING"
  | "PROPERTY_OVERLAND_WATER_MISSING"
  | "PROPERTY_BASE_DEDUCTIBLE_TOO_HIGH"
  | "PROPERTY_WATER_DEDUCTIBLE_TOO_HIGH"
  | "PROPERTY_ALE_MISSING"
  | "PROPERTY_EQUIPMENT_BREAKDOWN_MISSING"
  | "DEDUCTIBLE_INCREASE_PROHIBITED"
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
