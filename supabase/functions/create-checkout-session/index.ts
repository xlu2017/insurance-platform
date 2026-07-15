// Creates a Stripe test-mode Checkout session for the C$30 annual membership.
// When PAYMENTS_BYPASS=true (default for local demo) the subscription is
// activated directly so the demo works without Stripe keys.
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const bypass = (Deno.env.get("PAYMENTS_BYPASS") ?? "true") === "true";
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

  if (bypass || !stripeKey) {
    await admin.from("subscriptions").upsert(
      {
        profile_id: user.id,
        status: "active",
        current_period_end: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      },
      { onConflict: "profile_id" },
    );
    await admin.from("audit_events").insert({
      actor_profile_id: user.id,
      actor_role: "customer",
      action: "subscription_activated_bypass",
      entity_type: "subscription",
      after_summary: { status: "active", bypass: true },
    });
    return new Response(JSON.stringify({ bypass: true, status: "active" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeKey);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price_data: {
          currency: "cad",
          unit_amount: 3000,
          recurring: { interval: "year" },
          product_data: { name: "Insurance Autopilot Membership" },
        },
        quantity: 1,
      },
    ],
    metadata: { profile_id: user.id },
    subscription_data: { metadata: { profile_id: user.id } },
    success_url: Deno.env.get("CHECKOUT_SUCCESS_URL") ?? "http://localhost:8081/checkout-success",
    cancel_url: Deno.env.get("CHECKOUT_CANCEL_URL") ?? "http://localhost:8081/checkout-cancel",
  });

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { "Content-Type": "application/json" },
  });
});
