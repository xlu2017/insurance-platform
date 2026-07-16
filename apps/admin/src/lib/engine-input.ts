import type { EngineInput } from "@autopilot/insurance-engine";
import { loadHouseholdMandateV2, MandateValidationError } from "@autopilot/database";
import {
  AutoCoverageDetails,
  PropertyCoverageDetails,
  mandateV2ToEngineMandate,
} from "@autopilot/schemas";
import type { EngineQuote, QuoteComponent } from "@autopilot/schemas";
import { supabaseBrowser } from "@/lib/supabase";

export interface DbQuote {
  id: string;
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
  quote_policy_components: {
    id: string;
    product_line: "auto" | "property";
    annual_premium_cents: number;
    asset_id?: string | null;
    quote_coverages: { coverage: Record<string, unknown> }[];
  }[];
}

function toComponent(c: DbQuote["quote_policy_components"][number]): QuoteComponent | null {
  const coverage = c.quote_coverages[0]?.coverage ?? {};
  if (c.product_line === "auto") {
    const parsed = AutoCoverageDetails.safeParse(coverage as unknown);
    if (!parsed.success) return null;
    return {
      productLine: c.product_line,
      assetId: c.asset_id ?? undefined,
      annualPremiumCents: c.annual_premium_cents,
      auto: parsed.data,
      property: null,
    };
  }
  const parsed = PropertyCoverageDetails.safeParse(coverage as unknown);
  if (!parsed.success) return null;
  return {
    productLine: c.product_line,
    assetId: c.asset_id ?? undefined,
    annualPremiumCents: c.annual_premium_cents,
    auto: null,
    property: parsed.data,
  };
}

function first<T>(arr: T[] | undefined | null): T | undefined {
  return arr && arr.length > 0 ? arr[0] : undefined;
}

function toFinancialRating(value: string): EngineQuote["insurerFinancialRating"] {
  const known = ["A_plus", "A", "A_minus", "B_plus", "B_or_lower", "any"] as const;
  return known.includes(value as (typeof known)[number])
    ? (value as (typeof known)[number])
    : "any";
}

function toPaymentFrequency(value: string): EngineQuote["paymentFrequency"] {
  const known = ["monthly", "quarterly", "semi_annual", "annual"] as const;
  return known.includes(value as (typeof known)[number])
    ? (value as (typeof known)[number])
    : undefined;
}

function toBillingMethod(value: string): EngineQuote["billingMethod"] {
  const known = ["automatic_bank", "credit_card", "mail"] as const;
  return known.includes(value as (typeof known)[number])
    ? (value as (typeof known)[number])
    : undefined;
}

export function toEngineQuote(q: DbQuote): EngineQuote | null {
  const components = q.quote_policy_components.map(toComponent).filter(Boolean) as QuoteComponent[];
  if (components.length !== q.quote_policy_components.length) return null;
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
    state: q.state as EngineQuote["state"],
    isIncumbent: q.is_incumbent,
    policyFeesCents: q.policy_fees_cents,
    paymentFeesCents: q.payment_fees_cents,
    bundleDiscountCents: q.bundle_discount_cents,
    cancellationChargeCents: q.cancellation_charge_cents,
    underwritingConditions: q.underwriting_conditions,
    components,
    expiresAt: q.expires_at,
    paymentFrequency: paymentFrequency ? toPaymentFrequency(paymentFrequency) : undefined,
    billingMethod: billingMethod ? toBillingMethod(billingMethod) : undefined,
    distributionChannel,
    insurerFinancialRating: insurer ? toFinancialRating(insurer.financial_strength_rating) : "any",
  };
}

export async function loadEngineInput(
  caseId: string,
  householdId: string,
): Promise<{ input: EngineInput; quotes: DbQuote[] } | { error: string }> {
  const supabase = supabaseBrowser();
  const [quotesRes, mandateLoad, vehiclesRes, propertiesRes] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "id, insurer_id, state, is_incumbent, policy_fees_cents, payment_fees_cents, bundle_discount_cents, cancellation_charge_cents, underwriting_conditions, expires_at, insurers(name, financial_strength_rating, payment_frequencies, billing_methods, distribution), quote_policy_components(id, product_line, annual_premium_cents, asset_id, quote_coverages(coverage))",
      )
      .eq("case_id", caseId),
    loadHouseholdMandateV2(supabase, householdId).catch((err) => {
      if (err instanceof MandateValidationError) {
        return { error: `Mandate validation failed: ${err.message}` };
      }
      return { error: err instanceof Error ? err.message : String(err) };
    }),
    supabase.from("vehicles").select("id").eq("household_id", householdId),
    supabase.from("properties").select("id").eq("household_id", householdId),
  ]);

  if (quotesRes.error) return { error: quotesRes.error.message };
  if ("error" in mandateLoad) return { error: mandateLoad.error };

  const dbQuotes = quotesRes.data as unknown as DbQuote[];
  const engineQuotes = dbQuotes.map(toEngineQuote).filter(Boolean) as EngineQuote[];

  const incumbentQuote = engineQuotes.find((q) => q.isIncumbent);
  if (!incumbentQuote) return { error: "No incumbent quote entered for this case." };
  const incumbentAutoComponent = incumbentQuote.components.find((c) => c.productLine === "auto");
  const incumbentPropertyComponent = incumbentQuote.components.find(
    (c) => c.productLine === "property",
  );
  if (!incumbentAutoComponent?.auto || !incumbentPropertyComponent?.property)
    return { error: "The incumbent quote must include both auto and property components." };

  const mandate = mandateV2ToEngineMandate(mandateLoad.mandate, mandateLoad.switching);

  const input: EngineInput = {
    mandate,
    quotes: engineQuotes.filter((q) => !q.isIncumbent),
    incumbentAuto: {
      quote: incumbentQuote,
      component: incumbentAutoComponent as QuoteComponent & { auto: AutoCoverageDetails },
    },
    incumbentProperty: {
      quote: incumbentQuote,
      component: incumbentPropertyComponent as QuoteComponent & {
        property: PropertyCoverageDetails;
      },
    },
    assets: {
      vehicles: (vehiclesRes.data ?? []).map((v) => ({ id: v.id })),
      properties: (propertiesRes.data ?? []).map((p) => ({ id: p.id })),
    },
  };

  return { input, quotes: dbQuotes };
}
