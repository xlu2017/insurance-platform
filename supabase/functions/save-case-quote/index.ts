// Atomic, validated quote-write boundary for the admin and operations UI.
//
// Operations or admin users submit a complete quote aggregate. The function
// authenticates the caller, verifies case access, validates every field and
// coverage object with strict Zod schemas, checks that each component maps to a
// household asset of the right product line, classifies each component as
// draft/incomplete/invalid/valid using structured Zod issue metadata, and calls
// the internal service-role-only RPC persist_case_quote_v2.
//
// The explicit saveIntent boundary controls whether a request is accepted as a
// draft or must be fully validated before persistence:
//   - "draft": permits incomplete coverage, classifies issues, persists the raw
//     input, never produces normalized engine input.
//   - "validate": requires every component to be strictly valid; on any issue
//     it returns 422 and leaves the quote unchanged.
//
// No part of the quote, component, or coverage aggregate is written unless the
// whole transaction succeeds.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  AutoCoverageDetails,
  PropertyCoverageDetails,
  QuoteDataSource,
  QuoteSaveIntent,
  SaveCaseQuoteRequest,
  type QuoteComponentDraft,
} from "../_shared/autopilot.js";

const COVERAGE_SCHEMA_VERSION = 2;

interface ValidationIssue {
  path: string[];
  code: string;
  expected?: string;
  received: unknown;
  message: string;
}

interface ClassifiedComponent {
  component_id?: string;
  product_line: "auto" | "property";
  asset_id: string;
  annual_premium_cents: number;
  raw_coverage: Record<string, unknown>;
  normalized_coverage: Record<string, unknown> | null;
  validation_status: "draft" | "incomplete" | "invalid" | "valid";
  validation_errors: ValidationIssue[];
  coverage_schema_version: number;
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

function toValidationIssue(issue: {
  path: (string | number)[];
  message: string;
  code?: string;
  expected?: string;
  received?: unknown;
}): ValidationIssue {
  return {
    path: issue.path.map(String),
    code: issue.code ?? "invalid",
    expected: issue.expected,
    received: issue.received,
    message: issue.message,
  };
}

function classifyStatus(issues: ValidationIssue[]): ClassifiedComponent["validation_status"] {
  if (issues.length === 0) return "valid";
  const incomplete = issues.some((issue) => {
    if (issue.received === undefined) return true;
    if (issue.received === "unknown" || issue.received === "" || issue.received === null)
      return true;
    if (
      issue.code === "invalid_type" &&
      (issue.received === "undefined" || issue.received === undefined)
    ) {
      return true;
    }
    if (issue.code === "unknown_value" || issue.code === "too_small" || issue.code === "too_big") {
      return true;
    }
    return false;
  });
  return incomplete ? "incomplete" : "invalid";
}

function validateCoverage(
  productLine: "auto" | "property",
  coverage: Record<string, unknown>,
): ValidationIssue[] {
  const schema = productLine === "auto" ? AutoCoverageDetails : PropertyCoverageDetails;
  const parsed = schema.safeParse(coverage);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) =>
    toValidationIssue({
      path: ["coverage", ...issue.path],
      code: issue.code,
      expected: String(issue.expected),
      received: issue.received,
      message: issue.message,
    }),
  );
}

function normalizeCoverage(
  productLine: "auto" | "property",
  coverage: Record<string, unknown>,
): Record<string, unknown> | null {
  const schema = productLine === "auto" ? AutoCoverageDetails : PropertyCoverageDetails;
  const parsed = schema.safeParse(coverage);
  return parsed.success ? (parsed.data as Record<string, unknown>) : null;
}

function validateAndClassifyComponent(
  component: QuoteComponentDraft,
  householdAssets: { vehicleIds: Set<string>; propertyIds: Set<string> },
  saveIntent: "draft" | "validate",
): ClassifiedComponent {
  const issues: ValidationIssue[] = [];

  if (component.productLine === "auto" && !householdAssets.vehicleIds.has(component.assetId)) {
    issues.push({
      path: ["assetId"],
      code: "cross_household_asset",
      received: component.assetId,
      message: "Asset is not a vehicle belonging to the case household.",
    });
  } else if (
    component.productLine === "property" &&
    !householdAssets.propertyIds.has(component.assetId)
  ) {
    issues.push({
      path: ["assetId"],
      code: "cross_household_asset",
      received: component.assetId,
      message: "Asset is not a property belonging to the case household.",
    });
  }

  issues.push(...validateCoverage(component.productLine, component.coverage));

  // Unknown enum values mean the operator has not supplied the required fact.
  const cov = component.coverage as Record<string, unknown>;
  if (component.productLine === "auto") {
    if (cov.coverageForm === "unknown") {
      issues.push({
        path: ["coverage", "coverageForm"],
        code: "unknown_value",
        received: "unknown",
        message: "Auto coverage form must be specified.",
      });
    }
    if (cov.vehicleClass === "unknown") {
      issues.push({
        path: ["coverage", "vehicleClass"],
        code: "unknown_value",
        received: "unknown",
        message: "Vehicle use class must be specified.",
      });
    }
    if (cov.financingStatus === "unknown") {
      issues.push({
        path: ["coverage", "financingStatus"],
        code: "unknown_value",
        received: "unknown",
        message: "Financing status must be specified.",
      });
    }
  } else {
    if (cov.coverageForm === "unknown") {
      issues.push({
        path: ["coverage", "coverageForm"],
        code: "unknown_value",
        received: "unknown",
        message: "Property coverage form must be specified.",
      });
    }
    if (cov.propertyType === "unknown") {
      issues.push({
        path: ["coverage", "propertyType"],
        code: "unknown_value",
        received: "unknown",
        message: "Property type must be specified.",
      });
    }
    if (cov.settlementBasis === "unknown") {
      issues.push({
        path: ["coverage", "settlementBasis"],
        code: "unknown_value",
        received: "unknown",
        message: "Settlement basis must be specified.",
      });
    }
  }

  const classification = classifyStatus(issues);
  const normalized =
    saveIntent === "validate" && classification === "valid"
      ? normalizeCoverage(component.productLine, component.coverage)
      : null;

  // A draft is never promoted to valid, even when the coverage is complete;
  // it remains raw input only.
  const validation_status: ClassifiedComponent["validation_status"] =
    saveIntent === "draft"
      ? classification === "valid"
        ? "draft"
        : classification
      : classification;

  return {
    component_id: component.componentId,
    product_line: component.productLine,
    asset_id: component.assetId,
    annual_premium_cents: component.annualPremiumCents,
    raw_coverage: component.coverage as Record<string, unknown>,
    normalized_coverage: normalized,
    validation_status,
    validation_errors: issues,
    coverage_schema_version: COVERAGE_SCHEMA_VERSION,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ code: "METHOD_NOT_ALLOWED", message: "Only POST is allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonResponse({ code: "UNAUTHORIZED", message: "Missing or invalid authorization" }, 401);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["operations", "admin"].includes(profile.role)) {
    return jsonResponse(
      { code: "FORBIDDEN", message: "Only operations or admin staff may save quotes" },
      403,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: "INVALID_JSON", message: "Request body is not valid JSON" }, 400);
  }

  const parsedRequest = SaveCaseQuoteRequest.safeParse(body);
  if (!parsedRequest.success) {
    return jsonResponse(
      {
        code: "INVALID_INPUT",
        message: "Request does not match SaveCaseQuoteRequest",
        issues: parsedRequest.error.issues,
      },
      400,
    );
  }

  const request = parsedRequest.data;
  const saveIntent = request.saveIntent;
  if (!QuoteSaveIntent.safeParse(saveIntent).success) {
    return jsonResponse(
      { code: "INVALID_SAVE_INTENT", message: "saveIntent must be 'draft' or 'validate'" },
      400,
    );
  }

  const { data: canAccess } = await supabase.rpc("can_access_case_for_profile", {
    p_case_id: request.caseId,
    p_profile_id: user.id,
  });
  if (!canAccess) {
    return jsonResponse({ code: "CASE_ACCESS_DENIED", message: "Cannot access this case" }, 403);
  }

  const { data: caseRow, error: caseErr } = await service
    .from("optimization_cases")
    .select("household_id")
    .eq("id", request.caseId)
    .single();
  if (caseErr || !caseRow) {
    return jsonResponse(
      { code: "CASE_NOT_FOUND", message: caseErr?.message ?? "Case not found" },
      404,
    );
  }

  const [{ data: vehicles }, { data: properties }, { data: insurer }] = await Promise.all([
    service.from("vehicles").select("id").eq("household_id", caseRow.household_id),
    service.from("properties").select("id").eq("household_id", caseRow.household_id),
    service.from("insurers").select("id").eq("id", request.insurerId).single(),
  ]);

  if (!insurer) {
    return jsonResponse(
      { code: "INSURER_NOT_FOUND", message: "Selected insurer does not exist" },
      400,
    );
  }

  const householdAssets = {
    vehicleIds: new Set((vehicles ?? []).map((v) => v.id)),
    propertyIds: new Set((properties ?? []).map((p) => p.id)),
  };

  if (!QuoteDataSource.safeParse(request.dataSource).success) {
    return jsonResponse(
      { code: "INVALID_DATA_SOURCE", message: "Unsupported quote data source" },
      400,
    );
  }

  const classifiedComponents = request.components.map((component) =>
    validateAndClassifyComponent(component as QuoteComponentDraft, householdAssets, saveIntent),
  );

  if (saveIntent === "validate") {
    const invalidComponents = classifiedComponents.filter((c) => c.validation_status !== "valid");
    if (invalidComponents.length > 0) {
      return jsonResponse(
        {
          code: "QUOTE_VALIDATION_FAILED",
          message: "One or more components failed validation; the quote was not saved.",
          components: invalidComponents,
        },
        422,
      );
    }
  }

  const rpcBody = {
    p_case_id: request.caseId,
    p_actor_profile_id: user.id,
    p_quote_id: request.quoteId ?? null,
    p_expected_version: request.expectedVersion ?? null,
    p_insurer_id: request.insurerId,
    p_state: request.state,
    p_is_incumbent: request.isIncumbent,
    p_expires_at: request.expiresAt ?? null,
    p_policy_fees_cents: request.policyFeesCents,
    p_payment_fees_cents: request.paymentFeesCents,
    p_bundle_discount_cents: request.bundleDiscountCents,
    p_cancellation_charge_cents: request.cancellationChargeCents,
    p_underwriting_conditions: request.underwritingConditions,
    p_data_source: request.dataSource,
    p_components: classifiedComponents,
  };

  const { data: persisted, error: rpcError } = await service.rpc("persist_case_quote_v2", rpcBody);
  if (rpcError) {
    return jsonResponse(
      { code: "PERSIST_FAILED", message: rpcError.message },
      /version|stale|conflict/i.test(rpcError.message) ? 409 : 500,
    );
  }

  const statuses = classifiedComponents.map((c) => c.validation_status);
  const aggregateStatus: string = statuses.includes("invalid")
    ? "invalid"
    : statuses.includes("incomplete")
      ? "incomplete"
      : saveIntent === "draft"
        ? "draft"
        : "valid";

  return jsonResponse({
    success: true,
    quoteId: (persisted as { quoteId?: string })?.quoteId,
    version: (persisted as { version?: number })?.version,
    aggregateStatus,
    saveIntent,
    components: classifiedComponents,
  });
});
