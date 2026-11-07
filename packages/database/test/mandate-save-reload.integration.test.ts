import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  createDefaultHouseholdCoverageMandateV2,
  createDefaultSwitchingPreferencesV2,
  updateVehicleOverrideV2,
} from "@autopilot/schemas";
import { loadHouseholdMandateV2, saveHouseholdMandateV2 } from "../src/mandate-repository";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
// Fallback is Supabase's public demo service-role JWT for local dev stacks
// (iss "supabase-demo") — not a real secret, local use only.
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Demo household seeded by supabase/seed.sql.
const DEMO_HOUSEHOLD_ID = "20000000-0000-0000-0000-000000000001";
const DEMO_VEHICLE_ID = "22000000-0000-0000-0000-000000000001";

describe("mandate save/reload integration", () => {
  it("saves and reloads a versioned mandate atomically", async () => {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const mandate = updateVehicleOverrideV2(
      createDefaultHouseholdCoverageMandateV2(),
      DEMO_VEHICLE_ID,
      {
        liability: { rule: "minimum", amountCents: 25_000_000 },
      },
    );
    const switching = createDefaultSwitchingPreferencesV2();

    const saveResult = await saveHouseholdMandateV2(supabase, {
      householdId: DEMO_HOUSEHOLD_ID,
      expectedMandateVersion: 1,
      expectedSwitchingVersion: 1,
      mandate,
      switching,
    });

    expect(saveResult.success).toBe(true);
    expect(saveResult.mandateVersion).toBeGreaterThan(0);
    expect(saveResult.switchingVersion).toBeGreaterThan(0);

    const loadResult = await loadHouseholdMandateV2(supabase, DEMO_HOUSEHOLD_ID);

    expect(loadResult.mandate.schemaVersion).toBe(2);
    expect(loadResult.mandate.householdAutoDefaults.liability).toEqual({
      rule: "minimum",
      amountCents: 200_000_000,
    });

    const vehicleOverride = loadResult.mandate.vehicleOverrides.find(
      (o) => o.vehicleId === DEMO_VEHICLE_ID,
    );
    expect(vehicleOverride?.values.liability).toEqual({
      rule: "minimum",
      amountCents: 25_000_000,
    });

    expect(loadResult.switching.customerApprovalRequired).toBe(true);
    expect(loadResult.switching.materialCoverageReductionsAllowed).toBe(false);
  });

  it("rejects a stale version with STALE_VERSION", async () => {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const staleSave = await saveHouseholdMandateV2(supabase, {
      householdId: DEMO_HOUSEHOLD_ID,
      expectedMandateVersion: 0,
      expectedSwitchingVersion: 1,
      mandate: createDefaultHouseholdCoverageMandateV2(),
      switching: createDefaultSwitchingPreferencesV2(),
    });

    expect(staleSave.success).toBe(false);
    expect(staleSave.code).toBe("STALE_VERSION");
  });
});
