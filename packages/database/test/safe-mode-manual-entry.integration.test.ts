import { randomUUID } from "node:crypto";
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
const ADMIN_ID = "00000000-0000-0000-0000-000000000004";

const FAKE_SHA256 = "0".repeat(64);

type BatchCreateResult = {
  batch: { id: string; case_id: string; session_id: string } & Record<string, unknown>;
  session_id: string;
};

async function getAdminClient() {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({
    email: "admin@example.com",
    password: "DemoAdmin123!",
  });
  if (error) throw new Error("Failed to sign in admin: " + error.message);
  return client;
}

async function getCustomerClient() {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({
    email: "customer@example.com",
    password: "DemoCustomer123!",
  });
  if (error) throw new Error("Failed to sign in customer: " + error.message);
  return client;
}

async function createIsolatedHousehold(admin: SupabaseClient) {
  const householdId = `b0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
  const { error } = await admin.from("households").insert({
    id: householdId,
    owner_profile_id: CUSTOMER_ID,
    name: "Safe Mode Manual Entry Test Household",
    province: "AB",
    autopilot_active: false,
    onboarding_step: "complete",
  });
  if (error) throw error;
  await admin.from("household_members").insert([
    { household_id: householdId, profile_id: CUSTOMER_ID, member_role: "owner" },
    { household_id: householdId, profile_id: ADMIN_ID, member_role: "admin" },
  ]);
  return householdId;
}

async function createBatch(admin: SupabaseClient, householdId: string) {
  const { data, error } = await admin
    .rpc("create_document_processing_batch", {
      p_household_id: householdId,
      p_client_request_id: `safe-mode-${randomUUID()}`,
      p_actor_id: CUSTOMER_ID,
    })
    .single();
  expect(error).toBeNull();
  const result = data as BatchCreateResult;
  return result;
}

async function addPolicyDocumentToBatch(
  admin: SupabaseClient,
  householdId: string,
  batchId: string,
  uploadedBy = CUSTOMER_ID,
) {
  const { data: policyDoc, error: docError } = await admin
    .from("policy_documents")
    .insert({
      household_id: householdId,
      file_name: "safe-mode-policy.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      storage_path: `safe/${randomUUID()}.pdf`,
      uploaded_by: uploadedBy,
      category: "other",
    })
    .select("id")
    .single();
  expect(docError).toBeNull();

  const { error: itemError } = await admin.from("document_processing_batch_items").insert({
    batch_id: batchId,
    household_id: householdId,
    client_item_id: `item-${randomUUID()}`,
    policy_document_id: policyDoc!.id,
    selected_file_name: "safe-mode-policy.pdf",
    category: "other",
    content_sha256: FAKE_SHA256,
    status: "uploaded",
  });
  expect(itemError).toBeNull();

  return policyDoc!.id;
}

describe("safe-mode manual entry and staff completion", () => {
  const createdHouseholdIds: string[] = [];

  beforeAll(() => {
    assertLocalSupabase(SUPABASE_URL);
  });

  afterEach(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    for (const householdId of createdHouseholdIds) {
      await admin.from("candidate_field_reviews").delete().eq("household_id", householdId);
      await admin.from("candidate_approvals").delete().eq("household_id", householdId);
      await admin.from("manual_policy_reviews").delete().eq("household_id", householdId);
      await admin.from("asset_candidates").delete().eq("household_id", householdId);
      await admin.from("document_processing_batch_items").delete().eq("household_id", householdId);
      await admin.from("document_processing_batches").delete().eq("household_id", householdId);
      await admin.from("document_extraction_sessions").delete().eq("household_id", householdId);
      await admin.from("policy_documents").delete().eq("household_id", householdId);
      await admin.from("audit_events").delete().eq("household_id", householdId);
      await admin.from("optimization_cases").delete().eq("household_id", householdId);
      await admin.from("household_members").delete().eq("household_id", householdId);
      await admin.from("households").delete().eq("id", householdId);
    }
    createdHouseholdIds.length = 0;
  });

  it("customer can manually enter a policy after a safe-mode upload", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { batch, session_id: sessionId } = await createBatch(admin, householdId);
    const batchId = batch.id;
    const caseId = batch.case_id;

    await addPolicyDocumentToBatch(admin, householdId, batchId);

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", caseId);
    await admin
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batchId);

    const identityFingerprint = `manual-entry-${randomUUID()}`;
    const { data, error } = await customer.rpc("save_customer_manual_policy_review_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `safe-entry-${randomUUID()}`,
      p_asset_type: "property",
      p_identity_fingerprint: identityFingerprint,
      p_display_label: "Primary residence",
      p_match_classification: "new",
      p_selected_facts_json: {
        identity: {
          fullAddress: "123 Main St",
          city: "Calgary",
          province: "AB",
          postalCode: "T2A 0A0",
        },
        currentPolicy: { insurerName: "Test Insurer", annualPremiumCents: 100000 },
        currentCoverage: { dwellingLimitCents: 50000000, baseDeductibleCents: 100000 },
        mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 50000000 } },
      },
    });

    expect(error).toBeNull();
    const result = data as { success?: boolean; candidate?: { id: string } } | null;
    expect(result?.success).toBe(true);
    expect(result?.candidate?.id).toBeTruthy();

    const { data: batchRow } = await admin
      .from("document_processing_batches")
      .select("status, case_id, session_id")
      .eq("id", batchId)
      .single();
    expect(batchRow?.status).toBe("ready_for_review");
    expect(batchRow?.case_id).toBe(caseId);
    expect(batchRow?.session_id).toBe(sessionId);

    const { data: candidate } = await admin
      .from("asset_candidates")
      .select("session_id, household_id, review_status, asset_type, display_label")
      .eq("id", result!.candidate!.id)
      .single();
    expect(candidate?.session_id).toBe(sessionId);
    expect(candidate?.household_id).toBe(householdId);
    expect(candidate?.review_status).toBe("pending");
    expect(candidate?.asset_type).toBe("property");
    expect(candidate?.display_label).toBe("Primary residence");

    const { data: audit } = await admin
      .from("audit_events")
      .select("action, case_id, household_id")
      .eq("action", "customer_manual_candidate_created")
      .eq("case_id", caseId)
      .single();
    expect(audit).not.toBeNull();
  });

  it("staff can complete a manual review using the original batch and session", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const staff = await getAdminClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { batch, session_id: sessionId } = await createBatch(admin, householdId);
    const batchId = batch.id;
    const caseId = batch.case_id;

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", caseId);
    await admin
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batchId);

    const { data: candidate, error: candidateError } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        asset_type: "property",
        identity_fingerprint: `staff-candidate-${randomUUID()}`,
        display_label: "Manual rental property",
        review_status: "pending",
        selected_facts_json: { identity: {} },
      })
      .select("id")
      .single();
    expect(candidateError).toBeNull();

    const { data, error } = await staff.rpc("complete_manual_review_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [candidate!.id],
    });

    expect(error).toBeNull();
    const result = data as { success?: boolean; linked_candidates?: number } | null;
    expect(result?.success).toBe(true);
    expect(result?.linked_candidates).toBe(1);

    const { data: batchRow } = await admin
      .from("document_processing_batches")
      .select("status, case_id")
      .eq("id", batchId)
      .single();
    expect(batchRow?.status).toBe("ready_for_review");
    expect(batchRow?.case_id).toBe(caseId);

    const { data: updatedCandidate } = await admin
      .from("asset_candidates")
      .select("session_id")
      .eq("id", candidate!.id)
      .single();
    expect(updatedCandidate?.session_id).toBe(sessionId);

    const { data: audit } = await admin
      .from("audit_events")
      .select("action, case_id, household_id")
      .eq("action", "manual_review_completed")
      .eq("case_id", caseId)
      .single();
    expect(audit).not.toBeNull();
  });

  it("rejects non-staff callers for manual review completion", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { batch, session_id: sessionId } = await createBatch(admin, householdId);

    const { error } = await customer.rpc("complete_manual_review_v1", {
      p_batch_id: batch.id,
      p_session_id: sessionId,
      p_case_id: batch.case_id,
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_candidate_ids: [],
    });

    expect(error).not.toBeNull();
  });
});
