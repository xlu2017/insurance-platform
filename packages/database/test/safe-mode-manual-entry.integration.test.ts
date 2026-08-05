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
  batch: { id: string; case_id: string; session_id: string; status: string } & Record<
    string,
    unknown
  >;
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
  const { data, error } = await admin.rpc("create_document_processing_batch", {
    p_household_id: householdId,
    p_client_request_id: `safe-mode-${randomUUID()}`,
    p_actor_id: CUSTOMER_ID,
  });
  expect(error).toBeNull();
  const result = data as BatchCreateResult;
  return result;
}

async function addPolicyDocumentToBatch(
  admin: SupabaseClient,
  householdId: string,
  batchId: string,
  suffix = "",
) {
  const { data: policyDoc, error: docError } = await admin
    .from("policy_documents")
    .insert({
      household_id: householdId,
      file_name: `safe-mode-policy${suffix}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      storage_path: `safe/${randomUUID()}.pdf`,
      uploaded_by: CUSTOMER_ID,
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
    selected_file_name: `safe-mode-policy${suffix}.pdf`,
    category: "other",
    content_sha256: FAKE_SHA256,
    status: "uploaded",
  });
  expect(itemError).toBeNull();

  return policyDoc!.id;
}

function selectedFactsForProperty() {
  return {
    identity: {
      fullAddress: "123 Main St",
      city: "Calgary",
      province: "AB",
      postalCode: "T2A 0A0",
      yearBuilt: "1995",
    },
    currentPolicy: {
      insurerName: "Test Insurer",
      policyNumber: "POL-123",
      annualPremiumCents: 100000,
      expiryDate: "2026-12-31",
    },
    currentCoverage: {
      dwellingLimitCents: 50000000,
      contentsLimitCents: 10000000,
      liabilityLimitCents: 2000000,
      baseDeductibleCents: 100000,
    },
    mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 50000000 } },
  };
}

function selectedFactsForVehicle() {
  return {
    identity: { year: "2020", make: "Honda", model: "Civic", vin: "2HGFC2F59JH500001" },
    currentPolicy: {
      insurerName: "Test Insurer",
      policyNumber: "POL-456",
      annualPremiumCents: 150000,
      expiryDate: "2026-12-31",
    },
    currentCoverage: {
      thirdPartyLiabilityCents: 1000000,
      collisionDeductibleCents: 50000,
      comprehensiveDeductibleCents: 50000,
    },
    mandateSuggestions: { thirdPartyLiability: { rule: "minimum", amountCents: 1000000 } },
  };
}

async function saveManualCandidate(
  client: SupabaseClient,
  params: {
    batchId: string;
    sessionId: string;
    caseId: string;
    householdId: string;
    requestId: string;
    assetType: "property" | "vehicle";
    label: string;
    sourceDocumentIds: string[];
    selectedFacts: Record<string, unknown>;
  },
) {
  return client.rpc("save_customer_manual_policy_review_v1", {
    p_batch_id: params.batchId,
    p_session_id: params.sessionId,
    p_case_id: params.caseId,
    p_household_id: params.householdId,
    p_client_request_id: params.requestId,
    p_asset_type: params.assetType,
    p_identity_fingerprint: `manual-${params.assetType}-${params.requestId}`,
    p_display_label: params.label,
    p_source_document_ids: params.sourceDocumentIds,
    p_selected_facts_json: params.selectedFacts,
    p_match_classification: "new",
  });
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
      await admin.from("manual_entry_idempotency").delete().eq("household_id", householdId);
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
    const docId = await addPolicyDocumentToBatch(admin, householdId, batchId);

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", caseId);
    await admin
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batchId);

    const requestId = `safe-entry-${randomUUID()}`;
    const { data, error } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId,
      assetType: "property",
      label: "Primary residence",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });

    expect(error).toBeNull();
    const result = data as { success?: boolean; candidate_id?: string } | null;
    expect(result?.success).toBe(true);
    expect(result?.candidate_id).toBeTruthy();

    const { data: batchRow } = await admin
      .from("document_processing_batches")
      .select("status, case_id, session_id")
      .eq("id", batchId)
      .single();
    expect(batchRow?.status).toBe("manual_review");
    expect(batchRow?.case_id).toBe(caseId);
    expect(batchRow?.session_id).toBe(sessionId);

    const { data: item } = await admin
      .from("document_processing_batch_items")
      .select("manual_entry_status")
      .eq("batch_id", batchId)
      .eq("policy_document_id", docId)
      .single();
    expect(item?.manual_entry_status).toBe("assigned");

    const { data: audit } = await admin
      .from("audit_events")
      .select("action, case_id, household_id")
      .eq("action", "customer_manual_candidate_saved")
      .eq("case_id", caseId)
      .single();
    expect(audit).not.toBeNull();
  });

  it("omitted source documents or documents not in batch are rejected", async () => {
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

    const { error: emptyError } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `empty-source-${randomUUID()}`,
      assetType: "property",
      label: "No source doc",
      sourceDocumentIds: [],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(emptyError).not.toBeNull();

    const foreignDocId = `00000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    const { error: foreignError } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `foreign-source-${randomUUID()}`,
      assetType: "property",
      label: "Foreign source doc",
      sourceDocumentIds: [foreignDocId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(foreignError).not.toBeNull();
  });

  it("rejects manual entry for dangerous, ready, active processing, or unrelated batches", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { batch, session_id: sessionId } = await createBatch(admin, householdId);
    const batchId = batch.id;
    const caseId = batch.case_id;
    const docId = await addPolicyDocumentToBatch(admin, householdId, batchId);

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", caseId);
    await admin
      .from("document_processing_batches")
      .update({ mode_snapshot: "dangerous" })
      .eq("id", batchId);

    const { error: dangerousError } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `dangerous-${randomUUID()}`,
      assetType: "property",
      label: "Dangerous",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(dangerousError).not.toBeNull();

    await admin
      .from("document_processing_batches")
      .update({ mode_snapshot: "safe", status: "ready_for_review" })
      .eq("id", batchId);
    const { error: readyError } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `ready-${randomUUID()}`,
      assetType: "property",
      label: "Ready",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(readyError).not.toBeNull();

    await admin.from("document_processing_batches").update({ status: "queued" }).eq("id", batchId);
    const { error: activeError } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `active-${randomUUID()}`,
      assetType: "property",
      label: "Active",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(activeError).not.toBeNull();
  });

  it("rejects cross-case and cross-session requests", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { batch, session_id: sessionId } = await createBatch(admin, householdId);
    const batchId = batch.id;
    const caseId = batch.case_id;
    const docId = await addPolicyDocumentToBatch(admin, householdId, batchId);

    const otherBatch = await createBatch(admin, householdId);

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", caseId);
    await admin
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batchId);

    const { error: wrongCaseError } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId: otherBatch.batch.case_id,
      householdId,
      requestId: `wrong-case-${randomUUID()}`,
      assetType: "property",
      label: "Wrong case",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(wrongCaseError).not.toBeNull();

    const { error: wrongSessionError } = await saveManualCandidate(customer, {
      batchId,
      sessionId: otherBatch.session_id,
      caseId,
      householdId,
      requestId: `wrong-session-${randomUUID()}`,
      assetType: "property",
      label: "Wrong session",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(wrongSessionError).not.toBeNull();
  });

  it("sequential and concurrent save requests with the same client_request_id are idempotent", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { batch, session_id: sessionId } = await createBatch(admin, householdId);
    const batchId = batch.id;
    const caseId = batch.case_id;
    const docId = await addPolicyDocumentToBatch(admin, householdId, batchId);

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", caseId);
    await admin
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batchId);

    const requestId = `idempotent-save-${randomUUID()}`;

    const { data: firstData, error: firstError } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId,
      assetType: "property",
      label: "Residence",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(firstError).toBeNull();
    const firstCandidateId = (firstData as { candidate_id?: string })?.candidate_id;
    expect(firstCandidateId).toBeTruthy();

    const { data: secondData, error: secondError } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId,
      assetType: "property",
      label: "Residence",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(secondError).toBeNull();
    expect((secondData as { candidate_id?: string })?.candidate_id).toBe(firstCandidateId);

    const concurrent = await Promise.all([
      saveManualCandidate(customer, {
        batchId,
        sessionId,
        caseId,
        householdId,
        requestId,
        assetType: "property",
        label: "Residence",
        sourceDocumentIds: [docId],
        selectedFacts: selectedFactsForProperty(),
      }),
      saveManualCandidate(customer, {
        batchId,
        sessionId,
        caseId,
        householdId,
        requestId,
        assetType: "property",
        label: "Residence",
        sourceDocumentIds: [docId],
        selectedFacts: selectedFactsForProperty(),
      }),
    ]);
    for (const { data, error } of concurrent) {
      expect(error).toBeNull();
      expect((data as { candidate_id?: string })?.candidate_id).toBe(firstCandidateId);
    }

    const { data: ledger } = await admin
      .from("manual_entry_idempotency")
      .select("id")
      .eq("household_id", householdId)
      .eq("batch_id", batchId)
      .eq("operation_type", "save_candidate")
      .eq("client_request_id", requestId);
    expect(ledger?.length).toBe(1);
  });

  it("supports multiple documents and multiple candidates with correct provenance", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { batch, session_id: sessionId } = await createBatch(admin, householdId);
    const batchId = batch.id;
    const caseId = batch.case_id;

    const propertyDocs = await Promise.all([
      addPolicyDocumentToBatch(admin, householdId, batchId, "-p1"),
      addPolicyDocumentToBatch(admin, householdId, batchId, "-p2"),
      addPolicyDocumentToBatch(admin, householdId, batchId, "-p3"),
    ]);
    const vehicleDoc = await addPolicyDocumentToBatch(admin, householdId, batchId, "-v1");

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", caseId);
    await admin
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batchId);

    const candidates: {
      label: string;
      assetType: "property" | "vehicle";
      docIds: string[];
      requestId: string;
      facts: Record<string, unknown>;
    }[] = [
      {
        label: "Property 1",
        assetType: "property",
        docIds: [propertyDocs[0]],
        requestId: `p1-${randomUUID()}`,
        facts: selectedFactsForProperty(),
      },
      {
        label: "Property 2",
        assetType: "property",
        docIds: [propertyDocs[1]],
        requestId: `p2-${randomUUID()}`,
        facts: selectedFactsForProperty(),
      },
      {
        label: "Property 3",
        assetType: "property",
        docIds: [propertyDocs[2]],
        requestId: `p3-${randomUUID()}`,
        facts: selectedFactsForProperty(),
      },
      {
        label: "Vehicle 1",
        assetType: "vehicle",
        docIds: [vehicleDoc],
        requestId: `v1-${randomUUID()}`,
        facts: selectedFactsForVehicle(),
      },
    ];

    const candidateIds: string[] = [];
    for (const c of candidates) {
      const { data, error } = await saveManualCandidate(customer, {
        batchId,
        sessionId,
        caseId,
        householdId,
        requestId: c.requestId,
        assetType: c.assetType,
        label: c.label,
        sourceDocumentIds: c.docIds,
        selectedFacts: c.facts,
      });
      expect(error).toBeNull();
      const candidateId = (data as { candidate_id?: string })?.candidate_id;
      expect(candidateId).toBeTruthy();
      candidateIds.push(candidateId!);

      const { data: candidate } = await admin
        .from("asset_candidates")
        .select("source_document_ids, selected_facts_json")
        .eq("id", candidateId)
        .single();
      expect(candidate?.source_document_ids).toEqual(c.docIds);
      expect((candidate?.selected_facts_json as { _source?: string })?._source).toBe(
        "customer_manual_entry",
      );
    }

    expect(candidateIds.length).toBe(4);
    expect(new Set(candidateIds).size).toBe(4);
  });

  it("prevents completion when documents are unassigned", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { batch, session_id: sessionId } = await createBatch(admin, householdId);
    const batchId = batch.id;
    const caseId = batch.case_id;
    const docId = await addPolicyDocumentToBatch(admin, householdId, batchId);

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", caseId);
    await admin
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batchId);

    // Add a candidate for one document while another document is left unassigned.
    const extraDocId = await addPolicyDocumentToBatch(admin, householdId, batchId, "-extra");
    const requestId = `unassigned-${randomUUID()}`;
    const { data, error } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId,
      assetType: "property",
      label: "Covered property",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(error).toBeNull();
    expect((data as { candidate_id?: string })?.candidate_id).toBeTruthy();

    const completeId = `complete-${randomUUID()}`;
    const { error: completeError } = await customer.rpc("complete_customer_manual_entry_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_client_request_id: completeId,
      p_skipped_document_ids: [],
    });
    expect(completeError).not.toBeNull();

    // Mark the extra document as skipped and complete successfully.
    const { error: skipError } = await customer.rpc("set_manual_entry_document_status_v1", {
      p_batch_id: batchId,
      p_policy_document_id: extraDocId,
      p_household_id: householdId,
      p_status: "skipped",
    });
    expect(skipError).toBeNull();

    const { data: completeData, error: completeRetryError } = await customer.rpc(
      "complete_customer_manual_entry_v1",
      {
        p_batch_id: batchId,
        p_session_id: sessionId,
        p_case_id: caseId,
        p_household_id: householdId,
        p_client_request_id: completeId,
        p_skipped_document_ids: [extraDocId],
      },
    );
    expect(completeRetryError).toBeNull();
    expect((completeData as { success?: boolean })?.success).toBe(true);

    const { data: batchRow } = await admin
      .from("document_processing_batches")
      .select("status")
      .eq("id", batchId)
      .single();
    expect(batchRow?.status).toBe("ready_for_review");
  });

  it("customer completion is idempotent", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { batch, session_id: sessionId } = await createBatch(admin, householdId);
    const batchId = batch.id;
    const caseId = batch.case_id;
    const docId = await addPolicyDocumentToBatch(admin, householdId, batchId);

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", caseId);
    await admin
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batchId);

    const saveId = `save-${randomUUID()}`;
    const { data: saveData, error: saveError } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: saveId,
      assetType: "property",
      label: "Home",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(saveError).toBeNull();

    const completeId = `complete-${randomUUID()}`;
    const first = await customer.rpc("complete_customer_manual_entry_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_client_request_id: completeId,
      p_skipped_document_ids: [],
    });
    expect(first.error).toBeNull();
    expect((first.data as { success?: boolean })?.success).toBe(true);

    const second = await customer.rpc("complete_customer_manual_entry_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_client_request_id: completeId,
      p_skipped_document_ids: [],
    });
    expect(second.error).toBeNull();
    expect((second.data as { success?: boolean })?.success).toBe(true);

    const { data: audit } = await admin
      .from("audit_events")
      .select("id")
      .eq("action", "customer_manual_entry_completed")
      .eq("entity_id", batchId);
    expect(audit?.length).toBe(1);

    const { data: ledger } = await admin
      .from("manual_entry_idempotency")
      .select("id")
      .eq("household_id", householdId)
      .eq("batch_id", batchId)
      .eq("operation_type", "complete_entry")
      .eq("client_request_id", completeId);
    expect(ledger?.length).toBe(1);
  });

  it("staff can complete a manual review and rejects invalid candidate arrays", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const staff = await getAdminClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { batch, session_id: sessionId } = await createBatch(admin, householdId);
    const batchId = batch.id;
    const caseId = batch.case_id;
    const docId = await addPolicyDocumentToBatch(admin, householdId, batchId);

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", caseId);
    await admin
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batchId);

    const saveId = `staff-save-${randomUUID()}`;
    const { data: saveData, error: saveError } = await saveManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: saveId,
      assetType: "property",
      label: "Home",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(saveError).toBeNull();
    const candidateId = (saveData as { candidate_id?: string })?.candidate_id!;

    const { error: emptyError } = await staff.rpc("complete_manual_review_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [],
    });
    expect(emptyError).not.toBeNull();

    const { error: duplicateError } = await staff.rpc("complete_manual_review_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [candidateId, candidateId],
    });
    expect(duplicateError).not.toBeNull();

    const otherHousehold = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(otherHousehold);
    const { data: otherCandidate, error: otherError } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: otherHousehold,
        asset_type: "property",
        identity_fingerprint: `foreign-${randomUUID()}`,
        display_label: "Foreign candidate",
        review_status: "pending",
        selected_facts_json: {},
        source_document_ids: [docId],
      })
      .select("id")
      .single();
    expect(otherError).toBeNull();

    const { error: foreignError } = await staff.rpc("complete_manual_review_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [candidateId, otherCandidate!.id],
    });
    expect(foreignError).not.toBeNull();

    const { data, error } = await staff.rpc("complete_manual_review_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [candidateId],
      p_client_request_id: `staff-complete-${randomUUID()}`,
    });
    expect(error).toBeNull();
    expect((data as { success?: boolean; linked_candidates?: number })?.success).toBe(true);
    expect((data as { linked_candidates?: number })?.linked_candidates).toBe(1);

    const { data: batchRow } = await admin
      .from("document_processing_batches")
      .select("status")
      .eq("id", batchId)
      .single();
    expect(batchRow?.status).toBe("ready_for_review");

    const { error: againError } = await staff.rpc("complete_manual_review_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [candidateId],
      p_client_request_id: `staff-complete-${randomUUID()}`,
    });
    expect(againError).not.toBeNull();
  });

  it("customers cannot call staff completion and staff cannot attach unrelated documents", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const customer = await getCustomerClient();
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

    const { error: customerStaffError } = await customer.rpc("complete_manual_review_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_candidate_ids: [],
    });
    expect(customerStaffError).not.toBeNull();

    // Candidate referencing a document from another household's batch is rejected.
    const otherHousehold = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(otherHousehold);
    const otherBatch = await createBatch(admin, otherHousehold);
    const otherDoc = await addPolicyDocumentToBatch(admin, otherHousehold, otherBatch.batch.id);
    const { data: badCandidate, error: badCandidateError } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        asset_type: "property",
        identity_fingerprint: `bad-doc-${randomUUID()}`,
        display_label: "Foreign document candidate",
        review_status: "pending",
        selected_facts_json: {},
        source_document_ids: [otherDoc],
      })
      .select("id")
      .single();
    expect(badCandidateError).toBeNull();

    const { error: foreignDocError } = await staff.rpc("complete_manual_review_v1", {
      p_batch_id: batchId,
      p_session_id: sessionId,
      p_case_id: caseId,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [badCandidate!.id],
    });
    expect(foreignDocError).not.toBeNull();
  });
});
