import {
  AutoCoverageDetails,
  type EngineQuote,
  PropertyCoverageDetails,
  type QuoteComponent,
  type QuoteDataSource,
  PaymentFrequency,
  BillingMethod,
  BrokerDirectPreference,
} from "@autopilot/schemas";

export interface DbQuote {
  id: string;
  updated_at: string;
  version: number;
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
    version: number;
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
    coverage?: Record<string, unknown>;
    raw_coverage?: Record<string, unknown>;
    normalized_coverage?: Record<string, unknown>;
    field_provenance?: Record<string, QuoteComponent["fieldProvenance"]>;
    validation_status?: string;
    validation_errors?: { path: string[]; code: string; message: string }[];
    coverage_schema_version?: number;
    data_source?: string;
    validated_at?: string | null;
    validated_by?: string | null;
  }[];
}

export interface QuoteCoverageError {
  quoteId?: string;
  componentId?: string;
  productLine?: string;
  fieldPath?: string;
  message: string;
}

function toFinancialRating(value: string): EngineQuote["insurer"]["financialStrengthRating"] {
  const known = ["unknown", "A_plus", "A", "A_minus", "B_plus", "B_or_lower"] as const;
  return known.includes(value as (typeof known)[number])
    ? (value as EngineQuote["insurer"]["financialStrengthRating"])
    : "unknown";
}

function toPaymentFrequencies(
  values: string[] | undefined | null,
): EngineQuote["insurer"]["paymentFrequencies"] {
  if (!values) return [];
  const parsed: EngineQuote["insurer"]["paymentFrequencies"] = [];
  for (const value of values) {
    const result = PaymentFrequency.safeParse(value);
    if (result.success) parsed.push(result.data);
  }
  return parsed;
}

function toBillingMethods(
  values: string[] | undefined | null,
): EngineQuote["insurer"]["billingMethods"] {
  if (!values) return [];
  const parsed: EngineQuote["insurer"]["billingMethods"] = [];
  for (const value of values) {
    const result = BillingMethod.safeParse(value);
    if (result.success) parsed.push(result.data);
  }
  return parsed;
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
  const row = c.quote_coverages.find((r) => r.validation_status !== "superseded");
  if (!row) {
    return {
      quoteId: undefined,
      componentId: c.id,
      productLine: c.product_line,
      message: "Quote component has no active coverage row",
    };
  }
  const coverage = row.normalized_coverage ?? row.coverage;
  const validationStatus = row.validation_status;
  const validationErrors = row.validation_errors ?? [];
  const provenance: QuoteComponent["provenance"] =
    row.data_source || row.validated_at || row.validated_by || row.coverage_schema_version
      ? {
          dataSource: row.data_source as QuoteDataSource | undefined,
          validatedAt: row.validated_at ?? undefined,
          validatedBy: row.validated_by ?? undefined,
          coverageSchemaVersion: row.coverage_schema_version ?? undefined,
        }
      : undefined;

  const rawCoverage: QuoteComponent["rawCoverage"] =
    ((row.raw_coverage ?? row.coverage) as Record<string, unknown> | undefined) ?? {};
  const fieldProvenance: QuoteComponent["fieldProvenance"] =
    (row.field_provenance as QuoteComponent["fieldProvenance"]) ?? {};

  if (validationStatus !== "valid") {
    return {
      quoteId: undefined,
      componentId: c.id,
      productLine: c.product_line,
      message: `Quote component is ${validationStatus}: ${validationErrorMessage(validationErrors)}`,
    };
  }

  if (c.product_line === "auto") {
    const parsed = AutoCoverageDetails.safeParse(coverage ?? {});
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
      rawCoverage,
      fieldProvenance,
      validationStatus,
      validationErrors,
      provenance,
    };
  }

  const parsed = PropertyCoverageDetails.safeParse(coverage ?? {});
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
    rawCoverage,
    fieldProvenance,
    validationStatus,
    validationErrors,
    provenance,
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

  const dbInsurer = q.insurers;
  if (!dbInsurer) {
    return {
      quoteId: q.id,
      message: "Quote insurer metadata is missing",
    };
  }

  const distribution =
    dbInsurer.distribution === null
      ? null
      : (BrokerDirectPreference.safeParse(dbInsurer.distribution).data ?? null);

  return {
    id: q.id,
    state: q.state as EngineQuote["state"],
    isIncumbent: q.is_incumbent,
    policyFeesCents: q.policy_fees_cents,
    paymentFeesCents: q.payment_fees_cents,
    bundleDiscountCents: q.bundle_discount_cents,
    cancellationChargeCents: q.cancellation_charge_cents,
    underwritingConditions: q.underwriting_conditions,
    components,
    expiresAt: q.expires_at,
    insurer: {
      id: q.insurer_id,
      name: dbInsurer.name,
      financialStrengthRating: toFinancialRating(dbInsurer.financial_strength_rating),
      paymentFrequencies: toPaymentFrequencies(dbInsurer.payment_frequencies),
      billingMethods: toBillingMethods(dbInsurer.billing_methods),
      distribution,
      version: dbInsurer.version,
    },
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
