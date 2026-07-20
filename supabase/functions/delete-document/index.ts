import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function updateBatchCounts(admin: any, batchId: string): Promise<void> {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ message: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonResponse({ message: "Unauthorized" }, 401);

  let payload: { documentId?: unknown };
  try {
    payload = (await req.json()) as { documentId?: unknown };
  } catch {
    return jsonResponse({ message: "Invalid JSON body" }, 400);
  }

  const documentId = typeof payload.documentId === "string" ? payload.documentId : "";
  if (!isUuid(documentId)) {
    return jsonResponse({ message: "Missing or invalid documentId" }, 400);
  }

  const { data: document, error: documentError } = await supabase
    .from("policy_documents")
    .select("id, household_id, storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (documentError) return jsonResponse({ message: "Failed to load document" }, 500);
  if (!document) return jsonResponse({ message: "Document not found" }, 404);

  const [{ data: household }, { data: membership }] = await Promise.all([
    supabase
      .from("households")
      .select("id")
      .eq("id", document.household_id)
      .eq("owner_profile_id", user.id)
      .maybeSingle(),
    supabase
      .from("household_members")
      .select("household_id")
      .eq("household_id", document.household_id)
      .eq("profile_id", user.id)
      .maybeSingle(),
  ]);
  if (!household && !membership) return jsonResponse({ message: "Forbidden" }, 403);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const [{ data: activeItems }, { data: providerFiles }] = await Promise.all([
    admin
      .from("document_processing_batch_items")
      .select("document_processing_batches!batch_id(status)")
      .eq("policy_document_id", document.id),
    admin
      .from("document_analysis_provider_files")
      .select("deletion_status")
      .eq("policy_document_id", document.id),
  ]);
  const activeStatuses = new Set([
    "uploading_files",
    "checking_duplicates",
    "queued",
    "reading_policy_documents",
    "comparing_policies",
    "validating_extracted_details",
  ]);
  if (
    (activeItems ?? []).some((item: Record<string, unknown>) => {
      const joined = item.document_processing_batches as { status?: string } | null;
      return joined?.status ? activeStatuses.has(joined.status) : false;
    })
  ) {
    return jsonResponse({ message: "Document processing is still in progress" }, 409);
  }
  if (
    (providerFiles ?? []).some(
      (file: { deletion_status?: string | null }) => file.deletion_status !== "deleted",
    )
  ) {
    return jsonResponse({ message: "Document cleanup is still in progress" }, 409);
  }
  const { data: batchItems } = await admin
    .from("document_processing_batch_items")
    .select("batch_id")
    .eq("policy_document_id", document.id);
  const batchIds = Array.from(
    new Set((batchItems ?? []).map((item: { batch_id: string }) => item.batch_id)),
  );

  const { error: storageError } = await admin.storage
    .from("policy-documents")
    .remove([document.storage_path]);
  if (storageError) return jsonResponse({ message: "Failed to remove stored file" }, 502);

  const { error: deleteError } = await admin
    .from("policy_documents")
    .delete()
    .eq("id", document.id)
    .eq("household_id", document.household_id);
  if (deleteError) return jsonResponse({ message: "Failed to remove document record" }, 500);

  for (const batchId of batchIds) {
    await updateBatchCounts(admin, batchId);
  }

  return jsonResponse({ id: document.id });
});
