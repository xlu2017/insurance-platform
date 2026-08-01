import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type AdminClient = SupabaseClient<any, "public", any>;

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblY8_IU";

const CUSTOMER_ID = "00000000-0000-0000-0000-000000000001";
const CUSTOMER_EMAIL = "customer@example.com";
const CUSTOMER_PASSWORD = "DemoCustomer123!";

function assertLocalSupabase() {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Destructive integration tests may only run against local Supabase.");
  }
}

async function getCustomerAccessToken(): Promise<string> {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await client.auth.signInWithPassword({
    email: CUSTOMER_EMAIL,
    password: CUSTOMER_PASSWORD,
  });
  if (error || !data.session) throw new Error("Failed to sign in customer: " + error?.message);
  return data.session.access_token;
}

async function createBatch(
  accessToken: string,
  householdId: string,
  clientRequestId: string,
  extraBody?: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/document-processing-batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "create",
      household_id: householdId,
      client_request_id: clientRequestId,
      ...extraBody,
    }),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text };
  }
  return { status: res.status, body };
}

describe("document-processing-batch create action", () => {
  let accessToken: string;

  beforeAll(async () => {
    assertLocalSupabase();
    accessToken = await getCustomerAccessToken();
  });

  async function setupHousehold(admin: AdminClient) {
    const householdId = `90000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    await admin.from("households").insert({
      id: householdId,
      owner_profile_id: CUSTOMER_ID,
      name: "Batch Test Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "document_processing_consent",
    });
    await admin
      .from("household_members")
      .insert({ household_id: householdId, profile_id: CUSTOMER_ID, member_role: "owner" });
    return householdId;
  }

  async function tearDownHousehold(admin: AdminClient, householdId: string) {
    await admin.from("document_processing_batch_items").delete().eq("household_id", householdId);
    await admin.from("document_processing_batches").delete().eq("household_id", householdId);
    await admin.from("document_extraction_sessions").delete().eq("household_id", householdId);
    await admin.from("optimization_cases").delete().eq("household_id", householdId);
    await admin.from("document_processing_authorizations").delete().eq("household_id", householdId);
    await admin.from("document_processing_consent").delete().eq("household_id", householdId);
    await admin.from("household_document_processing_settings").delete().eq("household_id", householdId);
    await admin.from("household_members").delete().eq("household_id", householdId);
    await admin.from("households").delete().eq("id", householdId);
  }

  it("creates a safe batch when Dangerous mode is not enabled", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await setupHousehold(admin);

    await admin.from("household_document_processing_settings").insert({
      household_id: householdId,
      dangerous_mode_enabled: false,
      setting_version: 1,
    });

    const { status, body } = await createBatch(
      accessToken,
      householdId,
      `safe-${randomUUID()}`,
    );
    expect(status).toBe(201);
    expect(body.automatic_processing).toBe(false);

    const { data: batch } = await admin
      .from("document_processing_batches")
      .select("mode_snapshot, consent_id")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(batch?.mode_snapshot).toBe("safe");
    expect(batch?.consent_id).toBeNull();

    await tearDownHousehold(admin, householdId);
  });

  it("returns CONSENT_REQUIRED when Dangerous mode is enabled without active consent", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await setupHousehold(admin);

    await admin.from("household_document_processing_settings").insert({
      household_id: householdId,
      dangerous_mode_enabled: true,
      setting_version: 1,
      disclosure_version: "dangerous-mode-v1",
      configured_provider: "gemini",
      configured_model_id: "gemini-2.5-flash",
    });

    const { status, body } = await createBatch(
      accessToken,
      householdId,
      `consent-missing-${randomUUID()}`,
    );
    expect(status).toBe(403);
    expect(body.code).toBe("CONSENT_REQUIRED");

    await tearDownHousehold(admin, householdId);
  });

  it("creates a dangerous batch when Dangerous mode and active consent are present", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await setupHousehold(admin);

    await admin.from("household_document_processing_settings").insert({
      household_id: householdId,
      dangerous_mode_enabled: true,
      setting_version: 1,
      disclosure_version: "dangerous-mode-v1",
      configured_provider: "gemini",
      configured_model_id: "gemini-2.5-flash",
    });

    const { data: consent } = await admin
      .from("document_processing_consent")
      .insert({
        household_id: householdId,
        profile_id: CUSTOMER_ID,
        purpose: "insurance_policy_extraction",
        privacy_notice_version: "dangerous-mode-v1",
        processor_contract_version: "processor-contract-v1",
        foreign_processing_acknowledged: true,
        automated_processing_acknowledged: true,
        raw_processing_approved: true,
        authority_basis: "household_owner",
        status: "active",
      })
      .select("id")
      .single();

    const { status, body } = await createBatch(
      accessToken,
      householdId,
      `dangerous-${randomUUID()}`,
    );
    expect(status).toBe(201);
    expect(body.automatic_processing).toBe(true);

    const { data: batch } = await admin
      .from("document_processing_batches")
      .select("mode_snapshot, consent_id")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(batch?.mode_snapshot).toBe("dangerous");
    expect(batch?.consent_id).toBe(consent?.id);

    await tearDownHousehold(admin, householdId);
  });

  it("ignores a client-supplied mode parameter and uses the protected setting", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await setupHousehold(admin);

    await admin.from("household_document_processing_settings").insert({
      household_id: householdId,
      dangerous_mode_enabled: true,
      setting_version: 1,
      disclosure_version: "dangerous-mode-v1",
      configured_provider: "gemini",
      configured_model_id: "gemini-2.5-flash",
    });

    await admin.from("document_processing_consent").insert({
      household_id: householdId,
      profile_id: CUSTOMER_ID,
      purpose: "insurance_policy_extraction",
      privacy_notice_version: "dangerous-mode-v1",
      processor_contract_version: "processor-contract-v1",
      foreign_processing_acknowledged: true,
      automated_processing_acknowledged: true,
      raw_processing_approved: true,
      authority_basis: "household_owner",
      status: "active",
    });

    const { status, body } = await createBatch(
      accessToken,
      householdId,
      `client-safe-${randomUUID()}`,
      { mode: "safe" },
    );
    expect(status).toBe(201);
    expect(body.automatic_processing).toBe(true);

    const { data: batch } = await admin
      .from("document_processing_batches")
      .select("mode_snapshot")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(batch?.mode_snapshot).toBe("dangerous");

    await tearDownHousehold(admin, householdId);
  });

  it("creates a safe batch after Dangerous mode is explicitly disabled", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await setupHousehold(admin);

    await admin.from("household_document_processing_settings").insert({
      household_id: householdId,
      dangerous_mode_enabled: true,
      setting_version: 1,
      disclosure_version: "dangerous-mode-v1",
      configured_provider: "gemini",
      configured_model_id: "gemini-2.5-flash",
    });

    await admin.from("document_processing_consent").insert({
      household_id: householdId,
      profile_id: CUSTOMER_ID,
      purpose: "insurance_policy_extraction",
      privacy_notice_version: "dangerous-mode-v1",
      processor_contract_version: "processor-contract-v1",
      foreign_processing_acknowledged: true,
      automated_processing_acknowledged: true,
      raw_processing_approved: true,
      authority_basis: "household_owner",
      status: "active",
    });

    // Explicitly disable Dangerous mode before batch creation.
    await admin
      .from("household_document_processing_settings")
      .update({ dangerous_mode_enabled: false, setting_version: 2 })
      .eq("household_id", householdId);

    const { status, body } = await createBatch(
      accessToken,
      householdId,
      `disabled-${randomUUID()}`,
    );
    expect(status).toBe(201);
    expect(body.automatic_processing).toBe(false);

    const { data: batch } = await admin
      .from("document_processing_batches")
      .select("mode_snapshot, consent_id")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(batch?.mode_snapshot).toBe("safe");
    expect(batch?.consent_id).toBeNull();

    await tearDownHousehold(admin, householdId);
  });
});
