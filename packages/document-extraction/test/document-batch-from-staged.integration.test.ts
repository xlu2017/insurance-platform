import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertLocalSupabase,
  LOCAL_SUPABASE_ANON_KEY,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY,
  LOCAL_SUPABASE_URL,
} from "@autopilot/test-fixtures";

type AdminClient = SupabaseClient<any, "public", any>;

const SUPABASE_URL = process.env.SUPABASE_URL ?? LOCAL_SUPABASE_URL;
const SERVICE_ROLE_KEY = LOCAL_SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = LOCAL_SUPABASE_ANON_KEY;

const CUSTOMER_ID = "00000000-0000-0000-0000-000000000001";
const CUSTOMER_EMAIL = "customer@example.com";
const CUSTOMER_PASSWORD = "DemoCustomer123!";

async function getCustomerAccessToken(): Promise<string> {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await client.auth.signInWithPassword({
    email: CUSTOMER_EMAIL,
    password: CUSTOMER_PASSWORD,
  });
  if (error || !data.session) throw new Error("Failed to sign in customer: " + error?.message);
  return data.session.access_token;
}

function makePngBlob(salt?: string): Blob {
  const base = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  const suffix = new TextEncoder().encode(salt ?? "");
  return new Blob([base, suffix], { type: "image/png" });
}

async function stageDocument(
  accessToken: string,
  householdId: string,
  file: File,
  stagingRequestId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", "staged");
  form.append("householdId", householdId);
  form.append("category", "auto_detect");
  form.append("stagingRequestId", stagingRequestId);

  const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-document`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY },
    body: form,
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { message: text };
  }
  return { status: res.status, body };
}

async function createFromStaged(
  accessToken: string,
  householdId: string,
  policyDocumentIds: string[],
  clientRequestId: string,
  caseId?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const payload: Record<string, unknown> = {
    action: "create-from-staged",
    household_id: householdId,
    new_policy_document_ids: policyDocumentIds,
    client_request_id: clientRequestId,
  };
  if (caseId) payload.case_id = caseId;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/document-processing-batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { message: text };
  }
  return { status: res.status, body };
}

async function getAuthenticatedSupabaseClient(): Promise<SupabaseClient<any, "public", any>> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email: CUSTOMER_EMAIL,
    password: CUSTOMER_PASSWORD,
  });
  if (error) throw new Error("Failed to sign in customer: " + error.message);
  return client;
}

describe("document-processing-batch create-from-staged action", () => {
  let accessToken: string;
  const createdHouseholdIds: string[] = [];
  const createdDocumentIds: string[] = [];

  beforeAll(async () => {
    assertLocalSupabase(SUPABASE_URL);
    accessToken = await getCustomerAccessToken();
  });

  afterEach(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    for (const documentId of createdDocumentIds) {
      const { data: doc } = await admin
        .from("policy_documents")
        .select("storage_path")
        .eq("id", documentId)
        .maybeSingle();
      if (doc?.storage_path) {
        await admin.storage.from("policy-documents").remove([doc.storage_path]);
      }
    }
    createdDocumentIds.length = 0;
    for (const householdId of createdHouseholdIds) {
      await admin.from("document_processing_batch_items").delete().eq("household_id", householdId);
      await admin.from("document_processing_batches").delete().eq("household_id", householdId);
      await admin.from("document_extraction_sessions").delete().eq("household_id", householdId);
      await admin.from("optimization_cases").delete().eq("household_id", householdId);
      await admin.from("policy_documents").delete().eq("household_id", householdId);
      await admin.from("household_members").delete().eq("household_id", householdId);
      await admin.from("households").delete().eq("id", householdId);
    }
    createdHouseholdIds.length = 0;
  });

  async function setupHousehold(admin: AdminClient, ownerProfileId: string = CUSTOMER_ID) {
    const householdId = `e0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdId);
    await admin.from("households").insert({
      id: householdId,
      owner_profile_id: ownerProfileId,
      name: "Edge Staged Batch Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });
    await admin
      .from("household_members")
      .insert({ household_id: householdId, profile_id: ownerProfileId, member_role: "owner" });
    return householdId;
  }

  it("creates a batch from staged documents and leaves safe mode in manual_review", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = await setupHousehold(admin);

    const file1 = new File([makePngBlob("a")], "staged-1.png", { type: "image/png" });
    const file2 = new File([makePngBlob("b")], "staged-2.png", { type: "image/png" });
    const stage1 = await stageDocument(accessToken, householdId, file1, randomUUID());
    const stage2 = await stageDocument(accessToken, householdId, file2, randomUUID());
    expect(stage1.status).toBe(200);
    expect(stage2.status).toBe(200);
    createdDocumentIds.push(stage1.body.id as string, stage2.body.id as string);

    const clientRequestId = `edge-staged-${randomUUID()}`;
    const { status, body } = await createFromStaged(
      accessToken,
      householdId,
      [stage1.body.id as string, stage2.body.id as string],
      clientRequestId,
    );
    expect(status).toBe(201);
    expect(body.id).toBeDefined();
    expect(body.document_count).toBe(2);

    const { data: items } = await admin
      .from("document_processing_batch_items")
      .select("policy_document_id")
      .eq("batch_id", body.id as string);
    expect(items).toHaveLength(2);

    const { data: docs } = await admin
      .from("policy_documents")
      .select("status")
      .in("id", [stage1.body.id, stage2.body.id]);
    expect(docs?.every((d) => d.status === "in_review")).toBe(true);
  });

  it("is idempotent with reordered IDs", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = await setupHousehold(admin);

    const file = new File([makePngBlob("idem")], "staged-idem.png", { type: "image/png" });
    const staged = await stageDocument(accessToken, householdId, file, randomUUID());
    expect(staged.status).toBe(200);
    createdDocumentIds.push(staged.body.id as string);

    const clientRequestId = `edge-staged-idem-${randomUUID()}`;
    const first = await createFromStaged(
      accessToken,
      householdId,
      [staged.body.id as string],
      clientRequestId,
    );
    const second = await createFromStaged(
      accessToken,
      householdId,
      [staged.body.id as string],
      clientRequestId,
    );
    expect(first.body.id).toBe(second.body.id);
    expect(first.body.session_id).toBe(second.body.session_id);

    const { count } = await admin
      .from("document_processing_batches")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(count).toBe(1);
  });

  it("rejects cross-household creation", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdA = await setupHousehold(admin);
    const householdB = `f0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdB);
    await admin.from("households").insert({
      id: householdB,
      owner_profile_id: "00000000-0000-0000-0000-000000000004",
      name: "Foreign Edge Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });

    const foreignDocId = randomUUID();
    await admin.from("policy_documents").insert({
      id: foreignDocId,
      household_id: householdB,
      file_name: "foreign.png",
      mime_type: "image/png",
      size_bytes: 12,
      storage_path: `docs/${foreignDocId}.png`,
      uploaded_by: "00000000-0000-0000-0000-000000000004",
      category: "other",
      content_sha256: "cc".repeat(32),
      status: "staged",
    });

    const { status, body } = await createFromStaged(
      accessToken,
      householdA,
      [foreignDocId],
      `xhh-${randomUUID()}`,
    );
    expect(status).toBe(403);
    expect(String(body.message ?? "")).toMatch(/FOREIGN|HOUSEHOLD|MISSING/);
  });

  it("rejects an empty new_policy_document_ids array without creating a case, session or batch", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = await setupHousehold(admin);

    const { status, body } = await createFromStaged(
      accessToken,
      householdId,
      [],
      `empty-${randomUUID()}`,
    );
    expect(status).toBe(400);
    expect(String(body.message ?? "")).toMatch(
      /POLICY_DOCUMENT_IDS_REQUIRED|new_policy_document_ids/,
    );

    const { count: caseCount } = await admin
      .from("optimization_cases")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    const { count: sessionCount } = await admin
      .from("document_extraction_sessions")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    const { count: batchCount } = await admin
      .from("document_processing_batches")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(caseCount).toBe(0);
    expect(sessionCount).toBe(0);
    expect(batchCount).toBe(0);
  });

  it("rejects mixed valid and invalid document IDs without creating a case, session or batch", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = await setupHousehold(admin);

    const { status, body } = await createFromStaged(
      accessToken,
      householdId,
      [randomUUID(), "not-a-uuid", "123"],
      `mixed-${randomUUID()}`,
    );
    expect(status).toBe(400);
    expect(String(body.message ?? "")).toMatch(/invalid.*uuid|non-UUID/i);

    const { count: caseCount } = await admin
      .from("optimization_cases")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    const { count: sessionCount } = await admin
      .from("document_extraction_sessions")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    const { count: batchCount } = await admin
      .from("document_processing_batches")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(caseCount).toBe(0);
    expect(sessionCount).toBe(0);
    expect(batchCount).toBe(0);
  });

  it("rejects a foreign case via the create-from-staged Edge contract", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdA = await setupHousehold(admin);
    const householdB = await setupHousehold(admin, "00000000-0000-0000-0000-000000000004");

    const file = new File([makePngBlob("case-foreign")], "staged-case-foreign.png", {
      type: "image/png",
    });
    const staged = await stageDocument(accessToken, householdA, file, randomUUID());
    expect(staged.status).toBe(200);
    createdDocumentIds.push(staged.body.id as string);

    const foreignCase = await admin
      .from("optimization_cases")
      .insert({
        household_id: householdB,
        created_by: "00000000-0000-0000-0000-000000000004",
        state: "awaiting_documents",
      })
      .select("id")
      .single();

    const { status, body } = await createFromStaged(
      accessToken,
      householdA,
      [staged.body.id as string],
      `foreign-case-${randomUUID()}`,
      foreignCase.data?.id as string,
    );
    expect(status).toBe(403);
    expect(String(body.message ?? "")).toMatch(/CASE_NOT_FOUND_OR_FOREIGN|FOREIGN/);
  });

  it("rejects the direct RPC with an empty document list", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = await setupHousehold(admin);
    const client = await getAuthenticatedSupabaseClient();

    const { error } = await client.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdId,
      p_policy_document_ids: [],
      p_client_request_id: `rpc-empty-${randomUUID()}`,
      p_actor_id: CUSTOMER_ID,
      p_case_id: null,
    });

    expect(error).not.toBeNull();
    expect(String(error?.message ?? "")).toMatch(/POLICY_DOCUMENT_IDS_REQUIRED/);

    const { count: caseCount } = await admin
      .from("optimization_cases")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    const { count: batchCount } = await admin
      .from("document_processing_batches")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(caseCount).toBe(0);
    expect(batchCount).toBe(0);
  });

  it("rejects the direct RPC with a foreign case", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdA = await setupHousehold(admin);
    const householdB = await setupHousehold(admin, "00000000-0000-0000-0000-000000000004");
    const file = new File([makePngBlob("rpc-foreign-case")], "staged-rpc-foreign.png", {
      type: "image/png",
    });
    const staged = await stageDocument(accessToken, householdA, file, randomUUID());
    expect(staged.status).toBe(200);
    createdDocumentIds.push(staged.body.id as string);

    const foreignCase = await admin
      .from("optimization_cases")
      .insert({
        household_id: householdB,
        created_by: "00000000-0000-0000-0000-000000000004",
        state: "awaiting_documents",
      })
      .select("id")
      .single();

    const client = await getAuthenticatedSupabaseClient();
    const { error } = await client.rpc("create_document_batch_from_staged_v1", {
      p_household_id: householdA,
      p_policy_document_ids: [staged.body.id],
      p_client_request_id: `rpc-foreign-case-${randomUUID()}`,
      p_actor_id: CUSTOMER_ID,
      p_case_id: foreignCase.data?.id,
    });

    expect(error).not.toBeNull();
    expect(String(error?.message ?? "")).toMatch(/CASE_NOT_FOUND_OR_FOREIGN/);
  });

  it("requires household membership on the authenticated direct RPC path", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const foreignHouseholdId = `e0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(foreignHouseholdId);
    await admin.from("households").insert({
      id: foreignHouseholdId,
      owner_profile_id: "00000000-0000-0000-0000-000000000004",
      name: "Foreign Edge Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });

    const client = await getAuthenticatedSupabaseClient();
    const { error } = await client.rpc("create_document_batch_from_staged_v1", {
      p_household_id: foreignHouseholdId,
      p_policy_document_ids: [randomUUID()],
      p_client_request_id: `rpc-membership-${randomUUID()}`,
      p_actor_id: CUSTOMER_ID,
      p_case_id: null,
    });

    expect(error).not.toBeNull();
    expect(String(error?.message ?? "")).toMatch(/HOUSEHOLD|MEMBER|access denied/);
  });
});
