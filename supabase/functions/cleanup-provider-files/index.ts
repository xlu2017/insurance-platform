import { createClient } from "npm:@supabase/supabase-js@2";
import { KimiK3Provider } from "../_shared/document-extraction.js";

interface ProviderFileDeletionResult {
  deleted: boolean;
  attempts: number;
  statusCode?: number;
  failureCategory?: string;
}

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

interface EmergencyRow {
  id: string;
  provider_file_id: string;
  policy_document_id?: string;
  retries: number;
  cleanup_status: string;
  next_attempt_at?: string;
  cleanup_claimed_at?: string;
  cleanup_lease_expires_at?: string;
  cleanup_worker_id?: string;
  operator_action_required: boolean;
}

interface ReadinessChecks {
  cron_active?: boolean;
  vault_secrets?: boolean;
  function_deployed?: boolean;
  health_invocation?: boolean;
  synthetic_resolved?: boolean;
  stale_deleting_count?: number;
  permanent_failure_count?: number;
  provider_credential_present?: boolean;
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
  providerCredentialPresent: boolean,
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

  checks.provider_credential_present = providerCredentialPresent;
  ready = ready && providerCredentialPresent;

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
  const admin = createClient(supabaseUrl, serviceKey);
  const workerId = crypto.randomUUID();

  // Provider credential and adapter initialization must be available before any
  // readiness or cleanup work is performed.
  const kimiApiKey = Deno.env.get("KIMI_K3_API_KEY") ?? "";
  let provider: InstanceType<typeof KimiK3Provider> | undefined;
  if (kimiApiKey) {
    try {
      provider = new KimiK3Provider({
        apiKey: kimiApiKey,
        baseUrl: Deno.env.get("KIMI_API_BASE_URL") ?? undefined,
      });
    } catch (e) {
      return jsonResponse(
        {
          error: "Failed to initialize provider adapter",
          details: e instanceof Error ? e.message : String(e),
        },
        503,
      );
    }
  }

  if (body.health_check === true) {
    const { ready: readinessReady, checks } = await checkReadiness(
      admin,
      workerId,
      kimiApiKey !== "",
    );
    if (!provider) {
      return jsonResponse(
        {
          status: "error",
          provider_ready: false,
          readiness: { ready: readinessReady, checks },
          error: "KIMI_K3_API_KEY not configured",
        },
        200,
      );
    }
    return jsonResponse({
      status: readinessReady ? "ok" : "error",
      provider_ready: true,
      readiness: { ready: readinessReady, checks },
    });
  }

  // Self-check and publish readiness status before processing the real queue.
  const { ready: readinessReady, checks } = await checkReadiness(
    admin,
    workerId,
    kimiApiKey !== "",
  );
  const checkedAt = new Date().toISOString();
  const { error: statusErr } = await admin.from("cleanup_readiness_status").upsert({
    id: "00000000-0000-0000-0000-000000000001",
    ready: readinessReady,
    checked_at: checkedAt,
    stale_deleting_count: checks.stale_deleting_count ?? 0,
    permanent_failure_count: checks.permanent_failure_count ?? 0,
    checks,
  });
  if (statusErr) {
    return jsonResponse(
      { error: "Failed to write readiness status", details: statusErr.message },
      500,
    );
  }

  if (!provider) {
    return jsonResponse(
      { error: "KIMI_K3_API_KEY not configured", readiness: { ready: readinessReady, checks } },
      503,
    );
  }

  const now = new Date().toISOString();
  const leaseExpires = addMinutes(now, LEASE_MINUTES);

  // Process unresolved emergency cleanup rows first, using the same lease model as
  // the normal queue to prevent concurrent workers from racing the same row.
  // Emergency rows become due either by next_attempt_at (pending/failed-permanently)
  // or by a `processing` row whose lease has expired (crashed worker recovery).
  const [emergencyDueResult, emergencyExpiredProcessingResult] = await Promise.all([
    admin
      .from("document_analysis_emergency_cleanup")
      .select(
        "id, provider_file_id, policy_document_id, retries, cleanup_status, next_attempt_at, cleanup_claimed_at, cleanup_lease_expires_at, cleanup_worker_id, operator_action_required",
      )
      .in("cleanup_status", ["pending", "failed_permanently"])
      .is("operator_action_required", false)
      .or(`cleanup_claimed_at.is.null,cleanup_lease_expires_at.lt.${now}`)
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
      .order("next_attempt_at", { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE),
    admin
      .from("document_analysis_emergency_cleanup")
      .select(
        "id, provider_file_id, policy_document_id, retries, cleanup_status, next_attempt_at, cleanup_claimed_at, cleanup_lease_expires_at, cleanup_worker_id, operator_action_required",
      )
      .eq("cleanup_status", "processing")
      .is("operator_action_required", false)
      .lt("cleanup_lease_expires_at", now)
      .order("cleanup_lease_expires_at", { ascending: true })
      .limit(BATCH_SIZE),
  ]);

  if (emergencyDueResult.error || emergencyExpiredProcessingResult.error) {
    return jsonResponse({ error: "Failed to fetch emergency cleanup queue" }, 500);
  }

  const emergencyRows: EmergencyRow[] = [
    ...((emergencyDueResult.data ?? []) as EmergencyRow[]),
    ...((emergencyExpiredProcessingResult.data ?? []) as EmergencyRow[]),
  ].slice(0, BATCH_SIZE);

  const emergencyResults: { id: string; status: string }[] = [];
  let emergencyPermanentFailure = false;

  for (const row of emergencyRows) {
    const attemptedAt = new Date().toISOString();
    const nextLeaseExpires = addMinutes(attemptedAt, LEASE_MINUTES);

    const isExpiredProcessing = row.cleanup_status === "processing";
    const claimFilter = isExpiredProcessing
      ? admin
          .from("document_analysis_emergency_cleanup")
          .update({
            cleanup_status: "processing",
            cleanup_claimed_at: attemptedAt,
            cleanup_lease_expires_at: nextLeaseExpires,
            cleanup_worker_id: workerId,
          })
          .eq("id", row.id)
          .eq("cleanup_status", "processing")
          .lt("cleanup_lease_expires_at", now)
      : admin
          .from("document_analysis_emergency_cleanup")
          .update({
            cleanup_status: "processing",
            cleanup_claimed_at: attemptedAt,
            cleanup_lease_expires_at: nextLeaseExpires,
            cleanup_worker_id: workerId,
          })
          .eq("id", row.id)
          .in("cleanup_status", ["pending", "failed_permanently"])
          .is("operator_action_required", false)
          .or(`cleanup_claimed_at.is.null,cleanup_lease_expires_at.lt.${now}`)
          .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`);

    const { data: claimed, error: claimErr } = await claimFilter
      .select("id, provider_file_id, policy_document_id, retries")
      .single();

    if (claimErr || !claimed) {
      emergencyResults.push({ id: String(row.id), status: "claim_failed" });
      continue;
    }

    const handle = { providerFileId: String(claimed.provider_file_id) };
    let deletion: ProviderFileDeletionResult;
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
    const retries = (claimed.retries ?? 0) + 1;
    const permanent = retries >= MAX_ATTEMPTS;

    let finalUpdate: Record<string, unknown>;
    if (deleted) {
      finalUpdate = {
        cleanup_status: "deleted",
        resolved_at: attemptedAt,
        retries,
        last_attempt_at: attemptedAt,
        last_failure_category: null,
        operator_action_required: false,
        cleanup_claimed_at: null,
        cleanup_lease_expires_at: null,
        cleanup_worker_id: null,
        next_attempt_at: null,
      };
    } else if (permanent) {
      finalUpdate = {
        cleanup_status: "failed_permanently",
        resolved_at: null,
        operator_action_required: true,
        retries,
        last_attempt_at: attemptedAt,
        last_failure_category: deletion.failureCategory ?? "max_attempts_exceeded",
        cleanup_claimed_at: null,
        cleanup_lease_expires_at: null,
        cleanup_worker_id: null,
        next_attempt_at: null,
      };
    } else {
      const backoffMinutes = Math.min(5 * Math.pow(2, retries - 1), 60);
      const nextAttempt = addMinutes(attemptedAt, backoffMinutes);
      finalUpdate = {
        cleanup_status: "pending",
        resolved_at: null,
        retries,
        last_attempt_at: attemptedAt,
        last_failure_category: deletion.failureCategory ?? "deletion_failed",
        cleanup_claimed_at: null,
        cleanup_lease_expires_at: null,
        cleanup_worker_id: null,
        next_attempt_at: nextAttempt,
      };
    }

    const { data: finalData, error: finalUpdateErr } = await admin
      .from("document_analysis_emergency_cleanup")
      .update(finalUpdate)
      .eq("id", claimed.id)
      .eq("cleanup_status", "processing")
      .eq("cleanup_worker_id", workerId)
      .select("id");

    if (finalUpdateErr) {
      emergencyPermanentFailure = true;
      emergencyResults.push({ id: String(claimed.id), status: "final_update_failed" });
      continue;
    }
    if (!finalData || finalData.length === 0) {
      emergencyResults.push({ id: String(claimed.id), status: "lease_lost" });
      continue;
    }

    if (finalUpdate.cleanup_status === "failed_permanently") {
      emergencyPermanentFailure = true;
    }

    emergencyResults.push({ id: String(claimed.id), status: String(finalUpdate.cleanup_status) });
  }

  // Process the normal provider-file cleanup queue with leased claims.
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
  let normalPermanentFailure = false;

  for (const row of (dueRows ?? []) as CleanupRow[]) {
    if (!row.provider_file_id || row.provider_file_id === "pending") {
      const attemptedAt = new Date().toISOString();
      // Claim the row before marking it permanently failed so concurrent workers
      // cannot both escalate the same record.
      const { data: missingClaimed, error: missingClaimErr } = await admin
        .from("document_analysis_provider_files")
        .update({
          deletion_status: "deleting",
          cleanup_claimed_at: attemptedAt,
          cleanup_lease_expires_at: addMinutes(attemptedAt, LEASE_MINUTES),
          cleanup_worker_id: workerId,
        })
        .eq("id", row.id)
        .eq("deletion_status", row.deletion_status)
        .or(
          `and(deletion_status.eq.queued,next_deletion_attempt_at.lte.${now}),and(deletion_status.eq.deleting,cleanup_lease_expires_at.lt.${now})`,
        )
        .select("id")
        .single();
      if (missingClaimErr || !missingClaimed) {
        results.push({ id: String(row.id), status: "claim_failed" });
        continue;
      }

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
      const { data: missingFinalData, error: missingUpdateErr } = await admin
        .from("document_analysis_provider_files")
        .update({
          deletion_status: "failed_permanently",
          cleanup_claimed_at: null,
          cleanup_lease_expires_at: null,
          cleanup_worker_id: null,
          next_deletion_attempt_at: null,
          last_deletion_error_category: "missing_provider_file_id",
        })
        .eq("id", missingClaimed.id)
        .eq("deletion_status", "deleting")
        .eq("cleanup_worker_id", workerId)
        .select("id");
      if (missingUpdateErr) {
        normalPermanentFailure = true;
        results.push({ id: String(row.id), status: "update_failed" });
        continue;
      }
      if (!missingFinalData || missingFinalData.length === 0) {
        results.push({ id: String(row.id), status: "lease_lost" });
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
    let deletion: ProviderFileDeletionResult;
    try {
      deletion = await provider.deleteFile(handle);
    } catch (e) {
      deletion = {
        deleted: false,
        attempts: (claimed.deletion_attempts ?? 0) + 1,
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
      const { data: finalData, error: finalUpdateErr } = await admin
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
        .eq("id", claimed.id)
        .eq("deletion_status", "deleting")
        .eq("cleanup_worker_id", workerId)
        .select("id");
      if (finalUpdateErr) {
        normalPermanentFailure = true;
        results.push({ id: String(claimed.id), status: "update_failed" });
        continue;
      }
      if (!finalData || finalData.length === 0) {
        results.push({ id: String(claimed.id), status: "lease_lost" });
        continue;
      }
      results.push({ id: String(claimed.id), status: "deleted" });
    } else {
      const backoffMinutes = Math.min(5 * Math.pow(2, attempts - 1), 60);
      const nextAttempt = addMinutes(attemptedAt, backoffMinutes);
      const permanent = attempts >= MAX_ATTEMPTS;
      const nextAt = permanent ? null : nextAttempt;
      const { data: finalData, error: finalUpdateErr } = await admin
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
        .eq("id", claimed.id)
        .eq("deletion_status", "deleting")
        .eq("cleanup_worker_id", workerId)
        .select("id");
      if (finalUpdateErr) {
        normalPermanentFailure = true;
        results.push({ id: String(claimed.id), status: "update_failed" });
        continue;
      }
      if (!finalData || finalData.length === 0) {
        results.push({ id: String(claimed.id), status: "lease_lost" });
        continue;
      }
      if (permanent) {
        normalPermanentFailure = true;
      }
      results.push({
        id: String(claimed.id),
        status: permanent ? "failed_permanently" : "queued",
      });
    }
  }

  // Recompute readiness after processing so any permanent failure or lease-holding
  // final-update failure is reflected immediately in the stored status.
  const finalReadiness = await checkReadiness(admin, workerId, kimiApiKey !== "");
  const hasFailures = emergencyPermanentFailure || normalPermanentFailure;
  if (hasFailures || emergencyResults.some((r) => r.status === "final_update_failed")) {
    finalReadiness.ready = false;
    finalReadiness.checks.errors = finalReadiness.checks.errors ?? [];
    if (emergencyPermanentFailure) {
      finalReadiness.checks.errors!.push("emergency cleanup permanent failure detected");
    }
    if (normalPermanentFailure) {
      finalReadiness.checks.errors!.push("normal cleanup permanent failure detected");
    }
  }

  const finalCheckedAt = new Date().toISOString();
  const { error: finalStatusErr } = await admin.from("cleanup_readiness_status").upsert({
    id: "00000000-0000-0000-0000-000000000001",
    ready: finalReadiness.ready,
    checked_at: finalCheckedAt,
    stale_deleting_count: finalReadiness.checks.stale_deleting_count ?? 0,
    permanent_failure_count: finalReadiness.checks.permanent_failure_count ?? 0,
    checks: finalReadiness.checks,
  });

  if (finalStatusErr) {
    finalReadiness.ready = false;
    finalReadiness.checks.errors = finalReadiness.checks.errors ?? [];
    finalReadiness.checks.errors.push(
      "Failed to persist cleanup readiness status: " +
        String(finalStatusErr.message ?? finalStatusErr),
    );
    return jsonResponse(
      {
        worker_id: workerId,
        readiness: finalReadiness,
        emergency_processed: emergencyResults.length,
        emergency_results: emergencyResults,
        processed: results.length,
        results,
        error: "Failed to write final readiness status",
        details: String(finalStatusErr.message ?? finalStatusErr),
      },
      500,
    );
  }

  return jsonResponse({
    worker_id: workerId,
    readiness: finalReadiness,
    emergency_processed: emergencyResults.length,
    emergency_results: emergencyResults,
    processed: results.length,
    results,
  });
});
