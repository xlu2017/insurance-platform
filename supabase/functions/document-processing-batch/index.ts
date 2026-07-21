// Durable batch creation, provider-neutral status and asynchronous routing.
import { createClient } from "npm:@supabase/supabase-js@2";
import { documentProcessingRoute } from "../_shared/document-extraction.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonError(message: string, status: number, code = "DOCUMENT_PROCESSING_FAILED") {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function publicBatch(batch: Record<string, unknown>) {
  const internalStatus = String(batch.status);
  const status =
    internalStatus === "queued" || internalStatus === "manual_review"
      ? "reading_policy_documents"
      : internalStatus;
  return {
    id: String(batch.id),
    session_id: String(batch.session_id),
    status,
    automatic_processing: batch.mode_snapshot === "dangerous",
    document_count: Number(batch.document_count ?? 0),
    unique_document_count: Number(batch.unique_document_count ?? 0),
    deduplicated_count: Number(batch.deduplicated_count ?? 0),
    retryable: Boolean(batch.retryable),
    is_terminal:
      internalStatus === "ready_for_review" ||
      internalStatus === "additional_information_required" ||
      internalStatus === "processing_unavailable" ||
      internalStatus === "manual_review",
    created_at: String(batch.created_at),
  };
}

async function ensureManualReviewCase(admin: any, householdId: string): Promise<string> {
  const { data: existing } = await admin
    .from("optimization_cases")
    .select("id, state")
    .eq("household_id", householdId)
    .in("state", ["awaiting_documents", "extracting_information"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    if (existing.state === "awaiting_documents") {
      await admin
        .from("optimization_cases")
        .update({ state: "extracting_information" })
        .eq("id", existing.id);
    }
    return String(existing.id);
  }
  const { data: created, error } = await admin
    .from("optimization_cases")
    .insert({ household_id: householdId, state: "extracting_information" })
    .select("id")
    .single();
  if (error || !created) throw new Error("Failed to create manual review case");
  return String(created.id);
}

async function dispatchExtraction(
  admin: any,
  authHeader: string,
  householdId: string,
  batchId: string,
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/extract-policy-entities`,
      {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ household_id: householdId, batch_id: batchId }),
      },
    );
    if (!response.ok) {
      const retryable = response.status >= 500;
      await admin
        .from("document_processing_batches")
        .update({
          status: "processing_unavailable",
          retryable,
          next_retry_at: retryable ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
          error_code: "DOCUMENT_PROCESSING_FAILED",
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchId)
        .in("status", [
          "queued",
          "reading_policy_documents",
          "comparing_policies",
          "validating_extracted_details",
        ]);
    }
  } catch {
    await admin
      .from("document_processing_batches")
      .update({
        status: "processing_unavailable",
        retryable: true,
        next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        error_code: "DOCUMENT_ANALYSIS_UNAVAILABLE",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId)
      .in("status", [
        "queued",
        "reading_policy_documents",
        "comparing_policies",
        "validating_extracted_details",
      ]);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return jsonError("Method not allowed", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401, "UNAUTHORIZED");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }
  const action = String(body.action ?? "");
  const householdId = String(body.household_id ?? "");
  if (!isUuid(householdId)) return jsonError("Invalid household_id", 400);

  const { data: household } = await supabase
    .from("households")
    .select("id")
    .eq("id", householdId)
    .maybeSingle();
  if (!household) return jsonError("Household not found", 404);

  if (action === "latest") {
    const { data: latest } = await admin
      .from("document_processing_batches")
      .select("*")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return jsonResponse(latest ? publicBatch(latest) : null);
  }

  if (action === "list") {
    const { data: rows } = await admin
      .from("document_processing_batches")
      .select("*")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false });
    return jsonResponse((rows ?? []).map(publicBatch));
  }

  if (action === "create") {
    const clientRequestId = String(body.client_request_id ?? "");
    if (!clientRequestId || clientRequestId.length > 240) {
      return jsonError("Invalid client_request_id", 400);
    }
    const { data: existing } = await admin
      .from("document_processing_batches")
      .select("*")
      .eq("household_id", householdId)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();
    if (existing) return jsonResponse(publicBatch(existing));

    const { data: setting } = await admin
      .from("household_document_processing_settings")
      .select("*")
      .eq("household_id", householdId)
      .maybeSingle();
    const dangerous = setting?.dangerous_mode_enabled === true;
    const { data: consent } = dangerous
      ? await admin
          .from("document_processing_consent")
          .select("id")
          .eq("household_id", householdId)
          .eq("purpose", "insurance_policy_extraction")
          .eq("status", "active")
          .order("consented_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

    const { data: session, error: sessionError } = await admin
      .from("document_extraction_sessions")
      .insert({ household_id: householdId, created_by: user.id, status: "open" })
      .select("id")
      .single();
    if (sessionError || !session) return jsonError("Failed to create extraction session", 500);

    const { data: batch, error: batchError } = await admin
      .from("document_processing_batches")
      .insert({
        household_id: householdId,
        created_by: user.id,
        client_request_id: clientRequestId,
        session_id: session.id,
        mode_snapshot: dangerous ? "dangerous" : "safe",
        settings_version: Number(setting?.setting_version ?? 1),
        disclosure_version: setting?.disclosure_version ?? null,
        configured_provider: setting?.configured_provider ?? null,
        configured_model_id: setting?.configured_model_id ?? null,
        consent_id: consent?.id ?? null,
        status: "uploading_files",
      })
      .select("*")
      .single();
    if (batchError || !batch) return jsonError("Failed to create document batch", 500);

    await admin.from("audit_events").insert({
      actor_profile_id: user.id,
      action: "document_processing_batch_created",
      entity_type: "document_processing_batch",
      entity_id: batch.id,
      household_id: householdId,
      after_summary: { mode: dangerous ? "automatic" : "manual" },
    });
    return jsonResponse(publicBatch(batch), 201);
  }

  const batchId = String(body.batch_id ?? "");
  if (!isUuid(batchId)) return jsonError("Invalid batch_id", 400);
  const { data: batch } = await admin
    .from("document_processing_batches")
    .select("*")
    .eq("id", batchId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!batch) return jsonError("Document batch not found", 404);

  if (action === "status") {
    const processingStatuses = [
      "reading_policy_documents",
      "comparing_policies",
      "validating_extracted_details",
    ];
    const leaseExpired =
      batch.worker_lease_expires_at &&
      new Date(String(batch.worker_lease_expires_at)).getTime() <= Date.now();
    if (processingStatuses.includes(String(batch.status)) && leaseExpired) {
      const { data: reclaimed } = await admin
        .from("document_processing_batches")
        .update({
          status: "processing_unavailable",
          retryable: true,
          next_retry_at: new Date().toISOString(),
          error_code: "WORKER_LEASE_EXPIRED",
          completed_at: new Date().toISOString(),
          worker_lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchId)
        .eq("worker_lease_expires_at", batch.worker_lease_expires_at)
        .select("*")
        .maybeSingle();
      if (reclaimed) return jsonResponse(publicBatch(reclaimed));
    }
    return jsonResponse(publicBatch(batch));
  }
  if (action !== "submit" && action !== "retry") return jsonError("Invalid action", 400);

  const { data: items } = await admin
    .from("document_processing_batch_items")
    .select("policy_document_id")
    .eq("batch_id", batchId);
  const documentIds = Array.from(
    new Set((items ?? []).map((item: { policy_document_id: string }) => item.policy_document_id)),
  );
  if (documentIds.length === 0) return jsonError("The batch has no uploaded documents", 400);

  if (batch.status === "ready_for_review" || batch.status === "manual_review") {
    return jsonResponse(publicBatch(batch));
  }
  if (
    action === "submit" &&
    ["reading_policy_documents", "comparing_policies", "validating_extracted_details"].includes(
      String(batch.status),
    )
  ) {
    return jsonResponse(publicBatch(batch), 202);
  }
  if (action === "retry" && batch.status === "queued") {
    return jsonResponse(publicBatch(batch), 202);
  }
  if (
    action === "retry" &&
    !(batch.status === "processing_unavailable" && batch.retryable === true)
  ) {
    return jsonError("This batch is not retryable", 409);
  }

  const processingRoute = documentProcessingRoute(
    batch.mode_snapshot === "dangerous" ? "dangerous" : "safe",
  );
  if (!processingRoute.dispatchExternalProcessing) {
    const manualCaseId = await ensureManualReviewCase(admin, householdId);
    await Promise.all([
      admin
        .from("document_processing_batches")
        .update({
          status: "manual_review",
          manual_case_id: manualCaseId,
          retryable: false,
          submitted_at: batch.submitted_at ?? new Date().toISOString(),
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", batchId),
      admin.from("policy_documents").update({ status: "in_review" }).in("id", documentIds),
      admin.from("audit_events").insert({
        actor_profile_id: user.id,
        action: "document_batch_assigned_for_manual_review",
        entity_type: "document_processing_batch",
        entity_id: batchId,
        household_id: householdId,
        after_summary: { document_count: documentIds.length },
      }),
    ]);
    const { data: updated } = await admin
      .from("document_processing_batches")
      .select("*")
      .eq("id", batchId)
      .single();
    return jsonResponse(publicBatch(updated));
  }

  const now = new Date().toISOString();
  const { data: queued, error: queueError } = await admin
    .from("document_processing_batches")
    .update({
      status: "queued",
      retryable: true,
      retry_count: action === "retry" ? Number(batch.retry_count ?? 0) + 1 : batch.retry_count,
      submitted_at: batch.submitted_at ?? now,
      completed_at: null,
      error_code: null,
      next_retry_at: null,
      worker_claimed_at: null,
      worker_lease_expires_at: null,
      updated_at: now,
    })
    .eq("id", batchId)
    .select("*")
    .single();
  if (queueError || !queued) return jsonError("Failed to queue document processing", 500);

  const runtime = (
    globalThis as unknown as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }
  ).EdgeRuntime;
  if (!runtime?.waitUntil) {
    await admin
      .from("document_processing_batches")
      .update({
        status: "processing_unavailable",
        retryable: true,
        error_code: "WORKER_UNAVAILABLE",
      })
      .eq("id", batchId);
    return jsonError(
      "Document processing is temporarily unavailable",
      503,
      "DOCUMENT_ANALYSIS_UNAVAILABLE",
    );
  }
  const work = dispatchExtraction(admin, authHeader, householdId, batchId);
  runtime.waitUntil(work);
  return jsonResponse(publicBatch(queued), 202);
});
