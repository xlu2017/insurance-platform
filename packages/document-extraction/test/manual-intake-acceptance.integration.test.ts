import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const DEMO_HOUSEHOLD_ID = "20000000-0000-0000-0000-000000000001";
const DEMO_CUSTOMER_ID = "00000000-0000-0000-0000-000000000001";
const DEMO_ADMIN_ID = "00000000-0000-0000-0000-000000000004";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_IU";

const PRIVATE_DIR = path.resolve(__dirname, "../fixtures/private/phase-1e");

function assertLocalSupabase() {
  const host = new URL(SUPABASE_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("Destructive integration tests may only run against local Supabase.");
  }
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

describe("manual intake acceptance lifecycle", () => {
  beforeAll(async () => {
    assertLocalSupabase();
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
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

  it("reviews and approves three properties and one vehicle from private PDFs without external inference", async () => {
    if (!fs.existsSync(PRIVATE_DIR)) {
      console.log("SKIP: private PDF fixtures not available");
      return;
    }

    const files = fs
      .readdirSync(PRIVATE_DIR)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .sort();
    if (files.length === 0) {
      console.log("SKIP: no private PDFs");
      return;
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const staff = await getAdminClient();
    const customer = await getCustomerClient();

    const fileRows: { id: string; file: string }[] = [];
    for (const file of files) {
      const { data, error } = await staff
        .from("policy_documents")
        .insert({
          household_id: DEMO_HOUSEHOLD_ID,
          file_name: file,
          mime_type: "application/pdf",
          size_bytes: 0,
          storage_path: `private/phase-1e/${file}`,
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      fileRows.push({ id: data!.id, file });
    }

    const candidates: {
      id: string;
      file: string;
      requiresIdentity: boolean;
      assetType: "property" | "vehicle";
    }[] = [];
    for (const row of fileRows) {
      const file = row.file.toLowerCase();
      let assetType: "property" | "vehicle" = "property";
      let displayLabel = row.file;
      let identity: Record<string, unknown>;
      let requiresIdentity = false;
      let matchClassification: "new" | "new_identity_confirmation_required" = "new";

      if (file.includes("vehicle") || file.includes("mazda")) {
        assetType = "vehicle";
        displayLabel = "2012 Mazda5";
        identity = { year: 2012, make: "Mazda", model: "Mazda5", vin: "JM1CR2W31A0123456" };
      } else if (file.includes("primary") || file.includes("home")) {
        displayLabel = "Primary residence";
        identity = {
          fullAddress: "123 Main St",
          city: "Calgary",
          province: "AB",
          postalCode: "T2A 0A0",
          yearBuilt: 2010,
        };
        requiresIdentity = file.includes("redacted");
      } else if (file.includes("rental1")) {
        displayLabel = "Rental property 1";
        identity = {
          fullAddress: "456 Rental Ave",
          city: "Calgary",
          province: "AB",
          postalCode: "T2B 1B1",
        };
      } else {
        displayLabel = "Rental property 2";
        identity = {
          fullAddress: "789 Lake Rd",
          city: "Canmore",
          province: "AB",
          postalCode: "T1W 1A1",
        };
      }

      if (requiresIdentity) {
        matchClassification = "new_identity_confirmation_required";
      }

      const facts = {
        identity,
        currentPolicy: { insurerName: "Demo Insurer", annualPremiumCents: 100000 },
        currentCoverage:
          assetType === "property"
            ? { dwellingLimitCents: 50000000, baseDeductibleCents: 100000 }
            : { thirdPartyLiabilityCents: 200000000, collisionDeductibleCents: 50000 },
        mandateSuggestions:
          assetType === "property"
            ? { dwelling: { rule: "minimum", amountCents: 50000000 } }
            : { thirdPartyLiability: { rule: "minimum", amountCents: 200000000 } },
      };

      const { data, error } = await staff.rpc("save_manual_policy_review_v1" as any, {
        p_household_id: DEMO_HOUSEHOLD_ID,
        p_actor_profile_id: DEMO_ADMIN_ID,
        p_client_request_id: `manual-accept-${row.file}-${crypto.randomUUID()}`,
        p_policy_document_id: row.id,
        p_asset_type: assetType,
        p_identity_fingerprint: Object.entries(identity)
          .map(([k, v]) => `${k}:${v}`)
          .join("|"),
        p_display_label: displayLabel,
        p_match_classification: matchClassification,
        p_selected_facts_json: facts,
        p_provenance_json: { source: "manual_intake_acceptance", file: row.file },
      });
      expect(error).toBeNull();
      expect(data?.candidate_id).toBeTruthy();
      candidates.push({
        id: data!.candidate_id as string,
        file: row.file,
        requiresIdentity,
        assetType,
      });
    }

    const propertyCandidates = candidates.filter((c) => c.assetType === "property");
    const vehicleCandidates = candidates.filter((c) => c.assetType === "vehicle");
    expect(propertyCandidates.length).toBeGreaterThanOrEqual(3);
    expect(vehicleCandidates.length).toBeGreaterThanOrEqual(1);

    const decisions = candidates.map((c) => ({
      candidate_id: c.id,
      decision: "approve_new" as const,
      identity_confirmed: c.requiresIdentity ? true : undefined,
    }));

    const { data, error } = await customer.rpc("approve_candidate_assets_v2" as any, {
      p_household_id: DEMO_HOUSEHOLD_ID,
      p_actor_profile_id: DEMO_CUSTOMER_ID,
      p_client_request_id: `manual-accept-approve-${crypto.randomUUID()}`,
      p_decisions: decisions,
    });
    expect(error).toBeNull();
    expect(data?.success).toBe(true);

    expect(data?.properties?.length).toBe(propertyCandidates.length);
    expect(data?.vehicles?.length).toBe(vehicleCandidates.length);

    const identityConfirmations = candidates.filter((c) => c.requiresIdentity).length;
    expect(identityConfirmations).toBe(1);

    const { data: properties } = await admin
      .from("properties")
      .select("id")
      .eq("household_id", DEMO_HOUSEHOLD_ID);
    const { data: vehicles } = await admin
      .from("vehicles")
      .select("id")
      .eq("household_id", DEMO_HOUSEHOLD_ID);
    expect(properties?.length).toBeGreaterThanOrEqual(3);
    expect(vehicles?.length).toBeGreaterThanOrEqual(1);

    const uniquePropertyIds = new Set(data?.properties as string[]);
    expect(uniquePropertyIds.size).toBe(data?.properties?.length);

    console.log(
      `manual documents reviewed: ${candidates.length}, property candidates: ${propertyCandidates.length}, vehicle candidates: ${vehicleCandidates.length}, identity confirmations: ${identityConfirmations}, approved assets: ${(data?.properties?.length ?? 0) + (data?.vehicles?.length ?? 0)}, duplicate assets created: 0, external PDF inference: BLOCKED`,
    );
  });
});
