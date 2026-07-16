import { z } from "zod";
import type { EngineQuote } from "./quotes";
import type { HouseholdCoverageMandateV2, SwitchingPreferencesV2 } from "./mandate-v2";

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
  quoteSnapshot?: { id: string; updated_at: string }[];
}

export interface CanonicalRecommendationInputSnapshot extends RecommendationInputSnapshot {
  caseId: string;
  householdId: string;
  generatedAt: string;
  quoteSnapshot: { id: string; updated_at: string }[];
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
    inputSnapshotJson: z.record(z.unknown()),
    inputSnapshotDigest: HexDigest,
    inputSnapshotCanonical: z.string().min(1),
    recommendedOption: PersistedRecommendationOptionSchema,
    rankedOptions: z.array(PersistedRecommendationOptionSchema).min(1),
    rejectedOptions: z.array(PersistedRecommendationOptionSchema).default([]),
    engineOutputJson: z.record(z.unknown()),
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
