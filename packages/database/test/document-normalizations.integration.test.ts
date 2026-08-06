import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertLocalSupabase,
  LOCAL_SUPABASE_ANON_KEY,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY,
  LOCAL_SUPABASE_URL,
} from "@autopilot/test-fixtures";

const SUPABASE_URL = process.env.SUPABASE_URL ?? LOCAL_SUPABASE_URL;
const SERVICE_ROLE_KEY = LOCAL_SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = LOCAL_SUPABASE_ANON_KEY;

const CUSTOMER_ID = "00000000-0000-0000-0000-000000000001";

function assertDefined<T>(value: T | undefined | null, message = "expected value"): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

function uniqueDigest() {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function serviceRoleClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  });
}

async function createIsolatedHousehold() {
  const admin = serviceRoleClient();
  const householdId = `b0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
  const { error } = await admin.from("households").insert({
    id: householdId,
    owner_profile_id: CUSTOMER_ID,
    name: "Document Normalizations Household",
    province: "AB",
    autopilot_active: false,
    onboarding_step: "complete",
  });
  if (error) throw error;
  await admin.from("household_members").insert({
    household_id: householdId,
    profile_id: CUSTOMER_ID,
    member_role: "owner",
  });
  return householdId;
}

async function createPolicyDocument(admin: SupabaseClient, householdId: string) {
  const id = randomUUID();
  const digest = uniqueDigest();
  const { error } = await admin.from("policy_documents").insert({
    id,
    household_id: householdId,
    file_name: `doc-${randomUUID()}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 1024,
    storage_path: `docs/${randomUUID()}.pdf`,
    uploaded_by: CUSTOMER_ID,
    category: "other",
    content_sha256: digest,
  });
  if (error) throw error;
  return { id, digest };
}

async function createBatchWithItems(admin: SupabaseClient, householdId: string, itemCount: number) {
  const { data, error } = await admin.rpc("create_document_processing_batch", {
    p_household_id: householdId,
    p_client_request_id: `norm-batch-${randomUUID()}`,
    p_actor_id: CUSTOMER_ID,
  });
  if (error) throw error;
  const typed = data as {
    batch: { id: string; case_id: string; session_id: string } & Record<string, unknown>;
    session_id: string;
  };

  const docs = [];
  for (let i = 0; i < itemCount; i++) {
    const doc = await createPolicyDocument(admin, householdId);
    const { error: itemError } = await admin.from("document_processing_batch_items").insert({
      batch_id: typed.batch.id,
      household_id: householdId,
      client_item_id: `item-${i}-${randomUUID()}`,
      policy_document_id: doc.id,
      selected_file_name: doc.id,
      category: "other",
      content_sha256: doc.digest,
      status: "uploaded",
    });
    if (itemError) throw itemError;
    docs.push(doc);
  }

  await admin
    .from("document_processing_batches")
    .update({ document_count: itemCount })
    .eq("id", typed.batch.id);

  return { batchId: typed.batch.id, sessionId: typed.session_id, docs };
}

async function createCompletedNormalization(
  admin: SupabaseClient,
  householdId: string,
  policyDocumentId: string,
  digest: string,
) {
  const { data, error } = await admin.rpc("persist_document_normalization_v1", {
    p_household_id: householdId,
    p_policy_document_id: policyDocumentId,
    p_content_sha256: digest,
    p_normalization_schema_version: "v1",
    p_analyzer_version: "test-v1",
    p_model_provider: "test",
    p_model_id: "test-model",
    p_prompt_version: "v1",
    p_classification: "supported",
    p_normalized_output_json: {},
    p_normalized_entities_json: [],
    p_conflicts_json: [],
    p_evidence_json: [],
  });
  if (error) throw error;
  return data as { id: string; reused: boolean };
}

beforeAll(async () => {
  await assertLocalSupabase();
});

describe("document normalizations and batch supersession", () => {
  const createdHouseholdIds: string[] = [];

  afterEach(async () => {
    const admin = serviceRoleClient();
    for (const householdId of createdHouseholdIds) {
      await admin.from("households").delete().eq("id", householdId);
    }
    createdHouseholdIds.length = 0;
  });

  it("persist_document_normalization_v1 is idempotent per content version", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const doc = await createPolicyDocument(admin, householdId);
    const first = await createCompletedNormalization(admin, householdId, doc.id, doc.digest);
    const second = await createCompletedNormalization(admin, householdId, doc.id, doc.digest);

    expect(first.id).toBe(second.id);
    expect(second.reused).toBe(true);

    const { count } = await admin
      .from("document_normalizations")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(count).toBe(1);
  });

  it("plan_document_upload_v1 reports no active batch for a quiet household", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const newDoc = await createPolicyDocument(admin, householdId);
    const { data, error } = await admin.rpc("plan_document_upload_v1", {
      p_household_id: householdId,
      p_new_policy_document_ids: [newDoc.id],
    });
    expect(error).toBeNull();
    const plan = data as Record<string, unknown>;
    expect(plan.activeBatchId).toBeNull();
    expect(plan.newDocumentCount).toBe(1);
    expect(plan.restartEstimate).toBeDefined();
    expect(plan.waitEstimate).toBeNull();
  });

  it("plan_document_upload_v1 reports an active batch with completed and unfinished counts", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batchId, docs } = await createBatchWithItems(admin, householdId, 2);
    const firstDoc = assertDefined(docs[0]);
    const norm = await createCompletedNormalization(
      admin,
      householdId,
      firstDoc.id,
      firstDoc.digest,
    );
    const { data: itemRow } = await admin
      .from("document_processing_batch_items")
      .select("id")
      .eq("batch_id", batchId)
      .eq("policy_document_id", firstDoc.id)
      .single();
    await admin.from("document_processing_batch_normalizations").insert({
      batch_id: batchId,
      batch_item_id: assertDefined(itemRow, "missing item row").id,
      normalization_id: norm.id,
      use_status: "created",
    });

    const newDoc = await createPolicyDocument(admin, householdId);
    const { data, error } = await admin.rpc("plan_document_upload_v1", {
      p_household_id: householdId,
      p_new_policy_document_ids: [newDoc.id],
    });
    expect(error).toBeNull();
    const plan = data as Record<string, unknown>;
    expect(plan.activeBatchId).toBe(batchId);
    expect(plan.completedNormalizationCount).toBe(1);
    expect(plan.unfinishedDocumentCount).toBe(1);
    expect(plan.newDocumentCount).toBe(1);
    expect(plan.restartEstimate).toBeDefined();
    expect(plan.waitEstimate).toBeDefined();
  });

  it("supersede_processing_batch_v1 creates a replacement batch and copies completed normalizations", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batchId, docs } = await createBatchWithItems(admin, householdId, 2);
    const firstDoc = assertDefined(docs[0]);
    const norm = await createCompletedNormalization(
      admin,
      householdId,
      firstDoc.id,
      firstDoc.digest,
    );
    const firstItemRow = assertDefined(
      (
        await admin
          .from("document_processing_batch_items")
          .select("id")
          .eq("batch_id", batchId)
          .eq("policy_document_id", firstDoc.id)
          .single()
      ).data,
    );
    await admin.from("document_processing_batch_normalizations").insert({
      batch_id: batchId,
      batch_item_id: firstItemRow.id,
      normalization_id: norm.id,
      use_status: "created",
    });

    const newDoc = await createPolicyDocument(admin, householdId);
    const { data, error } = await admin.rpc("supersede_processing_batch_v1", {
      p_active_batch_id: batchId,
      p_household_id: householdId,
      p_actor_id: CUSTOMER_ID,
      p_new_policy_document_ids: [newDoc.id],
    });
    expect(error).toBeNull();
    const result = data as { new_batch_id: string; superseded_batch_id: string };

    const { data: oldBatch } = await admin
      .from("document_processing_batches")
      .select("status, superseded_by_batch_id")
      .eq("id", batchId)
      .single();
    expect(oldBatch?.status).toBe("superseded");
    expect(oldBatch?.superseded_by_batch_id).toBe(result.new_batch_id);

    const { data: newItems } = await admin
      .from("document_processing_batch_items")
      .select("policy_document_id")
      .eq("batch_id", result.new_batch_id);
    const newDocIds = assertDefined(newItems)
      .map((i) => i.policy_document_id)
      .sort();
    expect(newDocIds).toEqual([...docs.map((d) => d.id), newDoc.id].sort());

    const { data: reusedNorms } = await admin
      .from("document_processing_batch_normalizations")
      .select("normalization_id, use_status")
      .eq("batch_id", result.new_batch_id)
      .eq("normalization_id", norm.id);
    expect(reusedNorms?.length).toBe(1);
    expect(assertDefined(reusedNorms?.[0]).use_status).toBe("reused");
  });

  it("create_successor_document_batch_v1 and advance_successor_batch_v1 reuse normalizations", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batchId, docs } = await createBatchWithItems(admin, householdId, 1);
    await admin
      .from("document_processing_batches")
      .update({ status: "reading_policy_documents" })
      .eq("id", batchId);

    const firstDoc = assertDefined(docs[0]);
    const norm = await createCompletedNormalization(
      admin,
      householdId,
      firstDoc.id,
      firstDoc.digest,
    );
    const firstItemRow = assertDefined(
      (
        await admin
          .from("document_processing_batch_items")
          .select("id")
          .eq("batch_id", batchId)
          .single()
      ).data,
    );
    await admin.from("document_processing_batch_normalizations").insert({
      batch_id: batchId,
      batch_item_id: firstItemRow.id,
      normalization_id: norm.id,
      use_status: "created",
    });

    const newDoc = await createPolicyDocument(admin, householdId);
    const { data: queueData, error: queueError } = await admin.rpc(
      "create_successor_document_batch_v1",
      {
        p_predecessor_batch_id: batchId,
        p_household_id: householdId,
        p_actor_id: CUSTOMER_ID,
        p_new_policy_document_ids: [newDoc.id],
      },
    );
    expect(queueError).toBeNull();
    const queued = queueData as { new_batch_id: string };

    const { data: queuedRow } = await admin
      .from("document_processing_batches")
      .select("status, depends_on_batch_id")
      .eq("id", queued.new_batch_id)
      .single();
    expect(queuedRow?.status).toBe("queued");
    expect(queuedRow?.depends_on_batch_id).toBe(batchId);

    await admin
      .from("document_processing_batches")
      .update({ status: "ready_for_review" })
      .eq("id", batchId);

    const { data: advanceData, error: advanceError } = await admin.rpc(
      "advance_successor_batch_v1",
      {
        p_predecessor_batch_id: batchId,
        p_household_id: householdId,
      },
    );
    expect(advanceError).toBeNull();
    const advanced = advanceData as { advanced: boolean };
    expect(advanced.advanced).toBe(true);

    const { data: successorNorms } = await admin
      .from("document_processing_batch_normalizations")
      .select("normalization_id, use_status")
      .eq("batch_id", queued.new_batch_id);
    expect(
      successorNorms?.some((n) => n.normalization_id === norm.id && n.use_status === "reused"),
    ).toBe(true);
  });

  it("record_document_asset_overlap_v1 stores overlap classifications", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batchId, docs } = await createBatchWithItems(admin, householdId, 1);
    const firstDoc = assertDefined(docs[0]);
    const norm = await createCompletedNormalization(
      admin,
      householdId,
      firstDoc.id,
      firstDoc.digest,
    );

    const { data, error } = await admin.rpc("record_document_asset_overlap_v1", {
      p_batch_id: batchId,
      p_normalization_id: norm.id,
      p_normalized_entity_key: "vehicle-1",
      p_asset_id: null,
      p_asset_type: null,
      p_existing_policy_id: null,
      p_classification: "new_asset",
      p_confidence: 0.95,
      p_details_json: {},
    });
    expect(error).toBeNull();
    expect(data).toBeDefined();
  });
});
