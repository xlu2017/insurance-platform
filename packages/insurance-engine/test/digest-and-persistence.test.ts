import { describe, expect, it } from "vitest";
import type { RecommendationInputSnapshot } from "@autopilot/schemas";
import { EngineRecommendationPersistencePayloadSchema } from "@autopilot/schemas";
import { bundleLossScenario, demoMandate } from "@autopilot/test-fixtures";
import {
  canonicalizeForDigest,
  canonicalSerializeRecommendationInput,
  canonicalSerializeRecommendationOutput,
} from "../src/canonical";
import { evaluateHousehold } from "../src";

const REC_QUOTE_A = "10000000-0000-0000-0000-0000000000a1";
const REC_QUOTE_B = "10000000-0000-0000-0000-0000000000a2";
const REC_AUTO_COMP = "20000000-0000-0000-0000-0000000000a1";
const REC_PROP_COMP = "20000000-0000-0000-0000-0000000000a2";
const ACTOR_ID = "30000000-0000-0000-0000-000000000001";

const baseSnapshot: RecommendationInputSnapshot = {
  caseId: "11111111-1111-1111-1111-111111111111",
  householdId: "22222222-2222-2222-2222-222222222222",
  mandateId: "33333333-3333-3333-3333-333333333333",
  mandateVersion: 1,
  mandateSchemaVersion: 2,
  jurisdiction: "AB",
  switchingPreferencesId: "44444444-4444-4444-4444-444444444444",
  switchingPreferencesVersion: 1,
  mandate: { jurisdiction: "AB", vehicleDefaults: {}, propertyDefaults: {} },
  switching: {},
  assets: { vehicles: [], properties: [] },
  quotes: [],
  quoteSnapshot: [],
};

describe("canonicalization", () => {
  it("excludes generatedAt from the canonical form", () => {
    const input = { ...baseSnapshot, generatedAt: "2026-01-01T00:00:00Z" };
    const canonical = canonicalizeForDigest(input);
    expect(canonical).not.toHaveProperty("generatedAt");
  });

  it("sorts object keys deterministically", () => {
    const canonical = canonicalizeForDigest({ b: 2, a: 1, c: 3 });
    expect(JSON.stringify(canonical)).toBe('{"a":1,"b":2,"c":3}');
  });

  it("produces stable digests for identical snapshots", () => {
    const { canonicalJson: a } = canonicalSerializeRecommendationInput(
      baseSnapshot,
      "1.0.0",
      "hash",
    );
    const { canonicalJson: b } = canonicalSerializeRecommendationInput(
      baseSnapshot,
      "1.0.0",
      "hash",
    );
    expect(a).toBe(b);
  });
});

describe("persistence payload schema", () => {
  it("rejects unknown top-level fields", () => {
    const payload = {
      caseId: "11111111-1111-1111-1111-111111111111",
      actorProfileId: "22222222-2222-2222-2222-222222222222",
      mandate: { id: "33333333-3333-3333-3333-333333333333", version: 1, schemaVersion: 2, jurisdiction: "AB" },
      switchingPreferences: { id: "44444444-4444-4444-4444-444444444444", version: 1 },
      engine: { version: "1.0.0", sourceHash: "a".repeat(64) },
      inputSnapshotJson: {},
      inputSnapshotDigest: "a".repeat(64),
      inputSnapshotCanonical: "",
      recommendedOption: null,
      rankedOptions: [],
      rejectedOptions: [],
      engineOutputJson: {},
      engineOutputDigest: "a".repeat(64),
      engineOutputCanonical: "",
      currentTotalCents: 0,
      proposedTotalCents: 0,
      netSavingsCents: 0,
      reasonCodes: [],
      comparison: {},
      extraField: true,
    };
    const parsed = EngineRecommendationPersistencePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("rejects an option missing component/asset identities", () => {
    const payload = {
      caseId: "11111111-1111-1111-1111-111111111111",
      actorProfileId: "22222222-2222-2222-2222-222222222222",
      mandate: { id: "33333333-3333-3333-3333-333333333333", version: 1, schemaVersion: 2, jurisdiction: "AB" },
      switchingPreferences: { id: "44444444-4444-4444-4444-444444444444", version: 1 },
      engine: { version: "1.0.0", sourceHash: "a".repeat(64) },
      inputSnapshotJson: {},
      inputSnapshotDigest: "a".repeat(64),
      inputSnapshotCanonical: "",
      recommendedOption: {
        rank: 1,
        auto_quote_id: "55555555-5555-5555-5555-555555555555",
        property_quote_id: "66666666-6666-6666-6666-666666666666",
        bundled: false,
        total_cents: 100_000,
        net_savings_cents: 0,
        eligible: true,
        reason_codes: [],
        ranking_factors: {},
        preference_alignment: { satisfied_count: 0, missed_count: 0, not_evaluable_count: 0, details: [] },
        deductible_total_cents: 0,
        underwriting_condition_count: 0,
      },
      rankedOptions: [],
      rejectedOptions: [],
      engineOutputJson: {},
      engineOutputDigest: "a".repeat(64),
      engineOutputCanonical: "",
      currentTotalCents: 100_000,
      proposedTotalCents: 100_000,
      netSavingsCents: 0,
      reasonCodes: [],
      comparison: {},
    };
    const parsed = EngineRecommendationPersistencePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("accepts a complete payload", () => {
    const s = bundleLossScenario();
    const input = {
      mandate: demoMandate,
      quotes: [s.altAAuto, s.incumbentPropertyUnbundled, s.altBBundle],
      incumbentAuto: s.incumbentAuto,
      incumbentProperty: s.incumbentProperty,
    };
    const result = evaluateHousehold(input);
    const recommended = result.eligible[0];
    const option = {
      rank: 1,
      auto_quote_id: REC_QUOTE_A,
      property_quote_id: REC_QUOTE_B,
      auto_component_id: REC_AUTO_COMP,
      property_component_id: REC_PROP_COMP,
      auto_asset_id: recommended.configuration.auto.component.assetId ?? REC_AUTO_COMP,
      property_asset_id: recommended.configuration.property.component.assetId ?? REC_PROP_COMP,
      bundled: recommended.configuration.bundled,
      total_cents: recommended.cost.totalCents,
      net_savings_cents: recommended.netSavingsCents,
      eligible: recommended.eligible,
      reason_codes: recommended.reasonCodes,
      ranking_factors: {
        total_cents: recommended.cost.totalCents,
        coverage_reductions_count: recommended.coverageReductions.length,
        deductible_total_cents: recommended.deductibleTotalCents,
        underwriting_condition_count: recommended.underwritingConditionCount,
        preference_missed_count: recommended.preferenceAlignment.missed_count,
        preference_unknown_count: recommended.preferenceAlignment.not_evaluable_count,
      },
      preference_alignment: recommended.preferenceAlignment,
      deductible_total_cents: recommended.deductibleTotalCents,
      underwriting_condition_count: recommended.underwritingConditionCount,
    };
    const { canonical: inputJson, canonicalJson: inputCanonical } = canonicalSerializeRecommendationInput(
      baseSnapshot,
      "1.0.0",
      "0".repeat(64),
    );
    const { canonical: outputJson, canonicalJson: outputCanonical } = canonicalSerializeRecommendationOutput(
      result,
      option,
      [option],
      [],
    );
    const payload = {
      caseId: baseSnapshot.caseId,
      actorProfileId: "22222222-2222-2222-2222-222222222222",
      mandate: { id: baseSnapshot.mandateId, version: 1, schemaVersion: 2, jurisdiction: "AB" },
      switchingPreferences: { id: baseSnapshot.switchingPreferencesId, version: 1 },
      engine: { version: "1.0.0", sourceHash: "0".repeat(64) },
      inputSnapshotJson: inputJson as Record<string, unknown>,
      inputSnapshotDigest: "0".repeat(64),
      inputSnapshotCanonical: inputCanonical,
      recommendedOption: option,
      rankedOptions: [option],
      rejectedOptions: [],
      engineOutputJson: outputJson as Record<string, unknown>,
      engineOutputDigest: "0".repeat(64),
      engineOutputCanonical: outputCanonical,
      currentTotalCents: result.incumbentTotalCents,
      proposedTotalCents: option.total_cents,
      netSavingsCents: option.net_savings_cents,
      reasonCodes: option.reason_codes,
      comparison: {},
    };
    const parsed = EngineRecommendationPersistencePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});
