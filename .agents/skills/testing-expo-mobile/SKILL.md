---
name: Testing the Insurance Autopilot Expo mobile app
description: How to run the end-to-end customer golden path and PR auth flows against the local Supabase backend for the @autopilot/mobile Expo web app.
---

# Testing the Insurance Autopilot Expo mobile app

## Devin Secrets Needed
None for the local stack.  If you want to test dangerous-mode external document processing locally, create `supabase/functions/.env` with `DOCUMENT_MODEL_PRIMARY`, `CONFIGURED_PROVIDER`, and `PROCESSOR_CONTRACT_VERSION` before `supabase start`.

## Repository setup
- Repo root: `/home/ubuntu/repos/insurance-platform`
- App package: `@autopilot/mobile`
- Supabase local backend should be started and seeded:
  ```bash
  supabase start && supabase db reset
  ```
- The Expo web dev server is started from the repo root with:
  ```bash
  pnpm --filter @autopilot/mobile dev --web
  ```

## Environment
The app reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from `apps/mobile/.env`.
For local Expo web testing, the default `http://127.0.0.1:54321` URL is accepted by `apps/mobile/lib/auth.ts` as long as `Platform.OS === "web"`.

If you want the sign-in screen to show the **"Sign in with test account"** shortcut with pre-filled demo credentials, export the demo variables before starting the dev server:

```bash
EXPO_PUBLIC_DEMO_EMAIL=customer@example.com \
EXPO_PUBLIC_DEMO_PASSWORD=DemoCustomer123! \
pnpm --filter @autopilot/mobile dev --web
```

Otherwise, type `customer@example.com` / `DemoCustomer123!` into the sign-in form fields.

## Data state for repeated golden-path runs
The demo `customer_questions` row (`34000000-0000-0000-0000-000000000001`) is updated to `answered` when the question is submitted. To re-test the full pending-question flow, reset it before a new run:

```bash
PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres -d postgres \
  -c "update customer_questions set status='pending', answer=null where id='34000000-0000-0000-0000-000000000001';"
```

## Common blockers and workarounds

### 1. Welcome/SecondaryButton Pressable may not respond to mouse clicks
In the configured test Chrome instance, `SecondaryButton` components (welcome **"Sign in"**, sign-in **"Sign in with test account"**, question **Yes/No** options) may not advance when clicked with `left_click` at the visible center, while `PrimaryButton` components (green **"Sign in"**, **"Submit answer** when answer already selected, bottom tab bar) usually respond. If a secondary button does not advance the UI, fall back to:

- Typing the target URL directly in the browser address bar (e.g. `http://localhost:8081/sign-in`).
- Triggering the same `onPress` through the browser console:
  ```javascript
  document.querySelector('button[aria-label="Sign in"]').click();
  ```

This is likely a browser pointer-event configuration issue rather than an app bug, but it can interfere with a smooth recording.

### 2. File picker on Expo web
The visible **Add PDF or image files** button in `expo-document-picker` sometimes does not open the OS file picker with mouse clicks.  When the dialog is open, you can use the keyboard: type the file name (e.g. `auto-policy.png`) to filter and press `Enter` (or `Alt+O` on some GTK file dialogs) to confirm.  If that fails, exercise the upload path via the hidden `<input type="file">` or a test script.

### 3. Console error: "The 'navigation' object hasn't been initialized yet"
`AuthGate`/callback routes may call `router.replace` before the Expo Router navigator mounts.  This produces a console error:

> "The 'navigation' object hasn't been initialized yet."

Use a guarded `safeReplace` (retry with small backoff until the navigator is ready) for any imperative redirects from `useEffect` hooks, including `auth/callback.tsx`.

## Other known runtime issues

### Profile sign-out Rules-of-Hooks crash (FIXED)
`apps/mobile/app/(tabs)/profile.tsx` previously declared `signingOut` and `signOutError` `useState` hooks after `if (isLoading) return <Loading />;`.  This caused a `Rendered more hooks than during the previous render` crash when the component re-rendered after sign-out.  The hooks are now declared above the early return; sign-out returns to `/welcome` cleanly.

### Expo web document upload (FIXED)
`apps/mobile/lib/upload.ts` previously called `FileSystem.uploadAsync` unconditionally, which threw on web.  It now has a `Platform.OS === "web"` branch that fetches the picked file blob, builds a `FormData` with `file`, `householdId`, `category`, `batchId`, and `clientItemId`, and POSTs to `functions/v1/upload-document`.  Document uploads succeed on Expo web.

### OAuth callback crash on web (STILL PRESENT as of PR #22 retest)
`apps/mobile/app/auth/callback.tsx` attempts `WebBrowser.dismissBrowser().catch(() => {})`.  On Expo web, `dismissBrowser` is defined but returns `undefined`, so the `.catch()` raises `Cannot read properties of undefined (reading 'catch')`.  A proper fix is to guard the returned promise, e.g. `Promise.resolve(WebBrowser.dismissBrowser?.()).catch(() => {})`, and continue using `safeReplace` for `router.replace`.

### Verify-email public path (FIXED)
`/verify-email` is now included in `PUBLIC_PATHS` in `apps/mobile/lib/auth-gate.ts`, so an unauthenticated user who registers without auto-confirm can reach the verify screen.

### Onboarding membership blocked locally
`/onboarding/membership` calls a Stripe checkout session edge function.  Without Stripe secrets configured, it returns a plain text error that the UI parses as JSON, producing `Unexpected token 'S', "Stripe is "... is not valid JSON`.  This blocks the full onboarding flow for new users unless Stripe is configured.

## Golden-path and PR #22 checkpoints
1. `http://localhost:8081/welcome` shows **"Insurance handled for you"** and **"Sign in"**.
2. `/sign-in` shows **"Welcome back"** with Email/Password fields and no bottom tab bar.
3. After sign-in, `/home` shows:
   - **"One item needs your attention"**
   - **"Answer a question from your insurer"** or a document-review action after an upload
   - **"Autopilot active"** pill
   - **"Your insurance"** card with **Prairie Shield Insurance** and **Combined annual premium $2,950.00**
4. The **Autopilot** tab shows the active **"2026 Renewal Review"** case with status **"Waiting for licensed review"** and the **"Licensed review"** timeline step highlighted.
5. Authenticated users navigating to `/sign-in` or `/register` while signed in redirect to `/home`; public routes hide the bottom tab bar.
6. The **Verify your email** screen at `/verify-email?email=...` renders and has working **Resend verification email** and **Back to sign in** actions.
7. **Continue with Google** on `/welcome` and `/register` opens the Google OAuth URL (fails locally with `invalid_client` unless Google OAuth secrets are configured).
8. Registration with a local auto-confirm Supabase config lands on `/home` with **"Finish setting up"**.
9. **Profile** sign-out returns to `/welcome` with no crash.
10. The **Instant AI review** toggle on Profile enables dangerous mode after explicit consent; safe mode creates a `manual_review` batch, dangerous mode attempts external AI processing (and shows `processing_unavailable` when external provider is not configured).
11. Document upload on Expo web works through the `fetch`/`FormData` branch.

## Useful DOM selectors for console fallbacks
- `button[aria-label="Sign in"]` (welcome)
- `input[aria-label="Email"]` / `input[aria-label="Password"]` (sign-in)
- `button[aria-label="Sign in"]` (green sign-in button)
- `button[aria-label="Answer question"]` (home)
- `button[aria-label="Yes"]` / `button[aria-label="No"]` (question)
- `button[aria-label="Submit answer"]` (question)
- `button[aria-label="Autopilot"]` (bottom tab bar)
- `button[aria-label="Instant AI review"]` (Profile toggle)
- `button[aria-label="Sign out"]` (Profile)
- `button[aria-label="Continue with Google"]` (welcome/register)
- `button[aria-label="Create account"]` (register)
- `button[aria-label="Resend verification email"]` (verify-email)
- `button[aria-label="Back to sign in"]` (verify-email)

## Console log signals
- `[auth] sign-in request: hostname=127.0.0.1` — a successful auth token request is being sent to the local Supabase backend.
- `[auth] invalid config: invalid_config` — the Supabase URL is being rejected.
- `The 'navigation' object hasn't been initialized yet` — an imperative redirect is firing before the Expo Router navigator is mounted.
- `Multiple GoTrueClient instances detected` and `props.pointerEvents is deprecated` — non-fatal warnings observed during the test run.
- `Rendered fewer hooks than expected` in `Profile` — Rules of Hooks crash on sign-out.
- `The method or property expo-file-system.uploadAsync is not available on web` — document upload blocked on Expo web (no web branch in `upload.ts`).
- `Cannot read properties of undefined (reading 'catch')` in `AuthCallback` — `WebBrowser.dismissBrowser()` returned `undefined`.
