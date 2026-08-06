import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
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

function serviceRoleClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  });
}

async function planUpload(
  accessToken: string,
  householdId: string,
  policyDocumentIds: string[],
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/document-processing-batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "plan",
      household_id: householdId,
      new_policy_document_ids: policyDocumentIds,
    }),
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

describe("normalization reuse through Edge planning", () => {
  let accessToken: string;
  const createdHouseholdIds: string[] = [];

  beforeAll(async () => {
    assertLocalSupabase(SUPABASE_URL);
    accessToken = await getCustomerAccessToken();
  });

  afterEach(async () => {
    const admin = serviceRoleClient();
    for (const householdId of createdHouseholdIds) {
      await admin
        .from("document_processing_batch_normalizations")
        .delete()
        .eq("household_id", householdId);
      await admin.from("document_processing_batch_items").delete().eq("household_id", householdId);
      await admin.from("document_processing_batches").delete().eq("household_id", householdId);
      await admin.from("document_extraction_sessions").delete().eq("household_id", householdId);
      await admin.from("optimization_cases").delete().eq("household_id", householdId);
      await admin.from("document_normalizations").delete().eq("household_id", householdId);
      await admin.from("policy_documents").delete().eq("household_id", householdId);
      await admin.from("household_members").delete().eq("household_id", householdId);
      await admin.from("households").delete().eq("id", householdId);
    }
    createdHouseholdIds.length = 0;
  });

  async function setupHousehold(admin: AdminClient) {
    const householdId = `e1000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdId);
    await admin.from("households").insert({
      id: householdId,
      owner_profile_id: CUSTOMER_ID,
      name: "Edge Reuse Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });
    await admin
      .from("household_members")
      .insert({ household_id: householdId, profile_id: CUSTOMER_ID, member_role: "owner" });
    return householdId;
  }

  async function createStagedDocument(admin: AdminClient, householdId: string, digest?: string) {
    const id = randomUUID();
    const contentSha256 = digest ?? createHash("sha256").update(randomUUID()).digest("hex");
    await admin.from("policy_documents").insert({
      id,
      household_id: householdId,
      file_name: `edge-reuse-${randomUUID()}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      storage_path: `docs/${randomUUID()}.pdf`,
      uploaded_by: CUSTOMER_ID,
      category: "other",
      content_sha256: contentSha256,
      status: "staged",
    });
    return { id, contentSha256 };
  }

  async function createCompletedNormalization(
    admin: AdminClient,
    householdId: string,
    policyDocumentId: string,
    digest: string,
    schemaVersion: string = "1.0.0",
    analyzerVersion: string = "default-v1",
  ) {
    const { data, error } = await admin.rpc("persist_document_normalization_v1", {
      p_household_id: householdId,
      p_policy_document_id: policyDocumentId,
      p_content_sha256: digest,
      p_normalization_schema_version: schemaVersion,
      p_analyzer_version: analyzerVersion,
      p_model_provider: "test",
      p_model_id: "test-model",
      p_prompt_version: "1.0.0",
      p_classification: "supported",
      p_normalized_output_json: { policyNumber: "POL-EDGE-001" },
      p_normalized_entities_json: [],
      p_conflicts_json: [],
      p_evidence_json: [],
    });
    if (error) throw error;
    return data as { id: string };
  }

  it("reports an exact duplicate when a compatible completed normalization exists", async () => {
    const admin = serviceRoleClient();
    const householdId = await setupHousehold(admin);

    const doc = await createStagedDocument(admin, householdId);
    const normalization = await createCompletedNormalization(
      admin,
      householdId,
      doc.id,
      doc.contentSha256,
    );

    const { status, body } = await planUpload(accessToken, householdId, [doc.id]);
    expect(status).toBe(200);
    expect(body.newUploadCount).toBe(1);
    expect(body.reusableNormalizationCount).toBe(1);
    expect(body.newNormalizationCount).toBe(0);

    const exactDuplicates = body.exactDuplicateDocuments as Record<string, unknown>[];
    expect(exactDuplicates).toHaveLength(1);
    expect(exactDuplicates[0].policyDocumentId).toBe(doc.id);
    expect(exactDuplicates[0].normalizationId).toBe(normalization.id);
  });

  it("forces new processing when the normalization schema version mismatches", async () => {
    const admin = serviceRoleClient();
    const householdId = await setupHousehold(admin);

    const doc = await createStagedDocument(admin, householdId);
    await createCompletedNormalization(
      admin,
      householdId,
      doc.id,
      doc.contentSha256,
      "0.9.0",
      "default-v1",
    );

    const { status, body } = await planUpload(accessToken, householdId, [doc.id]);
    expect(status).toBe(200);
    expect(body.reusableNormalizationCount).toBe(0);
    expect(body.newNormalizationCount).toBe(1);
    expect((body.exactDuplicateDocuments as unknown[]).length).toBe(0);
  });

  it("forces new processing when the analyzer version mismatches", async () => {
    const admin = serviceRoleClient();
    const householdId = await setupHousehold(admin);

    const doc = await createStagedDocument(admin, householdId);
    await createCompletedNormalization(
      admin,
      householdId,
      doc.id,
      doc.contentSha256,
      "1.0.0",
      "old-v1",
    );

    const { status, body } = await planUpload(accessToken, householdId, [doc.id]);
    expect(status).toBe(200);
    expect(body.reusableNormalizationCount).toBe(0);
    expect(body.newNormalizationCount).toBe(1);
  });

  it("does not reuse a normalization from another household", async () => {
    const admin = serviceRoleClient();
    const householdA = await setupHousehold(admin);
    const householdB = `e2000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdB);
    await admin.from("households").insert({
      id: householdB,
      owner_profile_id: "00000000-0000-0000-0000-000000000004",
      name: "Foreign Reuse Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });

    const doc = await createStagedDocument(admin, householdA);
    await admin.from("document_normalizations").insert({
      id: randomUUID(),
      household_id: householdB,
      policy_document_id: doc.id,
      content_sha256: doc.contentSha256,
      normalization_schema_version: "1.0.0",
      analyzer_version: "default-v1",
      model_provider: "test",
      model_id: "test-model",
      prompt_version: "1.0.0",
      classification: "supported",
      status: "complete",
      normalized_output_json: {},
      normalized_entities_json: [],
      conflicts_json: [],
      evidence_json: [],
    });

    const { status, body } = await planUpload(accessToken, householdA, [doc.id]);
    expect(status).toBe(200);
    expect(body.reusableNormalizationCount).toBe(0);
    expect(body.newNormalizationCount).toBe(1);
  });
});
