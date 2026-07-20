import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { basename } from "path";

const SUPABASE_URL = "http://127.0.0.1:54321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const publicClient = createClient(SUPABASE_URL, ANON_KEY);

const timestamp = Date.now();
const email = `danger-${timestamp}@example.com`;
const password = "Dangerous123!";

const files = [
  {
    path: "/home/ubuntu/attachments/168e2f0e-0e15-4bf3-bc73-bbf068dccfa5/vehicle-Mazda5-2026-08-27_Renewal_0000398171225.pdf",
    category: "current_auto_policy",
  },
  {
    path: "/home/ubuntu/attachments/4c3df4fd-5886-476a-9bd6-9cdaa23ca828/primary-home-Insurance-2025Dec31-2026Dec31_Redacted.pdf",
    category: "current_property_policy",
  },
  {
    path: "/home/ubuntu/attachments/2e9c7488-537e-43ba-9171-d5f19de568cf/rental1-Insurance-2026Sept2-2027Sept2.pdf",
    category: "current_property_policy",
  },
  {
    path: "/home/ubuntu/attachments/7bef7ffd-eda7-4e4f-889c-6a41e1388c26/rental2-Insurance-2025Sept24-2026Sept24.pdf",
    category: "current_property_policy",
  },
];

async function setupUser() {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) throw createErr;
  const userId = created.user.id;
  console.log("created user", userId);

  const { data: login, error: loginErr } = await publicClient.auth.signInWithPassword({
    email,
    password,
  });
  if (loginErr) throw loginErr;
  const accessToken = login.session.access_token;
  console.log("signed in");

  const { data: household, error: hhErr } = await publicClient
    .from("households")
    .insert({
      owner_profile_id: userId,
      name: "Dangerous Test Household",
      province: "AB",
      onboarding_step: "documents",
    })
    .select("id")
    .single();
  if (hhErr) throw hhErr;
  const householdId = household.id;
  console.log("created household", householdId);

  await publicClient
    .from("household_members")
    .insert({ household_id: householdId, profile_id: userId, member_role: "owner" });

  await admin.from("household_document_processing_settings").insert({
    household_id: householdId,
    dangerous_mode_enabled: true,
    setting_version: 1,
    enabled_by: userId,
    enabled_at: new Date().toISOString(),
    disclosure_version: "dangerous-mode-v1",
    configured_provider: "gemini-2.5-flash-lite",
    configured_model_id: "gemini-2.5-flash-lite",
  });

  return { userId, householdId, accessToken };
}

async function uploadFile(path, category, householdId, batchId, token) {
  const form = new FormData();
  form.append("householdId", householdId);
  form.append("category", category);
  form.append("clientItemId", `item-${crypto.randomUUID()}`);
  if (batchId) form.append("batchId", batchId);
  const buffer = readFileSync(path);
  const blob = new Blob([buffer], { type: "application/pdf" });
  form.append("file", blob, basename(path));
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/upload-document`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(`upload failed ${resp.status}: ${JSON.stringify(body)}`);
  return body;
}

async function submitBatch(householdId, batchId, token) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/document-processing-batch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "submit", household_id: householdId, batch_id: batchId }),
  });
  const body = await resp.json();
  if (!resp.ok) throw new Error(`submit failed ${resp.status}: ${JSON.stringify(body)}`);
  console.log("submit response", resp.status, body.status);
  return body;
}

async function pollBatch(householdId, batchId, token) {
  const start = Date.now();
  while (Date.now() - start < 240000) {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/document-processing-batch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", household_id: householdId, batch_id: batchId }),
    });
    const body = await resp.json();
    console.log("status", body.status, body.is_terminal);
    if (body.is_terminal || body.status === "ready_for_review") return body;
    if (["processing_unavailable", "manual_review"].includes(body.status))
      throw new Error(`batch ended in ${body.status}: ${JSON.stringify(body)}`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error("batch polling timeout");
}

(async () => {
  const { userId, householdId, accessToken } = await setupUser();
  let batchId = null;
  for (const f of files) {
    const result = await uploadFile(f.path, f.category, householdId, batchId, accessToken);
    batchId = result.batch_id;
    console.log("uploaded", result.id, "batch", batchId);
  }
  await submitBatch(householdId, batchId, accessToken);
  const batch = await pollBatch(householdId, batchId, accessToken);

  const { data: sessionRow } = await admin
    .from("document_processing_batches")
    .select("session_id")
    .eq("id", batchId)
    .single();
  const sessionId = sessionRow?.session_id ?? batch.session_id;

  console.log("batch ready", batch.status, "session", sessionId);

  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=390,844", "--window-position=100,50"],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  await page.goto("http://127.0.0.1:8081/");
  await page.waitForSelector('[data-testid="go-sign-in"]', { timeout: 10000 });
  await page.click('[data-testid="go-sign-in"]');
  await page.waitForSelector('[data-testid="email-input"]', { timeout: 10000 });
  await page.fill('[data-testid="email-input"]', email);
  await page.fill('[data-testid="password-input"]', password);
  await page.click('[data-testid="sign-in-button"]');
  await page.waitForSelector('[data-testid="autopilot-status-card"]', { timeout: 15000 });

  await page.goto(`http://127.0.0.1:8081/onboarding/review-entities?session_id=${sessionId}`);
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: "/home/ubuntu/screenshots/danger-review-visible.png",
    fullPage: false,
  });
  console.log("screenshot saved");

  // keep the window open for on-screen viewing
  await page.waitForTimeout(180000);
  await browser.close();
})();
