import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
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

function makePngBlob(): Blob {
  // Minimal PNG signature is enough for the upload boundary; content is not parsed.
  return new Blob(
    [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])],
    { type: "image/png" },
  );
}

async function stageDocument(
  accessToken: string,
  householdId: string,
  file: File,
  extraParams?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", "staged");
  form.append("householdId", householdId);
  form.append("category", "auto_detect");
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      form.append(key, value);
    }
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-document`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
    },
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

async function batchUpload(
  accessToken: string,
  householdId: string,
  file: File,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const form = new FormData();
  form.append("file", file);
  form.append("mode", "batch");
  form.append("householdId", householdId);
  form.append("category", "auto_detect");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-document`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
    },
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

describe("upload-document staging mode", () => {
  let accessToken: string;
  const createdHouseholdIds: string[] = [];
  const createdDocumentIds: string[] = [];

  beforeAll(async () => {
    assertLocalSupabase(SUPABASE_URL);
    accessToken = await getCustomerAccessToken();
  });

  async function setupHousehold(admin: AdminClient) {
    const householdId = `a0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdId);
    await admin.from("households").insert({
      id: householdId,
      owner_profile_id: CUSTOMER_ID,
      name: "Staging Test Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });
    await admin
      .from("household_members")
      .insert({ household_id: householdId, profile_id: CUSTOMER_ID, member_role: "owner" });
    return householdId;
  }

  async function setupForeignHousehold(admin: AdminClient) {
    const householdId = `f0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdId);
    await admin.from("households").insert({
      id: householdId,
      owner_profile_id: "00000000-0000-0000-0000-000000000004",
      name: "Foreign Staging Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });
    return householdId;
  }

  async function cleanup(admin: AdminClient, householdId: string) {
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
    await admin.from("document_processing_batch_items").delete().eq("household_id", householdId);
    await admin.from("document_processing_batches").delete().eq("household_id", householdId);
    await admin.from("document_extraction_sessions").delete().eq("household_id", householdId);
    await admin.from("policy_documents").delete().eq("household_id", householdId);
    await admin.from("household_members").delete().eq("household_id", householdId);
    await admin.from("households").delete().eq("id", householdId);
  }

  it("creates a policy document in staged mode without a batch or session", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = await setupHousehold(admin);

    const file = new File([makePngBlob()], "auto-policy.png", { type: "image/png" });
    const { status, body } = await stageDocument(accessToken, householdId, file, {
      stagingRequestId: randomUUID(),
    });
    expect(status).toBe(200);
    expect(body.staged).toBe(true);
    expect(typeof body.id).toBe("string");
    expect(typeof body.content_sha256).toBe("string");
    if (typeof body.id === "string") createdDocumentIds.push(body.id);

    const policyDocumentId = body.id as string;

    const { data: doc } = await admin
      .from("policy_documents")
      .select("id, status, household_id, content_sha256, storage_path, file_name")
      .eq("id", policyDocumentId)
      .single();
    expect(doc?.status).toBe("staged");
    expect(doc?.household_id).toBe(householdId);
    expect(doc?.file_name).toBe("auto-policy.png");

    const { data: batchItems } = await admin
      .from("document_processing_batch_items")
      .select("id")
      .eq("policy_document_id", policyDocumentId);
    expect(batchItems).toHaveLength(0);

    const { data: sessions } = await admin
      .from("document_extraction_sessions")
      .select("id")
      .eq("household_id", householdId);
    expect(sessions).toHaveLength(0);

    await cleanup(admin, householdId);
  });

  it("returns the content digest and does not retransmit on retry with the same staging request ID", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = await setupHousehold(admin);
    const stagingRequestId = randomUUID();

    const file = new File([makePngBlob()], "retry-policy.png", { type: "image/png" });
    const first = await stageDocument(accessToken, householdId, file, { stagingRequestId });
    expect(first.status).toBe(200);
    if (typeof first.body.id === "string") createdDocumentIds.push(first.body.id);

    const second = await stageDocument(accessToken, householdId, file, { stagingRequestId });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.content_sha256).toBe(first.body.content_sha256);

    const { count } = await admin
      .from("policy_documents")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId)
      .eq("content_sha256", first.body.content_sha256 as string);
    expect(count).toBe(1);

    await cleanup(admin, householdId);
  });

  it("rejects cross-household staging", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdA = await setupHousehold(admin);
    const householdB = await setupForeignHousehold(admin);

    const file = new File([makePngBlob()], "cross.png", { type: "image/png" });
    const { status, body } = await stageDocument(accessToken, householdA, file, {
      stagingRequestId: randomUUID(),
    });
    expect(status).toBe(200);
    if (typeof body.id === "string") createdDocumentIds.push(body.id);

    const malicious = new FormData();
    malicious.append("file", new File([makePngBlob()], "foreign.png", { type: "image/png" }));
    malicious.append("mode", "staged");
    malicious.append("householdId", householdB);
    malicious.append("category", "auto_detect");
    malicious.append("stagingRequestId", randomUUID());

    const res = await fetch(`${SUPABASE_URL}/functions/v1/upload-document`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, apikey: ANON_KEY },
      body: malicious,
    });
    expect(res.status).toBe(404);

    await cleanup(admin, householdA);
    await cleanup(admin, householdB);
  });

  it("rejects unsupported file types and oversized files", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = await setupHousehold(admin);

    const textFile = new File(["not an image"], "README.txt", { type: "text/plain" });
    const invalid = await stageDocument(accessToken, householdId, textFile);
    expect(invalid.status).toBe(415);

    const bigFile = new File([new Uint8Array(11 * 1024 * 1024)], "big.png", { type: "image/png" });
    const oversized = await stageDocument(accessToken, householdId, bigFile);
    expect(oversized.status).toBe(413);

    await cleanup(admin, householdId);
  });

  it("does not change batch upload behavior", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = await setupHousehold(admin);

    const file = new File([makePngBlob()], "batch-policy.png", { type: "image/png" });
    const { status, body } = await batchUpload(accessToken, householdId, file);
    expect(status).toBe(200);
    expect(body.staged).toBeUndefined();
    expect(typeof body.batch_id).toBe("string");
    expect(typeof body.item_id).toBe("string");
    if (typeof body.id === "string") createdDocumentIds.push(body.id);

    const { data: batch } = await admin
      .from("document_processing_batches")
      .select("id")
      .eq("id", body.batch_id as string)
      .single();
    expect(batch).toBeTruthy();

    const { data: item } = await admin
      .from("document_processing_batch_items")
      .select("id")
      .eq("id", body.item_id as string)
      .single();
    expect(item).toBeTruthy();

    await cleanup(admin, householdId);
  });

  it("allows a staged document to be supplied to plan_document_upload_v1", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = await setupHousehold(admin);

    const file = new File([makePngBlob()], "plan-policy.png", { type: "image/png" });
    const { status, body } = await stageDocument(accessToken, householdId, file, {
      stagingRequestId: randomUUID(),
    });
    expect(status).toBe(200);
    const policyDocumentId = body.id as string;
    createdDocumentIds.push(policyDocumentId);

    const { data: plan } = await admin.rpc("plan_document_upload_v1", {
      p_household_id: householdId,
      p_case_id: null,
      p_new_policy_document_ids: [policyDocumentId],
    });
    expect(plan).toBeTruthy();
    expect((plan as Record<string, unknown>).newUploadCount).toBe(1);
    expect((plan as Record<string, unknown>).exactDuplicateDocuments).toEqual([]);

    await cleanup(admin, householdId);
  });
});
