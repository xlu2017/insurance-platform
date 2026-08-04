import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const CUSTOMER_ID = "00000000-0000-0000-0000-000000000001";

interface BatchCreateResult {
  batch: { id: string } & Record<string, unknown>;
  session_id: string;
}

describe("create_document_processing_batch RPC concurrency", () => {
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

  async function createHousehold() {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = `b0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdId);
    await admin.from("households").insert({
      id: householdId,
      owner_profile_id: CUSTOMER_ID,
      name: "Batch Concurrency Test Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });
    await admin
      .from("household_members")
      .insert({ household_id: householdId, profile_id: CUSTOMER_ID, member_role: "owner" });
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

  it("serializes concurrent case batch creation so exactly one batch, session, and audit event exist", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const householdId = await createHousehold();
    const caseId = await createCase(householdId);

    const rpcArgs = {
      p_case_id: caseId,
      p_client_request_id: `case-upload:${caseId}`,
      p_actor_id: CUSTOMER_ID,
    };

    const responses = await Promise.all([
      admin.rpc("create_document_processing_batch", rpcArgs).single(),
      admin.rpc("create_document_processing_batch", rpcArgs).single(),
      admin.rpc("create_document_processing_batch", rpcArgs).single(),
    ]);

    const batchIds = new Set<string>();
    for (const response of responses) {
      expect(response.error).toBeNull();
      const result = response.data as BatchCreateResult | null;
      expect(result?.batch).toBeDefined();
      batchIds.add(result!.batch.id);
    }

    expect(batchIds.size).toBe(1);
    const batchId = Array.from(batchIds)[0];

    const { data: batchRows } = await admin
      .from("document_processing_batches")
      .select("id")
      .eq("case_id", caseId)
      .eq("status", "uploading_files");
    expect(batchRows?.length).toBe(1);

    const { data: sessionRows } = await admin
      .from("document_extraction_sessions")
      .select("id")
      .eq("case_id", caseId);
    expect(sessionRows?.length).toBe(1);

    const { data: auditRows } = await admin
      .from("audit_events")
      .select("id")
      .eq("case_id", caseId)
      .eq("action", "document_processing_batch_created");
    expect(auditRows?.length).toBe(1);

    const { data: session } = await admin
      .from("document_extraction_sessions")
      .select("id, case_id")
      .eq("case_id", caseId)
      .single();
    expect(session?.id).toBeTruthy();
    expect(session?.case_id).toBe(caseId);
  });
});
