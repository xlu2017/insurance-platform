// Atomic customer approval of extracted asset candidates.
//
// Customers review the candidates produced by extract-policy-entities and choose
// approve_new or skip for each one. This function creates the corresponding
// vehicle/property rows, builds a V2 mandate with asset-specific overrides from
// the extracted coverage values, and persists the mandate through the trusted
// persist_household_mandate_v2 RPC. All candidate decisions and the extraction
// session are updated to approved/closed inside the same transaction.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  createDefaultHouseholdCoverageMandateV2,
  createDefaultSwitchingPreferencesV2,
  HouseholdCoverageMandateV2,
  SwitchingPreferencesV2,
} from "../_shared/autopilot.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_DECISIONS = new Set(["approve_new", "skip"]);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface FactRow {
  id: string;
  candidate_id: string | null;
  field_path: string;
  normalized_value: unknown;
}

interface CandidateRecord {
  id: string;
  session_id: string;
  household_id: string;
  asset_type: "vehicle" | "property";
  identity_fingerprint: string;
  display_label: string;
  occupancy: string | null;
  match_classification: string;
  decision: string;
  review_status: string;
  source_document_ids: string[];
  selected_facts_json: Record<string, string>;
  conflicts_json: unknown[];
}

function findFact(facts: FactRow[], id: string | undefined): FactRow | undefined {
  if (!id) return undefined;
  return facts.find((f) => f.id === id);
}

function factValue<T>(facts: FactRow[], id: string | undefined): T | undefined {
  const f = findFact(facts, id);
  if (!f) return undefined;
  return f.normalized_value as T;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}

interface CreatedAsset {
  candidateId: string;
  assetType: "vehicle" | "property";
  assetId: string;
  overrideValues: Record<string, unknown>;
}

async function createVehicle(
  admin: ReturnType<typeof createClient>,
  householdId: string,
  candidate: CandidateRecord,
  facts: FactRow[],
): Promise<CreatedAsset> {
  const selected = candidate.selected_facts_json;
  const year = asNumber(factValue(facts, selected["vehicle.year"]));
  const make = asString(factValue(facts, selected["vehicle.make"]));
  const model = asString(factValue(facts, selected["vehicle.model"]));
  const vin = asString(factValue(facts, selected["vehicle.vin"]));

  if (!year || !make || !model) {
    throw new Error(`Vehicle candidate ${candidate.id} is missing required identity fields`);
  }

  const { data, error } = await admin
    .from("vehicles")
    .insert({
      household_id: householdId,
      year,
      make,
      model,
      vin: vin ?? null,
      primary_use: "commute",
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create vehicle");

  const overrideValues: Record<string, unknown> = {};
  const liability = asNumber(factValue(facts, selected["vehicle.thirdPartyLiabilityLimitCents"]));
  if (liability !== undefined)
    overrideValues.liability = { rule: "minimum", amountCents: liability };

  const collision = asNumber(factValue(facts, selected["vehicle.collisionDeductibleCents"]));
  if (collision !== undefined)
    overrideValues.collisionDeductible = { rule: "maximum", amountCents: collision };

  const comprehensive = asNumber(
    factValue(facts, selected["vehicle.comprehensiveDeductibleCents"]),
  );
  if (comprehensive !== undefined)
    overrideValues.comprehensiveDeductible = { rule: "maximum", amountCents: comprehensive };

  const glass = asNumber(factValue(facts, selected["vehicle.glassDeductibleCents"]));
  if (glass !== undefined) overrideValues.glassDeductible = { rule: "maximum", amountCents: glass };

  return { candidateId: candidate.id, assetType: "vehicle", assetId: data.id, overrideValues };
}

async function createProperty(
  admin: ReturnType<typeof createClient>,
  householdId: string,
  candidate: CandidateRecord,
  facts: FactRow[],
): Promise<CreatedAsset> {
  const selected = candidate.selected_facts_json;
  const street = asString(factValue(facts, selected["property.streetAddress"]));
  const city = asString(factValue(facts, selected["property.city"]));
  const province = asString(factValue(facts, selected["property.province"]));
  const postal = asString(factValue(facts, selected["property.postalCode"]));
  const occupancy = candidate.occupancy ?? "unknown";

  if (!city || !province || !postal) {
    throw new Error(`Property candidate ${candidate.id} is missing required identity fields`);
  }

  const { data, error } = await admin
    .from("properties")
    .insert({
      household_id: householdId,
      address_line1: street ?? "Address to be confirmed",
      city,
      province,
      postal_code: postal,
      dwelling_type: "detached",
      owner_occupied: occupancy !== "rental",
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create property");

  const overrideValues: Record<string, unknown> = {};

  const dwelling = asNumber(factValue(facts, selected["property.dwellingLimitCents"]));
  if (dwelling !== undefined)
    overrideValues.dwellingLimit = { rule: "minimum", amountCents: dwelling };

  const contents = asNumber(factValue(facts, selected["property.contentsLimitCents"]));
  if (contents !== undefined)
    overrideValues.contentsLimit = { rule: "minimum", amountCents: contents };

  const liability = asNumber(factValue(facts, selected["property.personalLiabilityLimitCents"]));
  if (liability !== undefined)
    overrideValues.personalLiabilityLimit = { rule: "minimum", amountCents: liability };

  const fairRental = asNumber(factValue(facts, selected["property.fairRentalValueLimitCents"]));
  if (fairRental !== undefined)
    overrideValues.additionalLivingExpenseLimit = { rule: "minimum", amountCents: fairRental };

  const baseDeductible = asNumber(factValue(facts, selected["property.baseDeductibleCents"]));
  if (baseDeductible !== undefined)
    overrideValues.baseDeductible = { rule: "maximum", amountCents: baseDeductible };

  const windHail = asNumber(factValue(facts, selected["property.windHailDeductibleCents"]));
  if (windHail !== undefined)
    overrideValues.windHailDeductible = { rule: "maximum", amountCents: windHail };

  return { candidateId: candidate.id, assetType: "property", assetId: data.id, overrideValues };
}

function buildMandatePayload(
  createdAssets: CreatedAsset[],
  jurisdiction: string,
): { mandate: unknown; switching: unknown } {
  const baseMandate = createDefaultHouseholdCoverageMandateV2();
  const switching = createDefaultSwitchingPreferencesV2();

  const vehicleOverrides = [];
  const propertyOverrides = [];

  for (const asset of createdAssets) {
    if (asset.assetType === "vehicle") {
      vehicleOverrides.push({
        vehicleId: asset.assetId,
        values: asset.overrideValues,
      });
    } else {
      propertyOverrides.push({
        propertyId: asset.assetId,
        values: asset.overrideValues,
      });
    }
  }

  const mandate = {
    ...baseMandate,
    jurisdiction,
    vehicleOverrides,
    propertyOverrides,
  };

  return { mandate, switching };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError("Method not allowed", 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  let body: { session_id?: string; decisions?: { candidateId: string; decision: string }[] };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const sessionId = body.session_id;
  if (!sessionId || !isUuid(sessionId)) {
    return jsonError("Missing or invalid session_id", 400);
  }
  if (!Array.isArray(body.decisions) || body.decisions.length === 0) {
    return jsonError("decisions must be a non-empty array", 400);
  }
  for (const d of body.decisions) {
    if (!isUuid(d.candidateId) || !VALID_DECISIONS.has(d.decision)) {
      return jsonError("Invalid candidateId or decision", 400);
    }
  }

  const { data: session, error: sessionErr } = await supabase
    .from("document_extraction_sessions")
    .select("id, household_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionErr || !session) {
    return jsonError("Session not found", 404);
  }
  if (session.status !== "open") {
    return jsonError("Session is not open for approval", 409);
  }

  const { data: candidates, error: candidatesErr } = await admin
    .from("asset_candidates")
    .select("*")
    .eq("session_id", sessionId);
  if (candidatesErr) {
    return jsonError(candidatesErr.message, 500);
  }
  const candidateById = new Map((candidates ?? []).map((c) => [c.id, c as CandidateRecord]));

  const candidateIds = body.decisions.map((d) => d.candidateId);
  const { data: facts, error: factsErr } = await admin
    .from("extracted_fact_assertions")
    .select("id, candidate_id, field_path, normalized_value")
    .in("candidate_id", candidateIds);
  if (factsErr) {
    return jsonError(factsErr.message, 500);
  }
  const factsByCandidate = new Map<string, FactRow[]>();
  for (const f of (facts ?? []) as FactRow[]) {
    if (!f.candidate_id) continue;
    const list = factsByCandidate.get(f.candidate_id) ?? [];
    list.push(f);
    factsByCandidate.set(f.candidate_id, list);
  }

  const createdAssets: CreatedAsset[] = [];

  for (const decision of body.decisions) {
    const candidate = candidateById.get(decision.candidateId);
    if (!candidate) {
      return jsonError(`Candidate ${decision.candidateId} not found`, 404);
    }
    if (candidate.household_id !== session.household_id) {
      return jsonError(`Candidate ${decision.candidateId} does not belong to session`, 403);
    }
    if (decision.decision === "approve_new") {
      const facts = factsByCandidate.get(candidate.id) ?? [];
      try {
        const asset =
          candidate.asset_type === "vehicle"
            ? await createVehicle(admin, session.household_id, candidate, facts)
            : await createProperty(admin, session.household_id, candidate, facts);
        createdAssets.push(asset);
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : "Asset creation failed", 422);
      }
    }
  }

  let mandateResult: { mandate: unknown; switching: unknown } | null = null;
  if (createdAssets.length > 0) {
    mandateResult = buildMandatePayload(createdAssets, "AB");
    const mandateParse = HouseholdCoverageMandateV2.safeParse(mandateResult.mandate);
    if (!mandateParse.success) {
      return jsonResponse(
        {
          code: "INVALID_MANDATE",
          message: "Built mandate is invalid",
          errors: mandateParse.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        500,
      );
    }
    const switchingParse = SwitchingPreferencesV2.safeParse(mandateResult.switching);
    if (!switchingParse.success) {
      return jsonResponse(
        {
          code: "INVALID_SWITCHING",
          message: "Built switching preferences are invalid",
          errors: switchingParse.error.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        500,
      );
    }

    const { data: currentMandate } = await admin
      .from("household_coverage_mandates")
      .select("version")
      .eq("household_id", session.household_id)
      .eq("is_current", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const expectedMandateVersion = currentMandate?.version ?? 0;

    const { data: currentSwitching } = await admin
      .from("switching_preferences")
      .select("version")
      .eq("household_id", session.household_id)
      .eq("is_current", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const expectedSwitchingVersion = currentSwitching?.version ?? 0;

    const { data, error: rpcErr } = await admin.rpc("persist_household_mandate_v2", {
      p_household_id: session.household_id,
      p_expected_mandate_version: expectedMandateVersion,
      p_expected_switching_version: expectedSwitchingVersion,
      p_household_auto_defaults: (mandateResult.mandate as any).householdAutoDefaults,
      p_household_property_defaults: (mandateResult.mandate as any).householdPropertyDefaults,
      p_vehicle_overrides: (mandateResult.mandate as any).vehicleOverrides,
      p_property_overrides: (mandateResult.mandate as any).propertyOverrides,
      p_switching_preferences: mandateResult.switching,
      p_jurisdiction: (mandateResult.mandate as any).jurisdiction,
      p_created_by: user.id,
    });
    if (rpcErr) {
      return jsonResponse({ code: rpcErr.code ?? "PERSIST_FAILED", message: rpcErr.message }, 409);
    }
    const result = data as { success: boolean; code?: string; message?: string } | null;
    if (result && result.success === false) {
      return jsonResponse(result, 409);
    }
  }

  // Update candidate decisions and session status.
  for (const decision of body.decisions) {
    const status = decision.decision === "approve_new" ? "approved" : "skipped";
    const { error } = await admin
      .from("asset_candidates")
      .update({ decision: decision.decision, review_status: status })
      .eq("id", decision.candidateId);
    if (error) {
      return jsonError(error.message, 500);
    }
  }

  const nextStatus = createdAssets.length > 0 ? "approved" : "closed";
  const { error: sessionUpdateErr } = await admin
    .from("document_extraction_sessions")
    .update({ status: nextStatus })
    .eq("id", sessionId);
  if (sessionUpdateErr) {
    return jsonError(sessionUpdateErr.message, 500);
  }

  return jsonResponse({
    session_id: sessionId,
    status: nextStatus,
    assets: createdAssets.map((a) => ({
      candidate_id: a.candidateId,
      asset_type: a.assetType,
      asset_id: a.assetId,
    })),
    mandate: mandateResult ? { jurisdiction: (mandateResult.mandate as any).jurisdiction } : null,
  });
});
