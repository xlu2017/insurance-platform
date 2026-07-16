import { z } from "zod";
import { NonNegativeCents } from "./money";
import {
  AutoCoverageForm,
  BillingMethod,
  BrokerDirectPreference,
  CoveragePreference,
  DeductibleRule,
  FinancingStatus,
  FinancialRating,
  LimitRule,
  PaymentFrequency,
  PropertyCoverageForm,
  PropertySettlement,
  PropertyType,
  VehicleUseClass,
} from "./enums";

export const LimitRequirement = z.object({
  rule: LimitRule,
  cents: NonNegativeCents.default(0),
});
export type LimitRequirement = z.infer<typeof LimitRequirement>;

export const DeductibleRequirement = z.object({
  rule: DeductibleRule,
  cents: NonNegativeCents.default(0),
});
export type DeductibleRequirement = z.infer<typeof DeductibleRequirement>;

export const AutoCoverageFormRequirement = z.object({
  preference: CoveragePreference,
  value: AutoCoverageForm.default("comprehensive"),
});
export type AutoCoverageFormRequirement = z.infer<typeof AutoCoverageFormRequirement>;

export const PropertyCoverageFormRequirement = z.object({
  preference: CoveragePreference,
  value: PropertyCoverageForm.default("comprehensive"),
});
export type PropertyCoverageFormRequirement = z.infer<typeof PropertyCoverageFormRequirement>;

export const PropertySettlementRequirement = z.object({
  preference: CoveragePreference,
  value: PropertySettlement.default("replacement_cost"),
});
export type PropertySettlementRequirement = z.infer<typeof PropertySettlementRequirement>;

const autoEndorsementKeys = [
  "accident_forgiveness",
  "rental_vehicle_coverage",
  "non_owned_automobile",
  "family_protection",
  "depreciation_waiver",
  "oem_parts",
  "roadside_assistance",
  "disappearing_deductible",
  "glass_coverage",
  "telematics",
] as const;

export const AutoEndorsementKey = z.enum(autoEndorsementKeys);
export type AutoEndorsementKey = z.infer<typeof AutoEndorsementKey>;

const autoEndorsementDefaults = Object.fromEntries(
  autoEndorsementKeys.map((k) => [k, CoveragePreference.default("indifferent")]),
) as Record<(typeof autoEndorsementKeys)[number], ReturnType<typeof CoveragePreference.default>>;

export const AutoEndorsementPreferences = z.object(autoEndorsementDefaults);
export type AutoEndorsementPreferences = z.infer<typeof AutoEndorsementPreferences>;

export const defaultAutoEndorsements: AutoEndorsementPreferences = Object.fromEntries(
  autoEndorsementKeys.map((k) => [k, "indifferent" as CoveragePreference]),
) as unknown as AutoEndorsementPreferences;

export const AutoRequirements = z.object({
  coverageForm: AutoCoverageFormRequirement.default({
    preference: "required",
    value: "comprehensive",
  }),
  liability: LimitRequirement.default({ rule: "minimum", cents: 200_000_000 }),
  collisionDeductible: DeductibleRequirement.default({ rule: "maximum", cents: 100_000 }),
  comprehensiveDeductible: DeductibleRequirement.default({ rule: "maximum", cents: 100_000 }),
  glassDeductible: DeductibleRequirement.default({ rule: "any", cents: 0 }),
  endorsements: AutoEndorsementPreferences.default(defaultAutoEndorsements),
  vehicleClass: VehicleUseClass.optional(),
  financingStatus: FinancingStatus.optional(),
});
export type AutoRequirements = z.infer<typeof AutoRequirements>;

const propertyOptionalCoverageKeys = [
  "equipment_breakdown",
  "service_line",
  "bylaw_coverage",
  "home_systems",
  "cyber",
  "scheduled_valuables",
  "home_business",
  "short_term_rental_permission",
  "claims_forgiveness",
  "groundwater_seepage",
  "ice_dam",
  "earthquake",
] as const;

export const PropertyOptionalCoverageKey = z.enum(propertyOptionalCoverageKeys);
export type PropertyOptionalCoverageKey = z.infer<typeof PropertyOptionalCoverageKey>;

const propertyOptionalCoverageDefaults = Object.fromEntries(
  propertyOptionalCoverageKeys.map((k) => [k, CoveragePreference.default("indifferent")]),
) as Record<
  (typeof propertyOptionalCoverageKeys)[number],
  ReturnType<typeof CoveragePreference.default>
>;

export const PropertyOptionalCoveragePreferences = z.object(propertyOptionalCoverageDefaults);
export type PropertyOptionalCoveragePreferences = z.infer<
  typeof PropertyOptionalCoveragePreferences
>;

export const defaultPropertyOptionalCoverages: PropertyOptionalCoveragePreferences =
  Object.fromEntries(
    propertyOptionalCoverageKeys.map((k) => [k, "indifferent" as CoveragePreference]),
  ) as unknown as PropertyOptionalCoveragePreferences;

export const WaterCoverageRequirement = z.object({
  preference: CoveragePreference,
  limit: LimitRequirement.default({ rule: "any", cents: 0 }),
  deductible: DeductibleRequirement.default({ rule: "any", cents: 0 }),
});
export type WaterCoverageRequirement = z.infer<typeof WaterCoverageRequirement>;

export const PropertyRequirements = z.object({
  propertyType: PropertyType.optional(),
  coverageForm: PropertyCoverageFormRequirement.default({
    preference: "required",
    value: "comprehensive",
  }),
  settlementBasis: PropertySettlementRequirement.default({
    preference: "required",
    value: "replacement_cost",
  }),
  dwellingLimit: LimitRequirement.default({ rule: "minimum", cents: 45_000_000 }),
  contentsLimit: LimitRequirement.default({ rule: "any", cents: 0 }),
  detachedStructuresLimit: LimitRequirement.default({ rule: "any", cents: 0 }),
  personalLiabilityLimit: LimitRequirement.default({ rule: "any", cents: 0 }),
  additionalLivingExpenseLimit: LimitRequirement.default({ rule: "any", cents: 0 }),
  baseDeductible: DeductibleRequirement.default({ rule: "maximum", cents: 250_000 }),
  waterDeductible: DeductibleRequirement.default({ rule: "any", cents: 0 }),
  windHailDeductible: DeductibleRequirement.default({ rule: "any", cents: 0 }),
  earthquakeDeductible: DeductibleRequirement.default({ rule: "any", cents: 0 }),
  sewerBackup: WaterCoverageRequirement.default({ preference: "indifferent" }),
  overlandWater: WaterCoverageRequirement.default({ preference: "indifferent" }),
  optionalCoverages: PropertyOptionalCoveragePreferences.default(defaultPropertyOptionalCoverages),
});
export type PropertyRequirements = z.infer<typeof PropertyRequirements>;

export const SwitchingPreferences = z.object({
  minNetAnnualSavingsCents: NonNegativeCents.default(20_000),
  maxPremiumIncreaseCents: NonNegativeCents.default(0),
  maxDeductibleIncreaseCents: NonNegativeCents.default(0),
  renewalOnlySwitching: z.boolean().default(true),
  householdOptimizationEnabled: z.boolean().default(true),
  splitInsurersAllowed: z.boolean().default(true),
  allowBundleBreakup: z.boolean().default(false),
  excludedInsurerIds: z.array(z.string().uuid()).default([]),
  deductibleIncreasesAllowed: z.boolean().default(false),
  materialCoverageReductionsAllowed: z.boolean().default(false),
  customerApprovalRequired: z.literal(true).default(true),
  switchOnlyAfterCustomerApproval: z.boolean().default(true),
  preferredPaymentFrequency: PaymentFrequency.default("annual"),
  preferredBillingMethod: BillingMethod.default("automatic_bank"),
  brokerDirectPreference: BrokerDirectPreference.default("indifferent"),
  minimumInsurerFinancialRating: FinancialRating.default("any"),
});
export type SwitchingPreferences = z.infer<typeof SwitchingPreferences>;

export const AssetAutoOverride = AutoRequirements.partial();
export type AssetAutoOverride = z.infer<typeof AssetAutoOverride>;

export const AssetPropertyOverride = PropertyRequirements.partial();
export type AssetPropertyOverride = z.infer<typeof AssetPropertyOverride>;

export const HouseholdMandate = z.object({
  auto: AutoRequirements,
  property: PropertyRequirements,
  switching: SwitchingPreferences,
  vehicleOverrides: z.record(z.string().uuid(), AssetAutoOverride).default({}),
  propertyOverrides: z.record(z.string().uuid(), AssetPropertyOverride).default({}),
});
export type HouseholdMandate = z.infer<typeof HouseholdMandate>;
