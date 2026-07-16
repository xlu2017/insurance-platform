import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HouseholdCoverageMandateV2,
  type SwitchingPreferencesV2,
  type SwitchingPreferencesRow,
  createDefaultHouseholdCoverageMandateV2,
  createDefaultSwitchingPreferencesV2,
  expandedUnversionedMandateToV2,
  switchingRowToDomain,
} from "@autopilot/schemas";
import type { Database, Json } from "./database.types";

export class MandateValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: { path: (string | number)[]; message: string }[],
  ) {
    super(message);
    this.name = "MandateValidationError";
  }
}

export interface MandateLoadResult {
  source: "v2" | "legacy_projection";
  mandate: HouseholdCoverageMandateV2;
  switching: SwitchingPreferencesV2;
  versions: { mandateVersion: number; switchingVersion: number };
}

export interface SaveMandateV2Request {
  householdId: string;
  expectedMandateVersion: number;
  expectedSwitchingVersion: number;
  mandate: HouseholdCoverageMandateV2;
  switching: SwitchingPreferencesV2;
}

export interface SaveMandateV2Result {
  success: boolean;
  code?: string;
  message?: string;
  mandateVersion?: number;
  switchingVersion?: number;
}

// Normalize a stored monetary rule. V2 persisted records may use `amountCents`,
// while legacy records use `cents`.
function normalizeStoredMonetaryRule(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if ("rule" in obj && typeof obj.rule === "string") {
    const out: Record<string, unknown> = { rule: obj.rule };
    if ("amountCents" in obj && obj.amountCents !== undefined) {
      out.cents = obj.amountCents;
    } else if ("cents" in obj && obj.cents !== undefined) {
      out.cents = obj.cents;
    }
    return out;
  }
  return value;
}

function normalizeStoredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeStoredValue);
  }
  if (value && typeof value === "object") {
    const normalized = normalizeStoredMonetaryRule(value);
    if (normalized !== value) return normalized;
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = normalizeStoredValue(v);
    }
    return out;
  }
  return value;
}

function validateMandate(mandate: unknown): HouseholdCoverageMandateV2 {
  const parsed = HouseholdCoverageMandateV2.safeParse(mandate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
    }));
    throw new MandateValidationError("Stored mandate is invalid", issues);
  }
  return parsed.data;
}

async function loadSwitching(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<{ switching: SwitchingPreferencesV2; version: number }> {
  const { data, error } = await supabase
    .from("switching_preferences")
    .select("*")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return { switching: createDefaultSwitchingPreferencesV2(), version: 0 };
  }

  return {
    switching: switchingRowToDomain(data as unknown as SwitchingPreferencesRow),
    version: data.version,
  };
}

async function loadV2Mandate(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<{ mandate: HouseholdCoverageMandateV2; version: number } | null> {
  const { data, error } = await supabase
    .from("household_coverage_mandates")
    .select("*")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .single();

  if (error || !data) return null;

  const [vehicleOverridesResult, propertyOverridesResult] = await Promise.all([
    supabase.from("vehicle_mandate_overrides").select("*").eq("mandate_id", data.id),
    supabase.from("property_mandate_overrides").select("*").eq("mandate_id", data.id),
  ]);

  const vehicleMandates: Record<string, unknown> = {};
  for (const row of vehicleOverridesResult.data ?? []) {
    vehicleMandates[row.vehicle_id] = normalizeStoredValue(row.override_values as unknown);
  }

  const propertyMandates: Record<string, unknown> = {};
  for (const row of propertyOverridesResult.data ?? []) {
    propertyMandates[row.property_id] = normalizeStoredValue(row.override_values as unknown);
  }

  const coverage = {
    auto_requirements: normalizeStoredValue(data.household_auto_defaults as unknown),
    property_requirements: normalizeStoredValue(data.household_property_defaults as unknown),
    vehicle_mandates: vehicleMandates,
    property_mandates: propertyMandates,
  };

  const effectiveFrom = new Date(data.effective_from).toISOString();
  const converted = expandedUnversionedMandateToV2(coverage, data.version, effectiveFrom);
  return { mandate: validateMandate(converted), version: data.version };
}

async function loadLegacyMandate(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<{ mandate: HouseholdCoverageMandateV2; version: number } | null> {
  const { data, error } = await supabase
    .from("coverage_requirements")
    .select("*")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .single();

  if (error || !data) return null;

  const converted = expandedUnversionedMandateToV2(
    {
      auto_requirements: normalizeStoredValue(data.auto_requirements as unknown),
      property_requirements: normalizeStoredValue(data.property_requirements as unknown),
      vehicle_mandates: normalizeStoredValue(data.vehicle_mandates as unknown),
      property_mandates: normalizeStoredValue(data.property_mandates as unknown),
    },
    data.version,
    new Date().toISOString(),
  );
  return { mandate: validateMandate(converted), version: data.version };
}

export async function loadHouseholdMandateV2(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<MandateLoadResult> {
  const switching = await loadSwitching(supabase, householdId);

  const v2 = await loadV2Mandate(supabase, householdId);
  if (v2) {
    return {
      source: "v2",
      mandate: v2.mandate,
      switching: switching.switching,
      versions: { mandateVersion: v2.version, switchingVersion: switching.version },
    };
  }

  const legacy = await loadLegacyMandate(supabase, householdId);
  if (legacy) {
    return {
      source: "legacy_projection",
      mandate: legacy.mandate,
      switching: switching.switching,
      versions: { mandateVersion: legacy.version, switchingVersion: switching.version },
    };
  }

  return {
    source: "legacy_projection",
    mandate: createDefaultHouseholdCoverageMandateV2(),
    switching: switching.switching,
    versions: { mandateVersion: 0, switchingVersion: switching.version },
  };
}

export async function saveHouseholdMandateV2(
  supabase: SupabaseClient<Database>,
  request: SaveMandateV2Request,
): Promise<SaveMandateV2Result> {
  const { data, error } = await supabase.rpc("save_household_mandate_v2", {
    p_household_id: request.householdId,
    p_expected_mandate_version: request.expectedMandateVersion,
    p_expected_switching_version: request.expectedSwitchingVersion,
    p_household_auto_defaults: request.mandate.householdAutoDefaults as unknown as Json,
    p_household_property_defaults: request.mandate.householdPropertyDefaults as unknown as Json,
    p_vehicle_overrides: request.mandate.vehicleOverrides as unknown as Json,
    p_property_overrides: request.mandate.propertyOverrides as unknown as Json,
    p_switching_preferences: request.switching as unknown as Json,
    p_jurisdiction: request.mandate.jurisdiction,
    p_effective_from: request.mandate.effectiveFrom,
  });

  if (error) {
    throw error;
  }

  const result = (data ?? {}) as Record<string, unknown>;
  if (result.success === true) {
    return {
      success: true,
      mandateVersion: Number(result.mandateVersion ?? 0),
      switchingVersion: Number(result.switchingVersion ?? 0),
    };
  }

  return {
    success: false,
    code: String(result.code ?? "UNKNOWN"),
    message: String(result.message ?? ""),
  };
}

export function resolveEffectiveVehicleMandateV2(
  mandate: HouseholdCoverageMandateV2,
  vehicleId: string,
): HouseholdCoverageMandateV2["householdAutoDefaults"] {
  const override = mandate.vehicleOverrides.find((o) => o.vehicleId === vehicleId);
  return resolveVehicleMandateV2(mandate.householdAutoDefaults, override);
}

export function resolveEffectivePropertyMandateV2(
  mandate: HouseholdCoverageMandateV2,
  propertyId: string,
): HouseholdCoverageMandateV2["householdPropertyDefaults"] {
  const override = mandate.propertyOverrides.find((o) => o.propertyId === propertyId);
  return resolvePropertyMandateV2(mandate.householdPropertyDefaults, override);
}

// Re-export schema helpers used by consumers.
export {
  createDefaultHouseholdCoverageMandateV2,
  createDefaultSwitchingPreferencesV2,
  updateVehicleOverrideV2,
  updatePropertyOverrideV2,
  clearVehicleOverrideV2,
  clearPropertyOverrideV2,
} from "@autopilot/schemas";

import { resolveVehicleMandateV2, resolvePropertyMandateV2 } from "@autopilot/schemas";
