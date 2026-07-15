// Sends a structured quote-request email for a quote request through the
// email provider adapter: Resend when RESEND_API_KEY is set, otherwise the
// email_outbox table. Staff only. Rate-limited per user.
import { createClient } from "npm:@supabase/supabase-js@2";

const RATE_LIMIT = 30; // sends per hour per user
const recentSends = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const window = (recentSends.get(userId) ?? []).filter((t) => now - t < 3600_000);
  if (window.length >= RATE_LIMIT) return true;
  window.push(now);
  recentSends.set(userId, window);
  return false;
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
  if (rateLimited(user.id)) return new Response("Rate limit exceeded", { status: 429 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: profile } = await admin.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || !["operations", "admin"].includes(profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const { quoteRequestId } = await req.json();
  const { data: qr } = await admin
    .from("quote_requests")
    .select(
      "id, state, product_lines, insurer_id, insurers(name), insurer_channels:insurer_id(address)",
    )
    .eq("id", quoteRequestId)
    .single();
  if (!qr) return new Response("Quote request not found", { status: 404 });

  const { data: channel } = await admin
    .from("insurer_channels")
    .select("address")
    .eq("insurer_id", qr.insurer_id)
    .eq("channel_type", "email")
    .maybeSingle();

  const toEmail = channel?.address ?? "quotes@example.invalid";
  const subject = `Quote request ${qr.id} — household insurance (${(qr.product_lines as string[]).join(", ")})`;
  const body = [
    "Hello,",
    "",
    "We are requesting a quotation for a household insurance client.",
    `Product lines: ${(qr.product_lines as string[]).join(", ")}`,
    `Reference: ${qr.id}`,
    "",
    "Structured details are available on request. This is a simulated message from the Insurance Autopilot demonstration platform.",
  ].join("\n");

  const resendKey = Deno.env.get("RESEND_API_KEY");
  let provider = "outbox";
  if (resendKey) {
    provider = "resend";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_FROM") ?? "autopilot@example.com",
        to: toEmail,
        subject,
        text: body,
      }),
    });
  }

  await admin.from("email_outbox").insert({
    to_email: toEmail,
    email_type: "quote_request",
    subject,
    body,
    provider,
    sent_at: new Date().toISOString(),
  });

  await admin
    .from("quote_requests")
    .update({ state: "sent", sent_at: new Date().toISOString() })
    .eq("id", qr.id)
    .eq("state", "queued");

  return new Response(JSON.stringify({ sent: true, provider }), {
    headers: { "Content-Type": "application/json" },
  });
});
