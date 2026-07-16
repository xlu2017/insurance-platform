// Sends a structured quote-request email for a quote request.
// Resend is used when RESEND_API_KEY is set; otherwise the email is recorded in the outbox.
// All state changes are persisted atomically through the send_quote_request_email RPC, which
// validates role/assignment, state, and idempotency.
import { createClient } from "npm:@supabase/supabase-js@2";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

  const { quoteRequestId } = await req.json();
  if (!isUuid(quoteRequestId)) {
    return new Response("Invalid quote request id", { status: 400, headers: corsHeaders });
  }

  // Compose email body using the quote request metadata.
  const { data: qr, error: qrErr } = await supabase
    .from("quote_requests")
    .select("id, state, product_lines, insurer_id, case_id, insurers(name)")
    .eq("id", quoteRequestId)
    .single();
  if (qrErr || !qr)
    return new Response("Quote request not found", { status: 404, headers: corsHeaders });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !["operations", "admin"].includes(profile.role)) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  if (profile.role !== "admin") {
    const { data: assignment } = await supabase
      .from("case_assignments")
      .select("id")
      .eq("case_id", qr.case_id)
      .eq("assignee_profile_id", user.id)
      .maybeSingle();
    if (!assignment) {
      return new Response("Not assigned to this case", { status: 403, headers: corsHeaders });
    }
  }

  if (qr.state !== "queued") {
    return new Response(`Quote request is not queued (current state: ${qr.state})`, {
      status: 409,
      headers: corsHeaders,
    });
  }

  const { data: channel } = await supabase
    .from("insurer_channels")
    .select("address")
    .eq("insurer_id", qr.insurer_id)
    .eq("channel_type", "email")
    .maybeSingle();
  const toEmail = channel?.address ?? "quotes@example.invalid";
  const insurerName = (qr.insurers as unknown as { name?: string })?.name ?? "the insurer";
  const productLines = ((qr.product_lines as string[]) ?? ["auto", "property"]).join(", ");
  const subject = `Quote request ${qr.id} — household insurance (${productLines})`;
  const body = [
    "Hello,",
    "",
    `We are requesting a quotation for a household insurance client through ${insurerName}.`,
    `Product lines: ${productLines}`,
    `Reference: ${qr.id}`,
    "",
    "Structured details are available on request. This is a simulated message from the Insurance Autopilot demonstration platform.",
  ].join("\n");

  let provider = "outbox";
  let externalSuccess = true;
  let resendError: string | null = null;

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    provider = "resend";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("EMAIL_FROM") ?? "autopilot@example.com",
          to: toEmail,
          subject,
          text: body,
        }),
      });
      externalSuccess = res.ok;
      if (!externalSuccess) {
        resendError = await res.text();
      }
    } catch (e) {
      externalSuccess = false;
      resendError = e instanceof Error ? e.message : "Resend request failed";
    }
  }

  // Persist the result through the atomic RPC.
  const { data: rpcData, error: rpcError } = await supabase.rpc("send_quote_request_email", {
    p_quote_request_id: quoteRequestId,
    p_provider: provider,
    p_external_success: externalSuccess,
  });

  if (rpcError) {
    return new Response(JSON.stringify({ sent: false, provider, error: rpcError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const result = rpcData as {
    sent: boolean;
    duplicate?: boolean;
    provider: string;
    error?: string;
  };
  if (!result.sent) {
    const status =
      result.error?.includes("not queued") || result.error?.includes("already sent") ? 409 : 502;
    return new Response(JSON.stringify(result), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (provider === "resend" && resendError) {
    return new Response(JSON.stringify({ sent: false, provider, error: resendError }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ sent: true, provider, duplicate: result.duplicate ?? false }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
