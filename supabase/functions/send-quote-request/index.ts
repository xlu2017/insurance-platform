// Sends a structured quote-request email for a quote request through the
// email provider adapter: Resend when RESEND_API_KEY is set, otherwise the
// email_outbox table. Staff only. DB-backed rate-limited per user.
import { createClient } from "npm:@supabase/supabase-js@2";

const RATE_LIMIT = 30; // sends per hour per user
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { quoteRequestId } = await req.json();
  if (!isUuid(quoteRequestId)) {
    return new Response("Invalid quote request id", { status: 400 });
  }

  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["operations", "admin"].includes(profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const { data: qr } = await admin
    .from("quote_requests")
    .select("id, state, product_lines, insurer_id, case_id, insurers(name)")
    .eq("id", quoteRequestId)
    .single();
  if (!qr) return new Response("Quote request not found", { status: 404 });
  if (qr.state !== "queued") {
    return new Response(`Quote request is not queued (current state: ${qr.state})`, {
      status: 409,
    });
  }

  // Verify the caller is assigned to this case (or is an admin).
  if (profile.role !== "admin") {
    const { data: assignment } = await admin
      .from("case_assignments")
      .select("id")
      .eq("case_id", qr.case_id)
      .eq("assignee_profile_id", user.id)
      .maybeSingle();
    if (!assignment) {
      return new Response("Not assigned to this case", { status: 403 });
    }
  }

  // DB-backed rate limit per user.
  const { count, error: rateError } = await admin
    .from("email_outbox")
    .select("id", { count: "exact", head: true })
    .eq("created_by", user.id)
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if (rateError) {
    return new Response(`Rate limit check failed: ${rateError.message}`, { status: 500 });
  }
  if ((count ?? 0) >= RATE_LIMIT) {
    return new Response("Rate limit exceeded", { status: 429 });
  }

  const { data: channel } = await admin
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
  let resendResponse: Response | null = null;
  let resendOk = false;
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (resendKey) {
    provider = "resend";
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_FROM") ?? "autopilot@example.com",
        to: toEmail,
        subject,
        text: body,
      }),
    });
    resendOk = resendResponse.ok;
    if (!resendOk) {
      const resendBody = await resendResponse.text();
      // Do not mark sent if the provider call fails. Record the attempt for audit.
      await admin.from("email_outbox").insert({
        to_email: toEmail,
        email_type: "quote_request",
        subject,
        body,
        provider,
        sent_at: new Date().toISOString(),
        created_by: user.id,
      });
      return new Response(JSON.stringify({ sent: false, provider, error: resendBody }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  await admin.from("email_outbox").insert({
    to_email: toEmail,
    email_type: "quote_request",
    subject,
    body,
    provider,
    sent_at: new Date().toISOString(),
    created_by: user.id,
  });

  const { error: updateError } = await admin
    .from("quote_requests")
    .update({ state: "sent", sent_at: new Date().toISOString() })
    .eq("id", qr.id)
    .eq("state", "queued");

  if (updateError) {
    return new Response(JSON.stringify({ sent: false, provider, error: updateError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ sent: true, provider }), {
    headers: { "Content-Type": "application/json" },
  });
});
