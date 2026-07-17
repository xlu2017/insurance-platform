import { z } from "zod";
import { NonNegativeCents } from "./money";
import {
  AutoCoverageDetails,
  PropertyCoverageDetails,
  ComponentFieldProvenance,
  PaymentFrequency,
  BillingMethod,
  BrokerDirectPreference,
  InsurerFinancialRating,
  QuoteState,
  QuoteDataSource,
  type EngineQuote,
} from "./quotes";
import { HouseholdCoverageMandateV2, SwitchingPreferencesV2 } from "./mandate-v2";

export interface HouseholdAssets {
  vehicles: Array<{ id: string }>;
  properties: Array<{ id: string }>;
}

export interface RecommendationInputSnapshot {
  caseId?: string;
  householdId?: string;
  mandateId: string;
  mandateVersion: number;
  mandateSchemaVersion: 2;
  jurisdiction: "AB";
  switchingPreferencesId: string;
  switchingPreferencesVersion: number;
  mandate: HouseholdCoverageMandateV2;
  switching: SwitchingPreferencesV2;
  assets: HouseholdAssets;
  quotes: EngineQuote[];
  quoteSnapshot?: { id: string; updated_at: string; version: number; is_incumbent: boolean }[];
}

export interface CanonicalRecommendationInputSnapshot extends RecommendationInputSnapshot {
  caseId: string;
  householdId: string;
  generatedAt: string;
  quoteSnapshot: { id: string; updated_at: string; version: number; is_incumbent: boolean }[];
}

export interface PreferenceAlignmentDetail {
  scope: string;
  item: string;
  outcome: "satisfied" | "missed" | "unknown" | "not_applicable";
}

export interface PreferenceAlignment {
  satisfied_count: number;
  missed_count: number;
  not_evaluable_count: number;
  details: PreferenceAlignmentDetail[];
}

export interface RankingFactors {
  total_cents: number;
  coverage_reductions_count: number;
  deductible_total_cents: number;
  underwriting_condition_count: number;
  preference_missed_count: number;
  preference_unknown_count: number;
}

export interface PersistedRecommendationOption {
  rank: number;
  auto_quote_id: string;
  property_quote_id: string;
  bundled: boolean;
  total_cents: number;
  net_savings_cents: number;
  eligible: boolean;
  reason_codes: string[];
  ranking_factors: RankingFactors;
  preference_alignment: PreferenceAlignment;
  deductible_total_cents: number;
  underwriting_condition_count: number;
}

export const QuoteSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    updated_at: z.string().datetime({ offset: true }),
    version: z.number().int().nonnegative(),
    is_incumbent: z.boolean(),
  })
  .strict();

const CanonicalAutoCoverageSnapshot = AutoCoverageDetails.strict();
const CanonicalPropertyCoverageSnapshot = PropertyCoverageDetails.strict();

export const CanonicalComponentSnapshotSchema = z
  .object({
    id: z.string().uuid().optional(),
    productLine: z.enum(["auto", "property"]),
    assetId: z.string().uuid(),
    annualPremiumCents: NonNegativeCents,
    auto: CanonicalAutoCoverageSnapshot.nullable(),
    property: CanonicalPropertyCoverageSnapshot.nullable(),
    rawCoverage: z.record(z.unknown()),
    fieldProvenance: ComponentFieldProvenance,
    validationStatus: z.literal("valid"),
    validationErrors: z
      .array(
        z.object({
          path: z.array(z.string()),
          code: z.string(),
          message: z.string(),
        }),
      )
      .default([]),
    provenance: z.object({
      dataSource: QuoteDataSource,
      validatedAt: z.string().datetime({ offset: true }).optional(),
      validatedBy: z.string().uuid().optional(),
      coverageSchemaVersion: z.number().int().nonnegative(),
    }),
  })
  .strict();

export const CanonicalInsurerMetadataSnapshotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    financialStrengthRating: InsurerFinancialRating,
    paymentFrequencies: z.array(PaymentFrequency),
    billingMethods: z.array(BillingMethod),
    distribution: BrokerDirectPreference.nullable(),
    version: z.number().int().nonnegative(),
  })
  .strict();

export const CanonicalReasonDetailSchema = z
  .object({
    scope: z.string(),
    quoteId: z.string().uuid().optional(),
    componentId: z.string().uuid().optional(),
    assetId: z.string().uuid().optional(),
    field: z.string(),
    expectedRule: z.string().optional(),
    actualValue: z.unknown().optional(),
    reasonCode: z.string(),
  })
  .strict();

const HexDigest = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Expected a 64-character lowercase hex SHA-256 digest");

const RankingFactorsSchema = z.object({
  total_cents: z.number().int().nonnegative(),
  coverage_reductions_count: z.number().int().nonnegative(),
  deductible_total_cents: z.number().int().nonnegative(),
  underwriting_condition_count: z.number().int().nonnegative(),
  preference_missed_count: z.number().int().nonnegative(),
  preference_unknown_count: z.number().int().nonnegative(),
});

const PreferenceAlignmentSchema = z.object({
  satisfied_count: z.number().int().nonnegative(),
  missed_count: z.number().int().nonnegative(),
  not_evaluable_count: z.number().int().nonnegative(),
  details: z.array(
    z.object({
      scope: z.string(),
      item: z.string(),
      outcome: z.enum(["satisfied", "missed", "unknown", "not_applicable"]),
    }),
  ),
});

export const PersistedRecommendationOptionSchema = z
  .object({
    rank: z.number().int().positive(),
    auto_quote_id: z.string().uuid(),
    property_quote_id: z.string().uuid(),
    auto_component_id: z.string().uuid(),
    property_component_id: z.string().uuid(),
    auto_asset_id: z.string().uuid(),
    property_asset_id: z.string().uuid(),
    bundled: z.boolean(),
    total_cents: z.number().int().nonnegative(),
    net_savings_cents: z.number().int(),
    eligible: z.boolean(),
    reason_codes: z.array(z.string()),
    ranking_factors: RankingFactorsSchema,
    preference_alignment: PreferenceAlignmentSchema,
    deductible_total_cents: z.number().int().nonnegative(),
    underwriting_condition_count: z.number().int().nonnegative(),
  })
  .strict();

const CanonicalQuoteSnapshot = z
  .object({
    id: z.string().uuid(),
    state: QuoteState,
    isIncumbent: z.boolean(),
    policyFeesCents: NonNegativeCents,
    paymentFeesCents: NonNegativeCents,
    bundleDiscountCents: NonNegativeCents,
    cancellationChargeCents: NonNegativeCents,
    underwritingConditions: z.array(z.string()),
    components: z.array(CanonicalComponentSnapshotSchema).min(1),
    expiresAt: z.string().datetime().nullable(),
    insurer: CanonicalInsurerMetadataSnapshotSchema,
  })
  .strict();

export const CanonicalRecommendationInputSnapshotSchema = z
  .object({
    caseId: z.string().uuid(),
    householdId: z.string().uuid(),
    mandateId: z.string().uuid(),
    mandateVersion: z.number().int().positive(),
    mandateSchemaVersion: z.literal(2),
    jurisdiction: z.literal("AB"),
    switchingPreferencesId: z.string().uuid(),
    switchingPreferencesVersion: z.number().int().positive(),
    assets: z
      .object({
        vehicles: z.array(z.object({ id: z.string().uuid() }).strict()),
        properties: z.array(z.object({ id: z.string().uuid() }).strict()),
      })
      .strict(),
    quotes: z.array(CanonicalQuoteSnapshot).min(1),
    quoteSnapshot: z.array(QuoteSnapshotSchema).min(1),
    mandate: HouseholdCoverageMandateV2,
    switching: SwitchingPreferencesV2,
    engineVersion: z.string(),
    engineSourceHash: HexDigest,
  })
  .strict();

export const CanonicalEngineOutputSchema = z
  .object({
    incumbentTotalCents: z.number().int().nonnegative(),
    recommendedOption: PersistedRecommendationOptionSchema,
    rankedOptions: z.array(PersistedRecommendationOptionSchema).min(1),
    rejectedOptions: z.array(PersistedRecommendationOptionSchema).default([]),
  })
  .strict();

export const EngineRecommendationPersistencePayloadSchema = z
  .object({
    caseId: z.string().uuid(),
    actorProfileId: z.string().uuid(),
    mandate: z
      .object({
        id: z.string().uuid(),
        version: z.number().int().positive(),
        schemaVersion: z.literal(2),
        jurisdiction: z.literal("AB"),
      })
      .strict(),
    switchingPreferences: z
      .object({
        id: z.string().uuid(),
        version: z.number().int().positive(),
      })
      .strict(),
    engine: z
      .object({
        version: z.string().min(1),
        sourceHash: HexDigest,
      })
      .strict(),
    inputSnapshotJson: CanonicalRecommendationInputSnapshotSchema,
    inputSnapshotDigest: HexDigest,
    inputSnapshotCanonical: z.string().min(1),
    recommendedOption: PersistedRecommendationOptionSchema,
    rankedOptions: z.array(PersistedRecommendationOptionSchema).min(1),
    rejectedOptions: z.array(PersistedRecommendationOptionSchema).default([]),
    engineOutputJson: CanonicalEngineOutputSchema,
    engineOutputDigest: HexDigest,
    engineOutputCanonical: z.string().min(1),
    currentTotalCents: z.number().int().nonnegative(),
    proposedTotalCents: z.number().int().nonnegative(),
    netSavingsCents: z.number().int(),
    reasonCodes: z.array(z.string()),
    comparison: z.record(z.unknown()),
    disclosureVersion: z.string().default("v1"),
  })
  .strict();

export type EngineRecommendationPersistencePayload = z.infer<
  typeof EngineRecommendationPersistencePayloadSchema
>;
