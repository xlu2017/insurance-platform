import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: Uint8Array): Promise<string> {
  // @ts-ignore: Deno's crypto.subtle.digest accepts Uint8Array views at runtime.
  const digest = await crypto.subtle.digest("SHA-256", input);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) return jsonError("Unauthorized", 401);

  const body = await req.json().catch(() => ({}));
  const householdId = body.household_id as string | undefined;
  const candidateIds = Array.isArray(body.candidate_ids)
    ? (body.candidate_ids as string[])
    : undefined;

  if (!householdId || !candidateIds || candidateIds.length === 0) {
    return jsonError("household_id and candidate_ids are required", 400);
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();
  if (profileErr || !profile) {
    return jsonError("Profile not found", 404);
  }

  const requestPayload = new TextEncoder().encode(
    [householdId, profile.id, ...candidateIds.sort()].join("|"),
  );
  const clientRequestId = await sha256Hex(requestPayload);

  const { data: result, error: rpcErr } = await admin.rpc("approve_candidate_assets_v1", {
    p_household_id: householdId,
    p_actor_profile_id: profile.id,
    p_client_request_id: clientRequestId,
    p_candidate_ids: candidateIds,
  });

  if (rpcErr || !result) {
    return jsonError(rpcErr?.message ?? "Approval failed", 500);
  }

  return jsonResponse({ success: true, result });
});
