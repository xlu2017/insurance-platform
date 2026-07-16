import {
  AutoCoverageDetails,
  type EngineQuote,
  PropertyCoverageDetails,
  type QuoteComponent,
} from "@autopilot/schemas";

export interface DbQuote {
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
  quote_policy_components: DbQuotePolicyComponent[];
}

export interface DbQuotePolicyComponent {
  id: string;
  product_line: "auto" | "property";
  annual_premium_cents: number;
  asset_id: string | null;
  quote_coverages: {
    coverage: Record<string, unknown>;
    validation_status?: string;
    validation_errors?: { path: string[]; code: string; message: string }[];
    coverage_schema_version?: number;
    data_source?: string;
  }[];
}

export interface QuoteCoverageError {
  quoteId?: string;
  componentId?: string;
  productLine?: string;
  fieldPath?: string;
  message: string;
}

function first<T>(arr: T[] | undefined | null): T | undefined {
  return arr && arr.length > 0 ? arr[0] : undefined;
}

function toFinancialRating(value: string): EngineQuote["insurerFinancialRating"] {
  const known = ["unknown", "A_plus", "A", "A_minus", "B_plus", "B_or_lower"] as const;
  return known.includes(value as (typeof known)[number])
    ? (value as EngineQuote["insurerFinancialRating"])
    : "unknown";
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

function formatZodIssues(
  basePath: string,
  issues: { path: (string | number)[]; message: string }[],
): string {
  return issues.map((issue) => `${basePath}.${issue.path.join(".")}: ${issue.message}`).join("; ");
}

function validationErrorMessage(
  errors: { path?: string[]; code?: string; message: string }[],
): string {
  return errors.map((e) => `${e.path?.join(".") ?? ""}: ${e.message}`).join("; ");
}

function toComponent(c: DbQuotePolicyComponent): QuoteComponent | QuoteCoverageError {
  const row = c.quote_coverages[0] ?? { coverage: {} };
  const coverage = row.coverage ?? {};
  const validationStatus = row.validation_status ?? "valid";
  const validationErrors = row.validation_errors ?? [];

  if (validationStatus !== "valid") {
    return {
      quoteId: undefined,
      componentId: c.id,
      productLine: c.product_line,
      message: `Quote component is ${validationStatus}: ${validationErrorMessage(validationErrors)}`,
    };
  }

  if (c.product_line === "auto") {
    const parsed = AutoCoverageDetails.safeParse(coverage);
    if (!parsed.success) {
      return {
        quoteId: undefined,
        componentId: c.id,
        productLine: c.product_line,
        message: `Auto coverage validation failed: ${formatZodIssues("auto", parsed.error.issues)}`,
      };
    }
    return {
      id: c.id,
      productLine: "auto",
      assetId: c.asset_id ?? undefined,
      annualPremiumCents: c.annual_premium_cents,
      auto: parsed.data,
      property: null,
      validationStatus,
      validationErrors,
    };
  }

  const parsed = PropertyCoverageDetails.safeParse(coverage);
  if (!parsed.success) {
    return {
      quoteId: undefined,
      componentId: c.id,
      productLine: c.product_line,
      message: `Property coverage validation failed: ${formatZodIssues("property", parsed.error.issues)}`,
    };
  }
  return {
    id: c.id,
    productLine: "property",
    assetId: c.asset_id ?? undefined,
    annualPremiumCents: c.annual_premium_cents,
    auto: null,
    property: parsed.data,
    validationStatus,
    validationErrors,
  };
}

export function toEngineQuote(q: DbQuote): EngineQuote | QuoteCoverageError {
  const components: QuoteComponent[] = [];
  for (const c of q.quote_policy_components) {
    const result = toComponent(c);
    if ("message" in result) {
      return { ...result, quoteId: q.id };
    }
    components.push(result);
  }

  const insurer = q.insurers;
  const paymentFrequency = first(insurer?.payment_frequencies);
  const billingMethod = first(insurer?.billing_methods);
  const distributionChannel =
    insurer?.distribution === "broker"
      ? "broker"
      : insurer?.distribution === "direct"
        ? "direct"
        : undefined;

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
    insurerFinancialRating: insurer ? toFinancialRating(insurer.financial_strength_rating) : "unknown",
  };
}

export function collectQuoteCoverageErrors(dbQuotes: DbQuote[]): QuoteCoverageError[] {
  const errors: QuoteCoverageError[] = [];
  for (const q of dbQuotes) {
    const result = toEngineQuote(q);
    if ("message" in result) {
      errors.push(result);
    }
  }
  return errors;
}
