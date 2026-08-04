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
const OTHER_ID = "00000000-0000-0000-0000-000000000002";

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

describe("confirm_customer_case_details RPC", () => {
  let accessToken: string;
  const createdCaseIds: string[] = [];
  const createdHouseholdIds: string[] = [];

  beforeAll(async () => {
    assertLocalSupabase();
    accessToken = await getCustomerAccessToken();
  });

  afterEach(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    for (const caseId of createdCaseIds) {
      await admin.from("audit_events").delete().eq("case_id", caseId);
      await admin.from("document_processing_batches").delete().eq("case_id", caseId);
      await admin.from("document_extraction_sessions").delete().eq("case_id", caseId);
      await admin.from("optimization_cases").delete().eq("id", caseId);
    }
    for (const householdId of createdHouseholdIds) {
      await admin.from("household_members").delete().eq("household_id", householdId);
      await admin.from("households").delete().eq("id", householdId);
    }
    createdCaseIds.length = 0;
    createdHouseholdIds.length = 0;
  });

  async function createHousehold(admin: AdminClient, ownerId = CUSTOMER_ID) {
    const householdId = `90000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdId);
    await admin.from("households").insert({
      id: householdId,
      owner_profile_id: ownerId,
      name: "Confirm RPC Test Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });
    await admin
      .from("household_members")
      .insert({ household_id: householdId, profile_id: ownerId, member_role: "owner" });
    return householdId;
  }

  async function createCase(householdId: string, state = "awaiting_customer_confirmation") {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const caseId = `a0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    const { error } = await admin.from("optimization_cases").insert({
      id: caseId,
      household_id: householdId,
      state,
      created_by: CUSTOMER_ID,
    });
    if (error) throw error;
    createdCaseIds.push(caseId);
    return caseId;
  }

  async function confirmAsCustomer(caseId: string) {
    const client = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    return client.rpc("confirm_customer_case_details", { p_case_id: caseId });
  }

  it("transitions the case and writes an audit event", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold(admin);
    const caseId = await createCase(householdId);

    const { data, error } = await confirmAsCustomer(caseId);
    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    const { data: caseRow } = await admin
      .from("optimization_cases")
      .select("state, closed_from_state")
      .eq("id", caseId)
      .single();
    expect(caseRow?.state).toBe("ready_for_market_search");

    const { data: auditRows } = await admin
      .from("audit_events")
      .select("action")
      .eq("case_id", caseId)
      .eq("action", "customer_confirmed_extracted_information");
    expect(auditRows?.length).toBe(1);
    expect(auditRows?.[0]?.action).toBe("customer_confirmed_extracted_information");
  });

  it("is idempotent and leaves exactly one audit event after two calls", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold(admin);
    const caseId = await createCase(householdId);

    const first = await confirmAsCustomer(caseId);
    expect(first.error).toBeNull();
    expect(first.data?.success).toBe(true);

    const second = await confirmAsCustomer(caseId);
    expect(second.error).toBeNull();
    expect(second.data?.already_confirmed).toBe(true);

    const { data: events } = await admin
      .from("audit_events")
      .select("id")
      .eq("case_id", caseId)
      .eq("action", "customer_confirmed_extracted_information");
    expect(events?.length).toBe(1);
  });

  it("rejects a case that does not belong to the customer", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold(admin, OTHER_ID);
    const caseId = await createCase(householdId);

    const { error } = await confirmAsCustomer(caseId);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/household|access|denied/i);
  });

  it("rejects a case that is not awaiting_customer_confirmation", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold(admin);
    const caseId = await createCase(householdId, "draft");

    const { error } = await confirmAsCustomer(caseId);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not ready|awaiting_customer_confirmation/i);

    const { data: caseRow } = await admin
      .from("optimization_cases")
      .select("state")
      .eq("id", caseId)
      .single();
    expect(caseRow?.state).toBe("draft");
  });

  it("cannot force non-confirmation states into ready_for_market_search", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold(admin);

    for (const state of [
      "draft",
      "licensed_review",
      "completed",
      "retained_incumbent",
      "cancelled",
    ] as const) {
      const caseId = await createCase(householdId, state);

      const { error } = await confirmAsCustomer(caseId);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/not ready|already_confirmed/i);

      const { data: caseRow } = await admin
        .from("optimization_cases")
        .select("state")
        .eq("id", caseId)
        .single();
      expect(caseRow?.state).toBe(state);

      const { data: audit } = await admin
        .from("audit_events")
        .select("id")
        .eq("case_id", caseId)
        .eq("action", "customer_confirmed_extracted_information")
        .single();
      expect(audit).toBeNull();
    }
  });

  it("returns already_confirmed after subsequent workflow advancement only when the confirmation event exists", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold(admin);

    // Without confirmation event, an advanced case is rejected.
    const advancedWithoutAudit = await createCase(householdId, "requesting_quotes");
    const rejectResult = await confirmAsCustomer(advancedWithoutAudit);
    expect(rejectResult.error).not.toBeNull();
    expect(rejectResult.error?.message).toMatch(/not ready/i);

    // Confirm a fresh case, then manually simulate workflow advancement.
    const caseId = await createCase(householdId);
    const { data: confirmData, error: confirmError } = await confirmAsCustomer(caseId);
    expect(confirmError).toBeNull();
    expect(confirmData?.success).toBe(true);

    await admin.from("optimization_cases").update({ state: "requesting_quotes" }).eq("id", caseId);

    const retry = await confirmAsCustomer(caseId);
    expect(retry.error).toBeNull();
    expect(retry.data?.already_confirmed).toBe(true);

    const { data: events } = await admin
      .from("audit_events")
      .select("id")
      .eq("case_id", caseId)
      .eq("action", "customer_confirmed_extracted_information");
    expect(events?.length).toBe(1);
  });
});
