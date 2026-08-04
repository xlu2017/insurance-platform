import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODMxMjk5Nn0.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const CUSTOMER_ID = "00000000-0000-0000-0000-000000000001";
const CUSTOMER_EMAIL = "customer@example.com";
const CUSTOMER_PASSWORD = "DemoCustomer123!";

interface BatchCreateResult {
  batch: { id: string; case_id?: string | null } & Record<string, unknown>;
  session_id: string;
}

describe("create_document_processing_batch RPC generic idempotency", () => {
  const createdHouseholdIds: string[] = [];
  const createdCaseIds: string[] = [];

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

  async function createHousehold(ownerId: string = CUSTOMER_ID) {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = `b0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdId);
    await admin.from("households").insert({
      id: householdId,
      owner_profile_id: ownerId,
      name: "Batch Generic Test Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });
    await admin
      .from("household_members")
      .insert({ household_id: householdId, profile_id: ownerId, member_role: "owner" });
    return householdId;
  }

  async function createCase(householdId: string) {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const caseId = `c0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    const { error } = await admin.from("optimization_cases").insert({
      id: caseId,
      household_id: householdId,
      state: "awaiting_documents",
      created_by: CUSTOMER_ID,
    });
    if (error) throw error;
    createdCaseIds.push(caseId);
    return caseId;
  }

  async function getAuthenticatedClient(): Promise<SupabaseClient> {
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await anon.auth.signInWithPassword({
      email: CUSTOMER_EMAIL,
      password: CUSTOMER_PASSWORD,
    });
    if (error || !data.session) throw error ?? new Error("Could not sign in test customer");
    return createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    });
  }

  it("requires a non-empty client_request_id for generic household uploads", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold();
    const { error } = await admin
      .rpc("create_document_processing_batch", {
        p_household_id: householdId,
        p_actor_id: CUSTOMER_ID,
      })
      .single();
    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/client_request_id is required/i);
  });

  it("returns the same batch for two sequential generic calls with the same key", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold();
    const clientRequestId = `generic-review:${randomUUID()}`;

    const first = await admin
      .rpc("create_document_processing_batch", {
        p_household_id: householdId,
        p_client_request_id: clientRequestId,
        p_actor_id: CUSTOMER_ID,
      })
      .single();
    expect(first.error).toBeNull();
    const firstResult = first.data as BatchCreateResult;
    const firstCaseId = firstResult.batch.case_id;
    if (firstCaseId) createdCaseIds.push(firstCaseId);

    const second = await admin
      .rpc("create_document_processing_batch", {
        p_household_id: householdId,
        p_client_request_id: clientRequestId,
        p_actor_id: CUSTOMER_ID,
      })
      .single();
    expect(second.error).toBeNull();
    const secondResult = second.data as BatchCreateResult;

    expect(secondResult.batch.id).toBe(firstResult.batch.id);
    expect(secondResult.batch.case_id).toBe(firstResult.batch.case_id);

    const { count: caseCount } = await admin
      .from("optimization_cases")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(caseCount).toBe(1);
  });

  it("serializes three concurrent generic calls into one case, batch, session, and audit event", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold();
    const clientRequestId = `generic-concurrent:${randomUUID()}`;

    const responses = await Promise.all([
      admin.rpc("create_document_processing_batch", {
        p_household_id: householdId,
        p_client_request_id: clientRequestId,
        p_actor_id: CUSTOMER_ID,
      }),
      admin.rpc("create_document_processing_batch", {
        p_household_id: householdId,
        p_client_request_id: clientRequestId,
        p_actor_id: CUSTOMER_ID,
      }),
      admin.rpc("create_document_processing_batch", {
        p_household_id: householdId,
        p_client_request_id: clientRequestId,
        p_actor_id: CUSTOMER_ID,
      }),
    ]);

    const batchIds = new Set<string>();
    const caseIds = new Set<string>();
    for (const response of responses) {
      expect(response.error).toBeNull();
      const result = response.data as BatchCreateResult;
      batchIds.add(result.batch.id);
      if (result.batch.case_id) caseIds.add(result.batch.case_id);
    }

    if (caseIds.size > 0) createdCaseIds.push(...Array.from(caseIds));

    expect(batchIds.size).toBe(1);
    expect(caseIds.size).toBe(1);
    const caseId = Array.from(caseIds)[0];

    const { count: batchCount } = await admin
      .from("document_processing_batches")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(batchCount).toBe(1);

    const { count: sessionCount } = await admin
      .from("document_extraction_sessions")
      .select("*", { count: "exact", head: true })
      .eq("case_id", caseId);
    expect(sessionCount).toBe(1);

    const { count: auditCount } = await admin
      .from("audit_events")
      .select("*", { count: "exact", head: true })
      .eq("case_id", caseId)
      .eq("action", "document_processing_batch_created");
    expect(auditCount).toBe(1);
  });

  it("rejects a generic call with a key that already belongs to another case", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold();
    const case1 = await createCase(householdId);

    const first = await admin
      .rpc("create_document_processing_batch", {
        p_case_id: case1,
        p_client_request_id: `case-upload:${case1}`,
        p_actor_id: CUSTOMER_ID,
      })
      .single();
    expect(first.error).toBeNull();

    const case2 = await createCase(householdId);
    const { error } = await admin
      .rpc("create_document_processing_batch", {
        p_case_id: case2,
        p_client_request_id: `case-upload:${case1}`,
        p_actor_id: CUSTOMER_ID,
      })
      .single();

    expect(error).toBeTruthy();
    expect(error?.message).toMatch(/IDEMPOTENCY_KEY_CONFLICT/i);
  });

  it("works when invoked by an authenticated customer", async () => {
    const client = await getAuthenticatedClient();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold();
    const clientRequestId = `generic-auth:${randomUUID()}`;

    const { data, error } = await client
      .rpc("create_document_processing_batch", {
        p_household_id: householdId,
        p_client_request_id: clientRequestId,
      })
      .single();

    expect(error).toBeNull();
    const result = data as BatchCreateResult;
    expect(result.batch.id).toBeTruthy();
    if (result.batch.case_id) createdCaseIds.push(result.batch.case_id);

    const { count: caseCount } = await admin
      .from("optimization_cases")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(caseCount).toBe(1);
  });

  it("rejects unauthorized household and case access", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const otherCustomerId = `d0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    // Ensure the other "customer" has a profile so membership checks are meaningful.
    await admin.auth.admin.createUser({
      email: `test-${randomUUID()}@example.com`,
      password: "password123",
      id: otherCustomerId,
      email_confirm: true,
    });

    const householdId = await createHousehold(otherCustomerId);
    const caseId = await createCase(householdId);

    const { error: householdError } = await admin
      .rpc("create_document_processing_batch", {
        p_household_id: householdId,
        p_client_request_id: `generic-unauthorized:${randomUUID()}`,
        p_actor_id: CUSTOMER_ID,
      })
      .single();
    expect(householdError).toBeTruthy();
    expect(householdError?.message).toMatch(/access denied/i);

    const { error: caseError } = await admin
      .rpc("create_document_processing_batch", {
        p_case_id: caseId,
        p_client_request_id: `case-upload:${caseId}`,
        p_actor_id: CUSTOMER_ID,
      })
      .single();
    expect(caseError).toBeTruthy();
    expect(caseError?.message).toMatch(/access denied|not found/i);
  });
});

describe("create_document_processing_batch RPC case branch", () => {
  const createdHouseholdIds: string[] = [];
  const createdCaseIds: string[] = [];

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

  async function createHousehold(ownerId: string = CUSTOMER_ID) {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = `b0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdId);
    await admin.from("households").insert({
      id: householdId,
      owner_profile_id: ownerId,
      name: "Batch Case Test Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });
    await admin
      .from("household_members")
      .insert({ household_id: householdId, profile_id: ownerId, member_role: "owner" });
    return householdId;
  }

  async function createCase(householdId: string) {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const caseId = `c0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    const { error } = await admin.from("optimization_cases").insert({
      id: caseId,
      household_id: householdId,
      state: "awaiting_documents",
      created_by: CUSTOMER_ID,
    });
    if (error) throw error;
    createdCaseIds.push(caseId);
    return caseId;
  }

  it("creates the first batch for an existing awaiting_documents case without duplicating the case", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold();
    const caseId = await createCase(householdId);

    const { data, error } = await admin
      .rpc("create_document_processing_batch", {
        p_case_id: caseId,
        p_client_request_id: `case-upload:${caseId}`,
        p_actor_id: CUSTOMER_ID,
      })
      .single();

    expect(error).toBeNull();
    const result = data as BatchCreateResult;
    expect(result.batch.case_id).toBe(caseId);
    expect(result.batch.status).toBe("uploading_files");

    const { count: caseCount } = await admin
      .from("optimization_cases")
      .select("*", { count: "exact", head: true })
      .eq("id", caseId);
    expect(caseCount).toBe(1);

    const { count: batchCount } = await admin
      .from("document_processing_batches")
      .select("*", { count: "exact", head: true })
      .eq("case_id", caseId);
    expect(batchCount).toBe(1);

    const { count: auditCount } = await admin
      .from("audit_events")
      .select("*", { count: "exact", head: true })
      .eq("case_id", caseId)
      .eq("action", "document_processing_batch_created");
    expect(auditCount).toBe(1);
  });

  it("reuses the same batch for repeated first-batch calls on the same case", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold();
    const caseId = await createCase(householdId);

    const responses = await Promise.all([
      admin.rpc("create_document_processing_batch", {
        p_case_id: caseId,
        p_client_request_id: `case-upload:${caseId}`,
        p_actor_id: CUSTOMER_ID,
      }),
      admin.rpc("create_document_processing_batch", {
        p_case_id: caseId,
        p_client_request_id: `case-upload:${caseId}`,
        p_actor_id: CUSTOMER_ID,
      }),
    ]);

    const batchIds = new Set<string>();
    for (const response of responses) {
      expect(response.error).toBeNull();
      const result = response.data as BatchCreateResult;
      batchIds.add(result.batch.id);
    }
    expect(batchIds.size).toBe(1);

    const { count: caseCount } = await admin
      .from("optimization_cases")
      .select("*", { count: "exact", head: true })
      .eq("id", caseId);
    expect(caseCount).toBe(1);
  });
});
