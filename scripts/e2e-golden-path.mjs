// End-to-end golden path run against a freshly seeded local Supabase.
// Exercises: operations state transition, server-side recommendation generation,
// reviewer approval, customer approval, switch advancement to completion, and audit verification.
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

function loadEnv() {
  const env = {};
  const candidates = [".env.local", "apps/admin/.env.local", "apps/mobile/.env.local"];
  for (const file of candidates) {
    try {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const [k, ...rest] = line.split("=");
        if (k && rest.length) env[k.trim()] = rest.join("=").trim();
      }
    } catch {}
  }
  return env;
}

const fileEnv = loadEnv();
const SUPABASE_URL = process.env.SUPABASE_URL || fileEnv.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || fileEnv.SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || "";

const householdId = "20000000-0000-0000-0000-000000000001";
const caseId = "30000000-0000-0000-0000-000000000001";
const customerEmail = "customer@example.com";
const opsEmail = "operations@example.com";
const reviewerEmail = "reviewer@example.com";
const password = "DemoCustomer123!";
const opsPassword = "DemoOperations123!";
const reviewerPassword = "DemoReviewer123!";

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
};

async function signIn(email, pass) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
  if (error) throw error;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false },
  });
}

async function expectSuccess(label, rpc, args) {
  const { data, error } = await rpc(args);
  if (error) throw new Error(`${label} failed: ${error.message}`);
  if (!data || data.success !== true) throw new Error(`${label} returned non-success: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log("Connecting to", SUPABASE_URL);

  // 1. Malicious role claim is rejected at the database level.
  const admin = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  if (SERVICE_KEY) admin.functions.setAuth(SERVICE_KEY);
  const serviceClient = SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${SERVICE_KEY}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

  if (serviceClient) {
    const email = `attacker${Date.now()}@example.com`;
    const { data: userData, error: createErr } = await serviceClient.auth.admin.createUser({
      email,
      password: "Password123!",
      email_confirm: true,
      user_metadata: { role: "admin" },
    });
    if (createErr) throw createErr;
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();
    assert(profile.role === "customer", `malicious role claim accepted: ${profile.role}`);
    console.log("1. Malicious admin role claim rejected -> customer");
  } else {
    console.log("1. Skipped malicious role claim test (no service role key)");
  }

  // 2. Operations signs in and transitions the seeded case to comparing_quotes.
  const ops = await signIn(opsEmail, opsPassword);
  await expectSuccess("update_case_state(comparing_quotes)", (a) => ops.rpc("update_case_state", a), {
    p_case_id: caseId,
    p_target_state: "comparing_quotes",
  });
  console.log("2. Case moved to comparing_quotes");

  // 3. Operations generates a recommendation server-side.
  const recResult = await (async () => {
    const { data, error } = await ops.functions.invoke("recommendation-generator", { body: { caseId } });
    if (error) throw new Error(`recommendation-generator failed: ${error.message}`);
    if (data.error) throw new Error(`recommendation-generator returned error: ${data.error}`);
    assert(data && data.recommendationId, "recommendation-generator did not return a recommendationId");
    return data;
  })();
  console.log("3. Generated recommendation", recResult.recommendationId, "version", recResult.version);

  // 4. Verify the case is now in licensed_review.
  const { data: caseAfterGen } = await ops
    .from("optimization_cases")
    .select("state")
    .eq("id", caseId)
    .single();
  assert(caseAfterGen.state === "licensed_review", `case state after generation: ${caseAfterGen.state}`);

  // 5. Reviewer approves and publishes the recommendation.
  const reviewer = await signIn(reviewerEmail, reviewerPassword);
  await expectSuccess("review_recommendation", (a) => reviewer.rpc("review_recommendation", a), {
    p_recommendation_id: recResult.recommendationId,
    p_approved: true,
    p_notes: "Approved by reviewer in E2E",
  });
  const { data: recAfterReview } = await reviewer
    .from("recommendations")
    .select("status")
    .eq("id", recResult.recommendationId)
    .single();
  assert(recAfterReview.status === "published", `recommendation status after review: ${recAfterReview.status}`);
  console.log("5. Reviewer published recommendation");

  // 6. Customer approves the recommendation with correct versions.
  const customer = await signIn(customerEmail, password);
  const { data: mandate } = await customer
    .from("coverage_requirements")
    .select("version")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .single();
  const { data: prefs } = await customer
    .from("switching_preferences")
    .select("version")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .single();
  const approval = await expectSuccess("approve_customer_recommendation", (a) => customer.rpc("approve_customer_recommendation", a), {
    p_recommendation_id: recResult.recommendationId,
    p_expected_rec_version: recResult.version,
    p_expected_mandate_version: mandate.version,
    p_expected_switching_version: prefs.version,
  });
  assert(approval.switch_event_id, "customer approval did not create a switch event");
  console.log("6. Customer approved recommendation; switch event", approval.switch_event_id);

  // 7. Operations advances the switch through every state to completion.
  const ops2 = await signIn(opsEmail, opsPassword);
  const states = [
    "replacement_pending",
    "replacement_confirmed",
    "incumbent_cancellation_pending",
    "incumbent_cancelled",
    "completed",
  ];
  for (const target of states) {
    await expectSuccess(`advance_switch_event(${target})`, (a) => ops2.rpc("advance_switch_event", a), {
      p_switch_event_id: approval.switch_event_id,
      p_target_state: target,
    });
  }
  console.log("7. Switch advanced to completed");

  // 8. Final DB state verification.
  const { data: finalCase } = await ops2
    .from("optimization_cases")
    .select("state")
    .eq("id", caseId)
    .single();
  assert(finalCase.state === "completed", `final case state: ${finalCase.state}`);

  const { data: audits } = await ops2
    .from("audit_events")
    .select("action")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  const actions = audits.map((a) => a.action);
  for (const expected of [
    "recommendation_generated",
    "recommendation_published",
    "recommendation_approved_by_customer",
    "switch_event_advanced",
  ]) {
    assert(actions.includes(expected), `missing audit action: ${expected}`);
  }
  console.log("8. Final case completed and audit actions present");

  console.log("\nGolden path passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
