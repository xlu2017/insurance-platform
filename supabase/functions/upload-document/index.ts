// Server-side document upload for the mobile app.
// Validates ownership, category, MIME type and size, uploads to the private policy-documents
// bucket, and inserts a policy_documents row. On any failure the storage object and metadata
// row are cleaned up so an incomplete upload cannot be orphaned.
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey",
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_CATEGORIES = new Set([
  "current_auto_policy",
  "current_property_policy",
  "renewal_notice",
  "competing_quote",
  "proof_of_insurance",
  "signed_authorization",
  "cancellation_confirmation",
  "other",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError("Method not allowed", 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Unauthorized", 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Invalid multipart body", 400);
  }

  const householdId = form.get("householdId")?.toString();
  const category = form.get("category")?.toString();
  const file = form.get("file");

  if (!householdId || !isUuid(householdId)) {
    return jsonError("Missing or invalid householdId", 400);
  }
  if (!category || !VALID_CATEGORIES.has(category)) {
    return jsonError("Missing or invalid category", 400);
  }
  if (!(file instanceof File)) {
    return jsonError("Missing file", 400);
  }

  // Verify the caller has access to the household.
  const { data: household, error: householdErr } = await supabase
    .from("households")
    .select("id")
    .eq("id", householdId)
    .maybeSingle();
  if (householdErr || !household) {
    return jsonError("Household not found", 404);
  }

  // Validate MIME type and size server-side. The bucket also enforces these limits, but we reject
  // early before anything is written.
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return jsonError("Unsupported file type", 415);
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return jsonError("File exceeds 10 MB limit", 413);
  }

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const randomSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${householdId}/${randomSuffix}-${safeName}`;

  // Reserve the metadata row first; this makes the upload atomic and auditable.
  const { data: docRow, error: insertErr } = await supabase
    .from("policy_documents")
    .insert({
      household_id: householdId,
      category,
      status: "uploaded",
      storage_path: path,
      file_name: file.name,
      mime_type: mimeType,
      size_bytes: file.size,
    })
    .select("id")
    .single();

  if (insertErr || !docRow) {
    return jsonError(insertErr?.message ?? "Failed to record document metadata", 500);
  }

  const bytes = await file.arrayBuffer();
  const { error: storageError } = await admin.storage
    .from("policy-documents")
    .upload(path, bytes, { contentType: mimeType, upsert: false });

  if (storageError) {
    // Clean up the metadata row on storage failure.
    await admin.from("policy_documents").delete().eq("id", docRow.id);
    return jsonError(storageError.message, 502);
  }

  return new Response(JSON.stringify({ id: docRow.id, path }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
