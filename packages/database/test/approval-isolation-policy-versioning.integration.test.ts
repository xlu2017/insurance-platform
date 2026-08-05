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
const ADMIN_ID = "00000000-0000-0000-0000-000000000004";

function uniqueDigest() {
  return createHash("sha256").update(randomUUID()).digest("hex");
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

async function getAdminClient() {
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({
    email: "admin@example.com",
    password: "DemoAdmin123!",
  });
  if (error) throw new Error("Failed to sign in admin: " + error.message);
  return client;
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
    name: "Approval Isolation Household",
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

async function createProcessingBatch(householdId: string) {
  const admin = serviceRoleClient();
  const { data, error } = await admin.rpc("create_document_processing_batch", {
    p_household_id: householdId,
    p_client_request_id: `approval-isolation-${randomUUID()}`,
    p_actor_id: CUSTOMER_ID,
  });
  if (error) throw error;
  return data as {
    batch: { id: string; case_id: string; session_id: string } & Record<string, unknown>;
    session_id: string;
  };
}

async function addPolicyDocument(admin: SupabaseClient, householdId: string, batchId: string) {
  const { data: policyDoc, error: docError } = await admin
    .from("policy_documents")
    .insert({
      household_id: householdId,
      file_name: `approval-isolation-${randomUUID()}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      storage_path: `approval/${randomUUID()}.pdf`,
      uploaded_by: CUSTOMER_ID,
      category: "other",
    })
    .select("id")
    .single();
  if (docError) throw docError;

  const { error: itemError } = await admin.from("document_processing_batch_items").insert({
    batch_id: batchId,
    household_id: householdId,
    client_item_id: `item-${randomUUID()}`,
    policy_document_id: policyDoc!.id,
    selected_file_name: `approval-isolation.pdf`,
    category: "other",
    content_sha256: uniqueDigest(),
    status: "uploaded",
  });
  if (itemError) throw itemError;

  return policyDoc!.id as string;
}

async function createExtractionSession(householdId: string) {
  const admin = serviceRoleClient();
  const { data: session, error } = await admin
    .from("document_extraction_sessions")
    .insert({ household_id: householdId, status: "open", created_by: CUSTOMER_ID })
    .select("id")
    .single();
  if (error) throw error;
  return session!.id as string;
}

async function createExtractedDocument(
  admin: SupabaseClient,
  householdId: string,
  sessionId: string,
) {
  const { data: policyDoc, error: docError } = await admin
    .from("policy_documents")
    .insert({
      household_id: householdId,
      file_name: `extracted-${randomUUID()}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      storage_path: `extracted/${randomUUID()}.pdf`,
      uploaded_by: CUSTOMER_ID,
      category: "other",
    })
    .select("id")
    .single();
  if (docError) throw docError;

  const { data: extracted, error: extractedError } = await admin
    .from("extracted_documents")
    .insert({
      session_id: sessionId,
      household_id: householdId,
      policy_document_id: policyDoc!.id,
      file_digest: uniqueDigest(),
      page_count: 1,
      classification: "supported",
      pages_json: [],
    })
    .select("id")
    .single();
  if (extractedError) throw extractedError;

  return {
    extractedDocumentId: extracted!.id as string,
    policyDocumentId: policyDoc!.id as string,
  };
}

async function createAnalysisRun(admin: SupabaseClient, householdId: string, sessionId: string) {
  const { data: run, error } = await admin
    .from("document_analysis_runs")
    .insert({
      session_id: sessionId,
      household_id: householdId,
      client_request_id: `run-${randomUUID()}`,
      model_provider: "test",
      model_id: "test-model",
      prompt_version: "1.0.0",
      output_schema_version: "1.0.0",
      attempt_count: 1,
      raw_response_json: {},
      validated_output_json: {},
      warnings_json: [],
    })
    .select("id")
    .single();
  if (error) throw error;
  return run!.id as string;
}

function extractedValue(value: unknown, confidence = 0.98) {
  return { status: "known", value, confidence, evidence: [] };
}

function autoVehicleFacts(overrides: Record<string, unknown> = {}) {
  return {
    identity: { year: 2020, make: "Honda", model: "Civic", vin: "2HGFC2F59JH500001" },
    currentPolicy: {
      insurerName: "Manual Vehicle Insurer",
      policyNumber: "POL-MAN-VEH",
      annualPremiumCents: 150000,
      expiryDate: "2026-12-31",
    },
    currentCoverage: {
      thirdPartyLiabilityCents: extractedValue(1000000),
      collisionDeductibleCents: extractedValue(50000),
      comprehensiveDeductibleCents: extractedValue(50000),
    },
    mandateSuggestions: { thirdPartyLiability: { rule: "minimum", amountCents: 1000000 } },
    ...overrides,
  };
}

function autoPropertyFacts(overrides: Record<string, unknown> = {}) {
  return {
    identity: {
      fullAddress: "123 Main St",
      city: "Calgary",
      province: "AB",
      postalCode: "T2A 0A0",
      yearBuilt: 1995,
    },
    currentPolicy: {
      insurerName: "Manual Property Insurer",
      policyNumber: "POL-MAN-PROP",
      annualPremiumCents: 120000,
      expiryDate: "2026-12-31",
    },
    currentCoverage: {
      dwellingLimitCents: extractedValue(50000000),
      contentsLimitCents: extractedValue(10000000),
      personalLiabilityLimitCents: extractedValue(2000000),
      baseDeductibleCents: extractedValue(100000),
    },
    mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 50000000 } },
    ...overrides,
  };
}

function partialVehicleFacts(existingVehicleId: string) {
  return {
    identity: { make: "Honda", model: "Civic" },
    _draftDecision: "link_existing",
    _draftExistingAssetId: existingVehicleId,
    _draftExistingAssetType: "vehicle",
    currentPolicy: {
      insurerName: "Renewal Insurer",
      policyNumber: "POL-RENEW-VEH",
      annualPremiumCents: 160000,
      expiryDate: "2027-12-31",
    },
    currentCoverage: {
      thirdPartyLiabilityCents: extractedValue(2000000),
      collisionDeductibleCents: extractedValue(50000),
      comprehensiveDeductibleCents: extractedValue(50000),
    },
    mandateSuggestions: { thirdPartyLiability: { rule: "minimum", amountCents: 2000000 } },
  };
}

function partialPropertyFacts(existingPropertyId: string) {
  return {
    identity: { fullAddress: "999 Existing Rd", city: "Calgary", province: "AB" },
    _draftDecision: "link_existing",
    _draftExistingAssetId: existingPropertyId,
    _draftExistingAssetType: "property",
    currentPolicy: {
      insurerName: "Renewal Insurer",
      policyNumber: "POL-RENEW-PROP",
      annualPremiumCents: 130000,
      expiryDate: "2027-12-31",
    },
    currentCoverage: {
      dwellingLimitCents: extractedValue(60000000),
      contentsLimitCents: extractedValue(12000000),
      personalLiabilityLimitCents: extractedValue(3000000),
      baseDeductibleCents: extractedValue(100000),
    },
    mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 60000000 } },
  };
}

async function markDocumentReviewed(
  client: SupabaseClient,
  batchId: string,
  householdId: string,
  docId: string,
) {
  const { error } = await client.rpc("set_manual_entry_document_status_v1" as any, {
    p_batch_id: batchId,
    p_policy_document_id: docId,
    p_household_id: householdId,
    p_status: "reviewed",
  });
  if (error) throw error;
}

async function assignAdminToCase(admin: SupabaseClient, caseId: string) {
  const { error } = await admin.from("case_assignments").insert({
    case_id: caseId,
    assignee_profile_id: ADMIN_ID,
    assignment_role: "admin",
  });
  if (error) throw error;
}

function formatCad(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
  });
}

function cellValue(coverage: Record<string, unknown>, key: string, stateKey: string): string {
  const state = (coverage._coverageState as Record<string, string> | undefined)?.[stateKey];
  if (state === "not_included") return "Not included";
  if (state === "unknown") return "Unknown";
  if (state === "not_applicable") return "Not applicable";
  if (state === "conflicting") return "Needs review";
  const raw = coverage[key];
  if (raw === undefined || raw === null) return "—";
  return formatCad(Number(raw));
}

describe("approval isolation and policy versioning", () => {
  const createdHouseholdIds: string[] = [];

  beforeAll(() => {
    assertLocalSupabase(SUPABASE_URL);
  });

  afterEach(async () => {
    const admin = serviceRoleClient();
    for (const householdId of createdHouseholdIds) {
      await admin.from("candidate_field_reviews").delete().eq("household_id", householdId);
      await admin.from("candidate_approvals").delete().eq("household_id", householdId);
      await admin.from("policy_asset_links").delete().eq("household_id", householdId);
      await admin.from("policies").delete().eq("household_id", householdId);
      await admin.from("vehicles").delete().eq("household_id", householdId);
      await admin.from("properties").delete().eq("household_id", householdId);
      await admin.from("manual_entry_idempotency").delete().eq("household_id", householdId);
      await admin.from("asset_candidates").delete().eq("household_id", householdId);
      await admin.from("extracted_documents").delete().eq("household_id", householdId);
      await admin.from("document_analysis_runs").delete().eq("household_id", householdId);
      await admin.from("document_processing_batch_items").delete().eq("household_id", householdId);
      await admin.from("document_processing_batches").delete().eq("household_id", householdId);
      await admin.from("document_extraction_sessions").delete().eq("household_id", householdId);
      await admin.from("policy_documents").delete().eq("household_id", householdId);
      await admin.from("audit_events").delete().eq("household_id", householdId);
      await admin.from("case_assignments").delete().eq("case_id", householdId);
      await admin.from("optimization_cases").delete().eq("household_id", householdId);
      await admin.from("household_members").delete().eq("household_id", householdId);
      await admin.from("households").delete().eq("id", householdId);
    }
    createdHouseholdIds.length = 0;
  });

  it("approval idempotency is scoped to household for a shared client_request_id", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const sharedRequestId = `shared-id-${randomUUID().slice(0, 8)}`;

    async function makeHouseholdAndApprove(householdLabel: string) {
      const householdId = await createIsolatedHousehold();
      createdHouseholdIds.push(householdId);
      const sessionId = await createExtractionSession(householdId);
      const { extractedDocumentId } = await createExtractedDocument(admin, householdId, sessionId);
      const analysisRunId = await createAnalysisRun(admin, householdId, sessionId);

      const { data: candidate, error: candidateError } = await admin
        .from("asset_candidates")
        .insert({
          session_id: sessionId,
          household_id: householdId,
          asset_type: "vehicle",
          identity_fingerprint: `${householdLabel}-${randomUUID()}`,
          display_label: `${householdLabel} vehicle`,
          match_classification: "new",
          decision: "undecided",
          review_status: "pending",
          source_document_ids: [extractedDocumentId],
          selected_facts_json: autoVehicleFacts(),
          analysis_run_id: analysisRunId,
        })
        .select("id")
        .single();
      if (candidateError) throw candidateError;

      const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
        p_household_id: householdId,
        p_actor_profile_id: CUSTOMER_ID,
        p_client_request_id: sharedRequestId,
        p_decisions: [{ candidate_id: candidate!.id, decision: "approve_new" }],
      });
      return { householdId, data, error, candidateId: candidate!.id };
    }

    const a = await makeHouseholdAndApprove("household-a");
    const b = await makeHouseholdAndApprove("household-b");

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.data?.vehicles?.length).toBe(1);
    expect(b.data?.vehicles?.length).toBe(1);

    const aVehicleId = a.data?.vehicles?.[0];
    const aPolicyId = a.data?.policies?.[0];
    const bVehicleId = b.data?.vehicles?.[0];
    const bPolicyId = b.data?.policies?.[0];

    expect(aVehicleId).not.toBe(bVehicleId);
    expect(aPolicyId).not.toBe(bPolicyId);
    expect(aVehicleId).not.toBeUndefined();
    expect(bVehicleId).not.toBeUndefined();

    const bResponse = JSON.stringify(b.data);
    expect(bResponse).not.toContain(aVehicleId);
    expect(bResponse).not.toContain(aPolicyId);
    expect(bResponse).not.toContain(a.candidateId);
  });

  it("customer manual candidate with partial identity links to an existing vehicle", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { data: vehicle } = await admin
      .from("vehicles")
      .insert({
        household_id: householdId,
        year: 2020,
        make: "Honda",
        model: "Civic",
        vin: "2HGFC2F59JH500001",
        primary_use: "commute",
        vehicle_use_class: "personal",
        financing_status: "owned",
        is_classic: false,
        is_modified: false,
        created_by: CUSTOMER_ID,
        updated_by: CUSTOMER_ID,
      })
      .select("id")
      .single();
    if (!vehicle) throw new Error("vehicle not created");

    const { batch } = await createProcessingBatch(householdId);
    const docId = await addPolicyDocument(admin, householdId, batch.id);

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", batch.case_id);
    await admin
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batch.id);

    const { data: saveData, error: saveError } = await customer.rpc(
      "save_customer_manual_policy_review_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `link-veh-save-${randomUUID()}`,
        p_asset_type: "vehicle",
        p_identity_fingerprint: `link-veh-${randomUUID()}`,
        p_display_label: "Renewed Honda Civic",
        p_source_document_ids: [docId],
        p_selected_facts_json: partialVehicleFacts(vehicle.id),
        p_match_classification: "new",
      },
    );
    expect(saveError).toBeNull();

    await markDocumentReviewed(customer, batch.id, householdId, docId);

    const { error: completeError } = await customer.rpc(
      "complete_customer_manual_entry_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `link-veh-complete-${randomUUID()}`,
        p_skipped_document_ids: [],
      },
    );
    expect(completeError).toBeNull();

    const candidateId = (saveData as { candidate_id?: string } | null)?.candidate_id!;
    const { data: approveData, error: approveError } = await customer.rpc(
      "approve_candidate_assets_v2" as any,
      {
        p_household_id: householdId,
        p_actor_profile_id: CUSTOMER_ID,
        p_client_request_id: `link-veh-approve-${randomUUID()}`,
        p_decisions: [
          {
            candidate_id: candidateId,
            decision: "link_existing",
            existing_asset_id: vehicle!.id,
            existing_asset_type: "vehicle",
          },
        ],
      },
    );
    expect(approveError).toBeNull();
    expect(approveData?.linked?.length).toBe(1);
    expect(approveData?.policies?.length).toBe(1);

    const { data: candidateRow } = await admin
      .from("asset_candidates")
      .select("approved_asset_id, approved_asset_type, approved_policy_id")
      .eq("id", candidateId)
      .single();
    expect(candidateRow?.approved_asset_id).toBe(vehicle.id);
    expect(candidateRow?.approved_asset_type).toBe("vehicle");

    const { data: link } = await admin
      .from("policy_asset_links")
      .select("policy_id, asset_id, asset_type, is_current")
      .eq("asset_id", vehicle.id)
      .eq("is_current", true)
      .single();
    expect(link?.asset_id).toBe(vehicle.id);
    expect(link?.policy_id).toBe(approveData?.policies?.[0]);
  });

  it("customer manual candidate with partial identity is rejected for approve_new", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batch } = await createProcessingBatch(householdId);
    const docId = await addPolicyDocument(admin, householdId, batch.id);

    await admin
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", batch.case_id);
    await admin
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batch.id);

    const facts = partialVehicleFacts("00000000-0000-0000-0000-000000000000");
    const { data: saveData, error: saveError } = await customer.rpc(
      "save_customer_manual_policy_review_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `partial-new-save-${randomUUID()}`,
        p_asset_type: "vehicle",
        p_identity_fingerprint: `partial-new-${randomUUID()}`,
        p_display_label: "Partial vehicle",
        p_source_document_ids: [docId],
        p_selected_facts_json: { ...facts, _draftDecision: "approve_new" },
        p_match_classification: "new",
      },
    );
    expect(saveError).toBeNull();

    await markDocumentReviewed(customer, batch.id, householdId, docId);

    const { error: completeError } = await customer.rpc(
      "complete_customer_manual_entry_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `partial-new-complete-${randomUUID()}`,
        p_skipped_document_ids: [],
      },
    );
    expect(completeError).not.toBeNull();
    expect(completeError?.message).toMatch(/year is required|identity/i);
  });

  it("staff manual candidate with partial identity links to an existing property", async () => {
    const customer = await getCustomerClient();
    const admin = await getAdminClient();
    const adminService = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { data: property } = await adminService
      .from("properties")
      .insert({
        household_id: householdId,
        address_line1: "999 Existing Rd",
        city: "Calgary",
        province: "AB",
        postal_code: "T9Z9Z9",
        property_type: "homeowner",
        dwelling_type: "detached",
        owner_occupied: true,
        created_by: CUSTOMER_ID,
        updated_by: CUSTOMER_ID,
      })
      .select("id")
      .single();
    if (!property) throw new Error("property not created");

    const { batch } = await createProcessingBatch(householdId);
    const docId = await addPolicyDocument(adminService, householdId, batch.id);

    await adminService
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", batch.case_id);
    await adminService
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batch.id);
    await assignAdminToCase(adminService, batch.case_id);

    const { data: saveData, error: saveError } = await admin.rpc(
      "save_staff_manual_policy_candidate_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `link-prop-save-${randomUUID()}`,
        p_asset_type: "property",
        p_identity_fingerprint: `link-prop-${randomUUID()}`,
        p_display_label: "Renewed residence",
        p_source_document_ids: [docId],
        p_selected_facts_json: partialPropertyFacts(property!.id),
        p_match_classification: "new",
      },
    );
    expect(saveError).toBeNull();

    await markDocumentReviewed(admin, batch.id, householdId, docId);

    const candidateId = (saveData as { candidate_id?: string } | null)?.candidate_id!;
    const { error: completeError } = await admin.rpc("complete_manual_review_v1" as any, {
      p_batch_id: batch.id,
      p_session_id: batch.session_id,
      p_case_id: batch.case_id,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [candidateId],
      p_client_request_id: `link-prop-complete-${randomUUID()}`,
      p_skipped_document_ids: [],
    });
    expect(completeError).toBeNull();

    const { data: approveData, error: approveError } = await customer.rpc(
      "approve_candidate_assets_v2" as any,
      {
        p_household_id: householdId,
        p_actor_profile_id: CUSTOMER_ID,
        p_client_request_id: `link-prop-approve-${randomUUID()}`,
        p_decisions: [
          {
            candidate_id: candidateId,
            decision: "link_existing",
            existing_asset_id: property!.id,
            existing_asset_type: "property",
          },
        ],
      },
    );
    expect(approveError).toBeNull();
    expect(approveData?.linked?.length).toBe(1);
    expect(approveData?.policies?.length).toBe(1);

    const { data: link } = await adminService
      .from("policy_asset_links")
      .select("policy_id, asset_id, asset_type, is_current")
      .eq("asset_id", property!.id)
      .eq("is_current", true)
      .single();
    expect(link?.asset_id).toBe(property!.id);
    expect(link?.policy_id).toBe(approveData?.policies?.[0]);
  });

  it("staff manual candidate with partial identity is rejected for approve_new", async () => {
    const admin = await getAdminClient();
    const adminService = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batch } = await createProcessingBatch(householdId);
    const docId = await addPolicyDocument(adminService, householdId, batch.id);

    await adminService
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", batch.case_id);
    await adminService
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batch.id);
    await assignAdminToCase(adminService, batch.case_id);

    const facts = partialPropertyFacts("00000000-0000-0000-0000-000000000000");
    const { data: saveData, error: saveError } = await admin.rpc(
      "save_staff_manual_policy_candidate_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `partial-prop-save-${randomUUID()}`,
        p_asset_type: "property",
        p_identity_fingerprint: `partial-prop-${randomUUID()}`,
        p_display_label: "Partial property",
        p_source_document_ids: [docId],
        p_selected_facts_json: { ...facts, _draftDecision: "approve_new" },
        p_match_classification: "new",
      },
    );
    expect(saveError).toBeNull();

    await markDocumentReviewed(admin, batch.id, householdId, docId);

    const candidateId = (saveData as { candidate_id?: string } | null)?.candidate_id!;
    const { error: completeError } = await admin.rpc("complete_manual_review_v1" as any, {
      p_batch_id: batch.id,
      p_session_id: batch.session_id,
      p_case_id: batch.case_id,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [candidateId],
      p_client_request_id: `partial-prop-complete-${randomUUID()}`,
      p_skipped_document_ids: [],
    });
    expect(completeError).not.toBeNull();
    expect(completeError?.message).toMatch(/address|postal code|identity/i);
  });

  it("skip and needs_correction completion do not require insurer or identity fields", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();

    for (const decision of ["skip", "needs_correction"]) {
      const householdId = await createIsolatedHousehold();
      createdHouseholdIds.push(householdId);
      const { batch } = await createProcessingBatch(householdId);
      const docId = await addPolicyDocument(admin, householdId, batch.id);

      await admin
        .from("optimization_cases")
        .update({ state: "extracting_information" })
        .eq("id", batch.case_id);
      await admin
        .from("document_processing_batches")
        .update({ status: "manual_review" })
        .eq("id", batch.id);

      const { data: saveData, error: saveError } = await customer.rpc(
        "save_customer_manual_policy_review_v1" as any,
        {
          p_batch_id: batch.id,
          p_session_id: batch.session_id,
          p_case_id: batch.case_id,
          p_household_id: householdId,
          p_client_request_id: `${decision}-save-${randomUUID()}`,
          p_asset_type: "vehicle",
          p_identity_fingerprint: `${decision}-${randomUUID()}`,
          p_display_label: `${decision} candidate`,
          p_source_document_ids: [docId],
          p_selected_facts_json: {
            _draftDecision: decision,
            identity: {},
            currentPolicy: {},
            currentCoverage: {},
            mandateSuggestions: {},
          },
          p_match_classification: "new",
        },
      );
      expect(saveError).toBeNull();

      await markDocumentReviewed(customer, batch.id, householdId, docId);

      const { error: completeError } = await customer.rpc(
        "complete_customer_manual_entry_v1" as any,
        {
          p_batch_id: batch.id,
          p_session_id: batch.session_id,
          p_case_id: batch.case_id,
          p_household_id: householdId,
          p_client_request_id: `${decision}-complete-${randomUUID()}`,
          p_skipped_document_ids: [],
        },
      );
      expect(completeError).toBeNull();
    }
  });

  it("coverage review state transitions resolve to known, unknown, and not_applicable", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const sessionId = await createExtractionSession(householdId);
    const { extractedDocumentId } = await createExtractedDocument(admin, householdId, sessionId);
    const analysisRunId = await createAnalysisRun(admin, householdId, sessionId);

    const currentCoverage: Record<string, unknown> = {
      knownField: extractedValue(1000000),
      unknownField: { status: "unknown", value: null, confidence: 0, evidence: [] },
      notIncludedField: { status: "not_included", value: null, confidence: 1, evidence: [] },
      conflictingField: { status: "conflicting", value: 50000, confidence: 0.5, evidence: [] },
      toUnknownField: extractedValue(2000000),
      toNotApplicableField: extractedValue(3000000),
    };

    const { data: candidate, error: candidateError } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        asset_type: "vehicle",
        identity_fingerprint: `coverage-transitions-${randomUUID()}`,
        display_label: "Coverage transitions vehicle",
        match_classification: "new",
        decision: "undecided",
        review_status: "pending",
        source_document_ids: [extractedDocumentId],
        selected_facts_json: {
          identity: { year: 2020, make: "Honda", model: "Civic", vin: "2HGFC2F59JH500001" },
          currentPolicy: {
            insurer: "Transitions Insurer",
            policyNumber: "POL-TRANS",
            annualPremiumCents: 150000,
            expiryDate: "2026-12-31",
          },
          currentCoverage,
          mandateSuggestions: { thirdPartyLiability: { rule: "minimum", amountCents: 1000000 } },
        },
        analysis_run_id: analysisRunId,
      })
      .select("id")
      .single();
    if (candidateError) throw candidateError;

    const reviews = [
      { field_path: "currentCoverage.knownField", action: "correct", corrected_value: 1500000 },
      { field_path: "currentCoverage.unknownField", action: "correct", corrected_value: 2500000 },
      {
        field_path: "currentCoverage.notIncludedField",
        action: "correct",
        corrected_value: 3500000,
      },
      { field_path: "currentCoverage.conflictingField", action: "correct", corrected_value: 75000 },
      { field_path: "currentCoverage.toUnknownField", action: "unknown" },
      { field_path: "currentCoverage.toNotApplicableField", action: "not_applicable" },
    ];

    for (const r of reviews) {
      const { error } = await admin.from("candidate_field_reviews").insert({
        candidate_id: candidate!.id,
        household_id: householdId,
        field_path: r.field_path,
        action: r.action,
        corrected_value: "corrected_value" in r ? r.corrected_value : null,
      });
      if (error) throw error;
    }

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `coverage-transitions-${randomUUID()}`,
      p_decisions: [{ candidate_id: candidate!.id, decision: "approve_new" }],
    });
    expect(error).toBeNull();

    const { data: policy } = await admin
      .from("policies")
      .select("coverage_details")
      .eq("id", data?.policies?.[0])
      .single();
    const coverage = (policy?.coverage_details ?? {}) as Record<string, unknown>;

    expect(coverage.knownField).toBe(1500000);
    expect(coverage.unknownField).toBe(2500000);
    expect(coverage.notIncludedField).toBe(3500000);
    expect(coverage.conflictingField).toBe(75000);
    expect(coverage.toUnknownField).toBeNull();
    expect(coverage.toNotApplicableField).toBeNull();

    const state = coverage._coverageState as Record<string, string> | undefined;
    expect(state?.knownField).toBe("known");
    expect(state?.unknownField).toBe("known");
    expect(state?.notIncludedField).toBe("known");
    expect(state?.conflictingField).toBe("known");
    expect(state?.toUnknownField).toBe("unknown");
    expect(state?.toNotApplicableField).toBe("not_applicable");

    const raw = coverage._rawCoverage as Record<string, unknown> | undefined;
    expect((raw?.knownField as { status?: string })?.status).toBe("known");
    expect((raw?.unknownField as { status?: string })?.status).toBe("unknown");
    expect((raw?.notIncludedField as { status?: string })?.status).toBe("not_included");
    expect((raw?.conflictingField as { status?: string })?.status).toBe("conflicting");
    expect((raw?.toUnknownField as { status?: string })?.status).toBe("known");
    expect((raw?.toNotApplicableField as { status?: string })?.status).toBe("known");

    expect(cellValue(coverage, "knownField", "knownField")).toBe(formatCad(1500000));
    expect(cellValue(coverage, "unknownField", "unknownField")).toBe(formatCad(2500000));
    expect(cellValue(coverage, "notIncludedField", "notIncludedField")).toBe(formatCad(3500000));
    expect(cellValue(coverage, "conflictingField", "conflictingField")).toBe(formatCad(75000));
    expect(cellValue(coverage, "toUnknownField", "toUnknownField")).toBe("Unknown");
    expect(cellValue(coverage, "toNotApplicableField", "toNotApplicableField")).toBe(
      "Not applicable",
    );
  });

  it("sequential vehicle renewals keep one current policy and retain history", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const sessionId = await createExtractionSession(householdId);
    const { data: vehicle } = await admin
      .from("vehicles")
      .insert({
        household_id: householdId,
        year: 2020,
        make: "Honda",
        model: "Civic",
        vin: "2HGFC2F59JH500001",
        primary_use: "commute",
        vehicle_use_class: "personal",
        financing_status: "owned",
        is_classic: false,
        is_modified: false,
        created_by: CUSTOMER_ID,
        updated_by: CUSTOMER_ID,
      })
      .select("id")
      .single();
    if (!vehicle) throw new Error("vehicle not created");

    async function renewVehicle(year: string, premium: number, requestId: string) {
      const { extractedDocumentId } = await createExtractedDocument(admin, householdId, sessionId);
      const analysisRunId = await createAnalysisRun(admin, householdId, sessionId);
      const { data: candidate } = await admin
        .from("asset_candidates")
        .insert({
          session_id: sessionId,
          household_id: householdId,
          asset_type: "vehicle",
          identity_fingerprint: `renew-${year}-${randomUUID()}`,
          display_label: `Renewal ${year}`,
          match_classification: "exact_existing_match",
          decision: "undecided",
          review_status: "pending",
          source_document_ids: [extractedDocumentId],
          selected_facts_json: {
            identity: { make: "Honda", model: "Civic" },
            currentPolicy: {
              insurerName: `Renewal ${year} Insurer`,
              policyNumber: `POL-VEH-${year}`,
              annualPremiumCents: premium,
              expiryDate: `${year}-12-31`,
            },
            currentCoverage: {
              thirdPartyLiabilityCents: extractedValue(1000000),
              collisionDeductibleCents: extractedValue(50000),
              comprehensiveDeductibleCents: extractedValue(50000),
            },
            mandateSuggestions: { thirdPartyLiability: { rule: "minimum", amountCents: 1000000 } },
          },
          analysis_run_id: analysisRunId,
        })
        .select("id")
        .single();
      const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
        p_household_id: householdId,
        p_actor_profile_id: CUSTOMER_ID,
        p_client_request_id: requestId,
        p_decisions: [
          {
            candidate_id: candidate!.id,
            decision: "link_existing",
            existing_asset_id: vehicle!.id,
            existing_asset_type: "vehicle",
          },
        ],
      });
      if (error) throw error;
      return data?.policies?.[0] as string;
    }

    const firstPolicyId = await renewVehicle("2025", 100000, `renew-veh-1-${randomUUID()}`);
    const secondPolicyId = await renewVehicle("2026", 110000, `renew-veh-2-${randomUUID()}`);

    expect(firstPolicyId).not.toBe(secondPolicyId);

    const { data: allLinks } = await admin
      .from("policy_asset_links")
      .select("policy_id, is_current, effective_to")
      .eq("asset_id", vehicle.id)
      .order("created_at", { ascending: false });
    expect(allLinks?.length).toBe(2);
    expect(allLinks?.filter((l) => l.is_current).length).toBe(1);
    expect(allLinks?.find((l) => l.is_current)?.policy_id).toBe(secondPolicyId);

    const { data: currentLink } = await admin
      .from("policy_asset_links")
      .select("policy_id")
      .eq("asset_id", vehicle.id)
      .eq("is_current", true)
      .single();
    expect(currentLink?.policy_id).toBe(secondPolicyId);
  });

  it("sequential property renewals keep one current policy and retain history", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const sessionId = await createExtractionSession(householdId);
    const { data: property } = await admin
      .from("properties")
      .insert({
        household_id: householdId,
        address_line1: "999 Existing Rd",
        city: "Calgary",
        province: "AB",
        postal_code: "T9Z9Z9",
        property_type: "homeowner",
        dwelling_type: "detached",
        owner_occupied: true,
        created_by: CUSTOMER_ID,
        updated_by: CUSTOMER_ID,
      })
      .select("id")
      .single();
    if (!property) throw new Error("property not created");

    async function renewProperty(year: string, premium: number, requestId: string) {
      const { extractedDocumentId } = await createExtractedDocument(admin, householdId, sessionId);
      const analysisRunId = await createAnalysisRun(admin, householdId, sessionId);
      const { data: candidate } = await admin
        .from("asset_candidates")
        .insert({
          session_id: sessionId,
          household_id: householdId,
          asset_type: "property",
          identity_fingerprint: `renew-${year}-${randomUUID()}`,
          display_label: `Renewal ${year}`,
          match_classification: "exact_existing_match",
          decision: "undecided",
          review_status: "pending",
          source_document_ids: [extractedDocumentId],
          selected_facts_json: {
            identity: { fullAddress: "999 Existing Rd", city: "Calgary", province: "AB" },
            currentPolicy: {
              insurerName: `Renewal ${year} Insurer`,
              policyNumber: `POL-PROP-${year}`,
              annualPremiumCents: premium,
              expiryDate: `${year}-12-31`,
            },
            currentCoverage: {
              dwellingLimitCents: extractedValue(50000000),
              contentsLimitCents: extractedValue(10000000),
              personalLiabilityLimitCents: extractedValue(2000000),
              baseDeductibleCents: extractedValue(100000),
            },
            mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 50000000 } },
          },
          analysis_run_id: analysisRunId,
        })
        .select("id")
        .single();
      const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
        p_household_id: householdId,
        p_actor_profile_id: CUSTOMER_ID,
        p_client_request_id: requestId,
        p_decisions: [
          {
            candidate_id: candidate!.id,
            decision: "link_existing",
            existing_asset_id: property!.id,
            existing_asset_type: "property",
          },
        ],
      });
      if (error) throw error;
      return data?.policies?.[0] as string;
    }

    const firstPolicyId = await renewProperty("2025", 120000, `renew-prop-1-${randomUUID()}`);
    const secondPolicyId = await renewProperty("2026", 130000, `renew-prop-2-${randomUUID()}`);

    expect(firstPolicyId).not.toBe(secondPolicyId);

    const { data: allLinks } = await admin
      .from("policy_asset_links")
      .select("policy_id, is_current, effective_to")
      .eq("asset_id", property!.id)
      .order("created_at", { ascending: false });
    expect(allLinks?.length).toBe(2);
    expect(allLinks?.filter((l) => l.is_current).length).toBe(1);
    expect(allLinks?.find((l) => l.is_current)?.policy_id).toBe(secondPolicyId);

    const { data: currentLink } = await admin
      .from("policy_asset_links")
      .select("policy_id")
      .eq("asset_id", property!.id)
      .eq("is_current", true)
      .single();
    expect(currentLink?.policy_id).toBe(secondPolicyId);
  });
});
