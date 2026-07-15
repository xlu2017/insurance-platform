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
  insurers: { name: string } | null;
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

export function toEngineQuote(q: DbQuote): EngineQuote {
  return {
    id: q.id,
    insurerId: q.insurer_id,
    insurerName: q.insurers?.name ?? "Unknown insurer",
    state: q.state as EngineQuote["state"],
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

export async function loadEngineInput(
  caseId: string,
  householdId: string,
): Promise<{ input: EngineInput; quotes: DbQuote[] } | { error: string }> {
  const supabase = supabaseBrowser();
  const [quotesRes, reqRes, prefsRes] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "id, insurer_id, state, is_incumbent, policy_fees_cents, payment_fees_cents, bundle_discount_cents, cancellation_charge_cents, underwriting_conditions, expires_at, insurers(name), quote_policy_components(id, product_line, annual_premium_cents, quote_coverages(coverage))",
      )
      .eq("case_id", caseId),
    supabase
      .from("coverage_requirements")
      .select("auto_requirements, property_requirements")
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

  const prefs = prefsRes.data as {
    min_net_annual_savings_cents: number;
    renewal_only_switching: boolean;
    household_optimization_enabled: boolean;
    split_insurers_allowed: boolean;
    excluded_insurer_ids: string[];
    deductible_increases_allowed: boolean;
  };

  const mandate: HouseholdMandate = {
    auto: reqRes.data.auto_requirements as HouseholdMandate["auto"],
    property: reqRes.data.property_requirements as HouseholdMandate["property"],
    switching: {
      minNetAnnualSavingsCents: prefs.min_net_annual_savings_cents,
      renewalOnlySwitching: prefs.renewal_only_switching,
      householdOptimizationEnabled: prefs.household_optimization_enabled,
      splitInsurersAllowed: prefs.split_insurers_allowed,
      excludedInsurerIds: prefs.excluded_insurer_ids,
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
