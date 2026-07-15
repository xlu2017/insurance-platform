import { z } from "zod";
import { NonNegativeCents, Cents } from "./money";
import { ProductLine, QuoteState } from "./enums";

export const AutoCoverageDetails = z.object({
  thirdPartyLiabilityCents: NonNegativeCents,
  collisionIncluded: z.boolean(),
  collisionDeductibleCents: NonNegativeCents.nullable(),
  comprehensiveIncluded: z.boolean(),
  comprehensiveDeductibleCents: NonNegativeCents.nullable(),
  accidentForgivenessIncluded: z.boolean(),
  rentalVehicleCoverageIncluded: z.boolean(),
  telematicsRequired: z.boolean(),
});
export type AutoCoverageDetails = z.infer<typeof AutoCoverageDetails>;

export const PropertyCoverageDetails = z.object({
  dwellingLimitCents: NonNegativeCents,
  replacementCostIncluded: z.boolean(),
  sewerBackupIncluded: z.boolean(),
  overlandWaterIncluded: z.boolean(),
  baseDeductibleCents: NonNegativeCents,
  waterDeductibleCents: NonNegativeCents.nullable(),
  additionalLivingExpensesIncluded: z.boolean(),
  equipmentBreakdownIncluded: z.boolean(),
});
export type PropertyCoverageDetails = z.infer<typeof PropertyCoverageDetails>;

export const QuoteComponent = z.object({
  productLine: ProductLine,
  annualPremiumCents: NonNegativeCents,
  auto: AutoCoverageDetails.nullable(),
  property: PropertyCoverageDetails.nullable(),
});
export type QuoteComponent = z.infer<typeof QuoteComponent>;

export const EngineQuote = z.object({
  id: z.string(),
  insurerId: z.string(),
  insurerName: z.string(),
  state: QuoteState,
  isIncumbent: z.boolean(),
  policyFeesCents: NonNegativeCents,
  paymentFeesCents: NonNegativeCents,
  /** Discount applied when this quote's insurer holds both product lines. Negative reduction expressed as positive cents. */
  bundleDiscountCents: NonNegativeCents,
  /** Charge incurred by leaving the incumbent mid-term for this line, if known. */
  cancellationChargeCents: NonNegativeCents,
  underwritingConditions: z.array(z.string()),
  components: z.array(QuoteComponent).min(1),
  expiresAt: z.string().datetime().nullable(),
});
export type EngineQuote = z.infer<typeof EngineQuote>;

export const CentsDelta = Cents;
