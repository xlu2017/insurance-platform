import { randomUUID, createHash } from "node:crypto";
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
const OPERATIONS_ID = "00000000-0000-0000-0000-000000000002";

const FAKE_SHA256 = "0".repeat(64);

function uniqueDigest() {
  return createHash("sha256").update(randomUUID()).digest("hex");
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
    name: "Schema Compatibility Household",
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
    p_client_request_id: `schema-compat-${randomUUID()}`,
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
      file_name: `schema-compat-${randomUUID()}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      storage_path: `schema/${randomUUID()}.pdf`,
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
    selected_file_name: `schema-compat.pdf`,
    category: "other",
    content_sha256: FAKE_SHA256,
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

function autoVehicleFacts() {
  return {
    identity: { year: 2020, make: "Honda", model: "Civic", vin: "2HGFC2F59JH500001" },
    currentPolicy: {
      insurer: "Auto Extraction Insurer",
      policyNumber: "POL-AUTO-EXT",
      annualPremiumCents: 150000,
      expiryDate: "2026-12-31",
    },
    currentCoverage: {
      thirdPartyLiabilityCents: extractedValue(1000000),
      collisionDeductibleCents: extractedValue(50000, 0.95),
      comprehensiveDeductibleCents: extractedValue(50000, 0.94),
    },
    mandateSuggestions: { thirdPartyLiability: { rule: "minimum", amountCents: 1000000 } },
  };
}

function autoPropertyFacts() {
  return {
    identity: {
      fullAddress: "123 Main St",
      city: "Calgary",
      province: "AB",
      postalCode: "T2A 0A0",
      yearBuilt: 1995,
    },
    currentPolicy: {
      insurer: "Property Extraction Insurer",
      policyNumber: "POL-PROP-EXT",
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
  };
}

describe("candidate approval schema compatibility", () => {
  const createdHouseholdIds: string[] = [];

  beforeAll(() => {
    assertLocalSupabase(SUPABASE_URL);
  });

  afterEach(async () => {
    const admin = serviceRoleClient();
    for (const householdId of createdHouseholdIds) {
      await admin.from("candidate_field_reviews").delete().eq("household_id", householdId);
      await admin.from("candidate_approvals").delete().eq("household_id", householdId);
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
      await admin.from("optimization_cases").delete().eq("household_id", householdId);
      await admin.from("household_members").delete().eq("household_id", householdId);
      await admin.from("households").delete().eq("id", householdId);
    }
    createdHouseholdIds.length = 0;
  });

  it("approves a real DetectedInsuranceEntity-shaped automatic candidate", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const sessionId = await createExtractionSession(householdId);
    const { extractedDocumentId, policyDocumentId } = await createExtractedDocument(
      admin,
      householdId,
      sessionId,
    );
    const analysisRunId = await createAnalysisRun(admin, householdId, sessionId);

    const facts = autoVehicleFacts();
    const { data: candidate, error: candidateError } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        asset_type: "vehicle",
        identity_fingerprint: `auto-veh-${randomUUID()}`,
        display_label: "2020 Honda Civic",
        match_classification: "new",
        decision: "undecided",
        review_status: "pending",
        source_document_ids: [extractedDocumentId],
        selected_facts_json: facts,
        analysis_run_id: analysisRunId,
      })
      .select("id")
      .single();
    if (candidateError) throw candidateError;

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `auto-approve-${randomUUID()}`,
      p_decisions: [{ candidate_id: candidate!.id, decision: "approve_new" }],
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.vehicles?.length).toBe(1);
    expect(data?.policies?.length).toBe(1);

    const { data: policy } = await admin
      .from("policies")
      .select("coverage_details, liability_limit_cents, insurer_name")
      .eq("id", data?.policies?.[0])
      .single();
    expect(policy?.insurer_name).toBe(facts.currentPolicy.insurer);
    expect(policy?.liability_limit_cents).toBe(1000000);
    expect(
      (policy?.coverage_details as Record<string, unknown> | null)?.thirdPartyLiabilityCents,
    ).toBe(1000000);
    expect(
      (policy?.coverage_details as Record<string, unknown> | null)?.comprehensiveDeductibleCents,
    ).toBe(50000);

    const { data: links } = await admin
      .from("policy_document_policy_links")
      .select("policy_document_id, policy_id, relationship_type")
      .eq("policy_id", data?.policies?.[0]);
    expect((links ?? []).length).toBe(1);
    expect(links?.[0]?.policy_document_id).toBe(policyDocumentId);
    expect(links?.[0]?.relationship_type).toBe("candidate_source");
  });

  it("object-valued coverage with not_included status normalizes to null", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const sessionId = await createExtractionSession(householdId);
    const { extractedDocumentId } = await createExtractedDocument(admin, householdId, sessionId);
    const analysisRunId = await createAnalysisRun(admin, householdId, sessionId);

    const facts = {
      identity: { year: 2019, make: "Toyota", model: "Corolla" },
      currentPolicy: {
        insurer: "Minimal Auto",
        annualPremiumCents: 100000,
        expiryDate: "2026-12-31",
      },
      currentCoverage: {
        thirdPartyLiabilityCents: extractedValue(1000000),
        collisionDeductibleCents: {
          status: "not_included",
          value: null,
          confidence: 1,
          evidence: [],
        },
      },
      mandateSuggestions: { thirdPartyLiability: { rule: "minimum", amountCents: 1000000 } },
    };

    const { data: candidate, error: candidateError } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        asset_type: "vehicle",
        identity_fingerprint: `auto-veh-null-${randomUUID()}`,
        display_label: "2019 Toyota Corolla",
        match_classification: "new",
        decision: "undecided",
        review_status: "pending",
        source_document_ids: [extractedDocumentId],
        selected_facts_json: facts,
        analysis_run_id: analysisRunId,
      })
      .select("id")
      .single();
    if (candidateError) throw candidateError;

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `auto-null-${randomUUID()}`,
      p_decisions: [{ candidate_id: candidate!.id, decision: "approve_new" }],
    });

    expect(error).toBeNull();
    const { data: policy } = await admin
      .from("policies")
      .select("coverage_details")
      .eq("id", data?.policies?.[0])
      .single();
    const coverage = policy?.coverage_details as Record<string, unknown> | null;
    expect(coverage?.thirdPartyLiabilityCents).toBe(1000000);
    expect(coverage?.collisionDeductibleCents).toBeNull();
    expect(
      (coverage?._rawCoverage as Record<string, unknown> | undefined)?.collisionDeductibleCents,
    ).toMatchObject({ status: "not_included" });
  });

  it("link_existing creates one policy and provenance links", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { data: property, error: propertyError } = await admin
      .from("properties")
      .insert({
        household_id: householdId,
        address_line1: "999 Existing Rd",
        city: "Calgary",
        province: "AB",
        postal_code: "T9Z9Z9",
        dwelling_type: "detached",
        owner_occupied: true,
        created_by: CUSTOMER_ID,
        updated_by: CUSTOMER_ID,
      })
      .select("id")
      .single();
    if (propertyError) throw propertyError;

    const sessionId = await createExtractionSession(householdId);
    const { extractedDocumentId } = await createExtractedDocument(admin, householdId, sessionId);
    const analysisRunId = await createAnalysisRun(admin, householdId, sessionId);

    const { data: candidate, error: candidateError } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        asset_type: "property",
        identity_fingerprint: `auto-link-${randomUUID()}`,
        display_label: "Linked residence",
        match_classification: "exact_existing_match",
        decision: "undecided",
        review_status: "pending",
        source_document_ids: [extractedDocumentId],
        selected_facts_json: autoPropertyFacts(),
        analysis_run_id: analysisRunId,
      })
      .select("id")
      .single();
    if (candidateError) throw candidateError;

    const linkRequestId = `link-approve-${randomUUID()}`;
    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: linkRequestId,
      p_decisions: [
        {
          candidate_id: candidate!.id,
          decision: "link_existing",
          existing_asset_id: property!.id,
          existing_asset_type: "property",
        },
      ],
    });

    expect(error).toBeNull();
    expect(data?.linked?.length).toBe(1);
    expect(data?.policies?.length).toBe(1);

    const { data: candidateRow } = await admin
      .from("asset_candidates")
      .select("approved_asset_id, approved_asset_type, approved_policy_id")
      .eq("id", candidate!.id)
      .single();
    expect(candidateRow?.approved_asset_id).toBe(property!.id);
    expect(candidateRow?.approved_asset_type).toBe("property");
    expect(candidateRow?.approved_policy_id).toBe(data?.policies?.[0]);

    const { data: links } = await admin
      .from("policy_document_policy_links")
      .select("policy_id, relationship_type")
      .eq("policy_id", data?.policies?.[0]);
    expect((links ?? []).length).toBe(1);
    expect(links?.[0]?.relationship_type).toBe("candidate_source");

    // Idempotent second approval returns the same policy.
    const { data: data2, error: error2 } = await customer.rpc(
      "approve_candidate_assets_v2" as any,
      {
        p_household_id: householdId,
        p_actor_profile_id: CUSTOMER_ID,
        p_client_request_id: linkRequestId,
        p_decisions: [
          {
            candidate_id: candidate!.id,
            decision: "link_existing",
            existing_asset_id: property!.id,
            existing_asset_type: "property",
          },
        ],
      },
    );
    expect(error2).toBeNull();
    expect(data2?.policies?.[0]).toBe(data?.policies?.[0]);
  });

  it("directly inserted arbitrary candidate cannot satisfy completion or approval", async () => {
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

    const { data: candidate, error: candidateError } = await admin
      .from("asset_candidates")
      .insert({
        session_id: batch.session_id,
        household_id: householdId,
        asset_type: "vehicle",
        identity_fingerprint: `arbitrary-${randomUUID()}`,
        display_label: "Arbitrary",
        match_classification: "new",
        source_document_ids: [docId],
        selected_facts_json: autoVehicleFacts(),
      })
      .select("id")
      .single();
    if (candidateError) throw candidateError;

    const { error: completeError } = await customer.rpc(
      "complete_customer_manual_entry_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `arbitrary-complete-${randomUUID()}`,
        p_skipped_document_ids: [],
      },
    );
    expect(completeError).not.toBeNull();

    const { error: approveError } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `arbitrary-approve-${randomUUID()}`,
      p_decisions: [{ candidate_id: candidate!.id, decision: "approve_new" }],
    });
    expect(approveError).not.toBeNull();
  });

  it("one candidate reference does not mark a shared document fully reviewed", async () => {
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

    const { error: saveError } = await customer.rpc(
      "save_customer_manual_policy_review_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `reviewing-${randomUUID()}`,
        p_asset_type: "vehicle",
        p_identity_fingerprint: `reviewing-veh-${randomUUID()}`,
        p_display_label: "2020 Honda Civic",
        p_source_document_ids: [docId],
        p_selected_facts_json: autoVehicleFacts(),
        p_match_classification: "new",
      },
    );
    expect(saveError).toBeNull();

    const { data: item } = await admin
      .from("document_processing_batch_items")
      .select("review_status")
      .eq("batch_id", batch.id)
      .eq("policy_document_id", docId)
      .single();
    expect(item?.review_status).toBe("reviewing");

    const { error: completeError } = await customer.rpc(
      "complete_customer_manual_entry_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `reviewing-complete-${randomUUID()}`,
        p_skipped_document_ids: [],
      },
    );
    expect(completeError).not.toBeNull();

    const { error: reviewedError } = await customer.rpc(
      "set_manual_entry_document_status_v1" as any,
      {
        p_batch_id: batch.id,
        p_policy_document_id: docId,
        p_household_id: householdId,
        p_status: "reviewed",
      },
    );
    expect(reviewedError).toBeNull();

    const { error: completeError2 } = await customer.rpc(
      "complete_customer_manual_entry_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `reviewing-complete2-${randomUUID()}`,
        p_skipped_document_ids: [],
      },
    );
    expect(completeError2).toBeNull();
  });

  it("rejects source and not-relevant overlap during completion", async () => {
    const admin = await getAdminClient();
    const customer = await getCustomerClient();
    const adminService = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batch } = await createProcessingBatch(householdId);
    const doc1 = await addPolicyDocument(adminService, householdId, batch.id);
    const doc2 = await addPolicyDocument(adminService, householdId, batch.id);
    await adminService
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", batch.case_id);
    await adminService
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batch.id);

    const { data: saveData, error: saveError } = await admin.rpc(
      "save_staff_manual_policy_candidate_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `overlap-save-${randomUUID()}`,
        p_asset_type: "vehicle",
        p_identity_fingerprint: `overlap-veh-${randomUUID()}`,
        p_display_label: "Overlap vehicle",
        p_source_document_ids: [doc1],
        p_selected_facts_json: autoVehicleFacts(),
        p_match_classification: "new",
      },
    );
    expect(saveError).toBeNull();
    const candidateId = (saveData as { candidate_id?: string } | null)?.candidate_id!;

    await adminService.from("case_assignments").insert({
      case_id: batch.case_id,
      assignee_profile_id: ADMIN_ID,
      assignment_role: "admin",
    });

    const { error: overlapError } = await admin.rpc("complete_manual_review_v1" as any, {
      p_batch_id: batch.id,
      p_session_id: batch.session_id,
      p_case_id: batch.case_id,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [candidateId],
      p_client_request_id: `overlap-${randomUUID()}`,
      p_skipped_document_ids: [doc1],
    });
    expect(overlapError?.message).toMatch(/referenced by a selected candidate/i);

    const { error: reviewedError } = await admin.rpc("set_manual_entry_document_status_v1" as any, {
      p_batch_id: batch.id,
      p_policy_document_id: doc1,
      p_household_id: householdId,
      p_status: "reviewed",
    });
    expect(reviewedError).toBeNull();

    const { error: noOverlapError } = await admin.rpc("complete_manual_review_v1" as any, {
      p_batch_id: batch.id,
      p_session_id: batch.session_id,
      p_case_id: batch.case_id,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [candidateId],
      p_client_request_id: `no-overlap-${randomUUID()}`,
      p_skipped_document_ids: [doc2],
    });
    expect(noOverlapError).toBeNull();
  });

  it("unassigned staff cannot change document status or delete candidates", async () => {
    const customer = await getCustomerClient();
    const operations = await getOperationsClient();
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

    const { data: saveData, error: saveError } = await customer.rpc(
      "save_customer_manual_policy_review_v1" as any,
      {
        p_batch_id: batch.id,
        p_session_id: batch.session_id,
        p_case_id: batch.case_id,
        p_household_id: householdId,
        p_client_request_id: `unassigned-save-${randomUUID()}`,
        p_asset_type: "vehicle",
        p_identity_fingerprint: `unassigned-veh-${randomUUID()}`,
        p_display_label: "Unassigned vehicle",
        p_source_document_ids: [docId],
        p_selected_facts_json: autoVehicleFacts(),
        p_match_classification: "new",
      },
    );
    expect(saveError).toBeNull();
    const candidateId = (saveData as { candidate_id?: string } | null)?.candidate_id!;

    const { error: statusError } = await operations.rpc(
      "set_manual_entry_document_status_v1" as any,
      {
        p_batch_id: batch.id,
        p_policy_document_id: docId,
        p_household_id: householdId,
        p_status: "reviewed",
      },
    );
    expect(statusError).not.toBeNull();

    const { error: deleteError } = await operations.rpc("delete_manual_entry_candidate_v1" as any, {
      p_candidate_id: candidateId,
      p_batch_id: batch.id,
      p_household_id: householdId,
    });
    expect(deleteError).not.toBeNull();
  });

  it("rejects mismatched approval actor ID", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
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
        identity_fingerprint: `actor-${randomUUID()}`,
        display_label: "Actor test",
        match_classification: "new",
        source_document_ids: [extractedDocumentId],
        selected_facts_json: autoVehicleFacts(),
        analysis_run_id: analysisRunId,
      })
      .select("id")
      .single();
    if (candidateError) throw candidateError;

    const { error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_client_request_id: `actor-${randomUUID()}`,
      p_decisions: [{ candidate_id: candidate!.id, decision: "approve_new" }],
    });
    expect(error?.message).toMatch(/approval actor profile id does not match authenticated user/i);
  });

  it("catches missing insurer and property postal code before completion", async () => {
    const admin = await getAdminClient();
    const adminService = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batch } = await createProcessingBatch(householdId);
    const doc1 = await addPolicyDocument(adminService, householdId, batch.id);
    const doc2 = await addPolicyDocument(adminService, householdId, batch.id);
    await adminService
      .from("optimization_cases")
      .update({ state: "extracting_information" })
      .eq("id", batch.case_id);
    await adminService
      .from("document_processing_batches")
      .update({ status: "manual_review" })
      .eq("id", batch.id);

    const missingInsurer = {
      identity: { year: 2020, make: "Honda", model: "Civic" },
      currentPolicy: { annualPremiumCents: 100000, expiryDate: "2026-12-31" },
      currentCoverage: { thirdPartyLiabilityCents: 1000000 },
      mandateSuggestions: {},
    };
    const missingPostal = {
      identity: { fullAddress: "123 Main St", city: "Calgary", province: "AB" },
      currentPolicy: {
        insurerName: "Home Co",
        annualPremiumCents: 100000,
        expiryDate: "2026-12-31",
      },
      currentCoverage: { dwellingLimitCents: 50000000 },
      mandateSuggestions: {},
    };

    const { data: v1 } = await admin.rpc("save_staff_manual_policy_candidate_v1" as any, {
      p_batch_id: batch.id,
      p_session_id: batch.session_id,
      p_case_id: batch.case_id,
      p_household_id: householdId,
      p_client_request_id: `missing-insurer-${randomUUID()}`,
      p_asset_type: "vehicle",
      p_identity_fingerprint: `missing-insurer-${randomUUID()}`,
      p_display_label: "Missing insurer",
      p_source_document_ids: [doc1],
      p_selected_facts_json: missingInsurer,
      p_match_classification: "new",
    });
    const { data: p1 } = await admin.rpc("save_staff_manual_policy_candidate_v1" as any, {
      p_batch_id: batch.id,
      p_session_id: batch.session_id,
      p_case_id: batch.case_id,
      p_household_id: householdId,
      p_client_request_id: `missing-postal-${randomUUID()}`,
      p_asset_type: "property",
      p_identity_fingerprint: `missing-postal-${randomUUID()}`,
      p_display_label: "Missing postal",
      p_source_document_ids: [doc2],
      p_selected_facts_json: missingPostal,
      p_match_classification: "new",
    });

    await adminService.from("case_assignments").insert({
      case_id: batch.case_id,
      assignee_profile_id: ADMIN_ID,
      assignment_role: "admin",
    });

    const { error: vehicleError } = await admin.rpc("complete_manual_review_v1" as any, {
      p_batch_id: batch.id,
      p_session_id: batch.session_id,
      p_case_id: batch.case_id,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [(v1 as { candidate_id: string }).candidate_id],
      p_client_request_id: `complete-missing-insurer-${randomUUID()}`,
    });
    expect(vehicleError?.message).toMatch(/insurer name is required/i);

    const { error: propertyError } = await admin.rpc("complete_manual_review_v1" as any, {
      p_batch_id: batch.id,
      p_session_id: batch.session_id,
      p_case_id: batch.case_id,
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_candidate_ids: [(p1 as { candidate_id: string }).candidate_id],
      p_client_request_id: `complete-missing-postal-${randomUUID()}`,
    });
    expect(propertyError?.message).toMatch(/postal code/i);
  });

  it("automatic extraction to approval creates final assets, policies and document links end to end", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const sessionId = await createExtractionSession(householdId);
    const { extractedDocumentId: vehicleDoc, policyDocumentId: vehiclePolicyDoc } =
      await createExtractedDocument(admin, householdId, sessionId);
    const { extractedDocumentId: propertyDoc, policyDocumentId: propertyPolicyDoc } =
      await createExtractedDocument(admin, householdId, sessionId);
    const analysisRunId = await createAnalysisRun(admin, householdId, sessionId);

    const { data: vehicleCandidate } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        asset_type: "vehicle",
        identity_fingerprint: `e2e-veh-${randomUUID()}`,
        display_label: "2020 Honda Civic",
        match_classification: "new",
        source_document_ids: [vehicleDoc],
        selected_facts_json: autoVehicleFacts(),
        analysis_run_id: analysisRunId,
      })
      .select("id")
      .single();

    const { data: propertyCandidate } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        asset_type: "property",
        identity_fingerprint: `e2e-prop-${randomUUID()}`,
        display_label: "Primary residence",
        match_classification: "new",
        source_document_ids: [propertyDoc],
        selected_facts_json: autoPropertyFacts(),
        analysis_run_id: analysisRunId,
      })
      .select("id")
      .single();

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `e2e-${randomUUID()}`,
      p_decisions: [
        { candidate_id: vehicleCandidate!.id, decision: "approve_new" },
        { candidate_id: propertyCandidate!.id, decision: "approve_new" },
      ],
    });

    expect(error).toBeNull();
    expect(data?.vehicles?.length).toBe(1);
    expect(data?.properties?.length).toBe(1);
    expect(data?.policies?.length).toBe(2);

    const { data: links } = await admin
      .from("policy_document_policy_links")
      .select("policy_document_id, policy_id, relationship_type")
      .in("policy_id", data?.policies ?? ["00000000-0000-0000-0000-000000000000"]);
    expect((links ?? []).length).toBe(2);
    const linkedDocIds = new Set(links?.map((l) => l.policy_document_id));
    expect(linkedDocIds.has(vehiclePolicyDoc)).toBe(true);
    expect(linkedDocIds.has(propertyPolicyDoc)).toBe(true);
    for (const link of links ?? []) {
      expect(link.relationship_type).toBe("candidate_source");
    }
  });

  it("a candidate with no insurer can be skipped", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
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
        identity_fingerprint: `skip-${randomUUID()}`,
        display_label: "Skipped vehicle",
        match_classification: "new",
        decision: "undecided",
        review_status: "pending",
        source_document_ids: [extractedDocumentId],
        selected_facts_json: {
          identity: { year: 2020, make: "Honda", model: "Civic" },
          currentPolicy: { annualPremiumCents: 100000, expiryDate: "2026-12-31" },
          currentCoverage: { thirdPartyLiabilityCents: 1000000 },
          mandateSuggestions: {},
        },
        analysis_run_id: analysisRunId,
      })
      .select("id")
      .single();
    if (candidateError) throw candidateError;

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `skip-${randomUUID()}`,
      p_decisions: [{ candidate_id: candidate!.id, decision: "skip" }],
    });

    expect(error).toBeNull();
    expect(data?.skipped?.length).toBe(1);
    expect(data?.policies?.length).toBe(0);

    const { data: row } = await admin
      .from("asset_candidates")
      .select("decision, review_status")
      .eq("id", candidate!.id)
      .single();
    expect(row?.decision).toBe("skip");
    expect(row?.review_status).toBe("skipped");
  });

  it("a candidate with missing identity can be marked needs_correction", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
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
        identity_fingerprint: `needs-correction-${randomUUID()}`,
        display_label: "Needs correction vehicle",
        match_classification: "new",
        decision: "undecided",
        review_status: "pending",
        source_document_ids: [extractedDocumentId],
        selected_facts_json: {
          identity: { make: "Honda" },
          currentPolicy: {
            insurerName: "Test Insurer",
            annualPremiumCents: 100000,
            expiryDate: "2026-12-31",
          },
          currentCoverage: { thirdPartyLiabilityCents: 1000000 },
          mandateSuggestions: {},
        },
        analysis_run_id: analysisRunId,
      })
      .select("id")
      .single();
    if (candidateError) throw candidateError;

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `needs-correction-${randomUUID()}`,
      p_decisions: [{ candidate_id: candidate!.id, decision: "needs_correction" }],
    });

    expect(error).toBeNull();
    expect(data?.needsCorrection?.length).toBe(1);

    const { data: row } = await admin
      .from("asset_candidates")
      .select("decision, review_status")
      .eq("id", candidate!.id)
      .single();
    expect(row?.decision).toBe("needs_correction");
    expect(row?.review_status).toBe("needs_correction");
  });

  it("partial-identity renewal candidate links to existing asset and creates a policy", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { data: property, error: propertyError } = await admin
      .from("properties")
      .insert({
        household_id: householdId,
        address_line1: "999 Existing Rd",
        city: "Calgary",
        province: "AB",
        postal_code: "T9Z9Z9",
        dwelling_type: "detached",
        owner_occupied: true,
        created_by: CUSTOMER_ID,
        updated_by: CUSTOMER_ID,
      })
      .select("id")
      .single();
    if (propertyError) throw propertyError;

    const sessionId = await createExtractionSession(householdId);
    const { extractedDocumentId } = await createExtractedDocument(admin, householdId, sessionId);
    const analysisRunId = await createAnalysisRun(admin, householdId, sessionId);

    const { data: candidate, error: candidateError } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        asset_type: "property",
        identity_fingerprint: `partial-link-${randomUUID()}`,
        display_label: "Partial linked residence",
        match_classification: "exact_existing_match",
        decision: "undecided",
        review_status: "pending",
        source_document_ids: [extractedDocumentId],
        selected_facts_json: {
          identity: { fullAddress: "999 Existing Rd", city: "Calgary", province: "AB" },
          currentPolicy: {
            insurerName: "Renewal Insurer",
            annualPremiumCents: 120000,
            expiryDate: "2026-12-31",
          },
          currentCoverage: { dwellingLimitCents: 50000000, personalLiabilityLimitCents: 2000000 },
          mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 50000000 } },
        },
        analysis_run_id: analysisRunId,
      })
      .select("id")
      .single();
    if (candidateError) throw candidateError;

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `partial-link-${randomUUID()}`,
      p_decisions: [
        {
          candidate_id: candidate!.id,
          decision: "link_existing",
          existing_asset_id: property!.id,
          existing_asset_type: "property",
        },
      ],
    });

    expect(error).toBeNull();
    expect(data?.linked?.length).toBe(1);
    expect(data?.policies?.length).toBe(1);

    const { data: row } = await admin
      .from("asset_candidates")
      .select("approved_asset_id, approved_asset_type, approved_policy_id")
      .eq("id", candidate!.id)
      .single();
    expect(row?.approved_asset_id).toBe(property!.id);
    expect(row?.approved_asset_type).toBe("property");
    expect(row?.approved_policy_id).toBe(data?.policies?.[0]);

    const { data: approveErrorData, error: approveError } = await customer.rpc(
      "approve_candidate_assets_v2" as any,
      {
        p_household_id: householdId,
        p_actor_profile_id: CUSTOMER_ID,
        p_client_request_id: `partial-new-${randomUUID()}`,
        p_decisions: [{ candidate_id: candidate!.id, decision: "approve_new" }],
      },
    );
    expect(approveError).not.toBeNull();
    expect(approveErrorData).toBeNull();
  });

  it("authenticated customer cannot directly insert an asset candidate", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const sessionId = await createExtractionSession(householdId);
    const { data: session } = await admin
      .from("document_extraction_sessions")
      .select("id")
      .eq("id", sessionId)
      .single();
    const { data: batch } = await admin.rpc("create_document_processing_batch", {
      p_household_id: householdId,
      p_client_request_id: `direct-insert-${randomUUID()}`,
      p_actor_id: CUSTOMER_ID,
    });
    const batchId = batch?.batch?.id as string;
    const caseId = batch?.batch?.case_id as string;

    const { error } = await customer.from("asset_candidates").insert({
      session_id: sessionId,
      household_id: householdId,
      asset_type: "property",
      identity_fingerprint: `direct-${randomUUID()}`,
      display_label: "Direct insert",
      match_classification: "new",
      source_document_ids: [],
      selected_facts_json: {
        _source: "customer_manual_entry",
        _manual_entry_session_id: sessionId,
        _manual_entry_batch_id: batchId,
        _manual_entry_case_id: caseId,
      },
    });

    expect(error).not.toBeNull();
  });

  it("coverage states known, unknown, not_applicable, and conflicting are preserved in policy", async () => {
    const customer = await getCustomerClient();
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const sessionId = await createExtractionSession(householdId);
    const { extractedDocumentId } = await createExtractedDocument(admin, householdId, sessionId);
    const analysisRunId = await createAnalysisRun(admin, householdId, sessionId);

    const facts = {
      identity: { year: 2020, make: "Honda", model: "Civic", vin: "2HGFC2F59JH500001" },
      currentPolicy: {
        insurer: "State Coverage",
        policyNumber: "POL-COV",
        annualPremiumCents: 150000,
        expiryDate: "2026-12-31",
      },
      currentCoverage: {
        thirdPartyLiabilityCents: extractedValue(1000000),
        collisionDeductibleCents: {
          status: "not_included",
          value: null,
          confidence: 1,
          evidence: [],
        },
        comprehensiveDeductibleCents: {
          status: "unknown",
          value: null,
          confidence: 0,
          evidence: [],
        },
        accidentBenefitCents: {
          status: "not_applicable",
          value: null,
          confidence: 1,
          evidence: [],
        },
        specifiedPerilsLimitCents: {
          status: "conflicting",
          value: 50000,
          confidence: 0.5,
          evidence: [],
        },
      },
      mandateSuggestions: { thirdPartyLiability: { rule: "minimum", amountCents: 1000000 } },
    };

    const { data: candidate, error: candidateError } = await admin
      .from("asset_candidates")
      .insert({
        session_id: sessionId,
        household_id: householdId,
        asset_type: "vehicle",
        identity_fingerprint: `coverage-states-${randomUUID()}`,
        display_label: "Coverage state vehicle",
        match_classification: "new",
        decision: "undecided",
        review_status: "pending",
        source_document_ids: [extractedDocumentId],
        selected_facts_json: facts,
        analysis_run_id: analysisRunId,
      })
      .select("id")
      .single();
    if (candidateError) throw candidateError;

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `coverage-states-${randomUUID()}`,
      p_decisions: [{ candidate_id: candidate!.id, decision: "approve_new" }],
    });

    expect(error).toBeNull();
    const { data: policy } = await admin
      .from("policies")
      .select("coverage_details")
      .eq("id", data?.policies?.[0])
      .single();
    const coverage = policy?.coverage_details as Record<string, unknown> | null;
    expect(coverage?.thirdPartyLiabilityCents).toBe(1000000);
    expect(coverage?.collisionDeductibleCents).toBeNull();
    expect(coverage?.comprehensiveDeductibleCents).toBeNull();
    expect(coverage?.accidentBenefitCents).toBeNull();
    expect(coverage?.specifiedPerilsLimitCents).toBeNull();

    const raw = coverage?._rawCoverage as Record<string, unknown> | undefined;
    const state = coverage?._coverageState as Record<string, string> | undefined;
    expect((raw?.collisionDeductibleCents as { status: string })?.status).toBe("not_included");
    expect((raw?.comprehensiveDeductibleCents as { status: string })?.status).toBe("unknown");
    expect((raw?.accidentBenefitCents as { status: string })?.status).toBe("not_applicable");
    expect((raw?.specifiedPerilsLimitCents as { status: string })?.status).toBe("conflicting");
    expect(state?.collisionDeductibleCents).toBe("not_included");
    expect(state?.comprehensiveDeductibleCents).toBe("unknown");
    expect(state?.accidentBenefitCents).toBe("not_applicable");
    expect(state?.specifiedPerilsLimitCents).toBe("conflicting");
  });
});
