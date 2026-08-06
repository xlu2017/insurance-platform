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

async function getAuthenticatedSupabaseClient(): Promise<AdminClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({
    email: CUSTOMER_EMAIL,
    password: CUSTOMER_PASSWORD,
  });
  if (error) throw new Error("Failed to sign in customer: " + error.message);
  return client as AdminClient;
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
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/document-processing-batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "create-from-staged",
      household_id: householdId,
      new_policy_document_ids: policyDocumentIds,
      client_request_id: clientRequestId,
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

async function planDocumentUpload(
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

async function extractPolicyEntities(
  accessToken: string,
  householdId: string,
  batchId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-policy-entities`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ household_id: householdId, batch_id: batchId }),
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

async function enableDangerousMode(client: AdminClient, householdId: string) {
  const { error } = await client.rpc("enable_dangerous_mode_v1", {
    p_household_id: householdId,
    p_disclosure_version: "dangerous-mode-v1",
    p_processor_contract_version: "processor-contract-v1",
    p_configured_provider: "gemini",
    p_configured_model_id: "gemini-2.5-flash",
    p_explicit_confirmation: true,
    p_foreign_processing_acknowledged: true,
    p_automated_processing_acknowledged: true,
    p_raw_processing_approved: true,
  });
  if (error) throw new Error("Failed to enable dangerous mode: " + error.message);
}

async function pollBatchStatus(
  admin: AdminClient,
  batchId: string,
  timeoutMs = 15000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await admin
      .from("document_processing_batches")
      .select("status")
      .eq("id", batchId)
      .maybeSingle();
    if (
      data?.status &&
      [
        "ready_for_review",
        "additional_information_required",
        "manual_review",
        "processing_unavailable",
        "superseded",
      ].includes(data.status)
    ) {
      return data.status as string;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

describe("extract-policy-entities normalization reuse", () => {
  let accessToken: string;
  const createdHouseholdIds: string[] = [];
  const createdDocumentIds: string[] = [];

  beforeAll(async () => {
    assertLocalSupabase(SUPABASE_URL);
    accessToken = await getCustomerAccessToken();
  });

  afterEach(async () => {
    const admin = serviceRoleClient();
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
      await admin.from("document_analysis_provider_files").delete().eq("household_id", householdId);
      await admin
        .from("document_processing_authorizations")
        .delete()
        .eq("household_id", householdId);
      await admin.from("document_processing_consent").delete().eq("household_id", householdId);
      await admin
        .from("household_document_processing_settings")
        .delete()
        .eq("household_id", householdId);
      await admin.from("document_normalizations").delete().eq("household_id", householdId);
      await admin.from("document_processing_batches").delete().eq("household_id", householdId);
      await admin.from("document_extraction_sessions").delete().eq("household_id", householdId);
      await admin.from("optimization_cases").delete().eq("household_id", householdId);
      await admin.from("policy_documents").delete().eq("household_id", householdId);
      await admin.from("household_members").delete().eq("household_id", householdId);
      await admin.from("households").delete().eq("id", householdId);
    }
    createdHouseholdIds.length = 0;
  });

  async function setupHousehold(admin: AdminClient) {
    const householdId = `e3000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdId);
    await admin.from("households").insert({
      id: householdId,
      owner_profile_id: CUSTOMER_ID,
      name: "Extraction Reuse Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });
    await admin
      .from("household_members")
      .insert({ household_id: householdId, profile_id: CUSTOMER_ID, member_role: "owner" });
    return householdId;
  }

  async function insertCompletedNormalization(
    admin: AdminClient,
    householdId: string,
    policyDocumentId: string,
    contentSha256: string,
  ) {
    const canonicalFingerprint = `vehicle:vin:${contentSha256.slice(0, 17)}`;
    const entity = {
      temporaryId: "entity-1",
      entityType: "vehicle",
      displayLabel: "2020 Honda Civic",
      canonicalFingerprint,
      candidateIdentity: {
        exactIdentityFingerprint: canonicalFingerprint,
        provisionalCandidateKey: null,
        identityStrength: "exact",
      },
      identity: { vin: contentSha256.slice(0, 17), year: 2020, make: "Honda", model: "Civic" },
      currentPolicy: {
        insurer: "Test Insurer",
        policyNumber: "POL-001",
        effectiveDate: "2026-01-01",
        expiryDate: "2027-01-01",
        annualPremiumCents: 100000,
      },
      currentCoverage: {},
      mandateSuggestions: {},
      evidence: [
        {
          documentId: policyDocumentId,
          pageNumber: 1,
          quotedLabel: "policy",
          evidenceSummary: "doc",
        },
      ],
      requiredConfirmations: [],
      resolution: { status: "new", confidence: 0.85, reasoning: "Extracted" },
    };

    const { data, error } = await admin
      .from("document_normalizations")
      .insert({
        household_id: householdId,
        policy_document_id: policyDocumentId,
        content_sha256: contentSha256,
        normalization_schema_version: "1.0.0",
        analyzer_version: "default-v1",
        model_provider: "gemini",
        model_id: "gemini-2.5-flash",
        prompt_version: "1.0.0",
        classification: "current_auto_policy",
        status: "complete",
        completed_at: new Date().toISOString(),
        normalized_output_json: {
          parserId: "native-document-analysis",
          parserVersion: "1.0.0",
          classification: "current_auto_policy",
          policy: entity.currentPolicy,
        },
        normalized_entities_json: [entity],
        conflicts_json: [],
        evidence_json: [{ documentId: policyDocumentId, pageNumber: 1 }],
      })
      .select("id")
      .single();

    if (error) throw error;
    return { normalizationId: data!.id as string, entity };
  }

  it("exact-duplicate-only batch completes without provider transmission", async () => {
    const admin = serviceRoleClient();
    const householdId = await setupHousehold(admin);

    const client = await getAuthenticatedSupabaseClient();
    await enableDangerousMode(client, householdId);

    const file = new File([makePngBlob("exact-dup")], "exact-dup.png", { type: "image/png" });
    const staged = await stageDocument(accessToken, householdId, file, randomUUID());
    expect(staged.status).toBe(200);
    const docId = staged.body.id as string;
    const contentSha256 = staged.body.content_sha256 as string;
    createdDocumentIds.push(docId);

    const { normalizationId } = await insertCompletedNormalization(
      admin,
      householdId,
      docId,
      contentSha256,
    );

    const clientRequestId = `exact-dup-${randomUUID()}`;
    const { status, body } = await createFromStaged(
      accessToken,
      householdId,
      [docId],
      clientRequestId,
    );
    expect([201, 202]).toContain(status);
    const batchId = body.id as string;
    expect(batchId).toBeTruthy();

    let batchStatus = await pollBatchStatus(admin, batchId, 10000);
    if (!batchStatus) {
      await extractPolicyEntities(accessToken, householdId, batchId);
      batchStatus = await pollBatchStatus(admin, batchId, 10000);
    }
    expect(batchStatus).toBe("ready_for_review");

    const { data: batch } = await admin
      .from("document_processing_batches")
      .select("*, document_processing_batch_items!document_processing_batch_items_batch_id_fkey(*)")
      .eq("id", batchId)
      .single();
    expect(batch).toBeTruthy();
    const batchItem = batch!.document_processing_batch_items[0];
    expect(batchItem).toBeTruthy();

    const { data: batchNorms } = await admin
      .from("document_processing_batch_normalizations")
      .select("*, use_status, batch_item_id, normalization_id")
      .eq("batch_id", batchId);
    expect(batchNorms).toHaveLength(1);
    expect(batchNorms![0].use_status).toBe("reused");
    expect(batchNorms![0].batch_item_id).toBe(batchItem.id);
    expect(batchNorms![0].normalization_id).toBe(normalizationId);

    const { data: overlaps } = await admin
      .from("document_asset_overlap_assessments")
      .select("*")
      .eq("batch_id", batchId);
    expect(overlaps).toHaveLength(1);
    expect(overlaps![0].classification).toBe("exact_file_duplicate");
    expect(overlaps![0].normalization_id).toBe(normalizationId);

    const { count: providerFileCount } = await admin
      .from("document_analysis_provider_files")
      .select("*", { count: "exact", head: true })
      .eq("policy_document_id", docId);
    expect(providerFileCount).toBe(0);

    const { count: candidateCount } = await admin
      .from("asset_candidates")
      .select("*", { count: "exact", head: true })
      .eq("session_id", batch!.session_id);
    expect(candidateCount).toBe(0);

    const { count: reviewCount } = await admin
      .from("candidate_field_reviews")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(reviewCount).toBe(0);

    const { data: doc } = await admin
      .from("policy_documents")
      .select("status")
      .eq("id", docId)
      .single();
    expect(doc?.status).toBe("extracted");

    const { data: session } = await admin
      .from("document_extraction_sessions")
      .select("status")
      .eq("id", batch!.session_id)
      .single();
    expect(session?.status).toBe("submitted");
  });

  it("mixed reused/new batch plans exactly one new upload and one reused normalization", async () => {
    const admin = serviceRoleClient();
    const householdId = await setupHousehold(admin);

    const reusedFile = new File([makePngBlob("reused-a")], "reused-a.png", { type: "image/png" });
    const newFile = new File([makePngBlob("new-b")], "new-b.png", { type: "image/png" });

    const reusedStage = await stageDocument(accessToken, householdId, reusedFile, randomUUID());
    const newStage = await stageDocument(accessToken, householdId, newFile, randomUUID());
    expect(reusedStage.status).toBe(200);
    expect(newStage.status).toBe(200);

    const reusedDocId = reusedStage.body.id as string;
    const newDocId = newStage.body.id as string;
    const reusedDigest = reusedStage.body.content_sha256 as string;
    createdDocumentIds.push(reusedDocId, newDocId);

    await insertCompletedNormalization(admin, householdId, reusedDocId, reusedDigest);

    const plan = await planDocumentUpload(accessToken, householdId, [reusedDocId, newDocId]);
    expect(plan.status).toBe(200);
    expect(plan.body.newUploadCount).toBe(2);
    expect(plan.body.reusableNormalizationCount).toBe(1);
    expect(plan.body.newNormalizationCount).toBe(1);

    const exactDuplicates = plan.body.exactDuplicateDocuments as Array<Record<string, unknown>>;
    expect(exactDuplicates).toHaveLength(1);
    expect(exactDuplicates[0].policyDocumentId).toBe(reusedDocId);

    const plannedIds = exactDuplicates.map((d) => d.policyDocumentId);
    expect(plannedIds).not.toContain(newDocId);
  });
});
