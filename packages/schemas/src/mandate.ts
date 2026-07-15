import { z } from "zod";
import { NonNegativeCents } from "./money";

export const AutoRequirements = z.object({
  minThirdPartyLiabilityCents: NonNegativeCents,
  collisionRequired: z.boolean(),
  comprehensiveRequired: z.boolean(),
  maxCollisionDeductibleCents: NonNegativeCents,
  maxComprehensiveDeductibleCents: NonNegativeCents,
  accidentForgivenessRequired: z.boolean(),
  rentalVehicleCoverageRequired: z.boolean(),
  telematicsAllowed: z.boolean(),
});
export type AutoRequirements = z.infer<typeof AutoRequirements>;

export const PropertyRequirements = z.object({
  minDwellingLimitCents: NonNegativeCents,
  replacementCostRequired: z.boolean(),
  sewerBackupRequired: z.boolean(),
  overlandWaterRequired: z.boolean(),
  maxBaseDeductibleCents: NonNegativeCents,
  maxWaterDeductibleCents: NonNegativeCents,
  additionalLivingExpensesRequired: z.boolean(),
  equipmentBreakdownRequired: z.boolean(),
});
export type PropertyRequirements = z.infer<typeof PropertyRequirements>;

export const SwitchingPreferences = z.object({
  minNetAnnualSavingsCents: NonNegativeCents,
  renewalOnlySwitching: z.boolean(),
  householdOptimizationEnabled: z.boolean(),
  splitInsurersAllowed: z.boolean(),
  excludedInsurerIds: z.array(z.string().uuid()),
  deductibleIncreasesAllowed: z.boolean(),
  materialCoverageReductionsAllowed: z.literal(false),
  customerApprovalRequired: z.literal(true),
});
export type SwitchingPreferences = z.infer<typeof SwitchingPreferences>;

export const HouseholdMandate = z.object({
  auto: AutoRequirements,
  property: PropertyRequirements,
  switching: SwitchingPreferences,
});
export type HouseholdMandate = z.infer<typeof HouseholdMandate>;
