import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createDefaultHouseholdCoverageMandateV2,
  createDefaultSwitchingPreferencesV2,
  updateVehicleOverrideV2,
} from "@autopilot/schemas";
import {
  assertLocalSupabase,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY,
  LOCAL_SUPABASE_URL,
} from "@autopilot/test-fixtures";
import { loadHouseholdMandateV2, saveHouseholdMandateV2 } from "../src/mandate-repository";

const SUPABASE_URL = process.env.SUPABASE_URL ?? LOCAL_SUPABASE_URL;
const SERVICE_ROLE_KEY = LOCAL_SUPABASE_SERVICE_ROLE_KEY;

const CUSTOMER_ID = "00000000-0000-0000-0000-000000000001";

describe("mandate save/reload integration", () => {
  const createdHouseholdIds: string[] = [];

  beforeAll(() => {
    assertLocalSupabase(SUPABASE_URL);
  });

  afterEach(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    for (const householdId of createdHouseholdIds) {
      const { data: mandates } = await admin
        .from("household_coverage_mandates")
        .select("id")
        .eq("household_id", householdId);
      const mandateIds = (mandates ?? []).map((m) => m.id);
      if (mandateIds.length > 0) {
        await admin.from("vehicle_mandate_overrides").delete().in("mandate_id", mandateIds);
      }
      await admin.from("household_coverage_mandates").delete().eq("household_id", householdId);
      await admin.from("switching_preferences").delete().eq("household_id", householdId);
      await admin.from("audit_events").delete().eq("household_id", householdId);
      await admin.from("vehicles").delete().eq("household_id", householdId);
      await admin.from("household_members").delete().eq("household_id", householdId);
      await admin.from("households").delete().eq("id", householdId);
    }
    createdHouseholdIds.length = 0;
  });

  async function setupHouseholdAndVehicle(): Promise<{ householdId: string; vehicleId: string }> {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const householdId = `a0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    const vehicleId = `b0000000-0000-0000-0000-${randomUUID().slice(-12)}`;
    createdHouseholdIds.push(householdId);

    const { error: householdError } = await admin.from("households").insert({
      id: householdId,
      owner_profile_id: CUSTOMER_ID,
      name: "Mandate Test Household",
      province: "AB",
      autopilot_active: false,
      onboarding_step: "complete",
    });
    if (householdError) throw householdError;
    const { error: memberError } = await admin
      .from("household_members")
      .insert({ household_id: householdId, profile_id: CUSTOMER_ID, member_role: "owner" });
    if (memberError) throw memberError;
    const { error: vehicleError } = await admin.from("vehicles").insert({
      id: vehicleId,
      household_id: householdId,
      year: 2020,
      make: "Test",
      model: "Vehicle",
      primary_use: "commute",
      created_by: CUSTOMER_ID,
      updated_by: CUSTOMER_ID,
    });
    if (vehicleError) throw vehicleError;

    return { householdId, vehicleId };
  }

  it("saves and reloads a versioned mandate atomically using the actual initial versions", async () => {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const { householdId, vehicleId } = await setupHouseholdAndVehicle();

    const initial = await loadHouseholdMandateV2(supabase, householdId);

    const mandate = updateVehicleOverrideV2(createDefaultHouseholdCoverageMandateV2(), vehicleId, {
      liability: { rule: "minimum", amountCents: 25_000_000 },
    });
    const switching = createDefaultSwitchingPreferencesV2();

    const saveResult = await saveHouseholdMandateV2(supabase, {
      householdId,
      expectedMandateVersion: initial.versions.mandateVersion,
      expectedSwitchingVersion: initial.versions.switchingVersion,
      mandate,
      switching,
      createdBy: CUSTOMER_ID,
    });

    expect(saveResult.success).toBe(true);
    expect(saveResult.mandateVersion).toBe(initial.versions.mandateVersion + 1);
    expect(saveResult.switchingVersion).toBe(initial.versions.switchingVersion + 1);

    const loadResult = await loadHouseholdMandateV2(supabase, householdId);

    expect(loadResult.mandate.schemaVersion).toBe(2);
    expect(loadResult.mandate.householdAutoDefaults.liability).toEqual({
      rule: "minimum",
      amountCents: 200_000_000,
    });

    const vehicleOverride = loadResult.mandate.vehicleOverrides.find(
      (o) => o.vehicleId === vehicleId,
    );
    expect(vehicleOverride?.values.liability).toEqual({
      rule: "minimum",
      amountCents: 25_000_000,
    });

    expect(loadResult.switching.customerApprovalRequired).toBe(true);
    expect(loadResult.switching.materialCoverageReductionsAllowed).toBe(false);
  });

  it("rejects a stale version with STALE_VERSION", async () => {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    });
    const { householdId } = await setupHouseholdAndVehicle();

    const initial = await loadHouseholdMandateV2(supabase, householdId);
    const saveResult = await saveHouseholdMandateV2(supabase, {
      householdId,
      expectedMandateVersion: initial.versions.mandateVersion,
      expectedSwitchingVersion: initial.versions.switchingVersion,
      mandate: createDefaultHouseholdCoverageMandateV2(),
      switching: createDefaultSwitchingPreferencesV2(),
      createdBy: CUSTOMER_ID,
    });
    expect(saveResult.success).toBe(true);

    const staleSave = await saveHouseholdMandateV2(supabase, {
      householdId,
      expectedMandateVersion: initial.versions.mandateVersion,
      expectedSwitchingVersion: initial.versions.switchingVersion + 1,
      mandate: createDefaultHouseholdCoverageMandateV2(),
      switching: createDefaultSwitchingPreferencesV2(),
      createdBy: CUSTOMER_ID,
    });

    expect(staleSave.success).toBe(false);
    expect(staleSave.code).toBe("STALE_VERSION");
  });
});
