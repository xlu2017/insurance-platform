// Generates a licensed-review recommendation for a case in `comparing_quotes`.
// Loads the current V2 mandate, switching preferences, assets and quotes, runs
// the same deterministic insurance engine used by workspace tests, builds a
// canonical input/output digest, and persists the result through an internal
// service-role-only RPC.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildEngineInputFromSnapshot,
  evaluateHousehold,
  loadRecommendationInputSnapshot,
  EngineRecommendationPersistencePayloadSchema,
  __AUTOPILOT_SOURCE_HASH__,
  type EngineRecommendationPersistencePayload,
  type EngineResult,
  type EvaluatedConfiguration,
} from "../_shared/autopilot.js";

const ENGINE_VERSION = "1.0.0";

function jsonResponse(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

function canonicalizeForDigest(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const sorted = value.map(canonicalizeForDigest).sort((a: unknown, b: unknown) => {
      const ka = JSON.stringify(a);
      const kb = JSON.stringify(b);
      return ka.localeCompare(kb);
    });
    return sorted;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = canonicalizeForDigest((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildRankingFactors(e: EvaluatedConfiguration) {
  return {
    total_cents: e.cost.totalCents,
    coverage_reductions_count: e.coverageReductions.length,
    deductible_total_cents: e.deductibleTotalCents,
    underwriting_condition_count: e.underwritingConditionCount,
    preference_missed_count: e.preferenceAlignment.missed_count,
    preference_unknown_count: e.preferenceAlignment.not_evaluable_count,
  };
}

function buildPreferenceAlignment(e: EvaluatedConfiguration) {
  return e.preferenceAlignment;
}

function buildPersistedOption(rank: number, e: EvaluatedConfiguration) {
  return {
    rank,
    auto_quote_id: e.configuration.auto.quoteId,
    property_quote_id: e.configuration.property.quoteId,
    bundled: e.configuration.bundled,
    total_cents: e.cost.totalCents,
    net_savings_cents: e.netSavingsCents,
    eligible: e.eligible,
    reason_codes: e.reasonCodes,
    ranking_factors: buildRankingFactors(e),
    preference_alignment: buildPreferenceAlignment(e),
    deductible_total_cents: e.deductibleTotalCents,
    underwriting_condition_count: e.underwritingConditionCount,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "Only POST is allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonResponse({ code: "UNAUTHORIZED", message: "Missing or invalid authorization" }, 401);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["operations", "admin"].includes(profile.role)) {
    return jsonResponse(
      { code: "FORBIDDEN", message: "Only operations or admin staff may generate recommendations" },
      403,
    );
  }

  let body: { caseId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: "INVALID_JSON", message: "Request body is not valid JSON" }, 400);
  }

  const caseId = body?.caseId;
  if (!caseId) {
    return jsonResponse({ code: "MISSING_CASE_ID", message: "caseId is required" }, 400);
  }

  const { data: caseRow, error: caseErr } = await supabase
    .from("optimization_cases")
    .select("id, household_id, state")
    .eq("id", caseId)
    .single();
  if (caseErr || !caseRow) {
    return jsonResponse(
      { code: "CASE_NOT_FOUND", message: caseErr?.message ?? "Case not found" },
      404,
    );
  }
  if (caseRow.state !== "comparing_quotes" && caseRow.state !== "customer_decision") {
    return jsonResponse(
      {
        code: "INVALID_CASE_STATE",
        message: `Case must be in comparing_quotes or customer_decision, got ${caseRow.state}`,
      },
      409,
    );
  }

  const snapshot = await loadRecommendationInputSnapshot(supabase, caseId);
  if ("code" in snapshot) {
    return jsonResponse(
      { code: snapshot.code, message: snapshot.message, details: snapshot.details },
      snapshot.code === "MANDATE_NOT_FOUND" || snapshot.code === "QUOTE_NOT_USABLE" ? 400 : 422,
    );
  }

  const engineInput = buildEngineInputFromSnapshot(snapshot);
  if ("code" in engineInput) {
    return jsonResponse(
      { code: engineInput.code, message: engineInput.message, details: engineInput.details },
      400,
    );
  }

  const result: EngineResult = evaluateHousehold(engineInput);

  if (result.rejection) {
    return jsonResponse({ code: result.rejection.code, message: result.rejection.message }, 422);
  }

  if (!result.recommended) {
    return jsonResponse({
      code: "NO_ELIGIBLE_RECOMMENDATION",
      message: "No economically eligible recommendation was found",
      eligible: 0,
      recommendationId: null,
    });
  }

  const rankedOptions = result.eligible.map((e, i) => buildPersistedOption(i + 1, e));
  const rejectedOptions = result.evaluated
    .filter((e) => !e.eligible && !e.configuration.isIncumbentConfiguration)
    .map((e, i) => buildPersistedOption(rankedOptions.length + i + 1, e));
  const recommendedOption = rankedOptions[0];

  const canonicalInput: Record<string, unknown> = canonicalizeForDigest({
    caseId: snapshot.caseId,
    householdId: snapshot.householdId,
    mandateId: snapshot.mandateId,
    mandateVersion: snapshot.mandateVersion,
    mandateSchemaVersion: snapshot.mandateSchemaVersion,
    jurisdiction: snapshot.jurisdiction,
    switchingPreferencesId: snapshot.switchingPreferencesId,
    switchingPreferencesVersion: snapshot.switchingPreferencesVersion,
    mandate: snapshot.mandate,
    switching: snapshot.switching,
    assets: snapshot.assets,
    quotes: snapshot.quotes,
    quoteSnapshot: snapshot.quoteSnapshot,
    engineVersion: ENGINE_VERSION,
    engineSourceHash: __AUTOPILOT_SOURCE_HASH__,
    generatedAt: new Date().toISOString(),
  }) as Record<string, unknown>;
  const inputSnapshotJson = canonicalInput;
  const inputSnapshotDigest = await sha256Hex(JSON.stringify(canonicalInput));

  const engineOutputJson = canonicalizeForDigest({
    incumbentTotalCents: result.incumbentTotalCents,
    recommendedOption,
    rankedOptions,
    rejectedOptions,
  }) as Record<string, unknown>;
  const engineOutputDigest = await sha256Hex(JSON.stringify(engineOutputJson));

  const payload: EngineRecommendationPersistencePayload = {
    caseId,
    actorProfileId: user.id,
    mandate: {
      id: snapshot.mandateId,
      version: snapshot.mandateVersion,
      schemaVersion: 2,
      jurisdiction: "AB",
    },
    switchingPreferences: {
      id: snapshot.switchingPreferencesId,
      version: snapshot.switchingPreferencesVersion,
    },
    engine: {
      version: ENGINE_VERSION,
      sourceHash: __AUTOPILOT_SOURCE_HASH__,
    },
    inputSnapshotJson,
    inputSnapshotDigest,
    recommendedOption,
    rankedOptions,
    rejectedOptions,
    engineOutputJson,
    engineOutputDigest,
    currentTotalCents: result.incumbentTotalCents,
    proposedTotalCents: recommendedOption.total_cents,
    netSavingsCents: recommendedOption.net_savings_cents,
    reasonCodes: recommendedOption.reason_codes,
    comparison: {
      proposedInsurer: result.recommended.configuration.auto.insurerName,
      bundled: result.recommended.configuration.bundled,
      materialDifferences: result.recommended.coverageReductions,
      deductibleDifferences: [],
    },
    disclosureVersion: "v1",
  };

  const parsed = EngineRecommendationPersistencePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(
      { code: "PERSISTENCE_PAYLOAD_INVALID", message: parsed.error.message },
      500,
    );
  }

  const serviceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SERVICE_ROLE_KEY") ??
    Deno.env.get("EDGE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    return jsonResponse(
      { code: "SERVICE_ROLE_KEY_MISSING", message: "Server cannot persist recommendations" },
      500,
    );
  }
  const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

  const { data: persistData, error: persistError } = await serviceClient.rpc(
    "persist_engine_recommendation_v2",
    {
      p_case_id: payload.caseId,
      p_actor_profile_id: payload.actorProfileId,
      p_mandate_id: payload.mandate.id,
      p_mandate_version: payload.mandate.version,
      p_mandate_schema_version: payload.mandate.schemaVersion,
      p_mandate_jurisdiction: payload.mandate.jurisdiction,
      p_switching_preferences_id: payload.switchingPreferences.id,
      p_switching_preferences_version: payload.switchingPreferences.version,
      p_input_snapshot_json: payload.inputSnapshotJson,
      p_input_snapshot_digest: payload.inputSnapshotDigest,
      p_engine_version: payload.engine.version,
      p_engine_source_hash: payload.engine.sourceHash,
      p_engine_output_json: payload.engineOutputJson,
      p_engine_output_digest: payload.engineOutputDigest,
      p_current_total_cents: payload.currentTotalCents,
      p_proposed_total_cents: payload.proposedTotalCents,
      p_net_savings_cents: payload.netSavingsCents,
      p_reason_codes: payload.reasonCodes,
      p_recommended_option_json: payload.recommendedOption,
      p_ranked_options_json: payload.rankedOptions,
      p_rejected_options_json: payload.rejectedOptions,
      p_comparison_json: payload.comparison,
      p_disclosure_version: payload.disclosureVersion,
    },
  );

  if (persistError) {
    return jsonResponse({ code: "PERSIST_FAILED", message: persistError.message }, 409);
  }

  const persisted = persistData as {
    recommendationId?: string;
    version?: number;
  } | null;
  return jsonResponse({
    recommendationId: persisted?.recommendationId,
    version: persisted?.version,
    recommended: {
      totalCents: result.recommended.cost.totalCents,
      netSavingsCents: result.recommended.netSavingsCents,
      autoInsurer: result.recommended.configuration.auto.insurerName,
      propertyInsurer: result.recommended.configuration.property.insurerName,
      bundled: result.recommended.configuration.bundled,
    },
    optionsCount: rankedOptions.length,
    inputSnapshotDigest,
    engineOutputDigest,
  });
});
