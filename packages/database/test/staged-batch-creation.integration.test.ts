import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertLocalSupabase,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY,
  LOCAL_SUPABASE_URL,
} from "@autopilot/test-fixtures";

const SUPABASE_URL = process.env.SUPABASE_URL ?? LOCAL_SUPABASE_URL;
const SERVICE_ROLE_KEY = LOCAL_SUPABASE_SERVICE_ROLE_KEY;
const CUSTOMER_ID = "00000000-0000-0000-0000-000000000001";

function serviceRoleClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  });
}

function uniqueDigest() {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

async function createIsolatedHousehold() {
  const admin = serviceRoleClient();
  const householdId = `c0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
  await admin.from("households").insert({
    id: householdId,
    owner_profile_id: CUSTOMER_ID,
    name: "Staged Batch Household",
    province: "AB",
    autopilot_active: false,
    onboarding_step: "complete",
  });
  await admin.from("household_members").insert({
    household_id: householdId,
    profile_id: CUSTOMER_ID,
    member_role: "owner",
  });
  return householdId;
}

async function createStagedDocument(admin: SupabaseClient, householdId: string) {
  const id = randomUUID();
  const digest = uniqueDigest();
  const { error } = await admin.from("policy_documents").insert({
    id,
    household_id: householdId,
    file_name: `staged-${randomUUID()}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 1024,
    storage_path: `docs/${randomUUID()}.pdf`,
    uploaded_by: CUSTOMER_ID,
    category: "other",
    content_sha256: digest,
    status: "staged",
  });
  if (error) throw error;
  return { id, digest };
}

async function createStagedInForeignHousehold() {
  const admin = serviceRoleClient();
  const householdId = `f0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
  await admin.from("households").insert({
    id: householdId,
    owner_profile_id: "00000000-0000-0000-0000-000000000004",
    name: "Foreign Staged Household",
    province: "AB",
    autopilot_active: false,
    onboarding_step: "complete",
  });
  return householdId;
}

beforeAll(async () => {
  await assertLocalSupabase();
});

describe("create_document_batch_from_staged_v1", () => {
  const createdHouseholdIds: string[] = [];

  afterEach(async () => {
    const admin = serviceRoleClient();
    for (const householdId of createdHouseholdIds) {
      await admin.from("document_processing_batch_items").delete().eq("household_id", householdId);
      await admin
        .from("document_processing_batch_normalizations")
        .delete()
        .eq("household_id", householdId);
      await admin.from("document_processing_batches").delete().eq("household_id", householdId);
      await admin.from("document_extraction_sessions").delete().eq("household_id", householdId);
      await admin.from("optimization_cases").delete().eq("household_id", householdId);
      await admin.from("policy_documents").delete().eq("household_id", householdId);
      await admin.from("household_members").delete().eq("household_id", householdId);
      await admin.from("households").delete().eq("id", householdId);
    }
    createdHouseholdIds.length = 0;
  });

  it("creates a batch and items transactionally from staged documents", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const doc1 = await createStagedDocument(admin, householdId);
    const doc2 = await createStagedDocument(admin, householdId);
    const clientRequestId = `staged-batch-${randomUUID()}`;

    const { data, error } = await admin.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [doc1.id, doc2.id],
      p_client_request_id: clientRequestId,
      p_case_id: null,
      p_actor_id: CUSTOMER_ID,
    });
    expect(error).toBeNull();

    const typed = data as { batch: { id: string }; session_id: string };
    expect(typed.batch).toBeDefined();
    expect(typed.session_id).toBeDefined();

    const { data: items } = await admin
      .from("document_processing_batch_items")
      .select("policy_document_id")
      .eq("batch_id", typed.batch.id)
      .order("policy_document_id");
    expect(items).toHaveLength(2);
    expect(items?.map((i) => i.policy_document_id)).toEqual(
      expect.arrayContaining([doc1.id, doc2.id]),
    );

    const { data: docs } = await admin
      .from("policy_documents")
      .select("status")
      .in("id", [doc1.id, doc2.id]);
    expect(docs?.every((d) => d.status !== "staged")).toBe(true);
  });

  it("is idempotent for the same client request ID with reordered IDs", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const doc1 = await createStagedDocument(admin, householdId);
    const doc2 = await createStagedDocument(admin, householdId);
    const clientRequestId = `staged-batch-${randomUUID()}`;

    const { data: first } = await admin.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [doc1.id, doc2.id],
      p_client_request_id: clientRequestId,
      p_case_id: null,
      p_actor_id: CUSTOMER_ID,
    });
    const { data: second } = await admin.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [doc2.id, doc1.id],
      p_client_request_id: clientRequestId,
      p_case_id: null,
      p_actor_id: CUSTOMER_ID,
    });

    expect((first as any).batch.id).toBe((second as any).batch.id);
    expect((first as any).session_id).toBe((second as any).session_id);

    const { count } = await admin
      .from("document_processing_batches")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(count).toBe(1);
  });

  it("rejects a changed document set for the same client request ID", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const doc1 = await createStagedDocument(admin, householdId);
    const doc2 = await createStagedDocument(admin, householdId);
    const doc3 = await createStagedDocument(admin, householdId);
    const clientRequestId = `staged-batch-${randomUUID()}`;

    const { error: firstError } = await admin.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [doc1.id, doc2.id],
      p_client_request_id: clientRequestId,
      p_case_id: null,
      p_actor_id: CUSTOMER_ID,
    });
    expect(firstError).toBeNull();

    const { error: secondError } = await admin.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [doc1.id, doc3.id],
      p_client_request_id: clientRequestId,
      p_case_id: null,
      p_actor_id: CUSTOMER_ID,
    });
    expect(secondError).not.toBeNull();
    expect(secondError?.message).toMatch(/CONTINUATION_PAYLOAD_MISMATCH/);
  });

  it("rejects duplicate, null, missing and foreign document IDs", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    const foreignHouseholdId = await createStagedInForeignHousehold();
    createdHouseholdIds.push(householdId, foreignHouseholdId);

    const doc1 = await createStagedDocument(admin, householdId);
    const foreignDoc = await createStagedDocument(admin, foreignHouseholdId);

    const { error: duplicateError } = await admin.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [doc1.id, doc1.id],
      p_client_request_id: `dup-${randomUUID()}`,
      p_case_id: null,
      p_actor_id: CUSTOMER_ID,
    });
    expect(duplicateError?.message).toMatch(/DUPLICATE/);

    const { error: nullError } = await admin.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [null as any],
      p_client_request_id: `null-${randomUUID()}`,
      p_case_id: null,
      p_actor_id: CUSTOMER_ID,
    });
    expect(nullError?.message).toMatch(/NULL/);

    const { error: missingError } = await admin.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [randomUUID()],
      p_client_request_id: `missing-${randomUUID()}`,
      p_case_id: null,
      p_actor_id: CUSTOMER_ID,
    });
    expect(missingError?.message).toMatch(/MISSING/);

    const { error: foreignError } = await admin.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [foreignDoc.id],
      p_client_request_id: `foreign-${randomUUID()}`,
      p_case_id: null,
      p_actor_id: CUSTOMER_ID,
    });
    expect(foreignError?.message).toMatch(/FOREIGN|MISSING/);
  });

  it("requires every document to be staged", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const doc = await createStagedDocument(admin, householdId);
    await admin.from("policy_documents").update({ status: "uploaded" }).eq("id", doc.id);

    const { error } = await admin.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [doc.id],
      p_client_request_id: `not-staged-${randomUUID()}`,
      p_case_id: null,
      p_actor_id: CUSTOMER_ID,
    });
    expect(error?.message).toMatch(/NOT_STAGED/);
  });

  it("rejects cross-household creation", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    const foreignHouseholdId = await createStagedInForeignHousehold();
    createdHouseholdIds.push(householdId, foreignHouseholdId);

    const foreignDoc = await createStagedDocument(admin, foreignHouseholdId);

    const { error } = await admin.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [foreignDoc.id],
      p_client_request_id: `xhh-${randomUUID()}`,
      p_case_id: null,
      p_actor_id: CUSTOMER_ID,
    });
    expect(error?.message).toMatch(/FOREIGN|MISSING/);
  });
});
