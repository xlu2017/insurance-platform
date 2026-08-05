---
name: Testing the Insurance Autopilot Expo mobile app
description: How to run the end-to-end customer golden path and PR auth flows against the local Supabase backend for the @autopilot/mobile Expo web app.
---

# Testing the Insurance Autopilot Expo mobile app

## Devin Secrets Needed

None for the local stack. If you want to test dangerous-mode external document processing locally, create `supabase/functions/.env` with `DOCUMENT_MODEL_PRIMARY`, `CONFIGURED_PROVIDER`, and `PROCESSOR_CONTRACT_VERSION` before `supabase start`.

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

The visible **Add PDF or image files** button in `expo-document-picker` sometimes does not open the OS file picker with mouse clicks. When the dialog is open, you can use the keyboard: type the file name (e.g. `auto-policy.png`) to filter and press `Enter` (or `Alt+O` on some GTK file dialogs) to confirm.

In some test environments the GTK file picker opens but does not list the fixture files or does not close when **Open** is clicked. If the dialog is stuck, close it with `wmctrl -c "Open Files"` and fall back to uploading directly via the `upload-document` Edge Function:

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/upload-document" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/insurance-fixtures/auto-policy.png" \
  -F "householdId=$HH" \
  -F "category=auto_detect" \
  -F "batchId=$BATCH" \
  -F "clientItemId=item-auto"
```

Then call `document-processing-batch` `submit` to move the batch to `manual_review`. Refresh the Documents screen to see the `Enter details manually` action.

The Expo web picker may only return one file even when `multiple: true` is set. To add multiple files, press `Files` again and select the next file; `documents.tsx` appends each selection to the pending list. After each selection, the primary button updates to `Upload N files`.

### 3. Hosted testing: multiple households for the demo account

On the hosted project, the demo account `customer@example.com` can own more than one household. `apps/mobile/lib/household.ts` `useHousehold()` queries:

```ts
await supabase
  .from("households")
  .select("id, name, province, autopilot_active, onboarding_step")
  .eq("owner_profile_id", userData.user.id)
  .maybeSingle();
```

With multiple rows this returns `PGRST116` and the app shows "Finish setting up" everywhere. This is fixed: `useHousehold()` now orders by `created_at` descending and `limit(1)` so it returns the most recently created household instead of throwing.

### 4. Hosted testing: manual-entry source documents

`apps/mobile/app/onboarding/manual-entry.tsx` directly selects from `document_processing_batch_items`. The hosted migration `20260720000011_dangerous_mode_document_batches.sql` revokes all privileges on that table from `authenticated` without granting `SELECT` back, so the manual-entry screen shows **No documents available** even though the batch has uploads. The RPC layer (`save_customer_manual_policy_review_v1` etc.) still works because it uses `security definer`. Options to unblock the UI:

- Grant `SELECT ON public.document_processing_batch_items TO authenticated;` in a migration.
- Move the manual-entry source-document query to an Edge Function or RPC.

This is fixed: migration `20260804200008_manual_entry_ui_permissions.sql` grants `SELECT ON public.document_processing_batch_items TO authenticated;`, so the manual-entry screen can load its source documents.

### 5. Manual-entry document review control

`save_customer_manual_policy_review_v1` sets `document_processing_batch_items.review_status = 'reviewing'`, but `complete_customer_manual_entry_v1` requires every document to be `reviewed` or `not_relevant`. The manual-entry screen therefore needs an explicit **Mark reviewed** action for documents that are referenced by a saved candidate. The screen now shows:

- **Mark reviewed** when a document is assigned to at least one candidate and is not yet reviewed.
- **Not relevant** when a document is not assigned to any candidate.
- **Reviewed** when the document has been explicitly marked reviewed.

### 6. Hosted Supabase EC256 JWT verification mismatch

On the hosted project `fztxclqboioicvbrenit.supabase.co`, a password-login token returned by `auth/v1/token` may be rejected by `auth/v1/user`, PostgREST, and Edge Functions with `crypto/ecdsa: verification error` or `No suitable key or wrong key type`. This is a project-level JWT/JWKS configuration issue, not an app bug. If this occurs, hosted mobile UI/API testing is blocked until the project signing keys are reissued or resynced. Verify with:

```bash
curl -sS -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"customer@example.com","password":"DemoCustomer123!"}'
curl -sS "$SUPABASE_URL/auth/v1/user" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN"
```

### 7. Manual-entry form input on Expo web

The manual-entry screen (`/onboarding/manual-entry`) uses React Native `TextInput` components. In the test Chrome environment, setting `input.value` and dispatching `input`/`change` events does **not** update React state, so validation errors persist even though the DOM inputs appear filled. Simulated typing with `Tab` navigation is also unreliable because the tab order does not always match the visual layout.

Workarounds:

- Use the browser console to open dropdowns and click options (`document.querySelector('[aria-label="Asset type"]').click()`), but fill the fields and save the candidate via the authenticated RPCs:
  - `save_customer_manual_policy_review_v1` for new candidates
  - `update_manual_entry_candidate_v1` for edits
  - `set_manual_entry_document_status_v1` to mark documents `not_relevant`
  - `complete_customer_manual_entry_v1` to finish
- After seeding candidates, refresh `/onboarding/manual-entry` or navigate directly to `/onboarding/review-entities?sessionId=<sessionId>` to test the review UI.

### 8. Review-entities correction persistence on Expo web

The `Edit` flow for a policy field (e.g., Annual premium) opens a `Field` input and calls `handleFieldComplete`/`persistReview` on **Save**. Setting `input.value` and dispatching `input`/`change` events does **not** update React state; the correction must be entered with real keyboard input.

Reliable sequence in the test Chrome environment:

1. Click the field row to open the `Confirm / Edit / Unsure` card.
2. Click **Edit** to switch to the input.
3. Focus and select the input from the console, then type:
   ```javascript
   const input = document.querySelector('input[aria-label="Annual premium"]');
   input.focus();
   input.select();
   ```
   Then use the `computer` `type` action to enter the new value.
4. Click **Save**. The summary should show the updated value.
5. After pressing **Continue**, verify the persisted correction:
   ```sql
   SELECT candidate_id, field_path, action, corrected_value
   FROM candidate_field_reviews
   WHERE candidate_id = '<candidate_id>'
     AND field_path = 'currentPolicy.annualPremiumCents';
   ```
   Expect `action = 'correct'` and `corrected_value = 130000` for a C$1,300.00 premium.

If the correction still does not persist, call `save_candidate_review_draft_v1` directly or insert the `candidate_field_reviews` row manually as a last resort.

### 9. Review-entities `Add` and `Continue` buttons may not respond to pointer clicks

In the test Chrome environment the per-candidate **Add** and summary **Continue** buttons often do not respond to `left_click`. Use console fallback:

```javascript
document.querySelector('button[aria-label="Add"]').click();
document.querySelector('button[aria-label="Continue"]').click();
```

### 10. Compare-coverage asset picker is constrained by the first asset type

The compare table chooses its spec list based on the first selected asset. The visible **Select asset** buttons may not respond to pointer clicks in the test Chrome environment; use `localStorage` to pre-populate the selection and reload.

To view vehicle coverage columns, place a vehicle asset first:

```javascript
const state = {
  selectedAssetIds: ["<vehicle_id_1>", "<vehicle_id_2>", "<property_id>"],
  colWidths: [180, 180, 180],
  hiddenSpecKeys: [],
  showMode: "all",
};
localStorage.setItem("compare-coverage-state-v1", JSON.stringify(state));
location.reload();
```

To view property coverage columns, place the property asset first.

### 6. Hosted testing: target the correct household for golden-path runs

The hosted demo account `customer@example.com` can own multiple households. `useHousehold()` returns the most recently created household, which may not be the intended `Smoke Test Household`. If the `Home` action routes to an unexpected `caseId`, check which household is loaded and navigate directly to `/(tabs)/documents?caseId=<target-case-id>` (or temporarily target `Smoke Test Household` in `apps/mobile/lib/household.ts` and revert after the test).

### 7. Console error: "The 'navigation' object hasn't been initialized yet"

`AuthGate`/callback routes may call `router.replace` before the Expo Router navigator mounts. This produces a console error:

> "The 'navigation' object hasn't been initialized yet."

Use a guarded `safeReplace` (retry with small backoff until the navigator is ready) for any imperative redirects from `useEffect` hooks, including `auth/callback.tsx`.

## Other known runtime issues

### Profile sign-out Rules-of-Hooks crash (FIXED)

`apps/mobile/app/(tabs)/profile.tsx` previously declared `signingOut` and `signOutError` `useState` hooks after `if (isLoading) return <Loading />;`. This caused a `Rendered more hooks than during the previous render` crash when the component re-rendered after sign-out. The hooks are now declared above the early return; sign-out returns to `/welcome` cleanly.

### Expo web document upload (FIXED)

`apps/mobile/lib/upload.ts` previously called `FileSystem.uploadAsync` unconditionally, which threw on web. It now has a `Platform.OS === "web"` branch that fetches the picked file blob, builds a `FormData` with `file`, `householdId`, `category`, `batchId`, and `clientItemId`, and POSTs to `functions/v1/upload-document`. Document uploads succeed on Expo web.

### OAuth callback crash on web (FIXED)

`apps/mobile/app/auth/callback.tsx` now guards `WebBrowser.dismissBrowser()` before calling it and wraps any returned promise with `Promise.resolve(...).catch(() => {})` so it no longer crashes when `dismissBrowser` is missing or returns `undefined`.

### Edge function "name resolution failed" (workaround)

If edge-function requests return `{"message":"name resolution failed"}`, the `supabase_edge_runtime_insurance-autopilot` Docker container is likely stopped. Restart it with:

```bash
docker start supabase_edge_runtime_insurance-autopilot
# or
supabase start
```

Also ensure the gitignored `supabase/functions/.env` contains `DOCUMENT_MODEL_PRIMARY`, `CONFIGURED_PROVIDER`, and `PROCESSOR_CONTRACT_VERSION` when testing dangerous-mode enablement.

### Verify-email public path (FIXED)

`/verify-email` is now included in `PUBLIC_PATHS` in `apps/mobile/lib/auth-gate.ts`, so an unauthenticated user who registers without auto-confirm can reach the verify screen.

### Case-scoped Documents screen and `manual_review` batches

`apps/mobile/app/(tabs)/documents.tsx` previously used `loadDocumentBatchForCase` (`action: latest-resumable-for-case`) when a `caseId` parameter was present, which excluded `manual_review` batches. This is fixed: it now uses `loadRelevantDocumentBatchForCase` (`action: latest-relevant-for-case`) so `manual_review` and `processing_unavailable` batches are displayed with their correct actions.

### Onboarding membership blocked locally

`/onboarding/membership` calls a Stripe checkout session edge function. Without Stripe secrets configured, it returns a plain text error that the UI parses as JSON, producing `Unexpected token 'S', "Stripe is "... is not valid JSON`. This blocks the full onboarding flow for new users unless Stripe is configured.

### Onboarding resume at Documents not wired in home.tsx

`document-processing-consent.tsx` persists `onboarding_step = 'documents'` after both **Allow processing** and **Upload without AI processing**. However, `apps/mobile/app/(tabs)/home.tsx` computes `setupAction` with:

```tsx
const isOnboardingComplete = household?.onboarding_step === "complete";
const setupAction = isOnboardingComplete
  ? { label: "Upload documents", route: "/(tabs)/documents" }
  : { label: "Continue setup", route: "/onboarding/document-processing-consent" };
```

When `onboarding_step` is `documents` (not `complete`), **Continue setup** routes back to the consent screen instead of `/onboarding/documents`. Directly reloading `/onboarding/documents` works, but a root relaunch that lands on `/home` may send the user to the wrong screen. Also, the demo seed creates an active `licensed_review` case and a pending `customer_questions` row, which can hide the `Continue setup` button entirely behind an `Answer question` / `Review coverage rules` action during relaunch tests.

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
- `invalid JWT: unable to parse or verify signature, token signature is invalid: crypto/ecdsa: verification error` from `auth/v1/user` (or `No suitable key or wrong key type` from PostgREST / `UNAUTHORIZED` from Edge Functions) — the hosted Supabase auth server is signing tokens with an EC256 key that the verifying services do not trust. Reissue/restart the project JWT/JWKS configuration before testing authenticated flows.
- Manual-entry `Finish and review` disabled with caption `Assign or mark every uploaded document before finishing.` — `save_customer_manual_policy_review_v1` sets `document_processing_batch_items.review_status = 'reviewing'`, but `complete_customer_manual_entry_v1` requires `reviewed` or `not_relevant`. The customer UI may not expose a `Reviewed` control; use `set_manual_entry_document_status_v1` to mark documents `reviewed` (or `not_relevant`) before finishing.
