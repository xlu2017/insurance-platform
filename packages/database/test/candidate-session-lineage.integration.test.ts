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

function uniqueDigest() {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function serviceRoleClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  });
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

async function createIsolatedHousehold() {
  const admin = serviceRoleClient();
  const householdId = `b0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
  const { error } = await admin.from("households").insert({
    id: householdId,
    owner_profile_id: CUSTOMER_ID,
    name: "Candidate Session Lineage Household",
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

async function createDangerousBatch(householdId: string) {
  const admin = serviceRoleClient();
  const { data, error } = await admin.rpc("create_document_processing_batch", {
    p_household_id: householdId,
    p_client_request_id: `lineage-batch-${randomUUID()}`,
    p_actor_id: CUSTOMER_ID,
  });
  if (error) throw error;
  const typed = data as {
    batch: { id: string; case_id: string; session_id: string } & Record<string, unknown>;
    session_id: string;
  };
  const { error: updateError } = await admin
    .from("document_processing_batches")
    .update({ mode_snapshot: "dangerous" })
    .eq("id", typed.batch.id);
  if (updateError) throw updateError;
  return { batch: typed.batch, session_id: typed.session_id };
}

async function persistBatchAnalysis(
  admin: SupabaseClient,
  householdId: string,
  sessionId: string,
  batchId: string,
  candidateId: string,
  assetType: "vehicle" | "property",
  selectedFacts: Record<string, unknown>,
) {
  const extractedDocId = randomUUID();
  const policyDocId = randomUUID();

  const { error: policyDocError } = await admin.from("policy_documents").insert({
    id: policyDocId,
    household_id: householdId,
    file_name: `lineage-${randomUUID()}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 1024,
    storage_path: `lineage/${randomUUID()}.pdf`,
    uploaded_by: CUSTOMER_ID,
    category: "other",
  });
  if (policyDocError) throw policyDocError;

  const resolution = (selectedFacts.resolution as Record<string, unknown>) ?? {};
  const hasMatch =
    (resolution as { matchedExistingEntityId?: string })?.matchedExistingEntityId ??
    (resolution as { matchedPendingCandidateId?: string })?.matchedPendingCandidateId ??
    (selectedFacts.existingAsset as { id?: string } | undefined)?.id;
  const matchClassification =
    resolution.status === "matches_existing" || resolution.status === "matches_pending_candidate"
      ? "exact_existing_match"
      : resolution.status === "possible_match_requires_confirmation"
        ? hasMatch
          ? "possible_existing_match"
          : "new_identity_confirmation_required"
        : "new";

  const { data, error } = await admin.rpc("persist_document_batch_analysis_v1" as any, {
    p_batch_id: batchId,
    p_household_id: householdId,
    p_session_id: sessionId,
    p_client_request_id: `lineage-${randomUUID()}`,
    p_analysis_json: {
      modelProvider: "test",
      modelId: "test-model",
      promptVersion: "1.0.0",
      outputSchemaVersion: "1.0.0",
      rawResponse: {},
      validatedOutput: {},
    },
    p_documents_json: [
      {
        id: extractedDocId,
        policy_document_id: policyDocId,
        file_digest: uniqueDigest(),
        page_count: 1,
        classification: "supported",
        parser_id: "test",
        parser_version: "1.0.0",
        pages_json: [],
      },
    ],
    p_candidates_json: [
      {
        id: candidateId,
        asset_type: assetType,
        identity_fingerprint: `${assetType}-lineage-${randomUUID()}`,
        display_label: assetType === "vehicle" ? "2018 Honda Civic" : "999 Existing Rd",
        match_classification: matchClassification,
        decision: "undecided",
        review_status: "pending",
        source_document_ids: [extractedDocId],
        selected_facts_json: selectedFacts,
        conflicts_json: [],
      },
    ],
  });
  if (error) throw error;
  return data as Record<string, unknown>;
}

function buildExistingAsset(existingId: string, assetType: "vehicle" | "property") {
  return {
    id: existingId,
    asset_type: assetType,
    display_label: assetType === "vehicle" ? "2018 Honda Civic" : "999 Existing Rd",
  };
}

function extractedValue(value: unknown, confidence = 0.98) {
  return { status: "known", value, confidence, evidence: [] };
}

function autoVehicleFacts(overrides: Record<string, unknown> = {}) {
  return {
    identity: { year: 2018, make: "Honda", model: "Civic" },
    currentPolicy: {
      insurerName: "Lineage Insurer",
      policyNumber: "POL-LINEAGE",
      annualPremiumCents: 150000,
      expiryDate: "2027-12-31",
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
      fullAddress: "999 Existing Rd",
      city: "Calgary",
      province: "AB",
      postalCode: "T9Z9Z9",
    },
    currentPolicy: {
      insurerName: "Lineage Property Insurer",
      policyNumber: "POL-LINEAGE-PROP",
      annualPremiumCents: 130000,
      expiryDate: "2027-12-31",
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

function matchesExistingFacts(existingId: string, assetType: "vehicle" | "property") {
  const facts = assetType === "vehicle" ? autoVehicleFacts() : autoPropertyFacts();
  return {
    ...facts,
    existingAsset: buildExistingAsset(existingId, assetType),
    resolution: {
      status: "matches_existing",
      matchedExistingEntityId: existingId,
      confidence: 0.99,
      reasoning: "Matches existing asset.",
    },
    candidateIdentity: { identityStrength: "exact" },
  };
}

function matchesPendingFacts(
  pendingCandidateId: string,
  existingId?: string,
  existingType?: "vehicle" | "property",
  draftDecision?: string,
) {
  const facts = autoVehicleFacts();
  const result: Record<string, unknown> = {
    ...facts,
    resolution: {
      status: "matches_pending_candidate",
      matchedPendingCandidateId: pendingCandidateId,
      confidence: 0.99,
      reasoning: "Matches pending candidate.",
    },
    candidateIdentity: { identityStrength: "exact" },
  };
  if (existingId && existingType) {
    result.existingAsset = buildExistingAsset(existingId, existingType);
  }
  if (draftDecision) {
    result._draftDecision = draftDecision;
    if (existingId && existingType) {
      result._draftExistingAssetId = existingId;
      result._draftExistingAssetType = existingType;
    }
    result._draftIdentityConfirmed =
      draftDecision === "link_existing" || draftDecision === "approve_new";
  }
  return result;
}

function explicitDraftFacts(
  draftDecision: string,
  existingId?: string,
  existingType?: "vehicle" | "property",
) {
  const facts: Record<string, unknown> = autoVehicleFacts();
  facts._draftDecision = draftDecision;
  if (existingId && existingType) {
    facts._draftExistingAssetId = existingId;
    facts._draftExistingAssetType = existingType;
    facts.existingAsset = buildExistingAsset(existingId, existingType);
  }
  return facts;
}

describe("candidate session lineage and persistence conflicts", () => {
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

  async function createVehicle(admin: SupabaseClient, householdId: string) {
    const { data } = await admin
      .from("vehicles")
      .insert({
        household_id: householdId,
        year: 2018,
        make: "Honda",
        model: "Civic",
        vin: `2HGFC2F59JH${Math.floor(Math.random() * 100000)
          .toString()
          .padStart(5, "0")}`,
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
    if (!data) throw new Error("vehicle not created");
    return data.id as string;
  }

  async function markBatchReadyForReview(admin: SupabaseClient, batchId: string) {
    const { error } = await admin
      .from("document_processing_batches")
      .update({ status: "ready_for_review" })
      .eq("id", batchId);
    if (error) throw error;
  }

  function sessionCandidateIds(admin: SupabaseClient, sessionId: string) {
    return admin
      .from("asset_candidates")
      .select(
        "id, draft_decision, draft_existing_asset_id, draft_existing_asset_type, draft_identity_confirmed",
      )
      .eq("session_id", sessionId)
      .in("review_status", ["pending", "reviewing"])
      .in("decision", ["undecided", "not_sure"]);
  }

  it("rejects a candidate id that belongs to another household", async () => {
    const admin = serviceRoleClient();
    const householdA = await createIsolatedHousehold();
    const householdB = await createIsolatedHousehold();
    createdHouseholdIds.push(householdA, householdB);

    const { batch: batchA, session_id: sessionA } = await createDangerousBatch(householdA);
    const vehicleA = await createVehicle(admin, householdA);
    const candidateA = randomUUID();
    await persistBatchAnalysis(
      admin,
      householdA,
      sessionA,
      batchA.id,
      candidateA,
      "vehicle",
      matchesExistingFacts(vehicleA, "vehicle"),
    );

    const { batch: batchB, session_id: sessionB } = await createDangerousBatch(householdB);
    const policyDocId = randomUUID();
    const extractedDocId = randomUUID();
    await admin.from("policy_documents").insert({
      id: policyDocId,
      household_id: householdB,
      file_name: `conflict-${randomUUID()}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 1024,
      storage_path: `conflict/${randomUUID()}.pdf`,
      uploaded_by: CUSTOMER_ID,
      category: "other",
    });

    const { error } = await admin.rpc("persist_document_batch_analysis_v1" as any, {
      p_batch_id: batchB.id,
      p_household_id: householdB,
      p_session_id: sessionB,
      p_client_request_id: `conflict-${randomUUID()}`,
      p_analysis_json: {
        modelProvider: "test",
        modelId: "test-model",
        promptVersion: "1.0.0",
        outputSchemaVersion: "1.0.0",
        rawResponse: {},
        validatedOutput: {},
      },
      p_documents_json: [
        {
          id: extractedDocId,
          policy_document_id: policyDocId,
          file_digest: uniqueDigest(),
          page_count: 1,
          classification: "supported",
          parser_id: "test",
          parser_version: "1.0.0",
          pages_json: [],
        },
      ],
      p_candidates_json: [
        {
          id: candidateA,
          asset_type: "vehicle",
          identity_fingerprint: `vehicle-conflict-${randomUUID()}`,
          display_label: "Conflict vehicle",
          match_classification: "exact_existing_match",
          decision: "undecided",
          review_status: "pending",
          source_document_ids: [extractedDocId],
          selected_facts_json: matchesExistingFacts(vehicleA, "vehicle"),
          conflicts_json: [],
        },
      ],
    });

    expect(error?.message).toMatch(/CANDIDATE_HOUSEHOLD_CONFLICT/i);

    const { count: runCount } = await admin
      .from("document_analysis_runs")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionB);
    expect(runCount).toBe(0);

    const { count: docCount } = await admin
      .from("extracted_documents")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionB);
    expect(docCount).toBe(0);
  });

  it("batch persistence preserves link_existing lineage through a pending match", async () => {
    const admin = serviceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batch: batchA, session_id: sessionA } = await createDangerousBatch(householdId);
    const vehicleId = await createVehicle(admin, householdId);
    const candidateId = randomUUID();
    await persistBatchAnalysis(
      admin,
      householdId,
      sessionA,
      batchA.id,
      candidateId,
      "vehicle",
      matchesExistingFacts(vehicleId, "vehicle"),
    );

    const { data: first } = await admin
      .from("asset_candidates")
      .select(
        "draft_decision, draft_identity_confirmed, draft_existing_asset_id, draft_existing_asset_type",
      )
      .eq("id", candidateId)
      .single();
    expect(first?.draft_decision).toBe("link_existing");
    expect(first?.draft_identity_confirmed).toBe(true);
    expect(first?.draft_existing_asset_id).toBe(vehicleId);
    expect(first?.draft_existing_asset_type).toBe("vehicle");

    const { batch: batchB, session_id: sessionB } = await createDangerousBatch(householdId);
    const secondCandidateId = randomUUID();
    await persistBatchAnalysis(
      admin,
      householdId,
      sessionB,
      batchB.id,
      secondCandidateId,
      "vehicle",
      matchesPendingFacts(candidateId, vehicleId, "vehicle", "link_existing"),
    );

    const { data: second } = await admin
      .from("asset_candidates")
      .select(
        "draft_decision, draft_identity_confirmed, draft_existing_asset_id, draft_existing_asset_type",
      )
      .eq("id", secondCandidateId)
      .single();
    expect(second?.draft_decision).toBe("link_existing");
    expect(second?.draft_identity_confirmed).toBe(true);
    expect(second?.draft_existing_asset_id).toBe(vehicleId);
    expect(second?.draft_existing_asset_type).toBe("vehicle");

    const { error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `lineage-approve-${randomUUID()}`,
      p_decisions: [
        {
          candidate_id: secondCandidateId,
          decision: "link_existing",
          existing_asset_id: vehicleId,
          existing_asset_type: "vehicle",
          identity_confirmed: true,
        },
      ],
    });
    expect(error).toBeNull();

    const { count } = await admin
      .from("vehicles")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(count).toBe(1);
  });

  it("batch persistence preserves approve_new lineage through a pending match", async () => {
    const admin = serviceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batch: batchA, session_id: sessionA } = await createDangerousBatch(householdId);
    const candidateId = randomUUID();
    await persistBatchAnalysis(
      admin,
      householdId,
      sessionA,
      batchA.id,
      candidateId,
      "vehicle",
      explicitDraftFacts("approve_new"),
    );

    const { data: first } = await admin
      .from("asset_candidates")
      .select("draft_decision, draft_identity_confirmed")
      .eq("id", candidateId)
      .single();
    expect(first?.draft_decision).toBe("approve_new");
    expect(first?.draft_identity_confirmed).toBe(true);

    const { batch: batchB, session_id: sessionB } = await createDangerousBatch(householdId);
    const secondCandidateId = randomUUID();
    await persistBatchAnalysis(
      admin,
      householdId,
      sessionB,
      batchB.id,
      secondCandidateId,
      "vehicle",
      matchesPendingFacts(candidateId, undefined, undefined, "approve_new"),
    );

    const { data: second } = await admin
      .from("asset_candidates")
      .select("draft_decision, draft_identity_confirmed")
      .eq("id", secondCandidateId)
      .single();
    expect(second?.draft_decision).toBe("approve_new");
    expect(second?.draft_identity_confirmed).toBe(true);

    const { error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `lineage-approve-new-${randomUUID()}`,
      p_decisions: [
        {
          candidate_id: secondCandidateId,
          decision: "approve_new",
          identity_confirmed: true,
        },
      ],
    });
    expect(error).toBeNull();

    const { count } = await admin
      .from("vehicles")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(count).toBe(1);
  });

  it("batch persistence preserves needs_correction lineage through a pending match", async () => {
    const admin = serviceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const vehicleId = await createVehicle(admin, householdId);

    const { batch: batchA, session_id: sessionA } = await createDangerousBatch(householdId);
    const candidateId = randomUUID();
    await persistBatchAnalysis(
      admin,
      householdId,
      sessionA,
      batchA.id,
      candidateId,
      "vehicle",
      explicitDraftFacts("needs_correction"),
    );

    const { data: first } = await admin
      .from("asset_candidates")
      .select("draft_decision, draft_identity_confirmed")
      .eq("id", candidateId)
      .single();
    expect(first?.draft_decision).toBe("needs_correction");
    expect(first?.draft_identity_confirmed).toBe(false);

    const { batch: batchB, session_id: sessionB } = await createDangerousBatch(householdId);
    const secondCandidateId = randomUUID();
    await persistBatchAnalysis(
      admin,
      householdId,
      sessionB,
      batchB.id,
      secondCandidateId,
      "vehicle",
      matchesPendingFacts(candidateId, undefined, undefined, "needs_correction"),
    );

    const { data: second } = await admin
      .from("asset_candidates")
      .select("draft_decision, draft_identity_confirmed")
      .eq("id", secondCandidateId)
      .single();
    expect(second?.draft_decision).toBe("needs_correction");
    expect(second?.draft_identity_confirmed).toBe(false);

    // A needs_correction candidate can be advanced to link_existing without creating a duplicate.
    const { error: saveError } = await customer.rpc("save_candidate_review_draft_v1" as any, {
      p_household_id: householdId,
      p_candidate_id: secondCandidateId,
      p_decision: "link_existing",
      p_identity_confirmed: true,
      p_existing_asset_id: vehicleId,
      p_existing_asset_type: "vehicle",
    });
    expect(saveError).toBeNull();

    const { data: saved } = await admin
      .from("asset_candidates")
      .select("draft_decision, draft_identity_confirmed, draft_existing_asset_id")
      .eq("id", secondCandidateId)
      .single();
    expect(saved?.draft_decision).toBe("link_existing");
    expect(saved?.draft_identity_confirmed).toBe(true);
    expect(saved?.draft_existing_asset_id).toBe(vehicleId);

    const { count } = await admin
      .from("vehicles")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(count).toBe(1);
  });

  it("batch persistence preserves undecided lineage through a pending match", async () => {
    const admin = serviceRoleClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batch: batchA, session_id: sessionA } = await createDangerousBatch(householdId);
    const candidateId = randomUUID();
    await persistBatchAnalysis(
      admin,
      householdId,
      sessionA,
      batchA.id,
      candidateId,
      "vehicle",
      explicitDraftFacts("undecided"),
    );

    const { data: first } = await admin
      .from("asset_candidates")
      .select("draft_decision, draft_identity_confirmed")
      .eq("id", candidateId)
      .single();
    expect(first?.draft_decision).toBe("undecided");
    expect(first?.draft_identity_confirmed).toBe(false);

    const { batch: batchB, session_id: sessionB } = await createDangerousBatch(householdId);
    const secondCandidateId = randomUUID();
    await persistBatchAnalysis(
      admin,
      householdId,
      sessionB,
      batchB.id,
      secondCandidateId,
      "vehicle",
      matchesPendingFacts(candidateId, undefined, undefined, "undecided"),
    );

    const { data: second } = await admin
      .from("asset_candidates")
      .select("draft_decision, draft_identity_confirmed")
      .eq("id", secondCandidateId)
      .single();
    expect(second?.draft_decision).toBe("undecided");
    expect(second?.draft_identity_confirmed).toBe(false);
  });

  it("processing Case B cannot remove a candidate from Case A", async () => {
    const admin = serviceRoleClient();
    const customer = await getCustomerClient();
    const householdId = await createIsolatedHousehold();
    createdHouseholdIds.push(householdId);

    const { batch: batchA, session_id: sessionA } = await createDangerousBatch(householdId);
    const vehicleId = await createVehicle(admin, householdId);
    const candidateA = randomUUID();
    await persistBatchAnalysis(
      admin,
      householdId,
      sessionA,
      batchA.id,
      candidateA,
      "vehicle",
      matchesExistingFacts(vehicleId, "vehicle"),
    );
    await markBatchReadyForReview(admin, batchA.id);

    const { data: sessionAResult } = await sessionCandidateIds(admin, sessionA);
    expect(sessionAResult?.length).toBe(1);
    expect(sessionAResult?.[0]?.id).toBe(candidateA);

    const { batch: batchB, session_id: sessionB } = await createDangerousBatch(householdId);
    const candidateB = randomUUID();
    const factsB = matchesPendingFacts(candidateA, vehicleId, "vehicle", "link_existing");
    await persistBatchAnalysis(
      admin,
      householdId,
      sessionB,
      batchB.id,
      candidateB,
      "vehicle",
      factsB,
    );

    const { data: sessionAResultAfter } = await sessionCandidateIds(admin, sessionA);
    expect(sessionAResultAfter?.length).toBe(1);
    expect(sessionAResultAfter?.[0]?.id).toBe(candidateA);

    const { data: sessionBResult } = await sessionCandidateIds(admin, sessionB);
    expect(sessionBResult?.length).toBe(1);
    expect(sessionBResult?.[0]?.id).toBe(candidateB);
    expect(sessionBResult?.[0]?.draft_decision).toBe("link_existing");
    expect(sessionBResult?.[0]?.draft_existing_asset_id).toBe(vehicleId);

    const { data: aData, error: aError } = await customer.rpc(
      "approve_candidate_assets_v2" as any,
      {
        p_household_id: householdId,
        p_actor_profile_id: CUSTOMER_ID,
        p_client_request_id: `case-a-approve-${randomUUID()}`,
        p_decisions: [
          {
            candidate_id: candidateA,
            decision: "link_existing",
            existing_asset_id: vehicleId,
            existing_asset_type: "vehicle",
            identity_confirmed: true,
          },
        ],
      },
    );
    expect(aError).toBeNull();

    const { data: bData, error: bError } = await customer.rpc(
      "approve_candidate_assets_v2" as any,
      {
        p_household_id: householdId,
        p_actor_profile_id: CUSTOMER_ID,
        p_client_request_id: `case-b-approve-${randomUUID()}`,
        p_decisions: [
          {
            candidate_id: candidateB,
            decision: "link_existing",
            existing_asset_id: vehicleId,
            existing_asset_type: "vehicle",
            identity_confirmed: true,
          },
        ],
      },
    );
    expect(bError).toBeNull();

    const { count: vehicleCount } = await admin
      .from("vehicles")
      .select("*", { count: "exact", head: true })
      .eq("household_id", householdId);
    expect(vehicleCount).toBe(1);

    const { data: links } = await admin
      .from("policy_asset_links")
      .select("policy_id, is_current")
      .eq("asset_id", vehicleId);
    expect(links?.length).toBe(2);
    expect(links?.filter((l) => l.is_current).length).toBe(1);
    expect(new Set(links?.map((l) => l.policy_id))).toEqual(
      new Set([aData?.policies?.[0], bData?.policies?.[0]]),
    );
  });
});
