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

async function waitForBatchReady(
  accessToken: string,
  admin: AdminClient,
  householdId: string,
  batchId: string,
): Promise<string> {
  let status = await pollBatchStatus(admin, batchId, 4000);
  if (!status) {
    await extractPolicyEntities(accessToken, householdId, batchId);
    status = await pollBatchStatus(admin, batchId, 20000);
  }
  if (!status) throw new Error("Batch did not reach terminal status");
  return status;
}

async function createBatchFromStagedRPC(
  admin: AdminClient,
  householdId: string,
  policyDocumentIds: string[],
  clientRequestId: string,
) {
  const { data, error } = await admin.rpc("create_document_batch_from_staged_v1", {
    p_household_id: householdId,
    p_policy_document_ids: policyDocumentIds,
    p_client_request_id: clientRequestId,
    p_case_id: null,
    p_actor_id: CUSTOMER_ID,
  });
  if (error) throw error;
  const result = data as { batch: { id: string; session_id: string }; session_id: string };
  return {
    batchId: result.batch.id,
    sessionId: result.batch.session_id ?? result.session_id,
  };
}

async function getBatchItems(admin: AdminClient, batchId: string) {
  const { data, error } = await admin
    .from("document_processing_batch_items")
    .select("id, policy_document_id, content_sha256")
    .eq("batch_id", batchId);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; policy_document_id: string; content_sha256: string }>;
}

async function persistBatchNormalization(
  admin: AdminClient,
  batchId: string,
  batchItemId: string,
  householdId: string,
  policyDocumentId: string,
  contentSha256: string,
  normalizedEntities: unknown[],
  classification = "current_auto_policy",
) {
  const { data: batch } = await admin
    .from("document_processing_batches")
    .select("processing_generation")
    .eq("id", batchId)
    .single();
  const { data, error } = await admin.rpc("persist_document_normalization_for_batch_v1", {
    p_batch_id: batchId,
    p_batch_item_id: batchItemId,
    p_household_id: householdId,
    p_policy_document_id: policyDocumentId,
    p_content_sha256: contentSha256,
    p_normalization_schema_version: "1.0.0",
    p_analyzer_version: "default-v1",
    p_model_provider: "gemini",
    p_model_id: "gemini-2.5-flash",
    p_prompt_version: "1.0.0",
    p_classification: classification,
    p_normalized_output_json: {
      parserId: "test",
      parserVersion: "1.0.0",
      classification,
    },
    p_normalized_entities_json: normalizedEntities,
    p_conflicts_json: [],
    p_evidence_json: [{ documentId: policyDocumentId, pageNumber: 1 }],
    p_processing_generation: batch?.processing_generation ?? 0,
  });
  if (error) throw error;
  return data as { normalization_id: string; use_status: string };
}

function buildNormalizationEntity(
  policyDocumentId: string,
  contentSha256: string,
  options: {
    canonicalFingerprint?: string;
    temporaryId?: string;
    entityType?: string;
    evidence?: unknown[];
    currentPolicy?: Record<string, unknown>;
    currentCoverage?: Record<string, unknown>;
  } = {},
) {
  const canonicalFingerprint =
    options.canonicalFingerprint ?? `vehicle:vin:${contentSha256.slice(0, 17)}`;
  return {
    temporaryId: options.temporaryId ?? "entity-1",
    entityType: options.entityType ?? "vehicle",
    displayLabel: "2020 Honda Civic",
    canonicalFingerprint,
    candidateIdentity: {
      exactIdentityFingerprint: canonicalFingerprint,
      provisionalCandidateKey: null,
      identityStrength: "exact",
    },
    identity: { vin: contentSha256.slice(0, 17), year: 2020, make: "Honda", model: "Civic" },
    currentPolicy: options.currentPolicy ?? {
      insurer: "Test Insurer",
      policyNumber: "POL-001",
      effectiveDate: "2026-01-01",
      expiryDate: "2027-01-01",
      annualPremiumCents: 100000,
    },
    currentCoverage: options.currentCoverage ?? {},
    mandateSuggestions: {},
    evidence:
      options.evidence ??
      ([
        {
          documentId: policyDocumentId,
          pageNumber: 1,
          quotedLabel: "policy",
          evidenceSummary: "doc",
        },
      ] as unknown[]),
    requiredConfirmations: [],
    resolution: { status: "new", confidence: 0.85, reasoning: "Extracted" },
  };
}

async function insertCompletedNormalization(
  admin: AdminClient,
  householdId: string,
  policyDocumentId: string,
  contentSha256: string,
  entityOverride?: Record<string, unknown>,
) {
  const entity = {
    ...buildNormalizationEntity(policyDocumentId, contentSha256),
    ...entityOverride,
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

describe("overlap persistence for multi-normalization entities", () => {
  let accessToken: string;
  const createdHouseholdIds: string[] = [];
  const createdDocumentIds: string[] = [];

  beforeAll(async () => {
    assertLocalSupabase(SUPABASE_URL);
    accessToken = await getCustomerAccessToken();
  });

  afterEach(async () => {
    const admin = serviceRoleClient();
    const docIdsToClean = [...createdDocumentIds];
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
      if (docIdsToClean.length > 0) {
        await admin
          .from("document_analysis_provider_files")
          .delete()
          .in("policy_document_id", docIdsToClean);
      }
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
      name: "Overlap Persistence Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });
    await admin
      .from("household_members")
      .insert({ household_id: householdId, profile_id: CUSTOMER_ID, member_role: "owner" });
    return householdId;
  }

  async function stageAndPrepare(
    householdId: string,
    files: { name: string; salt: string }[],
  ): Promise<Array<{ policyDocumentId: string; contentSha256: string; file: File }>> {
    const result = [];
    for (const { name, salt } of files) {
      const file = new File([makePngBlob(salt)], name, { type: "image/png" });
      const staged = await stageDocument(accessToken, householdId, file, randomUUID());
      expect(staged.status).toBe(200);
      createdDocumentIds.push(staged.body.id as string);
      result.push({
        policyDocumentId: staged.body.id as string,
        contentSha256: staged.body.content_sha256 as string,
        file,
      });
    }
    return result;
  }

  it(
    "one entity supported by two documents and two normalizations creates two assessment rows",
    { timeout: 60000 },
    async () => {
      const admin = serviceRoleClient();
      const householdId = await setupHousehold(admin);
      const client = await getAuthenticatedSupabaseClient();
      await enableDangerousMode(client, householdId);

      const docs = await stageAndPrepare(householdId, [
        { name: "multi-a.png", salt: "multi-a" },
        { name: "multi-b.png", salt: "multi-b" },
      ]);
      const sharedKey = `vehicle:vin:shared-${randomUUID().slice(0, 8)}`;

      for (const doc of docs) {
        await insertCompletedNormalization(
          admin,
          householdId,
          doc.policyDocumentId,
          doc.contentSha256,
          {
            canonicalFingerprint: sharedKey,
            evidence: [
              {
                documentId: doc.policyDocumentId,
                pageNumber: 1,
                quotedLabel: "policy",
                evidenceSummary: "doc",
              },
            ],
          } as Record<string, unknown>,
        );
      }

      const { batchId } = await createBatchFromStagedRPC(
        admin,
        householdId,
        docs.map((d) => d.policyDocumentId),
        `multi-normalization-${randomUUID()}`,
      );

      const status = await waitForBatchReady(accessToken, admin, householdId, batchId);
      expect(status).toBe("ready_for_review");

      const { data: overlaps } = await admin
        .from("document_asset_overlap_assessments")
        .select("*")
        .eq("batch_id", batchId)
        .order("created_at", { ascending: true });
      expect(overlaps).toHaveLength(2);
      const keys = new Set(overlaps?.map((o) => o.normalized_entity_key as string));
      expect(keys.size).toBe(1);
      expect([...keys][0]).toBe(sharedKey);

      const normalizationIds = overlaps?.map((o) => o.normalization_id as string);
      expect(new Set(normalizationIds).size).toBe(2);

      const { count: candidateCount } = await admin
        .from("asset_candidates")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      expect(candidateCount).toBe(0);

      const { count: reviewCount } = await admin
        .from("candidate_field_reviews")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      expect(reviewCount).toBe(0);
    },
  );

  it(
    "repeated evidence references to the same document create one assessment row",
    { timeout: 60000 },
    async () => {
      const admin = serviceRoleClient();
      const householdId = await setupHousehold(admin);
      const client = await getAuthenticatedSupabaseClient();
      await enableDangerousMode(client, householdId);

      const docs = await stageAndPrepare(householdId, [{ name: "repeat.png", salt: "repeat" }]);
      const doc = docs[0];
      const evidenceRef = {
        documentId: doc.policyDocumentId,
        pageNumber: 1,
        quotedLabel: "policy",
        evidenceSummary: "doc",
      };

      await insertCompletedNormalization(
        admin,
        householdId,
        doc.policyDocumentId,
        doc.contentSha256,
        {
          evidence: [evidenceRef, evidenceRef],
          currentCoverage: {
            liabilityLimit: {
              status: "known",
              value: 1000000,
              evidence: [evidenceRef],
            },
          },
        } as Record<string, unknown>,
      );

      const { batchId } = await createBatchFromStagedRPC(
        admin,
        householdId,
        [doc.policyDocumentId],
        `repeat-${randomUUID()}`,
      );

      const status = await waitForBatchReady(accessToken, admin, householdId, batchId);
      expect(status).toBe("ready_for_review");

      const { data: overlaps } = await admin
        .from("document_asset_overlap_assessments")
        .select("*")
        .eq("batch_id", batchId);
      expect(overlaps).toHaveLength(1);
      expect(overlaps![0].classification).toBe("exact_file_duplicate");

      const { count: candidateCount } = await admin
        .from("asset_candidates")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      expect(candidateCount).toBe(0);
    },
  );

  it(
    "current-policy and current-coverage evidence are both considered",
    { timeout: 60000 },
    async () => {
      const admin = serviceRoleClient();
      const householdId = await setupHousehold(admin);
      const client = await getAuthenticatedSupabaseClient();
      await enableDangerousMode(client, householdId);

      const docs = await stageAndPrepare(householdId, [{ name: "coverage.png", salt: "coverage" }]);
      const doc = docs[0];
      const evidenceRef = {
        documentId: doc.policyDocumentId,
        pageNumber: 1,
        quotedLabel: "policy",
        evidenceSummary: "doc",
      };

      await insertCompletedNormalization(
        admin,
        householdId,
        doc.policyDocumentId,
        doc.contentSha256,
        {
          evidence: [],
          currentPolicy: {
            insurer: "Test Insurer",
            policyNumber: "POL-001",
            effectiveDate: "2026-01-01",
            expiryDate: "2027-01-01",
            annualPremiumCents: 100000,
            policyDocumentEvidence: { evidence: [evidenceRef] },
          },
          currentCoverage: {
            liabilityLimit: {
              status: "known",
              value: 1000000,
              evidence: [evidenceRef],
            },
          },
        } as Record<string, unknown>,
      );

      const { batchId } = await createBatchFromStagedRPC(
        admin,
        householdId,
        [doc.policyDocumentId],
        `coverage-${randomUUID()}`,
      );

      const status = await waitForBatchReady(accessToken, admin, householdId, batchId);
      expect(status).toBe("ready_for_review");

      const { data: overlaps } = await admin
        .from("document_asset_overlap_assessments")
        .select("*")
        .eq("batch_id", batchId);
      expect(overlaps).toHaveLength(1);
      expect(overlaps![0].classification).toBe("exact_file_duplicate");

      const { count: candidateCount } = await admin
        .from("asset_candidates")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      expect(candidateCount).toBe(0);
    },
  );

  it(
    "one reused and one provider-created normalization are both associated correctly",
    { timeout: 60000 },
    async () => {
      const admin = serviceRoleClient();
      const householdId = await setupHousehold(admin);
      const client = await getAuthenticatedSupabaseClient();
      await enableDangerousMode(client, householdId);

      const docs = await stageAndPrepare(householdId, [
        { name: "reused-a.png", salt: "reused-a" },
        { name: "provider-b.png", salt: "provider-b" },
      ]);
      const [reusedDoc, providerDoc] = docs;
      const sharedKey = `vehicle:vin:shared-${randomUUID().slice(0, 8)}`;

      await insertCompletedNormalization(
        admin,
        householdId,
        reusedDoc.policyDocumentId,
        reusedDoc.contentSha256,
        {
          canonicalFingerprint: sharedKey,
          evidence: [
            {
              documentId: reusedDoc.policyDocumentId,
              pageNumber: 1,
              quotedLabel: "policy",
              evidenceSummary: "doc",
            },
          ],
        } as Record<string, unknown>,
      );

      const { batchId } = await createBatchFromStagedRPC(
        admin,
        householdId,
        [reusedDoc.policyDocumentId, providerDoc.policyDocumentId],
        `provider-created-${randomUUID()}`,
      );

      const items = await getBatchItems(admin, batchId);
      const providerItem = items.find((i) => i.policy_document_id === providerDoc.policyDocumentId);
      if (!providerItem) throw new Error("Provider batch item not found");

      await persistBatchNormalization(
        admin,
        batchId,
        providerItem.id,
        householdId,
        providerDoc.policyDocumentId,
        providerDoc.contentSha256,
        [
          buildNormalizationEntity(providerDoc.policyDocumentId, providerDoc.contentSha256, {
            canonicalFingerprint: sharedKey,
            evidence: [
              {
                documentId: providerDoc.policyDocumentId,
                pageNumber: 1,
                quotedLabel: "policy",
                evidenceSummary: "doc",
              },
            ],
          }),
        ],
      );

      const status = await waitForBatchReady(accessToken, admin, householdId, batchId);
      expect(status).toBe("ready_for_review");

      const { data: batchNorms } = await admin
        .from("document_processing_batch_normalizations")
        .select("*, normalization:document_normalizations(id, content_sha256)")
        .eq("batch_id", batchId);
      expect(batchNorms).toHaveLength(2);

      const { data: overlaps } = await admin
        .from("document_asset_overlap_assessments")
        .select("*")
        .eq("batch_id", batchId);
      expect(overlaps).toHaveLength(2);
      const keys = new Set(overlaps?.map((o) => o.normalized_entity_key as string));
      expect(keys.size).toBe(1);
      expect([...keys][0]).toBe(sharedKey);

      const normalizationIds = new Set(overlaps?.map((o) => o.normalization_id as string));
      expect(normalizationIds.size).toBe(2);

      const { count: candidateCount } = await admin
        .from("asset_candidates")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      expect(candidateCount).toBe(0);

      const { count: providerFileCount } = await admin
        .from("document_analysis_provider_files")
        .select("*", { count: "exact", head: true })
        .in("policy_document_id", createdDocumentIds);
      expect(providerFileCount).toBe(0);
    },
  );

  it(
    "exact-duplicate-only batch creates assessments but zero candidates and reviews",
    { timeout: 60000 },
    async () => {
      const admin = serviceRoleClient();
      const householdId = await setupHousehold(admin);
      const client = await getAuthenticatedSupabaseClient();
      await enableDangerousMode(client, householdId);

      const docs = await stageAndPrepare(householdId, [{ name: "dup-only.png", salt: "dup-only" }]);
      const doc = docs[0];
      const { normalizationId } = await insertCompletedNormalization(
        admin,
        householdId,
        doc.policyDocumentId,
        doc.contentSha256,
      );

      const { batchId } = await createBatchFromStagedRPC(
        admin,
        householdId,
        [doc.policyDocumentId],
        `dup-only-${randomUUID()}`,
      );

      const status = await waitForBatchReady(accessToken, admin, householdId, batchId);
      expect(status).toBe("ready_for_review");

      const { data: overlaps } = await admin
        .from("document_asset_overlap_assessments")
        .select("*")
        .eq("batch_id", batchId);
      expect(overlaps).toHaveLength(1);
      expect(overlaps![0].classification).toBe("exact_file_duplicate");
      expect(overlaps![0].normalization_id).toBe(normalizationId);

      const { count: candidateCount } = await admin
        .from("asset_candidates")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      expect(candidateCount).toBe(0);

      const { count: reviewCount } = await admin
        .from("candidate_field_reviews")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      expect(reviewCount).toBe(0);

      const { count: providerFileCount } = await admin
        .from("document_analysis_provider_files")
        .select("*", { count: "exact", head: true })
        .in("policy_document_id", createdDocumentIds);
      expect(providerFileCount).toBe(0);
    },
  );

  it("one assessment persistence failure creates zero candidates", { timeout: 60000 }, async () => {
    const admin = serviceRoleClient();
    const householdId = await setupHousehold(admin);
    const client = await getAuthenticatedSupabaseClient();
    await enableDangerousMode(client, householdId);

    const docs = await stageAndPrepare(householdId, [{ name: "fail.png", salt: "fail" }]);
    const doc = docs[0];

    // An unsupported asset type causes the overlap persistence RPC to fail with a
    // domain/type error, which should abort candidate derivation.
    await insertCompletedNormalization(
      admin,
      householdId,
      doc.policyDocumentId,
      doc.contentSha256,
      {
        entityType: "boat",
      } as Record<string, unknown>,
    );

    const { batchId } = await createBatchFromStagedRPC(
      admin,
      householdId,
      [doc.policyDocumentId],
      `fail-${randomUUID()}`,
    );

    await extractPolicyEntities(accessToken, householdId, batchId);
    const terminalStatus = await pollBatchStatus(admin, batchId, 15000);
    expect(terminalStatus).toBe("processing_unavailable");

    const { data: overlaps } = await admin
      .from("document_asset_overlap_assessments")
      .select("*")
      .eq("batch_id", batchId);
    expect(overlaps).toHaveLength(0);

    const { count: candidateCount } = await admin
      .from("asset_candidates")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(candidateCount).toBe(0);
  });

  it(
    "retrying the same extraction does not duplicate assessments",
    { timeout: 60000 },
    async () => {
      const admin = serviceRoleClient();
      const householdId = await setupHousehold(admin);
      const client = await getAuthenticatedSupabaseClient();
      await enableDangerousMode(client, householdId);

      const docs = await stageAndPrepare(householdId, [{ name: "retry.png", salt: "retry" }]);
      const doc = docs[0];
      await insertCompletedNormalization(
        admin,
        householdId,
        doc.policyDocumentId,
        doc.contentSha256,
      );

      const { batchId } = await createBatchFromStagedRPC(
        admin,
        householdId,
        [doc.policyDocumentId],
        `retry-${randomUUID()}`,
      );

      const status = await waitForBatchReady(accessToken, admin, householdId, batchId);
      expect(status).toBe("ready_for_review");

      const { data: firstOver } = await admin
        .from("document_asset_overlap_assessments")
        .select("*")
        .eq("batch_id", batchId);
      expect(firstOver).toHaveLength(1);

      await admin
        .from("document_processing_batches")
        .update({ status: "queued", updated_at: new Date().toISOString() })
        .eq("id", batchId);

      const retryStatus = await waitForBatchReady(accessToken, admin, householdId, batchId);
      expect(retryStatus).toBe("ready_for_review");

      const { data: secondOver } = await admin
        .from("document_asset_overlap_assessments")
        .select("*")
        .eq("batch_id", batchId);
      expect(secondOver).toHaveLength(1);
      expect(secondOver![0].id).toBe(firstOver![0].id);
    },
  );

  it(
    "evidence ordering does not alter persisted normalized entity keys",
    { timeout: 60000 },
    async () => {
      const admin = serviceRoleClient();
      const householdId = await setupHousehold(admin);
      const client = await getAuthenticatedSupabaseClient();
      await enableDangerousMode(client, householdId);

      const docs = await stageAndPrepare(householdId, [
        { name: "order-a.png", salt: "order-a" },
        { name: "order-b.png", salt: "order-b" },
      ]);
      const sharedKey = `vehicle:vin:order-${randomUUID().slice(0, 8)}`;

      for (const doc of docs) {
        await insertCompletedNormalization(
          admin,
          householdId,
          doc.policyDocumentId,
          doc.contentSha256,
          {
            canonicalFingerprint: sharedKey,
            evidence: [
              {
                documentId: doc.policyDocumentId,
                pageNumber: 1,
                quotedLabel: "policy",
                evidenceSummary: "doc",
              },
            ],
          } as Record<string, unknown>,
        );
      }

      const { batchId } = await createBatchFromStagedRPC(
        admin,
        householdId,
        [docs[1].policyDocumentId, docs[0].policyDocumentId],
        `order-${randomUUID()}`,
      );

      const status = await waitForBatchReady(accessToken, admin, householdId, batchId);
      expect(status).toBe("ready_for_review");

      const { data: overlaps } = await admin
        .from("document_asset_overlap_assessments")
        .select("*")
        .eq("batch_id", batchId);
      expect(overlaps).toHaveLength(2);
      const keys = overlaps?.map((o) => o.normalized_entity_key as string);
      expect(keys).toEqual([sharedKey, sharedKey]);
    },
  );

  it(
    "a missing evidence-to-normalization association fails explicitly",
    { timeout: 60000 },
    async () => {
      const admin = serviceRoleClient();
      const householdId = await setupHousehold(admin);
      const client = await getAuthenticatedSupabaseClient();
      await enableDangerousMode(client, householdId);

      const docs = await stageAndPrepare(householdId, [{ name: "missing.png", salt: "missing" }]);
      const doc = docs[0];
      const missingDocId = randomUUID();

      await insertCompletedNormalization(
        admin,
        householdId,
        doc.policyDocumentId,
        doc.contentSha256,
        {
          evidence: [],
          currentCoverage: {
            liabilityLimit: {
              status: "known",
              value: 1000000,
              evidence: [
                {
                  documentId: missingDocId,
                  pageNumber: 1,
                  quotedLabel: "policy",
                  evidenceSummary: "doc",
                },
              ],
            },
          },
        } as Record<string, unknown>,
      );

      const { batchId } = await createBatchFromStagedRPC(
        admin,
        householdId,
        [doc.policyDocumentId],
        `missing-${randomUUID()}`,
      );

      await extractPolicyEntities(accessToken, householdId, batchId);
      const terminalStatus = await pollBatchStatus(admin, batchId, 15000);
      expect(terminalStatus).toBe("processing_unavailable");

      const { data: overlaps } = await admin
        .from("document_asset_overlap_assessments")
        .select("*")
        .eq("batch_id", batchId);
      expect(overlaps).toHaveLength(0);

      const { count: candidateCount } = await admin
        .from("asset_candidates")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      expect(candidateCount).toBe(0);
    },
  );

  it(
    "another entity in the same batch remains independently classified",
    { timeout: 60000 },
    async () => {
      const admin = serviceRoleClient();
      const householdId = await setupHousehold(admin);
      const client = await getAuthenticatedSupabaseClient();
      await enableDangerousMode(client, householdId);

      const docs = await stageAndPrepare(householdId, [
        { name: "indep-a.png", salt: "indep-a" },
        { name: "indep-b.png", salt: "indep-b" },
      ]);

      for (const doc of docs) {
        await insertCompletedNormalization(
          admin,
          householdId,
          doc.policyDocumentId,
          doc.contentSha256,
          {
            canonicalFingerprint: `vehicle:vin:${doc.contentSha256.slice(0, 17)}`,
            temporaryId: `entity-${doc.contentSha256.slice(0, 8)}`,
            evidence: [
              {
                documentId: doc.policyDocumentId,
                pageNumber: 1,
                quotedLabel: "policy",
                evidenceSummary: "doc",
              },
            ],
          } as Record<string, unknown>,
        );
      }

      const { batchId } = await createBatchFromStagedRPC(
        admin,
        householdId,
        docs.map((d) => d.policyDocumentId),
        `indep-${randomUUID()}`,
      );

      const status = await waitForBatchReady(accessToken, admin, householdId, batchId);
      expect(status).toBe("ready_for_review");

      const { data: overlaps } = await admin
        .from("document_asset_overlap_assessments")
        .select("*")
        .eq("batch_id", batchId);
      expect(overlaps).toHaveLength(2);
      const keys = new Set(overlaps?.map((o) => o.normalized_entity_key as string));
      expect(keys.size).toBe(2);

      const { count: candidateCount } = await admin
        .from("asset_candidates")
        .select("*", { count: "exact", head: true })
        .eq("household_id", householdId);
      expect(candidateCount).toBe(0);
    },
  );
});
