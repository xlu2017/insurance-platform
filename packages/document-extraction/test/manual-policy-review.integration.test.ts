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
    name: "Manual Policy Review Test Household",
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

describe("save_manual_policy_review_v1", () => {
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
      await admin.from("document_extraction_sessions").delete().eq("household_id", householdId);
      await admin.from("policy_documents").delete().eq("household_id", householdId);
      await admin.from("household_members").delete().eq("household_id", householdId);
      await admin.from("households").delete().eq("id", householdId);
    }
    createdHouseholdIds.length = 0;
  });

  it("rejects non-staff callers", async () => {
    const user = await getCustomerClient();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { data, error } = await user.rpc("save_manual_policy_review_v1" as any, {
      p_household_id: householdId,
      p_actor_profile_id: CUSTOMER_ID,
      p_client_request_id: `manual-review-customer-${randomUUID()}`,
      p_policy_document_id: "00000000-0000-0000-0000-000000000000",
      p_asset_type: "property",
      p_identity_fingerprint: "fp-1",
      p_display_label: "Test",
    });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("creates a property candidate from a manually reviewed policy document", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const staff = await getAdminClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { data: policyDoc, error: policyDocErr } = await staff
      .from("policy_documents")
      .insert({
        household_id: householdId,
        file_name: "property-policy.pdf",
        mime_type: "application/pdf",
        size_bytes: 0,
        storage_path: "manual/property-policy.pdf",
      })
      .select("id")
      .single();
    expect(policyDocErr).toBeNull();

    const clientRequestId = `manual-review-property-${randomUUID()}`;
    const fingerprint = `property_manual_${randomUUID()}`;
    const { data, error } = await staff.rpc("save_manual_policy_review_v1" as any, {
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_client_request_id: clientRequestId,
      p_policy_document_id: policyDoc!.id,
      p_asset_type: "property",
      p_identity_fingerprint: fingerprint,
      p_display_label: "Manual rental property",
      p_occupancy: "rental",
      p_match_classification: "new",
      p_selected_facts_json: {
        identity: {
          fullAddress: "123 Test Ave",
          city: "Calgary",
          province: "AB",
          postalCode: "T1A 1A1",
        },
        currentPolicy: { insurerName: "Test Insurer", annualPremiumCents: 294000 },
        currentCoverage: { dwellingLimitCents: 43800000, fairRentalLimitCents: 8900000 },
        mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 43800000 } },
      },
      p_provenance_json: {
        reviewedBy: ADMIN_ID,
        sourcePage: "declarations",
        sourceSection: "coverage",
      },
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.candidate_id).toBeTruthy();

    const { data: candidate, error: candidateErr } = await admin
      .from("asset_candidates")
      .select(
        "asset_type, identity_fingerprint, display_label, occupancy, match_classification, review_status, decision, manual_reviewed_by, selected_facts_json",
      )
      .eq("id", data!.candidate_id)
      .single();
    expect(candidateErr).toBeNull();
    expect(candidate?.asset_type).toBe("property");
    expect(candidate?.identity_fingerprint).toBe(fingerprint);
    expect(candidate?.occupancy).toBe("rental");
    expect(candidate?.review_status).toBe("pending");
    expect(candidate?.decision).toBe("undecided");
    expect(candidate?.manual_reviewed_by).toBe(ADMIN_ID);
    expect(candidate?.selected_facts_json?._source).toBe("manual_policy_review");
    expect(candidate?.selected_facts_json?._provenance?.reviewedBy).toBe(ADMIN_ID);
  });

  it("rejects a source policy document from another household", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const staff = await getAdminClient();

    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const otherHouseholdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(otherHouseholdId);

    const { data: policyDoc, error: policyDocErr } = await staff
      .from("policy_documents")
      .insert({
        household_id: otherHouseholdId,
        file_name: "other.pdf",
        mime_type: "application/pdf",
        size_bytes: 0,
        storage_path: "manual/other.pdf",
      })
      .select("id")
      .single();
    expect(policyDocErr).toBeNull();

    const { data, error } = await staff.rpc("save_manual_policy_review_v1" as any, {
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_client_request_id: `cross-household-${randomUUID()}`,
      p_policy_document_id: policyDoc!.id,
      p_asset_type: "property",
      p_identity_fingerprint: "cross",
      p_display_label: "Cross household",
    });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("is idempotent under the same client request id", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const staff = await getAdminClient();
    const householdId = await createIsolatedHousehold(admin);
    createdHouseholdIds.push(householdId);

    const { data: policyDoc, error: policyDocErr } = await staff
      .from("policy_documents")
      .insert({
        household_id: householdId,
        file_name: "idempotent.pdf",
        mime_type: "application/pdf",
        size_bytes: 0,
        storage_path: "manual/idempotent.pdf",
      })
      .select("id")
      .single();
    expect(policyDocErr).toBeNull();

    const clientRequestId = `manual-review-idempotent-${randomUUID()}`;
    const fingerprint = `vehicle_manual_${randomUUID()}`;
    const payload = {
      p_household_id: householdId,
      p_actor_profile_id: ADMIN_ID,
      p_client_request_id: clientRequestId,
      p_policy_document_id: policyDoc!.id,
      p_asset_type: "vehicle",
      p_identity_fingerprint: fingerprint,
      p_display_label: "Manual vehicle",
      p_match_classification: "new",
      p_selected_facts_json: {},
      p_provenance_json: {},
    };

    const { data: first, error: err1 } = await staff.rpc(
      "save_manual_policy_review_v1" as any,
      payload,
    );
    expect(err1).toBeNull();
    const { data: second, error: err2 } = await staff.rpc(
      "save_manual_policy_review_v1" as any,
      payload,
    );
    expect(err2).toBeNull();
    expect(second?.candidate_id).toBe(first?.candidate_id);
  });
});
