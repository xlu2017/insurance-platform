import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineQuote, HouseholdAssets, RecommendationInputSnapshot } from "@autopilot/schemas";
import type { Database } from "./database.types";
import { loadCurrentV2Mandate } from "./mandate-repository";
import { toEngineQuote, type DbQuote, type QuoteCoverageError } from "./quote-normalizer";

export interface SnapshotLoadError {
  code: string;
  message: string;
  details?: QuoteCoverageError | { resource?: string; operation?: string };
}

export async function loadRecommendationInputSnapshot(
  supabase: SupabaseClient<Database>,
  caseId: string,
): Promise<RecommendationInputSnapshot | SnapshotLoadError> {
  const { data: caseRow, error: caseError } = await supabase
    .from("optimization_cases")
    .select("household_id, state")
    .eq("id", caseId)
    .single();

  if (caseError || !caseRow) {
    return {
      code: "CASE_NOT_FOUND",
      message: caseError?.message ?? "Case not found",
      details: { resource: "optimization_cases", operation: "select" },
    };
  }

  const householdId = caseRow.household_id;

  const [mandateResult, vehiclesRes, propertiesRes, quotesRes] = await Promise.all([
    loadCurrentV2Mandate(supabase, householdId).catch((err) => {
      if (err && typeof err === "object" && "code" in err) {
        return {
          code: err.code,
          message: err instanceof Error ? err.message : String(err),
        };
      }
      return { code: "MANDATE_LOAD_FAILED", message: String(err) };
    }),
    supabase.from("vehicles").select("id").eq("household_id", householdId),
    supabase.from("properties").select("id").eq("household_id", householdId),
    supabase
      .from("quotes")
      .select(
        "id, updated_at, insurer_id, state, is_incumbent, policy_fees_cents, payment_fees_cents, bundle_discount_cents, cancellation_charge_cents, underwriting_conditions, expires_at, insurers(name, financial_strength_rating, payment_frequencies, billing_methods, distribution), quote_policy_components(id, product_line, annual_premium_cents, asset_id, quote_coverages(coverage))",
      )
      .eq("case_id", caseId),
  ]);

  if (!mandateResult || "code" in mandateResult) {
    return {
      code: mandateResult ? "MANDATE_LOAD_FAILED" : "MANDATE_NOT_FOUND",
      message: mandateResult?.message ?? "No current V2 mandate exists for this household",
      details: { operation: "loadCurrentV2Mandate" },
    };
  }

  if (vehiclesRes.error) {
    return {
      code: "ASSET_LOAD_FAILED",
      message: vehiclesRes.error.message,
      details: { resource: "vehicles", operation: "select" },
    };
  }
  if (propertiesRes.error) {
    return {
      code: "ASSET_LOAD_FAILED",
      message: propertiesRes.error.message,
      details: { resource: "properties", operation: "select" },
    };
  }
  if (quotesRes.error) {
    return {
      code: "QUOTE_LOAD_FAILED",
      message: quotesRes.error.message,
      details: { resource: "quotes", operation: "select" },
    };
  }

  const dbQuotes = (quotesRes.data ?? []) as unknown as DbQuote[];
  const engineQuotes: EngineQuote[] = [];
  for (const q of dbQuotes) {
    const result = toEngineQuote(q);
    if ("message" in result) {
      return {
        code: "QUOTE_VALIDATION_FAILED",
        message: result.message,
        details: result,
      };
    }
    engineQuotes.push(result);
  }

  const assets: HouseholdAssets = {
    vehicles: (vehiclesRes.data ?? []).map((v) => ({ id: v.id })),
    properties: (propertiesRes.data ?? []).map((p) => ({ id: p.id })),
  };

  return {
    mandateId: mandateResult.mandateId,
    mandateVersion: mandateResult.mandateVersion,
    mandateSchemaVersion: 2,
    jurisdiction: "AB",
    switchingPreferencesId: mandateResult.switchingPreferencesId,
    switchingPreferencesVersion: mandateResult.switchingVersion,
    mandate: mandateResult.mandate,
    switching: mandateResult.switching,
    assets,
    quotes: engineQuotes,
    quoteSnapshot: dbQuotes.map((q) => ({ id: q.id, updated_at: q.updated_at })),
  };
}
