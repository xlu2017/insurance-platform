import { z } from "zod";
import { NonNegativeCents } from "./money";
import {
  AutoCoverageForm,
  BrokerDirectPreference,
  CoveragePreference,
  FinancialRating,
  PaymentFrequency,
  BillingMethod,
  PropertyCoverageForm,
  PropertySettlement,
} from "./enums";
import { AutoEndorsementKey, PropertyOptionalCoverageKey } from "./mandate";

// =============================================================================
// Monetary rule: discriminated union. No silent default amount.
// =============================================================================

export const MonetaryRule = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("minimum"), amountCents: NonNegativeCents }).strict(),
  z.object({ rule: z.literal("maximum"), amountCents: NonNegativeCents }).strict(),
  z.object({ rule: z.literal("exact"), amountCents: NonNegativeCents }).strict(),
  z.object({ rule: z.literal("match_current_or_better") }).strict(),
  z.object({ rule: z.literal("any") }).strict(),
]);
export type MonetaryRule = z.infer<typeof MonetaryRule>;

export const LimitRuleV2 = MonetaryRule;
export type LimitRuleV2 = MonetaryRule;
export const DeductibleRuleV2 = MonetaryRule;
export type DeductibleRuleV2 = MonetaryRule;

// =============================================================================
// Shared coverage-preference maps
// =============================================================================

const autoEndorsementKeys = AutoEndorsementKey.options;
const propertyOptionalCoverageKeys = PropertyOptionalCoverageKey.options;

export const AutoEndorsementPreferencesV2 = z.object(
  Object.fromEntries(autoEndorsementKeys.map((key) => [key, CoveragePreference])) as Record<
    (typeof autoEndorsementKeys)[number],
    typeof CoveragePreference
  >,
);
export type AutoEndorsementPreferencesV2 = z.infer<typeof AutoEndorsementPreferencesV2>;

export const PropertyOptionalCoveragePreferencesV2 = z.object(
  Object.fromEntries(
    propertyOptionalCoverageKeys.map((key) => [key, CoveragePreference]),
  ) as Record<(typeof propertyOptionalCoverageKeys)[number], typeof CoveragePreference>,
);
export type PropertyOptionalCoveragePreferencesV2 = z.infer<
  typeof PropertyOptionalCoveragePreferencesV2
>;

export function createDefaultAutoEndorsementsV2(): AutoEndorsementPreferencesV2 {
  const fresh = Object.fromEntries(autoEndorsementKeys.map((k) => [k, "indifferent" as const]));
  return AutoEndorsementPreferencesV2.parse(fresh);
}

export function createDefaultPropertyOptionalCoveragesV2(): PropertyOptionalCoveragePreferencesV2 {
  const fresh = Object.fromEntries(
    propertyOptionalCoverageKeys.map((k) => [k, "indifferent" as const]),
  );
  return PropertyOptionalCoveragePreferencesV2.parse(fresh);
}

// =============================================================================
// Water coverage (shared between sewer backup and overland water)
// =============================================================================

export const WaterCoverageRequirementV2 = z
  .object({
    preference: CoveragePreference,
    limit: MonetaryRule,
    deductible: MonetaryRule,
  })
  .strict();
export type WaterCoverageRequirementV2 = z.infer<typeof WaterCoverageRequirementV2>;

// =============================================================================
// Auto mandate
// =============================================================================

export const AutoCoverageFormRequirementV2 = z.object({
  preference: CoveragePreference,
  value: AutoCoverageForm,
});
export type AutoCoverageFormRequirementV2 = z.infer<typeof AutoCoverageFormRequirementV2>;

export const AutoMandateV2 = z
  .object({
    coverageForm: AutoCoverageFormRequirementV2,
    liability: MonetaryRule,
    collisionDeductible: MonetaryRule,
    comprehensiveDeductible: MonetaryRule,
    glassDeductible: MonetaryRule,
    endorsements: AutoEndorsementPreferencesV2,
  })
  .strict();
export type AutoMandateV2 = z.infer<typeof AutoMandateV2>;

export function createDefaultAutoMandateV2(): AutoMandateV2 {
  return AutoMandateV2.parse({
    coverageForm: { preference: "required" as const, value: "comprehensive" as const },
    liability: { rule: "minimum" as const, amountCents: 200_000_000 },
    collisionDeductible: { rule: "maximum" as const, amountCents: 100_000 },
    comprehensiveDeductible: { rule: "maximum" as const, amountCents: 100_000 },
    glassDeductible: { rule: "any" as const },
    endorsements: createDefaultAutoEndorsementsV2(),
  });
}

// =============================================================================
// Property mandate
// =============================================================================

export const PropertyCoverageFormRequirementV2 = z.object({
  preference: CoveragePreference,
  value: PropertyCoverageForm,
});
export type PropertyCoverageFormRequirementV2 = z.infer<typeof PropertyCoverageFormRequirementV2>;

export const PropertySettlementRequirementV2 = z.object({
  preference: CoveragePreference,
  value: PropertySettlement,
});
export type PropertySettlementRequirementV2 = z.infer<typeof PropertySettlementRequirementV2>;

export const PropertyMandateV2 = z
  .object({
    coverageForm: PropertyCoverageFormRequirementV2,
    settlementBasis: PropertySettlementRequirementV2,
    dwellingLimit: MonetaryRule,
    contentsLimit: MonetaryRule,
    detachedStructuresLimit: MonetaryRule,
    personalLiabilityLimit: MonetaryRule,
    additionalLivingExpenseLimit: MonetaryRule,
    baseDeductible: MonetaryRule,
    waterDeductible: MonetaryRule,
    windHailDeductible: MonetaryRule,
    earthquakeDeductible: MonetaryRule,
    sewerBackup: WaterCoverageRequirementV2,
    overlandWater: WaterCoverageRequirementV2,
    optionalCoverages: PropertyOptionalCoveragePreferencesV2,
  })
  .strict();
export type PropertyMandateV2 = z.infer<typeof PropertyMandateV2>;

export function createDefaultPropertyMandateV2(): PropertyMandateV2 {
  const anyRule = { rule: "any" as const };
  return PropertyMandateV2.parse({
    coverageForm: { preference: "required" as const, value: "comprehensive" as const },
    settlementBasis: { preference: "required" as const, value: "replacement_cost" as const },
    dwellingLimit: { rule: "minimum" as const, amountCents: 45_000_000 },
    contentsLimit: anyRule,
    detachedStructuresLimit: anyRule,
    personalLiabilityLimit: anyRule,
    additionalLivingExpenseLimit: anyRule,
    baseDeductible: { rule: "maximum" as const, amountCents: 250_000 },
    waterDeductible: anyRule,
    windHailDeductible: anyRule,
    earthquakeDeductible: anyRule,
    sewerBackup: {
      preference: "indifferent" as const,
      limit: anyRule,
      deductible: anyRule,
    },
    overlandWater: {
      preference: "indifferent" as const,
      limit: anyRule,
      deductible: anyRule,
    },
    optionalCoverages: createDefaultPropertyOptionalCoveragesV2(),
  });
}

// =============================================================================
// Asset-specific overrides
// =============================================================================

export const AutoMandateOverrideValuesV2 = z
  .object({
    coverageForm: AutoCoverageFormRequirementV2.optional(),
    liability: MonetaryRule.optional(),
    collisionDeductible: MonetaryRule.optional(),
    comprehensiveDeductible: MonetaryRule.optional(),
    glassDeductible: MonetaryRule.optional(),
    endorsements: AutoEndorsementPreferencesV2.partial().optional(),
  })
  .strict();
export type AutoMandateOverrideValuesV2 = z.infer<typeof AutoMandateOverrideValuesV2>;

export const VehicleMandateOverrideV2 = z
  .object({
    vehicleId: z.string().uuid(),
    values: AutoMandateOverrideValuesV2,
  })
  .strict();
export type VehicleMandateOverrideV2 = z.infer<typeof VehicleMandateOverrideV2>;

export const PropertyMandateOverrideValuesV2 = z
  .object({
    coverageForm: PropertyCoverageFormRequirementV2.optional(),
    settlementBasis: PropertySettlementRequirementV2.optional(),
    dwellingLimit: MonetaryRule.optional(),
    contentsLimit: MonetaryRule.optional(),
    detachedStructuresLimit: MonetaryRule.optional(),
    personalLiabilityLimit: MonetaryRule.optional(),
    additionalLivingExpenseLimit: MonetaryRule.optional(),
    baseDeductible: MonetaryRule.optional(),
    waterDeductible: MonetaryRule.optional(),
    windHailDeductible: MonetaryRule.optional(),
    earthquakeDeductible: MonetaryRule.optional(),
    sewerBackup: WaterCoverageRequirementV2.partial().optional(),
    overlandWater: WaterCoverageRequirementV2.partial().optional(),
    optionalCoverages: PropertyOptionalCoveragePreferencesV2.partial().optional(),
  })
  .strict();
export type PropertyMandateOverrideValuesV2 = z.infer<typeof PropertyMandateOverrideValuesV2>;

export const PropertyMandateOverrideV2 = z
  .object({
    propertyId: z.string().uuid(),
    values: PropertyMandateOverrideValuesV2,
  })
  .strict();
export type PropertyMandateOverrideV2 = z.infer<typeof PropertyMandateOverrideV2>;

// =============================================================================
// Versioned household mandate
// =============================================================================

export const HouseholdCoverageMandateV2 = z
  .object({
    schemaVersion: z.literal(2),
    jurisdiction: z.literal("AB"),
    version: z.number().int().positive(),
    effectiveFrom: z.string().datetime(),
    householdAutoDefaults: AutoMandateV2,
    householdPropertyDefaults: PropertyMandateV2,
    vehicleOverrides: z.array(VehicleMandateOverrideV2).default([]),
    propertyOverrides: z.array(PropertyMandateOverrideV2).default([]),
  })
  .strict();
export type HouseholdCoverageMandateV2 = z.infer<typeof HouseholdCoverageMandateV2>;

export function createDefaultHouseholdCoverageMandateV2(): HouseholdCoverageMandateV2 {
  return HouseholdCoverageMandateV2.parse({
    schemaVersion: 2 as const,
    jurisdiction: "AB" as const,
    version: 1,
    effectiveFrom: new Date().toISOString(),
    householdAutoDefaults: createDefaultAutoMandateV2(),
    householdPropertyDefaults: createDefaultPropertyMandateV2(),
    vehicleOverrides: [],
    propertyOverrides: [],
  });
}

// =============================================================================
// Switching preferences (domain model used by the V2 persistence layer)
// =============================================================================

export const SwitchingPreferencesV2 = z.object({
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
export type SwitchingPreferencesV2 = z.infer<typeof SwitchingPreferencesV2>;

export function createDefaultSwitchingPreferencesV2(): SwitchingPreferencesV2 {
  return SwitchingPreferencesV2.parse({});
}

// =============================================================================
// Pure override resolvers
// =============================================================================

export function resolveVehicleMandateV2(
  defaults: AutoMandateV2,
  override?: VehicleMandateOverrideV2,
): AutoMandateV2 {
  if (!override) return defaults;
  const v = override.values;
  return AutoMandateV2.parse({
    coverageForm: v.coverageForm
      ? { ...defaults.coverageForm, ...v.coverageForm }
      : defaults.coverageForm,
    liability: v.liability ?? defaults.liability,
    collisionDeductible: v.collisionDeductible ?? defaults.collisionDeductible,
    comprehensiveDeductible: v.comprehensiveDeductible ?? defaults.comprehensiveDeductible,
    glassDeductible: v.glassDeductible ?? defaults.glassDeductible,
    endorsements: v.endorsements
      ? { ...defaults.endorsements, ...v.endorsements }
      : defaults.endorsements,
  });
}

export function resolvePropertyMandateV2(
  defaults: PropertyMandateV2,
  override?: PropertyMandateOverrideV2,
): PropertyMandateV2 {
  if (!override) return defaults;
  const v = override.values;
  return PropertyMandateV2.parse({
    coverageForm: v.coverageForm
      ? { ...defaults.coverageForm, ...v.coverageForm }
      : defaults.coverageForm,
    settlementBasis: v.settlementBasis
      ? { ...defaults.settlementBasis, ...v.settlementBasis }
      : defaults.settlementBasis,
    dwellingLimit: v.dwellingLimit ?? defaults.dwellingLimit,
    contentsLimit: v.contentsLimit ?? defaults.contentsLimit,
    detachedStructuresLimit: v.detachedStructuresLimit ?? defaults.detachedStructuresLimit,
    personalLiabilityLimit: v.personalLiabilityLimit ?? defaults.personalLiabilityLimit,
    additionalLivingExpenseLimit:
      v.additionalLivingExpenseLimit ?? defaults.additionalLivingExpenseLimit,
    baseDeductible: v.baseDeductible ?? defaults.baseDeductible,
    waterDeductible: v.waterDeductible ?? defaults.waterDeductible,
    windHailDeductible: v.windHailDeductible ?? defaults.windHailDeductible,
    earthquakeDeductible: v.earthquakeDeductible ?? defaults.earthquakeDeductible,
    sewerBackup: v.sewerBackup
      ? { ...defaults.sewerBackup, ...v.sewerBackup }
      : defaults.sewerBackup,
    overlandWater: v.overlandWater
      ? { ...defaults.overlandWater, ...v.overlandWater }
      : defaults.overlandWater,
    optionalCoverages: v.optionalCoverages
      ? { ...defaults.optionalCoverages, ...v.optionalCoverages }
      : defaults.optionalCoverages,
  });
}

// =============================================================================
// Helpers for editing override lists
// =============================================================================

export function updateVehicleOverrideV2(
  mandate: HouseholdCoverageMandateV2,
  vehicleId: string,
  patch: AutoMandateOverrideValuesV2,
): HouseholdCoverageMandateV2 {
  const others = mandate.vehicleOverrides.filter((o) => o.vehicleId !== vehicleId);
  const existing = mandate.vehicleOverrides.find((o) => o.vehicleId === vehicleId);
  const nextValues = existing ? { ...existing.values, ...patch } : patch;
  return {
    ...mandate,
    vehicleOverrides: [
      ...others,
      { vehicleId, values: AutoMandateOverrideValuesV2.parse(nextValues) },
    ],
  };
}

export function clearVehicleOverrideV2(
  mandate: HouseholdCoverageMandateV2,
  vehicleId: string,
): HouseholdCoverageMandateV2 {
  return {
    ...mandate,
    vehicleOverrides: mandate.vehicleOverrides.filter((o) => o.vehicleId !== vehicleId),
  };
}

export function updatePropertyOverrideV2(
  mandate: HouseholdCoverageMandateV2,
  propertyId: string,
  patch: PropertyMandateOverrideValuesV2,
): HouseholdCoverageMandateV2 {
  const others = mandate.propertyOverrides.filter((o) => o.propertyId !== propertyId);
  const existing = mandate.propertyOverrides.find((o) => o.propertyId === propertyId);
  const nextValues = existing ? { ...existing.values, ...patch } : patch;
  return {
    ...mandate,
    propertyOverrides: [
      ...others,
      { propertyId, values: PropertyMandateOverrideValuesV2.parse(nextValues) },
    ],
  };
}

export function clearPropertyOverrideV2(
  mandate: HouseholdCoverageMandateV2,
  propertyId: string,
): HouseholdCoverageMandateV2 {
  return {
    ...mandate,
    propertyOverrides: mandate.propertyOverrides.filter((o) => o.propertyId !== propertyId),
  };
}
