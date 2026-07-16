// Creates a Stripe test-mode Checkout session for the C$30 annual membership.
// PAYMENTS_BYPASS defaults to false. When true, the subscription is activated directly so the
// local demo works without Stripe keys. When false, a real Checkout URL is returned and the
// mobile client polls the subscriptions table for the webhook to activate it.
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

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

  const bypass = Deno.env.get("PAYMENTS_BYPASS") === "true";

  if (bypass) {
    const { error: upsertErr } = await admin.from("subscriptions").upsert(
      {
        profile_id: user.id,
        status: "active",
        current_period_end: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      },
      { onConflict: "profile_id" },
    );
    if (upsertErr) {
      return new Response(JSON.stringify({ error: upsertErr.message }), { status: 500 });
    }
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

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return new Response("Stripe is not configured", { status: 503 });
  }

  const stripe = new Stripe(stripeKey);
  try {
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
  } catch (e) {
    const message = e instanceof Error ? e.message : "Stripe session creation failed";
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
