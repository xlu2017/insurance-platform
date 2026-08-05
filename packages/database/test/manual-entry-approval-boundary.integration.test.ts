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
const OPERATIONS_ID = "00000000-0000-0000-0000-000000000002";

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

async function getOperationsClient() {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({
    email: "operations@example.com",
    password: "DemoOperations123!",
  });
  if (error) throw new Error("Failed to sign in operations: " + error.message);
  return client;
}

function getServiceRoleClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  });
}

async function createIsolatedHousehold(serviceRole: SupabaseClient) {
  const householdId = `b0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
  const { error } = await serviceRole.from("households").insert({
    id: householdId,
    owner_profile_id: CUSTOMER_ID,
    name: "Manual Entry Approval Boundary Household",
    province: "AB",
    autopilot_active: false,
    onboarding_step: "complete",
  });
  if (error) throw error;
  return householdId;
}

async function createBatch(serviceRole: SupabaseClient, householdId: string) {
  const { data, error } = await serviceRole.rpc("create_document_processing_batch", {
    p_household_id: householdId,
    p_client_request_id: `boundary-${randomUUID()}`,
    p_actor_id: CUSTOMER_ID,
  });
  expect(error).toBeNull();
  return data as BatchCreateResult;
}

async function addPolicyDocumentToBatch(
  serviceRole: SupabaseClient,
  householdId: string,
  batchId: string,
  suffix = "",
) {
  const { data: policyDoc, error: docError } = await serviceRole
    .from("policy_documents")
    .insert({
      household_id: householdId,
      file_name: `boundary-policy${suffix}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      storage_path: `boundary/${randomUUID()}.pdf`,
      uploaded_by: CUSTOMER_ID,
      category: "other",
    })
    .select("id")
    .single();
  expect(docError).toBeNull();

  const { error: itemError } = await serviceRole.from("document_processing_batch_items").insert({
    batch_id: batchId,
    household_id: householdId,
    client_item_id: `item-${randomUUID()}`,
    policy_document_id: policyDoc!.id,
    selected_file_name: `boundary-policy${suffix}.pdf`,
    category: "other",
    content_sha256: FAKE_SHA256,
    status: "uploaded",
  });
  expect(itemError).toBeNull();

  return policyDoc!.id;
}

function selectedFactsForProperty(overrides: Record<string, unknown> = {}) {
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
      personalLiabilityLimitCents: 2000000,
      baseDeductibleCents: 100000,
    },
    mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 50000000 } },
    ...overrides,
  };
}

function selectedFactsForVehicle(overrides: Record<string, unknown> = {}) {
  return {
    identity: {
      year: "2020",
      make: "Honda",
      model: "Civic",
      vin: "2HGFC2F59JH500001",
    },
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
    ...overrides,
  };
}

async function saveCustomerManualCandidate(
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
    p_identity_fingerprint: `boundary-${params.assetType}-${params.requestId}`,
    p_display_label: params.label,
    p_source_document_ids: params.sourceDocumentIds,
    p_selected_facts_json: params.selectedFacts,
    p_match_classification: "new",
  });
}

async function saveStaffManualCandidate(
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
  return client.rpc("save_staff_manual_policy_candidate_v1", {
    p_batch_id: params.batchId,
    p_session_id: params.sessionId,
    p_case_id: params.caseId,
    p_household_id: params.householdId,
    p_client_request_id: params.requestId,
    p_asset_type: params.assetType,
    p_identity_fingerprint: `boundary-staff-${params.assetType}-${params.requestId}`,
    p_display_label: params.label,
    p_source_document_ids: params.sourceDocumentIds,
    p_selected_facts_json: params.selectedFacts,
    p_match_classification: "new",
  });
}

async function completeCustomerManualEntry(
  client: SupabaseClient,
  params: {
    batchId: string;
    sessionId: string;
    caseId: string;
    householdId: string;
    requestId: string;
    skippedDocumentIds: string[];
  },
) {
  return client.rpc("complete_customer_manual_entry_v1", {
    p_batch_id: params.batchId,
    p_session_id: params.sessionId,
    p_case_id: params.caseId,
    p_household_id: params.householdId,
    p_client_request_id: params.requestId,
    p_skipped_document_ids: params.skippedDocumentIds,
  });
}

async function completeStaffManualReview(
  client: SupabaseClient,
  params: {
    batchId: string;
    sessionId: string;
    caseId: string;
    householdId: string;
    requestId?: string;
    actorId: string;
    candidateIds: string[];
    skippedDocumentIds?: string[];
  },
) {
  return client.rpc("complete_manual_review_v1", {
    p_batch_id: params.batchId,
    p_session_id: params.sessionId,
    p_case_id: params.caseId,
    p_household_id: params.householdId,
    p_actor_profile_id: params.actorId,
    p_candidate_ids: params.candidateIds,
    p_client_request_id: params.requestId,
    p_skipped_document_ids: params.skippedDocumentIds ?? [],
  });
}

async function approveCandidates(
  client: SupabaseClient,
  params: {
    householdId: string;
    actorId: string;
    requestId: string;
    decisions: { candidate_id: string; decision: string }[];
  },
) {
  return client.rpc("approve_candidate_assets_v2", {
    p_household_id: params.householdId,
    p_actor_profile_id: params.actorId,
    p_client_request_id: params.requestId,
    p_decisions: params.decisions,
  });
}

describe("manual-entry approval boundary", () => {
  const createdHouseholdIds: string[] = [];

  beforeAll(() => {
    assertLocalSupabase(SUPABASE_URL);
  });

  afterEach(async () => {
    const serviceRole = getServiceRoleClient();
    for (const householdId of createdHouseholdIds) {
      await serviceRole.from("candidate_field_reviews").delete().eq("household_id", householdId);
      await serviceRole.from("candidate_approvals").delete().eq("household_id", householdId);
      await serviceRole.from("manual_policy_reviews").delete().eq("household_id", householdId);
      await serviceRole.from("manual_entry_idempotency").delete().eq("household_id", householdId);
      await serviceRole.from("asset_candidates").delete().eq("household_id", householdId);
      await serviceRole
        .from("policy_document_policy_links")
        .delete()
        .eq("household_id", householdId);
      await serviceRole
        .from("document_processing_batch_items")
        .delete()
        .eq("household_id", householdId);
      await serviceRole
        .from("document_processing_batches")
        .delete()
        .eq("household_id", householdId);
      await serviceRole
        .from("document_extraction_sessions")
        .delete()
        .eq("household_id", householdId);
      await serviceRole.from("policy_documents").delete().eq("household_id", householdId);
      await serviceRole.from("audit_events").delete().eq("household_id", householdId);
      await serviceRole.from("case_assignments").delete().eq("assignee_profile_id", OPERATIONS_ID);
      await serviceRole.from("optimization_cases").delete().eq("household_id", householdId);
      await serviceRole.from("household_members").delete().eq("household_id", householdId);
      await serviceRole.from("vehicles").delete().eq("household_id", householdId);
      await serviceRole.from("properties").delete().eq("household_id", householdId);
      await serviceRole.from("policies").delete().eq("household_id", householdId);
      await serviceRole.from("households").delete().eq("id", householdId);
    }
    createdHouseholdIds.length = 0;
  });

  async function prepareManualReviewBatch(serviceRole: SupabaseClient, householdId: string) {
    const { batch, session_id: sessionId } = await createBatch(serviceRole, householdId);
    const { error: stateError } = await serviceRole
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", batch.case_id);
    expect(stateError).toBeNull();
    const { error: batchError } = await serviceRole
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batch.id);
    expect(batchError).toBeNull();
    return { batchId: batch.id, sessionId, caseId: batch.case_id };
  }

  it("one candidate with three source documents creates exactly one policy with three provenance links", async () => {
    const serviceRole = getServiceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(serviceRole);
    createdHouseholdIds.push(householdId);
    const { batchId, sessionId, caseId } = await prepareManualReviewBatch(serviceRole, householdId);

    const doc1 = await addPolicyDocumentToBatch(serviceRole, householdId, batchId, "-1");
    const doc2 = await addPolicyDocumentToBatch(serviceRole, householdId, batchId, "-2");
    const doc3 = await addPolicyDocumentToBatch(serviceRole, householdId, batchId, "-3");

    const requestId = `three-docs-${randomUUID()}`;
    const { data: saveData, error: saveError } = await saveCustomerManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId,
      assetType: "property",
      label: "Principal residence",
      sourceDocumentIds: [doc1, doc2, doc3],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(saveError).toBeNull();
    const candidateId = (saveData as { candidate_id?: string } | null)?.candidate_id;
    expect(candidateId).toBeTruthy();

    const approveRequestId = `approve-three-${randomUUID()}`;
    const { data: approveData, error: approveError } = await approveCandidates(customer, {
      householdId,
      actorId: CUSTOMER_ID,
      requestId: approveRequestId,
      decisions: [{ candidate_id: candidateId!, decision: "approve_new" }],
    });
    expect(approveError).toBeNull();
    expect((approveData as { success?: boolean } | null)?.success).toBe(true);

    const result = approveData as {
      policies?: string[];
      properties?: string[];
    } | null;
    expect(result?.policies?.length).toBe(1);
    expect(result?.properties?.length).toBe(1);

    const policyId = result?.policies?.[0];
    const { data: candidate } = await serviceRole
      .from("asset_candidates")
      .select("approved_policy_id")
      .eq("id", candidateId)
      .single();
    expect(candidate?.approved_policy_id).toBe(policyId);

    const { data: links, error: linksError } = await serviceRole
      .from("policy_document_policy_links")
      .select("policy_document_id")
      .eq("policy_id", policyId)
      .eq("candidate_id", candidateId);
    expect(linksError).toBeNull();
    const linkedDocIds = (links ?? []).map((l) => l.policy_document_id).sort();
    expect(linkedDocIds).toEqual([doc1, doc2, doc3].sort());
  });

  it("one source document supports two vehicle candidates and both policies link to the same document", async () => {
    const serviceRole = getServiceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(serviceRole);
    createdHouseholdIds.push(householdId);
    const { batchId, sessionId, caseId } = await prepareManualReviewBatch(serviceRole, householdId);

    const docId = await addPolicyDocumentToBatch(serviceRole, householdId, batchId);

    const vehicle1RequestId = `vehicle-1-${randomUUID()}`;
    const vehicle2RequestId = `vehicle-2-${randomUUID()}`;

    const { data: v1Save } = await saveCustomerManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: vehicle1RequestId,
      assetType: "vehicle",
      label: "2020 Honda Civic",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForVehicle({
        identity: { year: "2020", make: "Honda", model: "Civic", vin: "1HGFC2F59HA000001" },
      }),
    });
    const { data: v2Save } = await saveCustomerManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: vehicle2RequestId,
      assetType: "vehicle",
      label: "2021 Toyota Corolla",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForVehicle({
        identity: { year: "2021", make: "Toyota", model: "Corolla", vin: "1HGFC2F59HA000002" },
        currentPolicy: {
          insurerName: "Test Insurer",
          policyNumber: "POL-789",
          annualPremiumCents: 140000,
          expiryDate: "2026-12-31",
        },
      }),
    });

    const v1Id = (v1Save as { candidate_id?: string } | null)?.candidate_id;
    const v2Id = (v2Save as { candidate_id?: string } | null)?.candidate_id;
    expect(v1Id).toBeTruthy();
    expect(v2Id).toBeTruthy();

    const { data: approveData, error: approveError } = await approveCandidates(customer, {
      householdId,
      actorId: CUSTOMER_ID,
      requestId: `approve-multi-vehicle-${randomUUID()}`,
      decisions: [
        { candidate_id: v1Id!, decision: "approve_new" },
        { candidate_id: v2Id!, decision: "approve_new" },
      ],
    });
    expect(approveError).toBeNull();
    const result = approveData as { policies?: string[]; vehicles?: string[] } | null;
    expect(result?.vehicles?.length).toBe(2);
    expect(result?.policies?.length).toBe(2);

    const { data: links } = await serviceRole
      .from("policy_document_policy_links")
      .select("policy_id, candidate_id")
      .eq("policy_document_id", docId);
    expect((links ?? []).length).toBe(2);
    const linkedPolicyIds = (links ?? []).map((l) => l.policy_id).sort();
    expect(linkedPolicyIds).toEqual(result?.policies?.slice().sort());
  });

  it("one bundled document supports both a property and a vehicle candidate", async () => {
    const serviceRole = getServiceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(serviceRole);
    createdHouseholdIds.push(householdId);
    const { batchId, sessionId, caseId } = await prepareManualReviewBatch(serviceRole, householdId);

    const docId = await addPolicyDocumentToBatch(serviceRole, householdId, batchId);

    const { data: propSave } = await saveCustomerManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `bundled-prop-${randomUUID()}`,
      assetType: "property",
      label: "Home",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    const { data: vehSave } = await saveCustomerManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `bundled-veh-${randomUUID()}`,
      assetType: "vehicle",
      label: "Auto",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForVehicle(),
    });

    const propId = (propSave as { candidate_id?: string } | null)?.candidate_id;
    const vehId = (vehSave as { candidate_id?: string } | null)?.candidate_id;

    const { data: approveData } = await approveCandidates(customer, {
      householdId,
      actorId: CUSTOMER_ID,
      requestId: `approve-bundled-${randomUUID()}`,
      decisions: [
        { candidate_id: propId!, decision: "approve_new" },
        { candidate_id: vehId!, decision: "approve_new" },
      ],
    });
    const result = approveData as {
      properties?: string[];
      vehicles?: string[];
      policies?: string[];
    } | null;
    expect(result?.properties?.length).toBe(1);
    expect(result?.vehicles?.length).toBe(1);
    expect(result?.policies?.length).toBe(2);

    const { data: links } = await serviceRole
      .from("policy_document_policy_links")
      .select("policy_id, candidate_id")
      .eq("policy_document_id", docId);
    expect((links ?? []).length).toBe(2);
  });

  it("operations staff with case assignment but no household membership can save a manual candidate", async () => {
    const serviceRole = getServiceRoleClient();
    const operations = await getOperationsClient();
    const householdId = await createIsolatedHousehold(serviceRole);
    createdHouseholdIds.push(householdId);
    const { batchId, sessionId, caseId } = await prepareManualReviewBatch(serviceRole, householdId);

    const { data: membership } = await serviceRole
      .from("household_members")
      .select("id")
      .eq("household_id", householdId)
      .eq("profile_id", OPERATIONS_ID);
    expect(membership?.length).toBe(0);

    await serviceRole.from("case_assignments").insert({
      case_id: caseId,
      assignee_profile_id: OPERATIONS_ID,
      assignment_role: "operations",
    });

    const docId = await addPolicyDocumentToBatch(serviceRole, householdId, batchId);

    const { data, error } = await saveStaffManualCandidate(operations, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `staff-no-member-${randomUUID()}`,
      assetType: "property",
      label: "Staff-entered residence",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(error).toBeNull();
    expect((data as { success?: boolean; candidate_id?: string } | null)?.success).toBe(true);
  });

  it("staff cannot complete a one-candidate four-document batch until remaining documents are resolved", async () => {
    const serviceRole = getServiceRoleClient();
    const operations = await getOperationsClient();
    const householdId = await createIsolatedHousehold(serviceRole);
    createdHouseholdIds.push(householdId);
    const { batchId, sessionId, caseId } = await prepareManualReviewBatch(serviceRole, householdId);

    await serviceRole.from("case_assignments").insert({
      case_id: caseId,
      assignee_profile_id: OPERATIONS_ID,
      assignment_role: "operations",
    });

    const doc1 = await addPolicyDocumentToBatch(serviceRole, householdId, batchId, "-1");
    const doc2 = await addPolicyDocumentToBatch(serviceRole, householdId, batchId, "-2");
    const doc3 = await addPolicyDocumentToBatch(serviceRole, householdId, batchId, "-3");
    const doc4 = await addPolicyDocumentToBatch(serviceRole, householdId, batchId, "-4");

    const { data: saveData } = await saveStaffManualCandidate(operations, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `one-of-four-${randomUUID()}`,
      assetType: "property",
      label: "Residence",
      sourceDocumentIds: [doc1],
      selectedFacts: selectedFactsForProperty(),
    });
    const candidateId = (saveData as { candidate_id?: string } | null)?.candidate_id;

    const { error: completeError } = await completeStaffManualReview(operations, {
      batchId,
      sessionId,
      caseId,
      householdId,
      actorId: OPERATIONS_ID,
      candidateIds: [candidateId!],
      skippedDocumentIds: [],
    });
    expect(completeError).not.toBeNull();

    for (const docId of [doc2, doc3, doc4]) {
      const { error: skipError } = await operations.rpc("set_manual_entry_document_status_v1", {
        p_batch_id: batchId,
        p_policy_document_id: docId,
        p_household_id: householdId,
        p_status: "not_relevant",
      });
      expect(skipError).toBeNull();
    }

    const { data: completeData, error: completeRetryError } = await completeStaffManualReview(
      operations,
      {
        batchId,
        sessionId,
        caseId,
        householdId,
        requestId: `complete-one-of-four-${randomUUID()}`,
        actorId: OPERATIONS_ID,
        candidateIds: [candidateId!],
        skippedDocumentIds: [doc2, doc3, doc4],
      },
    );
    expect(completeRetryError).toBeNull();
    expect((completeData as { success?: boolean } | null)?.success).toBe(true);

    const { data: batchRow } = await serviceRole
      .from("document_processing_batches")
      .select("status")
      .eq("id", batchId)
      .single();
    expect(batchRow?.status).toBe("ready_for_review");
  });

  it("blank vehicle identity cannot produce year 0", async () => {
    const serviceRole = getServiceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(serviceRole);
    createdHouseholdIds.push(householdId);
    const { batchId, sessionId, caseId } = await prepareManualReviewBatch(serviceRole, householdId);

    const docId = await addPolicyDocumentToBatch(serviceRole, householdId, batchId);

    const { data: saveData } = await saveCustomerManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `blank-identity-${randomUUID()}`,
      assetType: "vehicle",
      label: "Unknown vehicle",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForVehicle({
        identity: { year: "", make: "", model: "", vin: "" },
        currentPolicy: {
          insurerName: "Test",
          policyNumber: "POL",
          annualPremiumCents: 100000,
          expiryDate: "2026-12-31",
        },
      }),
    });
    const candidateId = (saveData as { candidate_id?: string } | null)?.candidate_id;

    const { error: approveError } = await approveCandidates(customer, {
      householdId,
      actorId: CUSTOMER_ID,
      requestId: `approve-blank-${randomUUID()}`,
      decisions: [{ candidate_id: candidateId!, decision: "approve_new" }],
    });
    expect(approveError).not.toBeNull();

    const { data: vehicles } = await serviceRole
      .from("vehicles")
      .select("id")
      .eq("household_id", householdId);
    expect(vehicles?.length).toBe(0);
  });

  it("blank premium cannot produce annual premium $0", async () => {
    const serviceRole = getServiceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(serviceRole);
    createdHouseholdIds.push(householdId);
    const { batchId, sessionId, caseId } = await prepareManualReviewBatch(serviceRole, householdId);

    const docId = await addPolicyDocumentToBatch(serviceRole, householdId, batchId);

    const { data: saveData } = await saveCustomerManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `blank-premium-${randomUUID()}`,
      assetType: "vehicle",
      label: "Premiumless vehicle",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForVehicle({
        currentPolicy: {
          insurerName: "Test",
          policyNumber: "POL",
          annualPremiumCents: null as unknown as number,
          expiryDate: "2026-12-31",
        },
      }),
    });
    const candidateId = (saveData as { candidate_id?: string } | null)?.candidate_id;

    const { error: approveError } = await approveCandidates(customer, {
      householdId,
      actorId: CUSTOMER_ID,
      requestId: `approve-blank-premium-${randomUUID()}`,
      decisions: [{ candidate_id: candidateId!, decision: "approve_new" }],
    });
    expect(approveError).not.toBeNull();

    const { data: policies } = await serviceRole
      .from("policies")
      .select("id")
      .eq("household_id", householdId);
    expect(policies?.length).toBe(0);
  });

  it("property liability persists as personalLiabilityLimitCents", async () => {
    const serviceRole = getServiceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(serviceRole);
    createdHouseholdIds.push(householdId);
    const { batchId, sessionId, caseId } = await prepareManualReviewBatch(serviceRole, householdId);

    const docId = await addPolicyDocumentToBatch(serviceRole, householdId, batchId);

    const { data: saveData } = await saveCustomerManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `liability-key-${randomUUID()}`,
      assetType: "property",
      label: "Residence",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty({
        currentCoverage: {
          dwellingLimitCents: 50000000,
          contentsLimitCents: 10000000,
          personalLiabilityLimitCents: 3000000,
          baseDeductibleCents: 100000,
        },
      }),
    });
    const candidateId = (saveData as { candidate_id?: string } | null)?.candidate_id;

    const { data: approveData } = await approveCandidates(customer, {
      householdId,
      actorId: CUSTOMER_ID,
      requestId: `approve-liability-${randomUUID()}`,
      decisions: [{ candidate_id: candidateId!, decision: "approve_new" }],
    });
    const result = approveData as { policies?: string[] } | null;
    const policyId = result?.policies?.[0];
    expect(policyId).toBeTruthy();

    const { data: policy } = await serviceRole
      .from("policies")
      .select("liability_limit_cents, coverage_details")
      .eq("id", policyId)
      .single();
    expect(policy?.liability_limit_cents).toBe(3000000);
    expect(
      (policy?.coverage_details as Record<string, unknown> | null)?.personalLiabilityLimitCents,
    ).toBe(3000000);
  });

  it("skipped document cannot be used as a candidate source", async () => {
    const serviceRole = getServiceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(serviceRole);
    createdHouseholdIds.push(householdId);
    const { batchId, sessionId, caseId } = await prepareManualReviewBatch(serviceRole, householdId);

    const docId = await addPolicyDocumentToBatch(serviceRole, householdId, batchId);

    const { error: skipError } = await customer.rpc("set_manual_entry_document_status_v1", {
      p_batch_id: batchId,
      p_policy_document_id: docId,
      p_household_id: householdId,
      p_status: "not_relevant",
    });
    expect(skipError).toBeNull();

    const { error: saveError } = await saveCustomerManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `skip-source-${randomUUID()}`,
      assetType: "property",
      label: "Skipped source",
      sourceDocumentIds: [docId],
      selectedFacts: selectedFactsForProperty(),
    });
    expect(saveError).not.toBeNull();
  });

  it("lost-response retry on admin save creates one candidate", async () => {
    const serviceRole = getServiceRoleClient();
    const operations = await getOperationsClient();
    const householdId = await createIsolatedHousehold(serviceRole);
    createdHouseholdIds.push(householdId);
    const { batchId, sessionId, caseId } = await prepareManualReviewBatch(serviceRole, householdId);

    await serviceRole.from("case_assignments").insert({
      case_id: caseId,
      assignee_profile_id: OPERATIONS_ID,
      assignment_role: "operations",
    });

    const docId = await addPolicyDocumentToBatch(serviceRole, householdId, batchId);
    const requestId = `lost-response-${randomUUID()}`;

    const [first, second] = await Promise.all([
      saveStaffManualCandidate(operations, {
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
      saveStaffManualCandidate(operations, {
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
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const firstId = (first.data as { candidate_id?: string } | null)?.candidate_id;
    const secondId = (second.data as { candidate_id?: string } | null)?.candidate_id;
    expect(firstId).toBe(secondId);

    const { data: candidates } = await serviceRole
      .from("asset_candidates")
      .select("id")
      .eq("household_id", householdId);
    expect(candidates?.length).toBe(1);

    const { data: ledger } = await serviceRole
      .from("manual_entry_idempotency")
      .select("id")
      .eq("household_id", householdId)
      .eq("operation_type", "staff_save_candidate")
      .eq("client_request_id", requestId);
    expect(ledger?.length).toBe(1);
  });

  it("full manual-entry workflow passes candidates through approve_candidate_assets_v2", async () => {
    const serviceRole = getServiceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold(serviceRole);
    createdHouseholdIds.push(householdId);
    const { batchId, sessionId, caseId } = await prepareManualReviewBatch(serviceRole, householdId);

    const propertyDoc = await addPolicyDocumentToBatch(serviceRole, householdId, batchId, "-prop");
    const vehicleDoc = await addPolicyDocumentToBatch(serviceRole, householdId, batchId, "-veh");

    const { data: propSave } = await saveCustomerManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `full-prop-${randomUUID()}`,
      assetType: "property",
      label: "Home",
      sourceDocumentIds: [propertyDoc],
      selectedFacts: selectedFactsForProperty(),
    });
    const { data: vehSave } = await saveCustomerManualCandidate(customer, {
      batchId,
      sessionId,
      caseId,
      householdId,
      requestId: `full-veh-${randomUUID()}`,
      assetType: "vehicle",
      label: "Car",
      sourceDocumentIds: [vehicleDoc],
      selectedFacts: selectedFactsForVehicle(),
    });

    const propCandidateId = (propSave as { candidate_id?: string } | null)?.candidate_id;
    const vehCandidateId = (vehSave as { candidate_id?: string } | null)?.candidate_id;

    const { data: completeData, error: completeError } = await completeCustomerManualEntry(
      customer,
      {
        batchId,
        sessionId,
        caseId,
        householdId,
        requestId: `full-complete-${randomUUID()}`,
        skippedDocumentIds: [],
      },
    );
    expect(completeError).toBeNull();
    expect((completeData as { success?: boolean } | null)?.success).toBe(true);

    const { data: approveData, error: approveError } = await approveCandidates(customer, {
      householdId,
      actorId: CUSTOMER_ID,
      requestId: `full-approve-${randomUUID()}`,
      decisions: [
        { candidate_id: propCandidateId!, decision: "approve_new" },
        { candidate_id: vehCandidateId!, decision: "approve_new" },
      ],
    });
    expect(approveError).toBeNull();
    const result = approveData as {
      success?: boolean;
      properties?: string[];
      vehicles?: string[];
      policies?: string[];
    } | null;
    expect(result?.success).toBe(true);
    expect(result?.properties?.length).toBe(1);
    expect(result?.vehicles?.length).toBe(1);
    expect(result?.policies?.length).toBe(2);

    const { data: property } = await serviceRole
      .from("properties")
      .select("id, address_line1, city")
      .eq("household_id", householdId)
      .single();
    expect(property).not.toBeNull();
    expect(property?.address_line1).toBe("123 Main St");

    const { data: vehicle } = await serviceRole
      .from("vehicles")
      .select("id, year, make, model")
      .eq("household_id", householdId)
      .single();
    expect(vehicle).not.toBeNull();
    expect(vehicle?.make).toBe("Honda");

    const policyIds = result?.policies ?? [];

    const { data: links } = await serviceRole
      .from("policy_document_policy_links")
      .select("policy_document_id, policy_id, candidate_id, relationship_type")
      .in("policy_id", policyIds.length ? policyIds : ["00000000-0000-0000-0000-000000000000"]);
    expect((links ?? []).length).toBe(2);
    for (const link of links ?? []) {
      expect(link.relationship_type).toBe("candidate_source");
    }
    const { data: policies } = await serviceRole
      .from("policies")
      .select("coverage_details, liability_limit_cents")
      .in("id", policyIds)
      .eq("household_id", householdId);
    expect((policies ?? []).length).toBe(2);
    const propertyPolicy = policies?.find(
      (p) => (p.coverage_details as Record<string, unknown> | null)?.personalLiabilityLimitCents,
    );
    expect(propertyPolicy?.liability_limit_cents).toBe(2000000);
  });
});
