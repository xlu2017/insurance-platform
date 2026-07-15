// Stripe webhook processor. Idempotent via the stripe_webhook_events table.
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const stripe = new Stripe(stripeKey);
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    if (!signature || !webhookSecret) throw new Error("Missing signature or secret");
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  // Idempotency: skip already-processed events.
  const { error: insertError } = await supabase
    .from("stripe_webhook_events")
    .insert({ id: event.id, event_type: event.type });
  if (insertError) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const object = event.data.object as Stripe.Checkout.Session | Stripe.Subscription;
    const profileId =
      "metadata" in object && object.metadata ? object.metadata["profile_id"] : undefined;
    if (profileId) {
      const status =
        event.type === "customer.subscription.deleted"
          ? "cancelled"
          : event.type === "checkout.session.completed"
            ? "active"
            : (object as Stripe.Subscription).status === "active"
              ? "active"
              : "past_due";
      await supabase.from("subscriptions").upsert(
        {
          profile_id: profileId,
          status,
          stripe_customer_id: typeof object.customer === "string" ? object.customer : null,
        },
        { onConflict: "profile_id" },
      );
      await supabase.from("audit_events").insert({
        actor_profile_id: profileId,
        actor_role: "customer",
        action: "subscription_event",
        entity_type: "subscription",
        after_summary: { status, event_type: event.type },
        correlation_id: event.id,
      });
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
