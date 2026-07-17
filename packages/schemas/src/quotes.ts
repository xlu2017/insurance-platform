import { z } from "zod";
import { NonNegativeCents, Cents } from "./money";
import {
  ProductLine,
  QuoteState,
  QuoteDataSource,
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
  additionalLivingExpenseLimitCents: NonNegativeCents.nullable(),
  additionalLivingExpensesIncluded: z.boolean(),
  replacementCostIncluded: z.boolean(),
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

export const ComponentProvenance = z
  .object({
    dataSource: QuoteDataSource.optional(),
    validatedAt: z.string().datetime({ offset: true }).optional(),
    validatedBy: z.string().uuid().optional(),
    coverageSchemaVersion: z.number().int().nonnegative().optional(),
  })
  .optional();

export const QuoteComponent = z.object({
  id: z.string().uuid().optional(),
  productLine: ProductLine,
  assetId: z.string().uuid().nullable().optional(),
  assetLabel: z.string().optional(),
  annualPremiumCents: NonNegativeCents,
  auto: AutoCoverageDetails.nullable(),
  property: PropertyCoverageDetails.nullable(),
  validationStatus: QuoteValidationStatus,
  validationErrors: z.array(
    z.object({
      path: z.array(z.string()),
      code: z.string(),
      message: z.string(),
    }),
  ),
  provenance: ComponentProvenance,
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
  insurerVersion: z.number().int().nonnegative().optional(),
});
export type EngineQuote = z.infer<typeof EngineQuote>;

export const CentsDelta = Cents;

export const QuoteValidationIssue = z.object({
  path: z.array(z.string()),
  code: z.string(),
  expected: z.string().optional(),
  received: z.unknown(),
  message: z.string(),
});
export type QuoteValidationIssue = z.infer<typeof QuoteValidationIssue>;

export const AutoCoverageDetailsDraft = AutoCoverageDetails.partial();
export type AutoCoverageDetailsDraft = z.infer<typeof AutoCoverageDetailsDraft>;

export const PropertyCoverageDetailsDraft = PropertyCoverageDetails.partial();
export type PropertyCoverageDetailsDraft = z.infer<typeof PropertyCoverageDetailsDraft>;

export const QuoteComponentDraft = z.discriminatedUnion("productLine", [
  z.object({
    componentId: z.string().uuid().optional(),
    productLine: z.literal("auto"),
    assetId: z.string().uuid(),
    annualPremiumCents: NonNegativeCents,
    coverage: z.record(z.unknown()),
  }),
  z.object({
    componentId: z.string().uuid().optional(),
    productLine: z.literal("property"),
    assetId: z.string().uuid(),
    annualPremiumCents: NonNegativeCents,
    coverage: z.record(z.unknown()),
  }),
]);
export type QuoteComponentDraft = z.infer<typeof QuoteComponentDraft>;

export const QuoteSaveIntent = z.enum(["draft", "validate"]);
export type QuoteSaveIntent = z.infer<typeof QuoteSaveIntent>;

export const SaveCaseQuoteRequest = z
  .object({
    caseId: z.string().uuid(),
    quoteId: z.string().uuid().optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
    saveIntent: QuoteSaveIntent,
    insurerId: z.string().uuid(),
    state: QuoteState,
    isIncumbent: z.boolean(),
    expiresAt: z.string().datetime().nullable().optional(),
    policyFeesCents: NonNegativeCents.default(0),
    paymentFeesCents: NonNegativeCents.default(0),
    bundleDiscountCents: NonNegativeCents.default(0),
    cancellationChargeCents: NonNegativeCents.default(0),
    underwritingConditions: z.array(z.string()).default([]),
    dataSource: QuoteDataSource,
    components: z.array(QuoteComponentDraft).min(1),
  })
  .strict()
  .superRefine((val, ctx) => {
    const componentIds = val.components
      .map((c) => c.componentId)
      .filter((id): id is string => id !== undefined);
    if (new Set(componentIds).size !== componentIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["components"],
        message: "Duplicate componentId values are not allowed",
      });
    }
    const pairs = val.components.map((c) => `${c.productLine}:${c.assetId}`);
    if (new Set(pairs).size !== pairs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["components"],
        message: "Duplicate productLine and assetId pairs are not allowed",
      });
    }
  });
export type SaveCaseQuoteRequest = z.infer<typeof SaveCaseQuoteRequest>;
