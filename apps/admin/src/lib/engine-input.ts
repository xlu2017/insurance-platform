import type {
  AutoCoverageDetails,
  EngineQuote,
  HouseholdMandate,
  PropertyCoverageDetails,
  QuoteComponent,
} from "@autopilot/schemas";
import type { EngineInput } from "@autopilot/insurance-engine";
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
    quote_coverages: { coverage: Record<string, unknown> }[];
  }[];
}

function toComponent(c: DbQuote["quote_policy_components"][number]): QuoteComponent {
  const coverage = c.quote_coverages[0]?.coverage ?? {};
  return {
    productLine: c.product_line,
    annualPremiumCents: c.annual_premium_cents,
    auto: c.product_line === "auto" ? (coverage as unknown as AutoCoverageDetails) : null,
    property:
      c.product_line === "property" ? (coverage as unknown as PropertyCoverageDetails) : null,
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

export function toEngineQuote(q: DbQuote): EngineQuote {
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
    components: q.quote_policy_components.map(toComponent),
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
  const [quotesRes, reqRes, prefsRes] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "id, insurer_id, state, is_incumbent, policy_fees_cents, payment_fees_cents, bundle_discount_cents, cancellation_charge_cents, underwriting_conditions, expires_at, insurers(name, financial_strength_rating, payment_frequencies, billing_methods, distribution), quote_policy_components(id, product_line, annual_premium_cents, quote_coverages(coverage))",
      )
      .eq("case_id", caseId),
    supabase
      .from("coverage_requirements")
      .select("auto_requirements, property_requirements, vehicle_mandates, property_mandates")
      .eq("household_id", householdId)
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("switching_preferences")
      .select("*")
      .eq("household_id", householdId)
      .eq("is_current", true)
      .maybeSingle(),
  ]);

  if (quotesRes.error) return { error: quotesRes.error.message };
  if (!reqRes.data || !prefsRes.data) return { error: "Household mandate is not configured." };

  const dbQuotes = quotesRes.data as unknown as DbQuote[];
  const engineQuotes = dbQuotes.map(toEngineQuote);

  const incumbentQuote = engineQuotes.find((q) => q.isIncumbent);
  if (!incumbentQuote) return { error: "No incumbent quote entered for this case." };
  const incumbentAutoComponent = incumbentQuote.components.find((c) => c.productLine === "auto");
  const incumbentPropertyComponent = incumbentQuote.components.find(
    (c) => c.productLine === "property",
  );
  if (!incumbentAutoComponent?.auto || !incumbentPropertyComponent?.property)
    return { error: "The incumbent quote must include both auto and property components." };

  const prefs = prefsRes.data as Record<string, unknown>;

  const mandate: HouseholdMandate = {
    auto: reqRes.data.auto_requirements as HouseholdMandate["auto"],
    property: reqRes.data.property_requirements as HouseholdMandate["property"],
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
      customerApprovalRequired: true,
      switchOnlyAfterCustomerApproval: Boolean(prefs.switch_only_after_customer_approval),
      preferredPaymentFrequency:
        (prefs.preferred_payment_frequency as HouseholdMandate["switching"]["preferredPaymentFrequency"]) ??
        "annual",
      preferredBillingMethod:
        (prefs.preferred_billing_method as HouseholdMandate["switching"]["preferredBillingMethod"]) ??
        "automatic_bank",
      brokerDirectPreference:
        (prefs.broker_direct_preference as HouseholdMandate["switching"]["brokerDirectPreference"]) ??
        "indifferent",
      minimumInsurerFinancialRating:
        (prefs.minimum_insurer_financial_rating as HouseholdMandate["switching"]["minimumInsurerFinancialRating"]) ??
        "any",
    },
    vehicleOverrides:
      (reqRes.data.vehicle_mandates as Record<string, Partial<HouseholdMandate["auto"]>> | null) ??
      {},
    propertyOverrides:
      (reqRes.data.property_mandates as Record<
        string,
        Partial<HouseholdMandate["property"]>
      > | null) ?? {},
  };

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
  };

  return { input, quotes: dbQuotes };
}
