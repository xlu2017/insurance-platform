// Stripe webhook processor. Idempotent and transactional via the database.
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";

const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";

type SubscriptionStatus = "inactive" | "pending" | "active" | "past_due" | "cancelled";

function mapStatus(status?: string): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      return "inactive";
  }
}

function timestampToIso(ts?: number | null): string | null {
  if (!ts) return null;
  return new Date(ts * 1000).toISOString();
}

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

  const processable =
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted";

  if (!processable) {
    return new Response(JSON.stringify({ received: true, processed: false }), { status: 200 });
  }

  const object = event.data.object as Stripe.Checkout.Session | Stripe.Subscription;
  const metadata = "metadata" in object && object.metadata ? object.metadata : {};
  const profileId = metadata["profile_id"];
  if (!profileId) {
    return new Response(JSON.stringify({ received: true, error: "missing profile_id" }), {
      status: 200,
    });
  }

  let status: SubscriptionStatus;
  let customerId: string | null = null;
  let subscriptionId: string | null = null;
  let currentPeriodEnd: string | null = null;

  if (event.type === "checkout.session.completed") {
    const session = object as Stripe.Checkout.Session;
    status = "active";
    customerId = typeof session.customer === "string" ? session.customer : null;
    subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
  } else {
    const sub = object as Stripe.Subscription;
    status = mapStatus(sub.status);
    customerId = typeof sub.customer === "string" ? sub.customer : null;
    subscriptionId = sub.id;
    currentPeriodEnd = timestampToIso(sub.current_period_end);
  }

  const { data, error } = await supabase.rpc("process_stripe_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_profile_id: profileId,
    p_status: status,
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscriptionId,
    p_current_period_end: currentPeriodEnd,
  });

  if (error) {
    // Return non-2xx so Stripe retries; the function has already recorded a failed attempt.
    return new Response(JSON.stringify({ received: true, error: error.message }), { status: 500 });
  }

  if (data && (data as { success: boolean }).success === false) {
    return new Response(
      JSON.stringify({ received: true, error: (data as { error: string }).error }),
      {
        status: 500,
      },
    );
  }

  return new Response(
    JSON.stringify({
      received: true,
      processed: true,
      already_processed:
        (data as { already_processed?: boolean } | null)?.already_processed ?? false,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
