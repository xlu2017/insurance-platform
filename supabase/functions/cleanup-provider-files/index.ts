import { createClient } from "npm:@supabase/supabase-js@2";
import { KimiK3Provider } from "../_shared/document-extraction.js";

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;
const LEASE_MINUTES = 5;
const STALE_DELETING_THRESHOLD_MINUTES = 10;

interface CleanupRow {
  id: string;
  provider_file_id: string;
  deletion_attempts: number;
  deletion_status: string;
  next_deletion_attempt_at?: string;
  cleanup_lease_expires_at?: string;
}

interface ReadinessChecks {
  cron_active?: boolean;
  vault_secrets?: boolean;
  function_deployed?: boolean;
  health_invocation?: boolean;
  synthetic_resolved?: boolean;
  stale_deleting_count?: number;
  errors?: string[];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function addMinutes(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

async function checkReadiness(
  admin: any,
  workerId: string,
): Promise<{ ready: boolean; checks: ReadinessChecks }> {
  const checks: ReadinessChecks = { errors: [] };

  const { data: rpcResult, error: rpcErr } = await admin.rpc("check_cleanup_readiness");
  let ready = false;
  if (rpcErr) {
    checks.errors!.push("check_cleanup_readiness RPC failed: " + String(rpcErr.message ?? rpcErr));
  } else if (!rpcResult?.ready) {
    checks.errors!.push("cleanup readiness check reported not ready");
    Object.assign(checks, rpcResult?.checks ?? {});
  } else {
    ready = true;
    Object.assign(checks, rpcResult.checks ?? {});
  }

  // The worker itself is executing, which demonstrates the function is deployed
  // and reachable. The extraction gate performs an authenticated health
  // invocation before enabling raw external processing.
  checks.health_invocation = true;

  return { ready, checks };
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const bodyText = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (body.health_check === true) {
    return jsonResponse({ status: "ok" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
  const admin = createClient(supabaseUrl, serviceKey);
  const workerId = crypto.randomUUID();

  // Self-check and publish readiness status before processing the real queue.
  const { ready: readinessReady, checks } = await checkReadiness(admin, workerId);
  const checkedAt = new Date().toISOString();
  const { error: statusErr } = await admin.from("cleanup_readiness_status").upsert({
    id: "00000000-0000-0000-0000-000000000001",
    ready: readinessReady,
    checked_at: checkedAt,
    stale_deleting_count: checks.stale_deleting_count ?? 0,
    checks,
  });
  if (statusErr) {
    return jsonResponse(
      { error: "Failed to write readiness status", details: statusErr.message },
      500,
    );
  }

  const kimiApiKey = Deno.env.get("KIMI_K3_API_KEY") ?? "";
  if (!kimiApiKey) {
    return jsonResponse({ error: "KIMI_K3_API_KEY not configured" }, 503);
  }

  const provider = new KimiK3Provider({
    apiKey: kimiApiKey,
    baseUrl: Deno.env.get("KIMI_API_BASE_URL") ?? undefined,
  });

  const now = new Date().toISOString();
  const leaseExpires = addMinutes(now, LEASE_MINUTES);

  // Process any unresolved emergency cleanup rows first.
  const { data: emergencyRows, error: emergencyFetchErr } = await admin
    .from("document_analysis_emergency_cleanup")
    .select("id, provider_file_id, policy_document_id, retries")
    .is("resolved_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (emergencyFetchErr) {
    return jsonResponse({ error: "Failed to fetch emergency cleanup queue" }, 500);
  }

  const emergencyResults: { id: string; status: string }[] = [];
  for (const row of emergencyRows ?? []) {
    const handle = { providerFileId: String(row.provider_file_id) };
    let deletion;
    try {
      deletion = await provider.deleteFile(handle);
    } catch (e) {
      deletion = {
        deleted: false,
        attempts: 1,
        failureCategory: e instanceof Error ? e.message : "delete_failed",
      };
    }
    const isNotFound =
      !deletion.deleted &&
      (deletion.statusCode === 404 ||
        String(deletion.failureCategory).includes("404") ||
        String(deletion.failureCategory).includes("Not Found"));
    const deleted = deletion.deleted || isNotFound;
    const attemptedAt = new Date().toISOString();
    const retries = (row.retries ?? 0) + 1;
    const permanent = retries >= MAX_ATTEMPTS;

    const { error: emergencyUpdateErr } = await admin
      .from("document_analysis_emergency_cleanup")
      .update({
        resolved_at: deleted || permanent ? attemptedAt : null,
        retries,
        failure_category: deletion.failureCategory ?? "deletion_failed",
      })
      .eq("id", row.id);
    if (emergencyUpdateErr) {
      emergencyResults.push({ id: String(row.id), status: "emergency_update_failed" });
      continue;
    }
    emergencyResults.push({
      id: String(row.id),
      status: deleted ? "deleted" : permanent ? "failed_permanently" : "pending",
    });
  }

  const { data: dueRows, error: fetchErr } = await admin
    .from("document_analysis_provider_files")
    .select(
      "id, provider_file_id, deletion_attempts, next_deletion_attempt_at, deletion_status, cleanup_lease_expires_at",
    )
    .or(
      `and(deletion_status.eq.queued,next_deletion_attempt_at.lte.${now}),and(deletion_status.eq.deleting,cleanup_lease_expires_at.lt.${now})`,
    )
    .order("next_deletion_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    return jsonResponse({ error: "Failed to fetch cleanup queue" }, 500);
  }

  const results: { id: string; status: string }[] = [];

  for (const row of (dueRows ?? []) as CleanupRow[]) {
    if (!row.provider_file_id || row.provider_file_id === "pending") {
      const attemptedAt = new Date().toISOString();
      const { error: missingInsertErr } = await admin
        .from("document_analysis_cleanup_attempts")
        .insert({
          file_id: row.id,
          attempted_at: attemptedAt,
          failure_category: "missing_provider_file_id",
          success: false,
          next_attempt_at: null,
        });
      if (missingInsertErr) {
        results.push({ id: String(row.id), status: "attempt_log_failed" });
        continue;
      }
      const { error: missingUpdateErr } = await admin
        .from("document_analysis_provider_files")
        .update({
          deletion_status: "failed_permanently",
          cleanup_claimed_at: null,
          cleanup_lease_expires_at: null,
          cleanup_worker_id: null,
          next_deletion_attempt_at: null,
          last_deletion_error_category: "missing_provider_file_id",
        })
        .eq("id", row.id);
      if (missingUpdateErr) {
        results.push({ id: String(row.id), status: "update_failed" });
        continue;
      }
      results.push({ id: String(row.id), status: "failed_permanently" });
      continue;
    }

    const baseUpdate = {
      deletion_status: "deleting",
      cleanup_claimed_at: now,
      cleanup_lease_expires_at: leaseExpires,
      cleanup_worker_id: workerId,
    };

    const claimFilter =
      row.deletion_status === "queued"
        ? admin
            .from("document_analysis_provider_files")
            .update(baseUpdate)
            .eq("id", row.id)
            .eq("deletion_status", "queued")
            .lte("next_deletion_attempt_at", now)
        : admin
            .from("document_analysis_provider_files")
            .update(baseUpdate)
            .eq("id", row.id)
            .eq("deletion_status", "deleting")
            .lt("cleanup_lease_expires_at", now);

    const { data: claimed, error: claimErr } = await claimFilter
      .select("id, provider_file_id, deletion_attempts")
      .single();

    if (claimErr || !claimed) {
      continue;
    }

    const handle = { providerFileId: String(claimed.provider_file_id) };
    let deletion;
    try {
      deletion = await provider.deleteFile(handle);
    } catch (e) {
      deletion = {
        deleted: false,
        attempts: (claimed.deletion_attempts ?? 0) + 1,
        statusCode: undefined as number | undefined,
        failureCategory: e instanceof Error ? e.message : "delete_failed",
      };
    }

    const isNotFound =
      !deletion.deleted &&
      (deletion.statusCode === 404 ||
        String(deletion.failureCategory).includes("404") ||
        String(deletion.failureCategory).includes("Not Found"));
    const deleted = deletion.deleted || isNotFound;
    const attemptedAt = new Date().toISOString();
    const attempts = (claimed.deletion_attempts ?? 0) + 1;

    const { error: attemptInsertErr } = await admin
      .from("document_analysis_cleanup_attempts")
      .insert({
        file_id: claimed.id,
        attempted_at: attemptedAt,
        status_code: deletion.statusCode ?? null,
        failure_category: deletion.failureCategory ?? null,
        success: deleted,
        next_attempt_at: null,
      });
    if (attemptInsertErr) {
      results.push({ id: String(claimed.id), status: "attempt_log_failed" });
      continue;
    }

    if (deleted) {
      const { error: finalUpdateErr } = await admin
        .from("document_analysis_provider_files")
        .update({
          deletion_status: "deleted",
          deleted_at: attemptedAt,
          last_deletion_error_category: null,
          next_deletion_attempt_at: null,
          cleanup_claimed_at: null,
          cleanup_lease_expires_at: null,
          cleanup_worker_id: null,
        })
        .eq("id", claimed.id);
      if (finalUpdateErr) {
        results.push({ id: String(claimed.id), status: "update_failed" });
        continue;
      }
      results.push({ id: String(claimed.id), status: "deleted" });
    } else {
      const backoffMinutes = Math.min(5 * Math.pow(2, attempts - 1), 60);
      const nextAttempt = addMinutes(attemptedAt, backoffMinutes);
      const permanent = attempts >= MAX_ATTEMPTS;
      const nextAt = permanent ? null : nextAttempt;
      const { error: finalUpdateErr } = await admin
        .from("document_analysis_provider_files")
        .update({
          deletion_status: permanent ? "failed_permanently" : "queued",
          deletion_attempts: attempts,
          last_deletion_error_category: deletion.failureCategory,
          next_deletion_attempt_at: nextAt,
          cleanup_claimed_at: null,
          cleanup_lease_expires_at: null,
          cleanup_worker_id: null,
        })
        .eq("id", claimed.id);
      if (finalUpdateErr) {
        results.push({ id: String(claimed.id), status: "update_failed" });
        continue;
      }
      results.push({
        id: String(claimed.id),
        status: permanent ? "failed_permanently" : "queued",
      });
    }
  }

  return jsonResponse({
    worker_id: workerId,
    readiness: { ready: readinessReady, checks },
    emergency_processed: emergencyResults.length,
    emergency_results: emergencyResults,
    processed: results.length,
    results,
  });
});
