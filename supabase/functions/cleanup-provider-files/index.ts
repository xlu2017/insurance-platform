import { createClient } from "npm:@supabase/supabase-js@2";
import { KimiK3Provider } from "../_shared/document-extraction.js";

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;
const LEASE_MINUTES = 5;

interface CleanupRow {
  id: string;
  provider_file_id: string;
  deletion_attempts: number;
  deletion_status: string;
  next_deletion_attempt_at?: string;
  cleanup_lease_expires_at?: string;
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

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
  const admin = createClient(supabaseUrl, serviceKey);

  const kimiApiKey = Deno.env.get("KIMI_K3_API_KEY") ?? "";
  if (!kimiApiKey) {
    return jsonResponse({ error: "KIMI_K3_API_KEY not configured" }, 503);
  }

  const provider = new KimiK3Provider({
    apiKey: kimiApiKey,
    baseUrl: Deno.env.get("KIMI_API_BASE_URL") ?? undefined,
  });

  const workerId = crypto.randomUUID();
  const now = new Date().toISOString();
  const leaseExpires = addMinutes(now, LEASE_MINUTES);

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
      await admin.from("document_analysis_cleanup_attempts").insert({
        file_id: row.id,
        attempted_at: attemptedAt,
        failure_category: "missing_provider_file_id",
        success: false,
        next_attempt_at: null,
      });
      await admin
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
      results.push({ id: String(row.id), status: "failed_permanently" });
      continue;
    }

    const claimFilter =
      row.deletion_status === "queued"
        ? admin
            .from("document_analysis_provider_files")
            .update({
              deletion_status: "deleting",
              cleanup_claimed_at: now,
              cleanup_lease_expires_at: leaseExpires,
              cleanup_worker_id: workerId,
            })
            .eq("id", row.id)
            .eq("deletion_status", "queued")
            .lte("next_deletion_attempt_at", now)
        : admin
            .from("document_analysis_provider_files")
            .update({
              deletion_status: "deleting",
              cleanup_claimed_at: now,
              cleanup_lease_expires_at: leaseExpires,
              cleanup_worker_id: workerId,
            })
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

    await admin.from("document_analysis_cleanup_attempts").insert({
      file_id: claimed.id,
      attempted_at: attemptedAt,
      status_code: deletion.statusCode ?? null,
      failure_category: deletion.failureCategory ?? null,
      success: deleted,
      next_attempt_at: null,
    });

    if (deleted) {
      await admin
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
      results.push({ id: String(claimed.id), status: "deleted" });
    } else {
      const backoffMinutes = Math.min(5 * Math.pow(2, attempts - 1), 60);
      const nextAttempt = addMinutes(attemptedAt, backoffMinutes);
      const permanent = attempts >= MAX_ATTEMPTS;
      const nextAt = permanent ? null : nextAttempt;
      await admin
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
      results.push({
        id: String(claimed.id),
        status: permanent ? "failed_permanently" : "queued",
      });
    }
  }

  return jsonResponse({ worker_id: workerId, processed: results.length, results });
});
