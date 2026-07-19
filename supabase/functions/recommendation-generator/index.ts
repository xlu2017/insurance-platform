// Generates a licensed-review recommendation for a case in `comparing_quotes`.
// Loads the current V2 mandate, switching preferences, assets and quotes, runs
// the deterministic insurance engine, builds a canonical input/output digest,
// and persists the result through an internal service-role-only RPC.
//
// Generation-attempt lifecycle is managed outside the persistence transaction so
// failed and no-eligible attempts remain durable in the audit log.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  buildEngineInputFromSnapshot,
  canonicalSerializeRecommendationInput,
  canonicalSerializeRecommendationOutput,
  verifyCanonicalString,
  verifyCanonicalPair,
  evaluateHousehold,
  loadRecommendationInputSnapshot,
  EngineRecommendationPersistencePayloadSchema,
  CanonicalRecommendationInputSnapshotSchema,
  CanonicalEngineOutputSchema,
  __AUTOPILOT_SOURCE_HASH__,
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

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildRankingFactors(e: any) {
  return {
    total_cents: e.cost.totalCents,
    coverage_reductions_count: e.coverageReductions.length,
    deductible_total_cents: e.deductibleTotalCents,
    underwriting_condition_count: e.underwritingConditionCount,
    preference_missed_count: e.preferenceAlignment.missed_count,
    preference_unknown_count: e.preferenceAlignment.not_evaluable_count,
  };
}

function buildPreferenceAlignment(e: any) {
  return e.preferenceAlignment;
}

function buildPersistedOption(rank: number, e: any) {
  const auto = e.configuration.auto;
  const property = e.configuration.property;
  return {
    rank,
    auto_quote_id: auto.quoteId,
    property_quote_id: property.quoteId,
    auto_component_id: auto.component.id,
    property_component_id: property.component.id,
    auto_asset_id: auto.component.assetId,
    property_asset_id: property.component.assetId,
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

async function startAttempt(
  client: SupabaseClient,
  actorProfileId: string,
  caseId: string,
): Promise<string> {
  const { data, error } = await client.rpc("start_recommendation_generation_attempt", {
    p_case_id: caseId,
    p_actor_profile_id: actorProfileId,
  });
  if (error) throw new Error(`start_recommendation_generation_attempt failed: ${error.message}`);
  return (data as string | null) ?? "";
}

interface CompleteAttemptParams {
  status: "input_rejected" | "no_eligible_option" | "persistence_conflict" | "completed";
  mandateId?: string;
  mandateVersion?: number;
  switchingPreferencesId?: string;
  switchingPreferencesVersion?: number;
  inputSnapshotDigest?: string;
  engineOutputDigest?: string;
  recommendationId?: string;
  errorCode?: string;
  safeErrorMessage?: string;
}

async function completeAttempt(
  client: SupabaseClient,
  attemptId: string,
  params: CompleteAttemptParams,
) {
  const { error } = await client.rpc("complete_recommendation_generation_attempt", {
    p_attempt_id: attemptId,
    p_status: params.status,
    p_mandate_id: params.mandateId ?? null,
    p_mandate_version: params.mandateVersion ?? null,
    p_switching_preferences_id: params.switchingPreferencesId ?? null,
    p_switching_preferences_version: params.switchingPreferencesVersion ?? null,
    p_engine_version: ENGINE_VERSION,
    p_engine_source_hash: __AUTOPILOT_SOURCE_HASH__,
    p_input_snapshot_digest: params.inputSnapshotDigest ?? null,
    p_engine_output_digest: params.engineOutputDigest ?? null,
    p_recommendation_id: params.recommendationId ?? null,
    p_error_code: params.errorCode ?? null,
    p_safe_error_message: params.safeErrorMessage ?? null,
  });
  if (error) console.error("complete_recommendation_generation_attempt failed:", error.message);
}

async function failAttempt(
  client: SupabaseClient,
  attemptId: string,
  errorCode: string,
  safeErrorMessage: string,
) {
  const { error } = await client.rpc("fail_recommendation_generation_attempt", {
    p_attempt_id: attemptId,
    p_error_code: errorCode,
    p_safe_error_message: safeErrorMessage,
  });
  if (error) console.error("fail_recommendation_generation_attempt failed:", error.message);
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

  // Start a durable generation attempt before any validation or engine work.
  let attemptId: string;
  try {
    attemptId = await startAttempt(serviceClient, user.id, caseId);
  } catch (err) {
    return jsonResponse(
      { code: "ATTEMPT_START_FAILED", message: err instanceof Error ? err.message : String(err) },
      500,
    );
  }

  const snapshot = await loadRecommendationInputSnapshot(supabase, caseId);
  if ("code" in snapshot) {
    await completeAttempt(serviceClient, attemptId, {
      status: "input_rejected",
      errorCode: snapshot.code,
      safeErrorMessage: snapshot.message,
    });
    return jsonResponse(
      { code: snapshot.code, message: snapshot.message, details: snapshot.details },
      snapshot.code === "MANDATE_NOT_FOUND" || snapshot.code === "QUOTE_NOT_USABLE" ? 400 : 422,
    );
  }

  const engineInput = buildEngineInputFromSnapshot(snapshot);
  if ("code" in engineInput) {
    await completeAttempt(serviceClient, attemptId, {
      status: "input_rejected",
      mandateId: snapshot.mandateId,
      mandateVersion: snapshot.mandateVersion,
      switchingPreferencesId: snapshot.switchingPreferencesId,
      switchingPreferencesVersion: snapshot.switchingPreferencesVersion,
      errorCode: engineInput.code,
      safeErrorMessage: engineInput.message,
    });
    return jsonResponse(
      {
        code: engineInput.code,
        message: engineInput.message,
        details: (engineInput as any).details,
      },
      400,
    );
  }

  const result = evaluateHousehold(engineInput);

  if (result.rejection) {
    await completeAttempt(serviceClient, attemptId, {
      status: "input_rejected",
      mandateId: snapshot.mandateId,
      mandateVersion: snapshot.mandateVersion,
      switchingPreferencesId: snapshot.switchingPreferencesId,
      switchingPreferencesVersion: snapshot.switchingPreferencesVersion,
      errorCode: result.rejection.code,
      safeErrorMessage: result.rejection.message,
    });
    return jsonResponse({ code: result.rejection.code, message: result.rejection.message }, 422);
  }

  if (!result.recommended) {
    await completeAttempt(serviceClient, attemptId, {
      status: "no_eligible_option",
      mandateId: snapshot.mandateId,
      mandateVersion: snapshot.mandateVersion,
      switchingPreferencesId: snapshot.switchingPreferencesId,
      switchingPreferencesVersion: snapshot.switchingPreferencesVersion,
      errorCode: "NO_ELIGIBLE_RECOMMENDATION",
      safeErrorMessage: "No economically eligible recommendation was found",
    });
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

  const { canonical: inputSnapshotJson, canonicalJson: inputSnapshotCanonical } =
    canonicalSerializeRecommendationInput(snapshot, ENGINE_VERSION, __AUTOPILOT_SOURCE_HASH__);
  const inputSnapshotDigest = await sha256Hex(inputSnapshotCanonical);
  const inputVerify = verifyCanonicalPair(
    CanonicalRecommendationInputSnapshotSchema,
    inputSnapshotJson,
    inputSnapshotCanonical,
  );
  if (!inputVerify.valid) {
    await completeAttempt(serviceClient, attemptId, {
      status: "input_rejected",
      mandateId: snapshot.mandateId,
      mandateVersion: snapshot.mandateVersion,
      switchingPreferencesId: snapshot.switchingPreferencesId,
      switchingPreferencesVersion: snapshot.switchingPreferencesVersion,
      errorCode: "CANONICAL_INPUT_UNSTABLE",
      safeErrorMessage: inputVerify.error ?? "Canonical input snapshot is not reproducible.",
    });
    return jsonResponse(
      {
        code: "CANONICAL_INPUT_UNSTABLE",
        message: inputVerify.error ?? "Canonical input snapshot is not reproducible.",
      },
      422,
    );
  }

  const { canonical: engineOutputJson, canonicalJson: engineOutputCanonical } =
    canonicalSerializeRecommendationOutput(
      result,
      recommendedOption,
      rankedOptions,
      rejectedOptions,
    );
  const engineOutputDigest = await sha256Hex(engineOutputCanonical);
  const outputVerify = verifyCanonicalPair(
    CanonicalEngineOutputSchema,
    engineOutputJson,
    engineOutputCanonical,
  );
  if (!outputVerify.valid) {
    await failAttempt(
      serviceClient,
      attemptId,
      "CANONICAL_OUTPUT_UNSTABLE",
      outputVerify.error ?? "Canonical engine output is not reproducible.",
    );
    return jsonResponse(
      {
        code: "CANONICAL_OUTPUT_UNSTABLE",
        message: outputVerify.error ?? "Canonical engine output is not reproducible.",
      },
      500,
    );
  }

  const payload = {
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
    inputSnapshotJson: inputSnapshotJson as Record<string, unknown>,
    inputSnapshotDigest,
    inputSnapshotCanonical,
    recommendedOption,
    rankedOptions,
    rejectedOptions,
    engineOutputJson: engineOutputJson as Record<string, unknown>,
    engineOutputDigest,
    engineOutputCanonical,
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
    await completeAttempt(serviceClient, attemptId, {
      status: "input_rejected",
      mandateId: snapshot.mandateId,
      mandateVersion: snapshot.mandateVersion,
      switchingPreferencesId: snapshot.switchingPreferencesId,
      switchingPreferencesVersion: snapshot.switchingPreferencesVersion,
      inputSnapshotDigest,
      errorCode: "PERSISTENCE_PAYLOAD_INVALID",
      safeErrorMessage: parsed.error.message,
    });
    return jsonResponse(
      { code: "PERSISTENCE_PAYLOAD_INVALID", message: parsed.error.message },
      500,
    );
  }

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
      p_input_snapshot_canonical: payload.inputSnapshotCanonical,
      p_input_snapshot_digest: payload.inputSnapshotDigest,
      p_engine_version: payload.engine.version,
      p_engine_source_hash: payload.engine.sourceHash,
      p_engine_output_json: payload.engineOutputJson,
      p_engine_output_canonical: payload.engineOutputCanonical,
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
    await completeAttempt(serviceClient, attemptId, {
      status: "persistence_conflict",
      mandateId: snapshot.mandateId,
      mandateVersion: snapshot.mandateVersion,
      switchingPreferencesId: snapshot.switchingPreferencesId,
      switchingPreferencesVersion: snapshot.switchingPreferencesVersion,
      inputSnapshotDigest,
      engineOutputDigest,
      errorCode: "PERSIST_FAILED",
      safeErrorMessage: persistError.message,
    });
    return jsonResponse({ code: "PERSIST_FAILED", message: persistError.message }, 409);
  }

  const persisted = persistData as {
    recommendationId?: string;
    version?: number;
  } | null;

  await completeAttempt(serviceClient, attemptId, {
    status: "completed",
    mandateId: snapshot.mandateId,
    mandateVersion: snapshot.mandateVersion,
    switchingPreferencesId: snapshot.switchingPreferencesId,
    switchingPreferencesVersion: snapshot.switchingPreferencesVersion,
    inputSnapshotDigest,
    engineOutputDigest,
    recommendationId: persisted?.recommendationId,
  });

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
