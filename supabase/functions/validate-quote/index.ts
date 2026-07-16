// Validated quote-write boundary for quote coverages.
// Authenticated operations or admin users can submit a quote component coverage payload.
// The function validates the schema, verifies component-to-asset integrity, classifies the
// coverage as valid/incomplete/invalid, records validation errors, and writes an audit event.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  AutoCoverageDetails,
  PropertyCoverageDetails,
  QuoteComponent,
} from "../_shared/autopilot.js";

const COVERAGE_SCHEMA_VERSION = 2;

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

function formatZodIssues(
  issues: { path: (string | number)[]; message: string }[],
): { path: string[]; code: string; message: string }[] {
  return issues.map((issue) => ({
    path: issue.path.map(String),
    code: "invalid",
    message: issue.message,
  }));
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
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
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
      { code: "FORBIDDEN", message: "Only operations or admin staff may validate quotes" },
      403,
    );
  }

  let body: {
    quote_component_id?: string;
    coverage?: Record<string, unknown>;
    data_source?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: "INVALID_JSON", message: "Request body is not valid JSON" }, 400);
  }

  const componentId = body.quote_component_id;
  if (!componentId || typeof componentId !== "string") {
    return jsonResponse({ code: "INVALID_INPUT", message: "quote_component_id is required" }, 400);
  }

  const { data: component, error: componentErr } = await service
    .from("quote_policy_components")
    .select("id, quote_id, product_line, asset_id, quotes!inner(case_id)")
    .eq("id", componentId)
    .single();
  if (componentErr || !component) {
    return jsonResponse({ code: "COMPONENT_NOT_FOUND", message: "Quote component not found" }, 404);
  }

  const quoteCaseId = (component.quotes as unknown as { case_id: string }).case_id;

  const { data: canAccess } = await supabase.rpc("can_access_case_for_profile", {
    p_case_id: quoteCaseId,
    p_profile_id: user.id,
  });
  if (!canAccess) {
    return jsonResponse({ code: "CASE_ACCESS_DENIED", message: "Cannot access this case" }, 403);
  }

  const productLine = component.product_line;
  const coverage = body.coverage ?? {};
  const parsed =
    productLine === "auto"
      ? AutoCoverageDetails.safeParse(coverage)
      : PropertyCoverageDetails.safeParse(coverage);

  let validationStatus: "valid" | "incomplete" | "invalid" = "valid";
  let validationErrors: { path: string[]; code: string; message: string }[] = [];

  if (!parsed.success) {
    validationErrors = formatZodIssues(parsed.error.issues);
    validationStatus = validationErrors.some((e) => e.message.toLowerCase().includes("required"))
      ? "incomplete"
      : "invalid";
  }

  // Verify exactly one coverage row exists for the component.
  const { data: existingRows, error: listErr } = await service
    .from("quote_coverages")
    .select("id")
    .eq("quote_component_id", componentId);
  if (listErr) {
    return jsonResponse({ code: "DATABASE_ERROR", message: listErr.message }, 500);
  }
  if ((existingRows?.length ?? 0) > 1) {
    return jsonResponse(
      { code: "MULTIPLE_COVERAGES", message: "Component has multiple active coverage rows" },
      400,
    );
  }

  const existingId = existingRows?.[0]?.id;
  const coverageSchema = productLine === "auto" ? AutoCoverageDetails : PropertyCoverageDetails;
  const quoteComponentResult = QuoteComponent.safeParse({
    id: component.id,
    productLine,
    assetId: component.asset_id,
    annualPremiumCents: 0,
    [productLine === "auto" ? "auto" : "property"]: parsed.success ? parsed.data : null,
    [productLine === "auto" ? "property" : "auto"]: null,
    validationStatus,
    validationErrors,
  });

  if (!quoteComponentResult.success) {
    validationErrors = [...validationErrors, ...formatZodIssues(quoteComponentResult.error.issues)];
    validationStatus = "invalid";
  }

  const now = new Date().toISOString();
  const payload = {
    quote_component_id: componentId,
    coverage: coverage,
    validation_status: validationStatus,
    validation_errors: validationErrors,
    validated_at: now,
    validated_by: user.id,
    coverage_schema_version: COVERAGE_SCHEMA_VERSION,
    data_source: body.data_source ?? "validate-quote-edge-function",
  };

  let coverageId: string;
  if (existingId) {
    const { data: updated, error: updErr } = await service
      .from("quote_coverages")
      .update(payload)
      .eq("id", existingId)
      .select("id")
      .single();
    if (updErr || !updated) {
      return jsonResponse(
        { code: "UPDATE_FAILED", message: updErr?.message ?? "Unknown update error" },
        500,
      );
    }
    coverageId = updated.id;
  } else {
    const { data: inserted, error: insErr } = await service
      .from("quote_coverages")
      .insert(payload)
      .select("id")
      .single();
    if (insErr || !inserted) {
      return jsonResponse(
        { code: "INSERT_FAILED", message: insErr?.message ?? "Unknown insert error" },
        500,
      );
    }
    coverageId = inserted.id;
  }

  await service.from("audit_events").insert({
    actor_profile_id: user.id,
    actor_role: profile.role,
    action: "quote_coverage_validated",
    entity_type: "quote_coverage",
    entity_id: coverageId,
    case_id: quoteCaseId,
    after_summary: {
      quote_component_id: componentId,
      validation_status: validationStatus,
      coverage_schema_version: COVERAGE_SCHEMA_VERSION,
      data_source: payload.data_source,
    },
  });

  return jsonResponse(
    {
      success: true,
      quote_component_id: componentId,
      quote_coverage_id: coverageId,
      validation_status: validationStatus,
      validation_errors: validationErrors,
      coverage_schema_version: COVERAGE_SCHEMA_VERSION,
    },
    validationStatus === "valid" ? 200 : 422,
  );
});
