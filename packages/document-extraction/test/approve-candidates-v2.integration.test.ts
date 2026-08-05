import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertLocalSupabase,
  LOCAL_SUPABASE_ANON_KEY,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY,
  LOCAL_SUPABASE_URL,
} from "@autopilot/test-fixtures";

const DEMO_HOUSEHOLD_ID = "20000000-0000-0000-0000-000000000001";
const DEMO_CUSTOMER_ID = "00000000-0000-0000-0000-000000000001";
const DEMO_ADMIN_ID = "00000000-0000-0000-0000-000000000004";

const SUPABASE_URL = process.env.SUPABASE_URL || LOCAL_SUPABASE_URL;
const SERVICE_ROLE_KEY = LOCAL_SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = LOCAL_SUPABASE_ANON_KEY;

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

async function createPolicyDocument(staff: any, label: string) {
  const { data, error } = await staff
    .from("policy_documents")
    .insert({
      household_id: DEMO_HOUSEHOLD_ID,
      file_name: `${label}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 0,
      storage_path: `manual/${label}.pdf`,
      uploaded_by: DEMO_ADMIN_ID,
    })
    .select("id")
    .single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function createManualCandidate(
  staff: any,
  clientRequestId: string,
  policyDocumentId: string,
  assetType: "property" | "vehicle",
  facts: any,
) {
  const { data, error } = await staff.rpc("save_manual_policy_review_v1" as any, {
    p_household_id: DEMO_HOUSEHOLD_ID,
    p_actor_profile_id: DEMO_ADMIN_ID,
    p_client_request_id: clientRequestId,
    p_policy_document_id: policyDocumentId,
    p_asset_type: assetType,
    p_identity_fingerprint: facts.identity.fingerprint || `${assetType}_manual`,
    p_display_label: facts.displayLabel,
    p_match_classification: facts.matchClassification || "new",
    p_selected_facts_json: {
      identity: facts.identity,
      currentPolicy: facts.currentPolicy,
      currentCoverage: facts.currentCoverage,
      mandateSuggestions: facts.mandateSuggestions,
    },
    p_provenance_json: { reviewedBy: DEMO_ADMIN_ID, source: "manual" },
  });
  expect(error).toBeNull();
  return data!.candidate_id as string;
}

describe("approve_candidate_assets_v2", () => {
  beforeAll(async () => {
    assertLocalSupabase();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    await admin.from("asset_candidates").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await admin
      .from("manual_policy_reviews")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await admin
      .from("candidate_approvals")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await admin
      .from("candidate_field_reviews")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await admin
      .from("document_extraction_sessions")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await admin.from("policy_documents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    // Remove assets created by previous tests, but preserve seed assets.
    await admin
      .from("vehicles")
      .delete()
      .not(
        "id",
        "in",
        "(22000000-0000-0000-0000-000000000001,22000000-0000-0000-0000-000000000002)",
      );
    await admin
      .from("properties")
      .delete()
      .not("id", "in", "(23000000-0000-0000-0000-000000000001)");
    await admin
      .from("policies")
      .delete()
      .not(
        "id",
        "in",
        "(24000000-0000-0000-0000-000000000001,24000000-0000-0000-0000-000000000002)",
      );
  });

  it("rejects non-member callers", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const otherUser = createClient(SUPABASE_URL, ANON_KEY);
    const email = `other-candidate-test-${Date.now()}@example.com`;
    const password = "OtherPass123!";
    const { data: createData, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: "authenticated" },
    });
    if (createError || !createData?.user) throw new Error("failed to create other user");

    const { error: signInError } = await otherUser.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error("failed to sign in other user");

    const { data, error } = await otherUser.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: DEMO_HOUSEHOLD_ID,
      p_actor_profile_id: createData.user.id,
      p_client_request_id: "cross-household-approval-1",
      p_decisions: [],
    });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("approves three property candidates and one vehicle candidate from manual review", async () => {
    const staff = await getAdminClient();
    const customer = await getCustomerClient();

    const prop1Doc = await createPolicyDocument(staff, "prop1");
    const prop2Doc = await createPolicyDocument(staff, "prop2");
    const prop3Doc = await createPolicyDocument(staff, "prop3");
    const veh1Doc = await createPolicyDocument(staff, "veh1");

    const prop1 = await createManualCandidate(
      staff,
      `approve-v2-prop1-${crypto.randomUUID()}`,
      prop1Doc,
      "property",
      {
        displayLabel: "Principal residence",
        identity: {
          fullAddress: "123 Oak St",
          city: "Calgary",
          province: "AB",
          postalCode: "T2A 1A1",
          yearBuilt: 2010,
          fingerprint: "prop1",
        },
        currentPolicy: {
          insurerName: "ABC Home",
          annualPremiumCents: 120000,
          effectiveDate: "2025-01-01",
          expiryDate: "2026-01-01",
        },
        currentCoverage: { dwellingLimitCents: 50000000, baseDeductibleCents: 100000 },
        mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 50000000 } },
      },
    );

    const prop2 = await createManualCandidate(
      staff,
      `approve-v2-prop2-${crypto.randomUUID()}`,
      prop2Doc,
      "property",
      {
        displayLabel: "Rental condo",
        identity: {
          fullAddress: "456 Rental Ave",
          city: "Calgary",
          province: "AB",
          postalCode: "T2B 2B2",
          fingerprint: "prop2",
        },
        currentPolicy: { insurerName: "Rental Insure", annualPremiumCents: 90000 },
        currentCoverage: { dwellingLimitCents: 30000000 },
        mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 30000000 } },
      },
    );

    const prop3 = await createManualCandidate(
      staff,
      `approve-v2-prop3-${crypto.randomUUID()}`,
      prop3Doc,
      "property",
      {
        displayLabel: "Cottage",
        identity: {
          fullAddress: "789 Lake Rd",
          city: "Canmore",
          province: "AB",
          postalCode: "T1W 1A1",
          fingerprint: "prop3",
        },
        currentPolicy: { insurerName: "Cottage Co", annualPremiumCents: 60000 },
        currentCoverage: { dwellingLimitCents: 25000000 },
        mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 25000000 } },
      },
    );

    const veh1 = await createManualCandidate(
      staff,
      `approve-v2-veh1-${crypto.randomUUID()}`,
      veh1Doc,
      "vehicle",
      {
        displayLabel: "2020 Honda Civic",
        identity: {
          year: 2020,
          make: "Honda",
          model: "Civic",
          vin: "1HGFC2F59HA123456",
          fingerprint: "veh1",
        },
        currentPolicy: { insurerName: "Auto Plus", annualPremiumCents: 140000 },
        currentCoverage: { thirdPartyLiabilityCents: 200000000, collisionDeductibleCents: 50000 },
        mandateSuggestions: { thirdPartyLiability: { rule: "minimum", amountCents: 200000000 } },
      },
    );

    const clientRequestId = `approve-all-${crypto.randomUUID()}`;
    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: DEMO_HOUSEHOLD_ID,
      p_actor_profile_id: DEMO_CUSTOMER_ID,
      p_client_request_id: clientRequestId,
      p_decisions: [
        { candidate_id: prop1, decision: "approve_new" },
        { candidate_id: prop2, decision: "approve_new" },
        { candidate_id: prop3, decision: "approve_new" },
        { candidate_id: veh1, decision: "approve_new" },
      ],
    });

    expect(error).toBeNull();
    expect(data?.success).toBe(true);
    expect(data?.properties?.length).toBe(3);
    expect(data?.vehicles?.length).toBe(1);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const { data: properties } = await admin
      .from("properties")
      .select("id")
      .eq("household_id", DEMO_HOUSEHOLD_ID);
    const { data: vehicles } = await admin
      .from("vehicles")
      .select("id")
      .eq("household_id", DEMO_HOUSEHOLD_ID);
    const { data: policies } = await admin
      .from("policies")
      .select("id")
      .eq("household_id", DEMO_HOUSEHOLD_ID);
    expect(data?.properties?.length).toBe(3);
    expect(data?.vehicles?.length).toBe(1);
    expect(properties?.length).toBeGreaterThanOrEqual(3);
    expect(vehicles?.length).toBeGreaterThanOrEqual(1);
    expect(policies?.length).toBeGreaterThanOrEqual(1);

    // Idempotent second call returns the same ids.
    const { data: data2, error: err2 } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: DEMO_HOUSEHOLD_ID,
      p_actor_profile_id: DEMO_CUSTOMER_ID,
      p_client_request_id: clientRequestId,
      p_decisions: [{ candidate_id: prop1, decision: "approve_new" }],
    });
    expect(err2).toBeNull();
    expect(data2?.properties).toEqual(data?.properties);
    expect(data2?.vehicles).toEqual(data?.vehicles);
  });

  it("skips a candidate and links to an existing asset", async () => {
    const staff = await getAdminClient();
    const customer = await getCustomerClient();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });

    // Use the seed property as an existing asset to link.
    const existingPropertyId = "23000000-0000-0000-0000-000000000001";

    const skipDoc = await createPolicyDocument(staff, "skip");
    const linkDoc = await createPolicyDocument(staff, "link");

    const skipCandidate = await createManualCandidate(
      staff,
      `skip-${crypto.randomUUID()}`,
      skipDoc,
      "vehicle",
      {
        displayLabel: "Skip me",
        identity: { year: 2015, make: "Ford", model: "F-150", fingerprint: "skip" },
        currentPolicy: { insurerName: "Old Auto", annualPremiumCents: 100000 },
        currentCoverage: {},
        mandateSuggestions: {},
      },
    );

    const linkCandidate = await createManualCandidate(
      staff,
      `link-${crypto.randomUUID()}`,
      linkDoc,
      "property",
      {
        displayLabel: "Link to existing",
        identity: {
          fullAddress: "999 Existing Rd",
          city: "Calgary",
          province: "AB",
          postalCode: "T9Z 9Z9",
          fingerprint: "link",
        },
        currentPolicy: { insurerName: "Linked Insurer", annualPremiumCents: 80000 },
        currentCoverage: { dwellingLimitCents: 40000000 },
        mandateSuggestions: { dwelling: { rule: "minimum", amountCents: 40000000 } },
      },
    );

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: DEMO_HOUSEHOLD_ID,
      p_actor_profile_id: DEMO_CUSTOMER_ID,
      p_client_request_id: `skip-link-${crypto.randomUUID()}`,
      p_decisions: [
        { candidate_id: skipCandidate, decision: "skip" },
        {
          candidate_id: linkCandidate,
          decision: "link_existing",
          existing_asset_id: existingPropertyId,
          existing_asset_type: "property",
        },
      ],
    });

    expect(error).toBeNull();
    expect(data?.skipped?.length).toBe(1);
    expect(data?.linked?.length).toBe(1);

    const { data: skipRow } = await admin
      .from("asset_candidates")
      .select("review_status, decision")
      .eq("id", skipCandidate)
      .single();
    expect(skipRow?.review_status).toBe("skipped");
    expect(skipRow?.decision).toBe("skip");

    const { data: linkRow } = await admin
      .from("asset_candidates")
      .select("review_status, decision, approved_asset_id, approved_asset_type")
      .eq("id", linkCandidate)
      .single();
    expect(linkRow?.review_status).toBe("approved");
    expect(linkRow?.decision).toBe("link_existing");
    expect(linkRow?.approved_asset_id).toBe(existingPropertyId);
    expect(linkRow?.approved_asset_type).toBe("property");
  });

  it("rejects approval when identity confirmation is required but not provided", async () => {
    const staff = await getAdminClient();
    const customer = await getCustomerClient();

    const doc = await createPolicyDocument(staff, "redacted");
    const redacted = await createManualCandidate(
      staff,
      `redacted-${crypto.randomUUID()}`,
      doc,
      "property",
      {
        displayLabel: "Redacted property",
        matchClassification: "new_identity_confirmation_required",
        identity: {
          fullAddress: "REDACTED",
          city: "Calgary",
          province: "AB",
          postalCode: "T0A 0A0",
          fingerprint: "redacted",
        },
        currentPolicy: { insurerName: "Redacted Insurer", annualPremiumCents: 110000 },
        currentCoverage: {},
        mandateSuggestions: {},
      },
    );

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: DEMO_HOUSEHOLD_ID,
      p_actor_profile_id: DEMO_CUSTOMER_ID,
      p_client_request_id: `redacted-${crypto.randomUUID()}`,
      p_decisions: [{ candidate_id: redacted, decision: "approve_new" }],
    });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("approves a redacted candidate after identity confirmation", async () => {
    const staff = await getAdminClient();
    const customer = await getCustomerClient();

    const doc = await createPolicyDocument(staff, "confirmed");
    const confirmed = await createManualCandidate(
      staff,
      `confirmed-${crypto.randomUUID()}`,
      doc,
      "property",
      {
        displayLabel: "Confirmed property",
        matchClassification: "new_identity_confirmation_required",
        identity: {
          fullAddress: "321 Confirmed Ln",
          city: "Calgary",
          province: "AB",
          postalCode: "T3C 3C3",
          fingerprint: "confirmed",
        },
        currentPolicy: { insurerName: "Confirmed Insurer", annualPremiumCents: 130000 },
        currentCoverage: {},
        mandateSuggestions: {},
      },
    );

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: DEMO_HOUSEHOLD_ID,
      p_actor_profile_id: DEMO_CUSTOMER_ID,
      p_client_request_id: `confirmed-approve-${crypto.randomUUID()}`,
      p_decisions: [{ candidate_id: confirmed, decision: "approve_new", identity_confirmed: true }],
    });

    expect(error).toBeNull();
    expect(data?.properties?.length).toBe(1);
  });

  it("does not duplicate assets on concurrent approval retries", async () => {
    const staff = await getAdminClient();
    const customer = await getCustomerClient();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });

    const doc = await createPolicyDocument(staff, "concurrent");
    const candidate = await createManualCandidate(
      staff,
      `concurrent-${crypto.randomUUID()}`,
      doc,
      "property",
      {
        displayLabel: "Concurrent property",
        identity: {
          fullAddress: "555 Concurrent Cres",
          city: "Calgary",
          province: "AB",
          postalCode: "T5D 5D5",
          fingerprint: "concurrent",
        },
        currentPolicy: { insurerName: "Concurrent Insurer", annualPremiumCents: 150000 },
        currentCoverage: {},
        mandateSuggestions: {},
      },
    );

    const clientRequestId = `concurrent-${crypto.randomUUID()}`;
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        customer.rpc("approve_candidate_assets_v2" as any, {
          p_household_id: DEMO_HOUSEHOLD_ID,
          p_actor_profile_id: DEMO_CUSTOMER_ID,
          p_client_request_id: clientRequestId,
          p_decisions: [{ candidate_id: candidate, decision: "approve_new" }],
        }),
      ),
    );

    for (const r of results) {
      expect(r.error).toBeNull();
      expect(r.data?.properties?.length).toBe(1);
    }

    const uniquePropertyIds = new Set(results.map((r) => r.data?.properties?.[0]));
    expect(uniquePropertyIds.size).toBe(1);

    const { data: properties } = await admin
      .from("properties")
      .select("id")
      .eq("household_id", DEMO_HOUSEHOLD_ID);
    const matching = properties?.filter((p: any) => uniquePropertyIds.has(p.id));
    expect(matching?.length).toBe(1);
  });
});
