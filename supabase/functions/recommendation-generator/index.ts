// Generates a licensed-review recommendation for a case in `comparing_quotes`.
// Loads household mandate, current policies (as the incumbent quote), and all
// bindable/conditional competing quotes, runs the deterministic insurance engine,
// and persists the recommendation + ranked options.
import { createClient } from "npm:@supabase/supabase-js@2";
import { evaluateHousehold } from "./engine.ts";
import type { EngineInput } from "./engine.ts";

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
  insurers: {
    name: string;
    financial_strength_rating: string;
    payment_frequencies: string[];
    billing_methods: string[];
    distribution: string;
  } | null;
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

function first<T>(arr: T[] | undefined | null): T | undefined {
  return arr && arr.length > 0 ? arr[0] : undefined;
}

function toFinancialRating(value: string): EngineInput["quotes"][number]["insurerFinancialRating"] {
  const known = ["A_plus", "A", "A_minus", "B_plus", "B_or_lower", "any"] as const;
  return known.includes(value as (typeof known)[number])
    ? (value as (typeof known)[number])
    : "any";
}

function toPaymentFrequency(value: string): EngineInput["quotes"][number]["paymentFrequency"] {
  const known = ["monthly", "quarterly", "semi_annual", "annual"] as const;
  return known.includes(value as (typeof known)[number])
    ? (value as (typeof known)[number])
    : undefined;
}

function toBillingMethod(value: string): EngineInput["quotes"][number]["billingMethod"] {
  const known = ["automatic_bank", "credit_card", "mail"] as const;
  return known.includes(value as (typeof known)[number])
    ? (value as (typeof known)[number])
    : undefined;
}

function toEngineQuote(q: DbQuote): any {
  const insurer = q.insurers;
  const paymentFrequency = first(insurer?.payment_frequencies);
  const billingMethod = first(insurer?.billing_methods);
  const distributionChannel =
    insurer?.distribution === "broker"
      ? "broker"
      : insurer?.distribution === "direct"
        ? "direct"
        : "indifferent";

  return {
    id: q.id,
    insurerId: q.insurer_id,
    insurerName: insurer?.name ?? "Unknown insurer",
    state: q.state,
    isIncumbent: q.is_incumbent,
    policyFeesCents: q.policy_fees_cents,
    paymentFeesCents: q.payment_fees_cents,
    bundleDiscountCents: q.bundle_discount_cents,
    cancellationChargeCents: q.cancellation_charge_cents,
    underwritingConditions: q.underwriting_conditions,
    components: q.quote_policy_components.map(toComponent),
    expiresAt: q.expires_at,
    paymentFrequency: paymentFrequency ? toPaymentFrequency(paymentFrequency) : undefined,
    billingMethod: billingMethod ? toBillingMethod(billingMethod) : undefined,
    distributionChannel,
    insurerFinancialRating: insurer ? toFinancialRating(insurer.financial_strength_rating) : "any",
  };
}

Deno.serve(async (req) => {
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
    return new Response("Forbidden", { status: 403 });
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
        "id, updated_at, insurer_id, state, is_incumbent, policy_fees_cents, payment_fees_cents, bundle_discount_cents, cancellation_charge_cents, underwriting_conditions, expires_at, insurers(name, financial_strength_rating, payment_frequencies, billing_methods, distribution), quote_policy_components(id, product_line, annual_premium_cents, quote_coverages(coverage))",
      )
      .eq("case_id", caseId),
    supabase
      .from("coverage_requirements")
      .select(
        "version, auto_requirements, property_requirements, vehicle_mandates, property_mandates",
      )
      .eq("household_id", caseRow.household_id)
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("switching_preferences")
      .select("*")
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

  const prefs = prefsRes.data as Record<string, unknown>;

  const mandate: EngineInput["mandate"] = {
    auto: reqRes.data.auto_requirements as any,
    property: reqRes.data.property_requirements as any,
    switching: {
      minNetAnnualSavingsCents: Number(prefs.min_net_annual_savings_cents ?? 0),
      maxPremiumIncreaseCents: Number(prefs.max_premium_increase_cents ?? 0),
      maxDeductibleIncreaseCents: Number(prefs.max_deductible_increase_cents ?? 0),
      renewalOnlySwitching: Boolean(prefs.renewal_only_switching),
      householdOptimizationEnabled: Boolean(prefs.household_optimization_enabled),
      splitInsurersAllowed: Boolean(prefs.split_insurers_allowed),
      allowBundleBreakup: Boolean(prefs.allow_bundle_breakup),
      excludedInsurerIds: Array.isArray(prefs.excluded_insurer_ids)
        ? (prefs.excluded_insurer_ids as string[])
        : [],
      deductibleIncreasesAllowed: Boolean(prefs.deductible_increases_allowed),
      materialCoverageReductionsAllowed: Boolean(prefs.material_coverage_reductions_allowed),
      customerApprovalRequired: Boolean(prefs.customer_approval_required),
      switchOnlyAfterCustomerApproval: Boolean(prefs.switch_only_after_customer_approval),
      preferredPaymentFrequency: (prefs.preferred_payment_frequency as any) ?? "annual",
      preferredBillingMethod: (prefs.preferred_billing_method as any) ?? "automatic_bank",
      brokerDirectPreference: (prefs.broker_direct_preference as any) ?? "indifferent",
      minimumInsurerFinancialRating: (prefs.minimum_insurer_financial_rating as any) ?? "any",
    },
    vehicleOverrides: (reqRes.data.vehicle_mandates ?? {}) as any,
    propertyOverrides: (reqRes.data.property_mandates ?? {}) as any,
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

  const ENGINE_VERSION = "1.0.0";

  const rec = result.recommended;
  const ranked = result.evaluated
    .slice()
    .sort((a: any, b: any) => a.cost.totalCents - b.cost.totalCents)
    .slice(0, 10);

  const quoteSnapshot = dbQuotes.map((q) => ({ id: q.id, updated_at: q.updated_at }));

  const optionsPayload = ranked.map((e: any, i: number) => ({
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
    p_switching_version: (prefs.version as number) ?? 1,
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
