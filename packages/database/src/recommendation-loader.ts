import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineQuote, HouseholdAssets, RecommendationInputSnapshot } from "@autopilot/schemas";
import type { Database } from "./database.types";
import { loadCurrentV2Mandate } from "./mandate-repository";
import { toEngineQuote, type DbQuote, type QuoteCoverageError } from "./quote-normalizer";

export interface SnapshotLoadError {
  code: string;
  message: string;
  details?: QuoteCoverageError | Record<string, unknown>;
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

  const [mandateResult, vehiclesRes, propertiesRes, quotesRes, readinessRes] = await Promise.all([
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
        "id, updated_at, version, insurer_id, state, is_incumbent, policy_fees_cents, payment_fees_cents, bundle_discount_cents, cancellation_charge_cents, underwriting_conditions, expires_at, insurers(name, version, financial_strength_rating, payment_frequencies, billing_methods, distribution), quote_policy_components(id, product_line, annual_premium_cents, asset_id, quote_coverages(coverage, raw_coverage, normalized_coverage, field_provenance, validation_status, validation_errors, coverage_schema_version, data_source, validated_at, validated_by))",
      )
      .eq("case_id", caseId),
    (
      supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (
              c: string,
              v: string,
            ) => Promise<{
              data: { quote_id: string; readiness_status: string }[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      }
    )
      .from("quote_readiness")
      .select("quote_id, readiness_status")
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
  if (readinessRes.error) {
    return {
      code: "QUOTE_READINESS_LOAD_FAILED",
      message: readinessRes.error.message,
      details: { resource: "quote_readiness", operation: "select" },
    };
  }

  const readinessByQuote = new Map(
    (readinessRes.data ?? []).map((r) => [r.quote_id, r.readiness_status]),
  );
  const dbQuotes = (quotesRes.data ?? []) as unknown as DbQuote[];
  const notReady = dbQuotes.filter((q) => readinessByQuote.get(q.id) !== "ready");
  if (notReady.length > 0) {
    return {
      code: "QUOTE_NOT_READY",
      message: `Quotes are not ready for recommendation: ${notReady
        .map((q) => `${q.id} (${readinessByQuote.get(q.id) ?? "unknown"})`)
        .join(", ")}`,
      details: {
        quoteIds: notReady.map((q) => q.id),
        readiness: Object.fromEntries(readinessByQuote),
      },
    };
  }

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
    caseId,
    householdId,
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
    quoteSnapshot: dbQuotes.map((q) => ({
      id: q.id,
      updated_at: q.updated_at,
      version: q.version,
      is_incumbent: q.is_incumbent,
    })),
  };
}
