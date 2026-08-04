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

  async function confirmAsCustomer(caseId: string, expectedState?: string) {
    const client = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    return client.rpc("confirm_customer_case_details", {
      p_case_id: caseId,
      p_expected_state: expectedState,
    });
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

    const { data: audit } = await admin
      .from("audit_events")
      .select("action")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(audit?.action).toBe("customer_confirmed_extracted_information");
  });

  it("is idempotent for an already confirmed case", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold(admin);
    const caseId = await createCase(householdId, "ready_for_market_search");

    const { data, error } = await confirmAsCustomer(caseId);
    expect(error).toBeNull();
    expect(data?.already_confirmed).toBe(true);

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
    expect(error?.message).toMatch(/household/);
  });

  it("rejects a case that is not in the expected state", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold(admin);
    const caseId = await createCase(householdId, "draft");

    const { error } = await confirmAsCustomer(caseId);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/not ready/);
  });
});
