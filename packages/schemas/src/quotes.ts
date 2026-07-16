import { z } from "zod";
import { NonNegativeCents, Cents } from "./money";
import {
  ProductLine,
  QuoteState,
  QuoteValidationStatus,
  AutoCoverageForm,
  PropertyCoverageForm,
  PropertySettlement,
  PropertyType,
  VehicleUseClass,
  FinancingStatus,
  PaymentFrequency,
  BillingMethod,
  BrokerDirectPreference,
  InsurerFinancialRating,
} from "./enums";

export const AutoCoverageDetails = z.object({
  thirdPartyLiabilityCents: NonNegativeCents,
  coverageForm: AutoCoverageForm,
  collisionIncluded: z.boolean(),
  collisionDeductibleCents: NonNegativeCents.nullable(),
  comprehensiveIncluded: z.boolean(),
  comprehensiveDeductibleCents: NonNegativeCents.nullable(),
  glassDeductibleCents: NonNegativeCents.nullable(),
  accidentForgivenessIncluded: z.boolean(),
  rentalVehicleCoverageIncluded: z.boolean(),
  nonOwnedAutomobileIncluded: z.boolean(),
  familyProtectionIncluded: z.boolean(),
  depreciationWaiverIncluded: z.boolean(),
  oemPartsIncluded: z.boolean(),
  roadsideAssistanceIncluded: z.boolean(),
  disappearingDeductibleIncluded: z.boolean(),
  glassCoverageIncluded: z.boolean(),
  telematicsRequired: z.boolean(),
  vehicleClass: VehicleUseClass,
  financingStatus: FinancingStatus,
});
export type AutoCoverageDetails = z.infer<typeof AutoCoverageDetails>;

export const PropertyCoverageDetails = z.object({
  propertyType: PropertyType,
  coverageForm: PropertyCoverageForm,
  settlementBasis: PropertySettlement,
  dwellingLimitCents: NonNegativeCents,
  contentsLimitCents: NonNegativeCents,
  detachedStructuresLimitCents: NonNegativeCents,
  personalLiabilityLimitCents: NonNegativeCents,
  additionalLivingExpenseLimitCents: NonNegativeCents,
  baseDeductibleCents: NonNegativeCents,
  waterDeductibleCents: NonNegativeCents.nullable(),
  windHailIncluded: z.boolean(),
  windHailDeductibleCents: NonNegativeCents.nullable(),
  earthquakeIncluded: z.boolean(),
  earthquakeDeductibleCents: NonNegativeCents.nullable(),
  sewerBackupIncluded: z.boolean(),
  sewerBackupLimitCents: NonNegativeCents.nullable(),
  sewerBackupDeductibleCents: NonNegativeCents.nullable(),
  overlandWaterIncluded: z.boolean(),
  overlandWaterLimitCents: NonNegativeCents.nullable(),
  overlandWaterDeductibleCents: NonNegativeCents.nullable(),
  groundwaterIncluded: z.boolean(),
  iceDamIncluded: z.boolean(),
  equipmentBreakdownIncluded: z.boolean(),
  serviceLineIncluded: z.boolean(),
  bylawCoverageIncluded: z.boolean(),
  homeSystemsIncluded: z.boolean(),
  cyberCoverageIncluded: z.boolean(),
  scheduledValuablesIncluded: z.boolean(),
  homeBusinessIncluded: z.boolean(),
  shortTermRentalPermissionIncluded: z.boolean(),
  claimsForgivenessIncluded: z.boolean(),
});
export type PropertyCoverageDetails = z.infer<typeof PropertyCoverageDetails>;

export const QuoteComponent = z.object({
  id: z.string().uuid().optional(),
  productLine: ProductLine,
  assetId: z.string().uuid().nullable().optional(),
  assetLabel: z.string().optional(),
  annualPremiumCents: NonNegativeCents,
  auto: AutoCoverageDetails.nullable(),
  property: PropertyCoverageDetails.nullable(),
  validationStatus: QuoteValidationStatus.default("valid"),
  validationErrors: z
    .array(
      z.object({
        path: z.array(z.string()),
        code: z.string(),
        message: z.string(),
      }),
    )
    .default([]),
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
  paymentFrequency: PaymentFrequency.optional(),
  billingMethod: BillingMethod.optional(),
  distributionChannel: BrokerDirectPreference.optional(),
  insurerFinancialRating: InsurerFinancialRating.optional(),
});
export type EngineQuote = z.infer<typeof EngineQuote>;

export const CentsDelta = Cents;
