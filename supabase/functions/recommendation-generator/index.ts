// Generates a licensed-review recommendation for a case in `comparing_quotes`.
// Loads household mandate, current policies (as the incumbent quote), and all
// bindable/conditional competing quotes, runs the deterministic insurance engine,
// and persists the recommendation + ranked options through an atomic database RPC.
import { createClient } from "npm:@supabase/supabase-js@2";
import { evaluateHousehold } from "./engine.ts";
import type { EngineInput, EvaluatedConfiguration } from "./engine.ts";

interface DbComponent {
  id: string;
  product_line: "auto" | "property";
  annual_premium_cents: number;
  quote_coverages: { coverage: Record<string, unknown> }[];
}

interface DbQuote {
  id: string;
  updated_at: string;
  insurer_id: string;
  state: string;
  is_incumbent: boolean;
  policy_fees_cents: number;
  payment_fees_cents: number;
  bundle_discount_cents: number;
  cancellation_charge_cents: number;
  underwriting_conditions: string[];
  expires_at: string | null;
  insurers: { name: string } | null;
  quote_policy_components: DbComponent[];
}

function toComponent(c: DbComponent): any {
  const coverage = c.quote_coverages[0]?.coverage ?? {};
  return {
    productLine: c.product_line,
    annualPremiumCents: c.annual_premium_cents,
    auto: c.product_line === "auto" ? coverage : null,
    property: c.product_line === "property" ? coverage : null,
  };
}

function toEngineQuote(q: DbQuote): any {
  return {
    id: q.id,
    insurerId: q.insurer_id,
    insurerName: q.insurers?.name ?? "Unknown insurer",
    state: q.state,
    isIncumbent: q.is_incumbent,
    policyFeesCents: q.policy_fees_cents,
    paymentFeesCents: q.payment_fees_cents,
    bundleDiscountCents: q.bundle_discount_cents,
    cancellationChargeCents: q.cancellation_charge_cents,
    underwritingConditions: q.underwriting_conditions,
    components: q.quote_policy_components.map(toComponent),
    expiresAt: q.expires_at,
  };
}

const ENGINE_VERSION = "1.0.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["operations", "admin"].includes(profile.role)) {
    return new Response("Forbidden: only operations or admins can generate recommendations", {
      status: 403,
    });
  }

  const { caseId } = await req.json();
  if (!caseId) return new Response("Missing caseId", { status: 400 });

  const { data: caseRow, error: caseErr } = await supabase
    .from("optimization_cases")
    .select("id, household_id, state, renewal_date")
    .eq("id", caseId)
    .single();
  if (caseErr || !caseRow) return new Response("Case not found", { status: 404 });
  if (caseRow.state !== "comparing_quotes") {
    return new Response("Case must be in comparing_quotes state", { status: 409 });
  }

  const [quotesRes, reqRes, prefsRes] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "id, updated_at, insurer_id, state, is_incumbent, policy_fees_cents, payment_fees_cents, bundle_discount_cents, cancellation_charge_cents, underwriting_conditions, expires_at, insurers(name), quote_policy_components(id, product_line, annual_premium_cents, quote_coverages(coverage))",
      )
      .eq("case_id", caseId),
    supabase
      .from("coverage_requirements")
      .select("version, auto_requirements, property_requirements")
      .eq("household_id", caseRow.household_id)
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("switching_preferences")
      .select(
        "version, min_net_annual_savings_cents, renewal_only_switching, household_optimization_enabled, split_insurers_allowed, excluded_insurer_ids, deductible_increases_allowed",
      )
      .eq("household_id", caseRow.household_id)
      .eq("is_current", true)
      .maybeSingle(),
  ]);

  if (quotesRes.error) return new Response(quotesRes.error.message, { status: 500 });
  if (!reqRes.data || !prefsRes.data) {
    return new Response("Household mandate is not configured", { status: 400 });
  }

  const dbQuotes = quotesRes.data as unknown as DbQuote[];
  const engineQuotes = dbQuotes.map(toEngineQuote);

  const incumbentQuote = engineQuotes.find((q) => q.isIncumbent);
  if (!incumbentQuote) {
    return new Response("No incumbent quote entered for this case", { status: 400 });
  }
  const incumbentAutoComponent = incumbentQuote.components.find(
    (c: any) => c.productLine === "auto",
  );
  const incumbentPropertyComponent = incumbentQuote.components.find(
    (c: any) => c.productLine === "property",
  );
  if (!incumbentAutoComponent?.auto || !incumbentPropertyComponent?.property) {
    return new Response("The incumbent quote must include both auto and property components", {
      status: 400,
    });
  }

  const prefs = prefsRes.data as {
    version: number;
    min_net_annual_savings_cents: number;
    renewal_only_switching: boolean;
    household_optimization_enabled: boolean;
    split_insurers_allowed: boolean;
    excluded_insurer_ids: string[];
    deductible_increases_allowed: boolean;
  };

  const mandate: EngineInput["mandate"] = {
    auto: reqRes.data.auto_requirements as any,
    property: reqRes.data.property_requirements as any,
    switching: {
      minNetAnnualSavingsCents: prefs.min_net_annual_savings_cents,
      renewalOnlySwitching: prefs.renewal_only_switching,
      householdOptimizationEnabled: prefs.household_optimization_enabled,
      splitInsurersAllowed: prefs.split_insurers_allowed,
      excludedInsurerIds: prefs.excluded_insurer_ids ?? [],
      deductibleIncreasesAllowed: prefs.deductible_increases_allowed,
      materialCoverageReductionsAllowed: false,
      customerApprovalRequired: true,
    },
  };

  const input: EngineInput = {
    mandate,
    quotes: engineQuotes.filter((q) => !q.isIncumbent),
    incumbentAuto: {
      quote: incumbentQuote,
      component: incumbentAutoComponent,
    },
    incumbentProperty: {
      quote: incumbentQuote,
      component: incumbentPropertyComponent,
    },
  };

  const result = evaluateHousehold(input);

  if (!result.recommended) {
    return new Response(
      JSON.stringify({ eligible: 0, evaluated: result.evaluated.length, recommendationId: null }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const rec = result.recommended;
  const ranked = result.evaluated
    .slice()
    .sort(
      (a: EvaluatedConfiguration, b: EvaluatedConfiguration) =>
        a.cost.totalCents - b.cost.totalCents,
    )
    .slice(0, 10);

  const quoteSnapshot = dbQuotes.map((q) => ({ id: q.id, updated_at: q.updated_at }));

  const optionsPayload = ranked.map((e: EvaluatedConfiguration, i: number) => ({
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
    p_mandate_version: reqRes.data.version ?? 1,
    p_switching_version: prefs.version ?? 1,
    p_quote_snapshot: quoteSnapshot,
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
    return new Response(JSON.stringify({ error: persistError.message }), { status: 409 });
  }

  return new Response(
    JSON.stringify({
      recommendationId: (persistData as any).recommendation_id,
      version: (persistData as any).version,
      recommended: {
        totalCents: rec.cost.totalCents,
        netSavingsCents: rec.netSavingsCents,
        autoInsurer: rec.configuration.auto.insurerName,
        propertyInsurer: rec.configuration.property.insurerName,
        bundled: rec.configuration.bundled,
      },
      optionsCount: optionsPayload.length,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
});
