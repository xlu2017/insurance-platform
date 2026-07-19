import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const DEMO_HOUSEHOLD_ID = "20000000-0000-0000-0000-000000000001";
const DEMO_ADMIN_ID = "00000000-0000-0000-0000-000000000004";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";

function assertLocalSupabase() {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Destructive integration tests may only run against local Supabase.");
  }
}

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_IU";

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

describe("save_manual_policy_review_v1", () => {
  beforeAll(async () => {
    assertLocalSupabase();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await admin.from("asset_candidates").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await admin
      .from("manual_policy_reviews")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await admin
      .from("document_extraction_sessions")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await admin.from("policy_documents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  });

  it("rejects non-staff callers", async () => {
    const user = await getCustomerClient();
    const { data, error } = await user.rpc("save_manual_policy_review_v1" as any, {
      p_household_id: DEMO_HOUSEHOLD_ID,
      p_actor_profile_id: "00000000-0000-0000-0000-000000000001",
      p_client_request_id: "manual-review-customer-1",
      p_policy_document_id: "00000000-0000-0000-0000-000000000000",
      p_asset_type: "property",
      p_identity_fingerprint: "fp-1",
      p_display_label: "Test",
    });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("creates a property candidate from a manually reviewed policy document", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const staff = await getAdminClient();

    const { data: policyDoc, error: policyDocErr } = await staff
      .from("policy_documents")
      .insert({
        household_id: DEMO_HOUSEHOLD_ID,
        file_name: "property-policy.pdf",
        mime_type: "application/pdf",
        size_bytes: 0,
        storage_path: "manual/property-policy.pdf",
      })
      .select("id")
      .single();
    expect(policyDocErr).toBeNull();

    const clientRequestId = `manual-review-property-${crypto.randomUUID()}`;
    const { data, error } = await staff.rpc("save_manual_policy_review_v1" as any, {
      p_household_id: DEMO_HOUSEHOLD_ID,
      p_actor_profile_id: DEMO_ADMIN_ID,
      p_client_request_id: clientRequestId,
      p_policy_document_id: policyDoc!.id,
      p_asset_type: "property",
      p_identity_fingerprint: "property_manual_1",
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
        reviewedBy: DEMO_ADMIN_ID,
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
    expect(candidate?.identity_fingerprint).toBe("property_manual_1");
    expect(candidate?.occupancy).toBe("rental");
    expect(candidate?.review_status).toBe("pending");
    expect(candidate?.decision).toBe("undecided");
    expect(candidate?.manual_reviewed_by).toBe(DEMO_ADMIN_ID);
    expect(candidate?.selected_facts_json?._source).toBe("manual_policy_review");
    expect(candidate?.selected_facts_json?._provenance?.reviewedBy).toBe(DEMO_ADMIN_ID);
  });

  it("rejects a source policy document from another household", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const staff = await getAdminClient();

    const { data: otherHousehold } = await admin
      .from("households")
      .insert({ owner_profile_id: DEMO_ADMIN_ID, name: "Other", province: "AB" })
      .select("id")
      .single();

    const { data: policyDoc, error: policyDocErr } = await staff
      .from("policy_documents")
      .insert({
        household_id: otherHousehold!.id,
        file_name: "other.pdf",
        mime_type: "application/pdf",
        size_bytes: 0,
        storage_path: "manual/other.pdf",
      })
      .select("id")
      .single();
    expect(policyDocErr).toBeNull();

    const { data, error } = await staff.rpc("save_manual_policy_review_v1" as any, {
      p_household_id: DEMO_HOUSEHOLD_ID,
      p_actor_profile_id: DEMO_ADMIN_ID,
      p_client_request_id: `cross-household-${crypto.randomUUID()}`,
      p_policy_document_id: policyDoc!.id,
      p_asset_type: "property",
      p_identity_fingerprint: "cross",
      p_display_label: "Cross household",
    });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("is idempotent under the same client request id", async () => {
    const staff = await getAdminClient();

    const { data: policyDoc, error: policyDocErr } = await staff
      .from("policy_documents")
      .insert({
        household_id: DEMO_HOUSEHOLD_ID,
        file_name: "idempotent.pdf",
        mime_type: "application/pdf",
        size_bytes: 0,
        storage_path: "manual/idempotent.pdf",
      })
      .select("id")
      .single();
    expect(policyDocErr).toBeNull();

    const clientRequestId = `manual-review-idempotent-${crypto.randomUUID()}`;
    const payload = {
      p_household_id: DEMO_HOUSEHOLD_ID,
      p_actor_profile_id: DEMO_ADMIN_ID,
      p_client_request_id: clientRequestId,
      p_policy_document_id: policyDoc!.id,
      p_asset_type: "vehicle",
      p_identity_fingerprint: "vehicle_manual_1",
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
