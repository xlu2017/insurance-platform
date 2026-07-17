// Entry point used to generate the Deno-compatible bundle consumed by
// supabase/functions/recommendation-generator. This file intentionally
// re-exports only the runtime values the Edge Function needs so the generated
// artifact is deterministic and small.
export { buildEngineInputFromSnapshot } from "../src/input-from-snapshot.ts";
export { evaluateHousehold } from "../src/engine.ts";
export {
  canonicalizeForDigest,
  canonicalSerializeRecommendationInput,
  canonicalSerializeRecommendationOutput,
  verifyCanonicalString,
  verifyCanonicalPair,
} from "../src/canonical.ts";
export type { EngineInput, EngineResult } from "../src/types.ts";

// Re-export the shared workspace loader so the Edge Function evaluates the same
// V2 mandate/switching/quote snapshot as workspace tests and applications.
export { loadRecommendationInputSnapshot } from "../../database/src/recommendation-loader.ts";
export type { SnapshotLoadError } from "../../database/src/recommendation-loader.ts";

// Re-export quote coverage schemas for the validated quote-write boundary.
export {
  AutoCoverageDetails,
  PropertyCoverageDetails,
  QuoteComponent,
  QuoteComponentDraft,
  QuoteValidationIssue,
  QuoteSaveIntent,
  SaveCaseQuoteRequest,
} from "../../schemas/src/quotes.ts";
export { CoveragePresence, QuoteDataSource } from "../../schemas/src/enums.ts";

// Expose the canonical V2 schemas so the public mandate-save Edge Function can
// validate requests with the same definitions used by the workspace.
export {
  HouseholdCoverageMandateV2,
  SwitchingPreferencesV2,
} from "../../schemas/src/mandate-v2.ts";

// Re-export recommendation persistence schemas so the Edge Function can build
// and validate the trusted persistence payload before calling the internal RPC.
export {
  EngineRecommendationPersistencePayloadSchema,
  CanonicalRecommendationInputSnapshotSchema,
  CanonicalEngineOutputSchema,
  type EngineRecommendationPersistencePayload,
  type PreferenceAlignment,
  type RankingFactors,
  type PersistedRecommendationOption,
} from "../../schemas/src/recommendation.ts";
