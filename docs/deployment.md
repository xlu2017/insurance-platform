# Deployment

## Supabase (hosted)

1. Create a project in the **Canada (Central)** region — `ca-central-1` — so household and policy
   data stays in Canada.
2. Link and push migrations:

   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```

3. Deploy Edge Functions:

   ```bash
   supabase functions deploy stripe-webhook create-checkout-session send-quote-request recommendation-generator
   supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... RESEND_API_KEY=re_...
   ```

4. **Do not run `supabase/seed.sql` in production** — it creates demo credentials. Seed insurers
   through the admin console instead.
5. Staff accounts must be created through the `assign_staff_role` service-role RPC from a trusted
   context; signup metadata cannot escalate a user to `operations`, `reviewer` or `admin`.
6. In Auth settings enable email confirmation and configure the mobile redirect URL.

## Admin console

Deploy `apps/admin` to Vercel (or any Node host). Environment:

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

No service-role key is ever configured on the client apps.

## Mobile app

EAS builds (`eas build`) with `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` set per
profile. Push notifications require an Expo access token; without it the app falls back to the
local notification log.

## Stripe

Test mode only. Create the `Insurance Autopilot Membership` product (C$30/year), point the webhook
at the `stripe-webhook` function URL, and unset `PAYMENTS_BYPASS`.

## Observability

Set `SENTRY_DSN` (functions) and `EXPO_PUBLIC_SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (clients) to
enable Sentry; everything is disabled when the variables are absent.
