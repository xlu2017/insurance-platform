import { createClient } from "npm:@supabase/supabase-js@2";
import { KimiK3Provider } from "../_shared/document-extraction.js";

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

  const now = new Date().toISOString();
  const { data: dueRows, error: fetchErr } = await admin
    .from("document_analysis_provider_files")
    .select("id, provider_file_id, deletion_attempts, next_deletion_attempt_at, deletion_status")
    .eq("deletion_status", "queued")
    .lte("next_deletion_attempt_at", now)
    .order("next_deletion_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    return jsonResponse({ error: "Failed to fetch cleanup queue" }, 500);
  }

  const results: { id: string; status: string }[] = [];

  for (const row of dueRows ?? []) {
    const { data: claimed, error: claimErr } = await admin
      .from("document_analysis_provider_files")
      .update({ deletion_status: "deleting" })
      .eq("id", row.id)
      .eq("deletion_status", "queued")
      .lte("next_deletion_attempt_at", now)
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
        errorCategory: e instanceof Error ? e.message : "delete_failed",
      };
    }

    const isNotFound =
      !deletion.deleted &&
      (deletion.statusCode === 404 ||
        String(deletion.errorCategory).includes("404") ||
        String(deletion.errorCategory).includes("Not Found"));
    const deleted = deletion.deleted || isNotFound;
    const attemptedAt = new Date().toISOString();
    const attempts = (claimed.deletion_attempts ?? 0) + 1;

    await admin.from("document_analysis_cleanup_attempts").insert({
      file_id: claimed.id,
      attempted_at: attemptedAt,
      status_code: deletion.statusCode ?? null,
      failure_category: deletion.errorCategory ?? null,
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
        })
        .eq("id", claimed.id);
      results.push({ id: String(claimed.id), status: "deleted" });
    } else {
      const nextAttempt = new Date();
      const backoffMinutes = Math.min(5 * Math.pow(2, attempts - 1), 60);
      nextAttempt.setMinutes(nextAttempt.getMinutes() + backoffMinutes);
      const permanent = attempts >= MAX_ATTEMPTS;
      const nextAt = permanent ? null : nextAttempt.toISOString();
      await admin
        .from("document_analysis_provider_files")
        .update({
          deletion_status: permanent ? "failed_permanently" : "queued",
          deletion_attempts: attempts,
          last_deletion_error_category: deletion.errorCategory,
          next_deletion_attempt_at: nextAt,
        })
        .eq("id", claimed.id);
      results.push({
        id: String(claimed.id),
        status: permanent ? "failed_permanently" : "queued",
      });
    }
  }

  return jsonResponse({ processed: results.length, results });
});
