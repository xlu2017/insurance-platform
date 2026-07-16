// Generates a licensed-review recommendation for a case in `comparing_quotes`.
// Loads the current V2 mandate, switching preferences, assets and quotes, runs
// the same deterministic insurance engine used by workspace tests, and persists
// the recommendation bound to the exact V2 snapshot.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildEngineInputFromSnapshot,
  evaluateHousehold,
  loadRecommendationInputSnapshot,
} from "./_shared/autopilot.js";

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
    // Operational snapshot-load errors include no rows, validation failures, etc.
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

  const result = evaluateHousehold(engineInput);

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

  const rec = result.recommended;
  const ranked = result.evaluated
    .slice()
    .sort((a, b) => a.cost.totalCents - b.cost.totalCents)
    .slice(0, 10);

  const optionsPayload = ranked.map((e, i) => ({
    rank: i + 1,
    auto_quote_id: e.configuration.auto.quoteId,
    property_quote_id: e.configuration.property.quoteId,
    bundled: e.configuration.bundled,
    total_cents: e.cost.totalCents,
    net_savings_cents: e.netSavingsCents,
    eligible: e.eligible,
    reason_codes: e.reasonCodes,
  }));

  const { data: persistData, error: persistError } = await supabase.rpc("persist_recommendation", {
    p_case_id: caseId,
    p_mandate_id: snapshot.mandateId,
    p_mandate_version: snapshot.mandateVersion,
    p_mandate_schema_version: snapshot.mandateSchemaVersion,
    p_mandate_jurisdiction: snapshot.jurisdiction,
    p_switching_preferences_id: snapshot.switchingPreferencesId,
    p_switching_preferences_version: snapshot.switchingPreferencesVersion,
    p_quote_snapshot: snapshot.quoteSnapshot ?? [],
    p_engine_version: ENGINE_VERSION,
    p_current_total_cents: result.incumbentTotalCents,
    p_proposed_total_cents: rec.cost.totalCents,
    p_net_savings_cents: rec.netSavingsCents,
    p_reason_codes: rec.reasonCodes,
    p_comparison: {
      proposedInsurer: rec.configuration.auto.insurerName,
      bundled: rec.configuration.bundled,
      materialDifferences: rec.coverageReductions,
      deductibleDifferences: [],
    },
    p_recommended: {
      auto_quote_id: rec.configuration.auto.quoteId,
      property_quote_id: rec.configuration.property.quoteId,
      bundled: rec.configuration.bundled,
      insurer_name: rec.configuration.auto.insurerName,
    },
    p_options: optionsPayload,
    p_disclosure_version: "v1",
  });

  if (persistError) {
    return jsonResponse({ code: "PERSIST_FAILED", message: persistError.message }, 409);
  }

  const persisted = persistData as {
    recommendationId?: string;
    version?: number;
    status?: string;
  } | null;
  return jsonResponse({
    recommendationId: persisted?.recommendationId,
    version: persisted?.version,
    recommended: {
      totalCents: rec.cost.totalCents,
      netSavingsCents: rec.netSavingsCents,
      autoInsurer: rec.configuration.auto.insurerName,
      propertyInsurer: rec.configuration.property.insurerName,
      bundled: rec.configuration.bundled,
    },
    optionsCount: optionsPayload.length,
  });
});
