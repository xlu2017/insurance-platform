// Server-side, batch-aware document upload. SHA-256 is calculated before storage
// or external AI transmission. Household duplicates reuse one canonical metadata
// row and one private storage object.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey",
};

const VALID_CATEGORIES = new Set([
  "auto_detect",
  "current_auto_policy",
  "current_property_policy",
  "renewal_notice",
  "competing_quote",
  "proof_of_insurance",
  "signed_authorization",
  "cancellation_confirmation",
  "other",
]);

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ message }), {
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // @ts-ignore Deno accepts Uint8Array views for Web Crypto digest.
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  return ".jpg";
}

async function updateBatchCounts(admin: SupabaseClient, batchId: string): Promise<void> {
  const { data: items } = await admin
    .from("document_processing_batch_items")
    .select("policy_document_id, deduplicated")
    .eq("batch_id", batchId);
  const rows = items ?? [];
  const uniqueIds = new Set(
    rows.map((item: { policy_document_id: string }) => item.policy_document_id),
  );
  await admin
    .from("document_processing_batches")
    .update({
      document_count: rows.length,
      unique_document_count: uniqueIds.size,
      deduplicated_count: rows.filter((item: { deduplicated: boolean }) => item.deduplicated)
        .length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);
}

async function createLegacyBatch(
  admin: SupabaseClient,
  householdId: string,
  actorProfileId: string,
): Promise<string> {
  const { data: setting } = await admin
    .from("household_document_processing_settings")
    .select("*")
    .eq("household_id", householdId)
    .maybeSingle();
  const { data: session, error: sessionError } = await admin
    .from("document_extraction_sessions")
    .insert({ household_id: householdId, created_by: actorProfileId, status: "open" })
    .select("id")
    .single();
  if (sessionError || !session) throw new Error("Failed to create document session");

  const { data: batch, error: batchError } = await admin
    .from("document_processing_batches")
    .insert({
      household_id: householdId,
      created_by: actorProfileId,
      client_request_id: `legacy-${crypto.randomUUID()}`,
      session_id: session.id,
      mode_snapshot: setting?.dangerous_mode_enabled ? "dangerous" : "safe",
      settings_version: Number(setting?.setting_version ?? 1),
      disclosure_version: setting?.disclosure_version ?? null,
      configured_provider: setting?.configured_provider ?? null,
      configured_model_id: setting?.configured_model_id ?? null,
      status: "uploading_files",
    })
    .select("id")
    .single();
  if (batchError || !batch) throw new Error("Failed to create document batch");
  return String(batch.id);
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
  if (!user) return jsonError("Unauthorized", 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Invalid multipart body", 400);
  }

  const householdId = form.get("householdId")?.toString();
  const category = form.get("category")?.toString();
  const requestedBatchId = form.get("batchId")?.toString();
  const clientItemId = form.get("clientItemId")?.toString() ?? `item-${crypto.randomUUID()}`;
  const file = form.get("file");

  if (!householdId || !isUuid(householdId)) return jsonError("Missing or invalid householdId", 400);
  if (!category || !VALID_CATEGORIES.has(category))
    return jsonError("Missing or invalid category", 400);
  if (requestedBatchId && !isUuid(requestedBatchId)) return jsonError("Invalid batchId", 400);
  if (!clientItemId || clientItemId.length > 200) return jsonError("Invalid clientItemId", 400);
  if (!(file instanceof File)) return jsonError("Missing file", 400);

  const { data: household } = await supabase
    .from("households")
    .select("id")
    .eq("id", householdId)
    .maybeSingle();
  if (!household) return jsonError("Household not found", 404);

  const rawMimeType = file.type || "application/octet-stream";
  const mimeType = rawMimeType === "image/jpg" ? "image/jpeg" : rawMimeType;
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) return jsonError("Unsupported file type", 415);
  if (file.size > MAX_FILE_SIZE_BYTES) return jsonError("File exceeds 10 MB limit", 413);

  let batchId = requestedBatchId;
  try {
    batchId ??= await createLegacyBatch(admin, householdId, user.id);
  } catch {
    return jsonError("Failed to create document batch", 500);
  }

  const { data: batch } = await admin
    .from("document_processing_batches")
    .select("id, household_id, status")
    .eq("id", batchId)
    .eq("household_id", householdId)
    .maybeSingle();
  if (!batch) return jsonError("Document batch not found", 404);
  if (!["uploading_files", "checking_duplicates"].includes(String(batch.status))) {
    return jsonError("Document batch is no longer accepting files", 409);
  }

  const { data: existingItem } = await admin
    .from("document_processing_batch_items")
    .select("id, policy_document_id, deduplicated, policy_documents(storage_path)")
    .eq("batch_id", batchId)
    .eq("client_item_id", clientItemId)
    .maybeSingle();
  if (existingItem) {
    const joined = existingItem.policy_documents as { storage_path?: string } | null;
    return jsonResponse({
      id: existingItem.policy_document_id,
      path: joined?.storage_path ?? "",
      batch_id: batchId,
      item_id: existingItem.id,
      deduplicated: existingItem.deduplicated,
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentSha256 = await sha256Hex(bytes);
  await admin
    .from("document_processing_batches")
    .update({ status: "checking_duplicates", updated_at: new Date().toISOString() })
    .eq("id", batchId);

  const { data: canonical } = await admin
    .from("policy_documents")
    .select("id, storage_path")
    .eq("household_id", householdId)
    .eq("content_sha256", contentSha256)
    .maybeSingle();

  if (canonical) {
    const { data: item, error: itemError } = await admin
      .from("document_processing_batch_items")
      .insert({
        batch_id: batchId,
        household_id: householdId,
        client_item_id: clientItemId,
        policy_document_id: canonical.id,
        selected_file_name: file.name,
        category,
        content_sha256: contentSha256,
        deduplicated: true,
        duplicate_of_policy_document_id: canonical.id,
        status: "deduplicated",
      })
      .select("id")
      .single();
    if (itemError || !item) return jsonError("Failed to record duplicate selection", 500);
    await updateBatchCounts(admin, batchId);
    return jsonResponse({
      id: canonical.id,
      path: canonical.storage_path,
      batch_id: batchId,
      item_id: item.id,
      deduplicated: true,
    });
  }

  const documentId = crypto.randomUUID();
  const storagePath = `${householdId}/${documentId}${extensionForMime(mimeType)}`;
  const { data: documentRow, error: insertError } = await admin
    .from("policy_documents")
    .insert({
      id: documentId,
      household_id: householdId,
      category,
      status: "uploaded",
      storage_path: storagePath,
      file_name: file.name,
      mime_type: mimeType,
      size_bytes: file.size,
      uploaded_by: user.id,
      content_sha256: contentSha256,
    })
    .select("id")
    .single();

  if (insertError || !documentRow) {
    // A concurrent upload may have won the household digest claim. The client
    // can retry the same item idempotently after that upload commits.
    if (insertError?.code === "23505") {
      return jsonError("This document is already being uploaded; retry this batch item", 409);
    }
    return jsonError("Failed to record document metadata", 500);
  }

  const { error: storageError } = await admin.storage
    .from("policy-documents")
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (storageError) {
    await admin.from("policy_documents").delete().eq("id", documentId);
    return jsonError("Failed to store document", 502);
  }

  const { data: item, error: itemError } = await admin
    .from("document_processing_batch_items")
    .insert({
      batch_id: batchId,
      household_id: householdId,
      client_item_id: clientItemId,
      policy_document_id: documentId,
      selected_file_name: file.name,
      category,
      content_sha256: contentSha256,
      deduplicated: false,
      status: "uploaded",
    })
    .select("id")
    .single();
  if (itemError || !item) {
    await admin.storage.from("policy-documents").remove([storagePath]);
    await admin.from("policy_documents").delete().eq("id", documentId);
    return jsonError("Failed to associate document with batch", 500);
  }

  await updateBatchCounts(admin, batchId);
  return jsonResponse({
    id: documentId,
    path: storagePath,
    batch_id: batchId,
    item_id: item.id,
    deduplicated: false,
  });
});
