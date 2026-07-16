import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HouseholdCoverageMandateV2,
  type HouseholdCoverageMandateV2 as HouseholdCoverageMandateV2Type,
  SwitchingPreferencesV2,
  type SwitchingPreferencesRow,
  createDefaultHouseholdCoverageMandateV2,
  createDefaultSwitchingPreferencesV2,
  expandedUnversionedMandateToV2,
  resolvePropertyMandateV2,
  resolveVehicleMandateV2,
  switchingRowToDomain,
} from "@autopilot/schemas";
import type { Database, Json } from "./database.types";

export class MandateLoadError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly resource: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "MandateLoadError";
  }
}

export class MandateValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: { path: (string | number)[]; message: string }[],
  ) {
    super(message);
    this.name = "MandateValidationError";
  }
}

type PostgrestError = { message: string; code?: string; details?: string };

function isNoRowsError(error: PostgrestError): boolean {
  return error.code === "PGRST116";
}

function throwIfError(error: PostgrestError | null, operation: string, resource: string): void {
  if (!error) return;
  throw new MandateLoadError(
    `Database error during ${operation} on ${resource}: ${error.message}`,
    operation,
    resource,
    error.code ?? "UNKNOWN",
  );
}

function canonicalizeStoredMonetaryRules(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(canonicalizeStoredMonetaryRules);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.rule === "string") {
      const out: Record<string, unknown> = { rule: obj.rule };
      if (obj.rule === "minimum" || obj.rule === "maximum" || obj.rule === "exact") {
        if (obj.amountCents !== undefined) {
          out.amountCents = obj.amountCents;
        } else if (obj.cents !== undefined) {
          out.amountCents = obj.cents;
        }
      }
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = canonicalizeStoredMonetaryRules(v);
    }
    return out;
  }
  return value;
}

function validateMandate(mandate: unknown): HouseholdCoverageMandateV2Type {
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

export interface CurrentV2Mandate {
  mandateId: string;
  mandateVersion: number;
  mandate: HouseholdCoverageMandateV2Type;
  switchingPreferencesId: string;
  switchingVersion: number;
  switching: SwitchingPreferencesV2;
}

export interface MandateLoadResult {
  source: "v2" | "legacy_projection";
  mandate: HouseholdCoverageMandateV2Type;
  switching: SwitchingPreferencesV2;
  versions: { mandateVersion: number; switchingVersion: number };
  mandateId?: string;
  switchingPreferencesId?: string;
}

export interface SaveMandateV2Request {
  householdId: string;
  expectedMandateVersion: number;
  expectedSwitchingVersion: number;
  mandate: HouseholdCoverageMandateV2Type;
  switching: SwitchingPreferencesV2;
  createdBy?: string;
}

export interface SaveMandateV2Result {
  success: boolean;
  code?: string;
  message?: string;
  mandateVersion?: number;
  switchingVersion?: number;
}

async function loadSwitching(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<{ id: string | null; switching: SwitchingPreferencesV2; version: number }> {
  const { data, error } = await supabase
    .from("switching_preferences")
    .select("*")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (isNoRowsError(error)) {
      return { id: null, switching: createDefaultSwitchingPreferencesV2(), version: 0 };
    }
    throwIfError(error, "loadSwitching", "switching_preferences");
  }

  if (!data) {
    return { id: null, switching: createDefaultSwitchingPreferencesV2(), version: 0 };
  }

  return {
    id: data.id,
    switching: switchingRowToDomain(data as unknown as SwitchingPreferencesRow),
    version: data.version,
  };
}

async function loadV2Mandate(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<{ id: string; version: number; mandate: HouseholdCoverageMandateV2Type } | null> {
  const { data, error } = await supabase
    .from("household_coverage_mandates")
    .select("*")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .single();

  if (error) {
    if (isNoRowsError(error)) return null;
    throwIfError(error, "loadV2Mandate", "household_coverage_mandates");
  }

  if (!data) return null;

  const [vehicleOverridesResult, propertyOverridesResult] = await Promise.all([
    supabase.from("vehicle_mandate_overrides").select("*").eq("mandate_id", data.id),
    supabase.from("property_mandate_overrides").select("*").eq("mandate_id", data.id),
  ]);

  throwIfError(vehicleOverridesResult.error, "loadV2Mandate", "vehicle_mandate_overrides");
  throwIfError(propertyOverridesResult.error, "loadV2Mandate", "property_mandate_overrides");

  const vehicleOverrides = (vehicleOverridesResult.data ?? []).map((row) => ({
    vehicleId: row.vehicle_id,
    values: canonicalizeStoredMonetaryRules(row.override_values as unknown),
  }));

  const propertyOverrides = (propertyOverridesResult.data ?? []).map((row) => ({
    propertyId: row.property_id,
    values: canonicalizeStoredMonetaryRules(row.override_values as unknown),
  }));

  const mandate = validateMandate({
    schemaVersion: 2,
    jurisdiction: data.jurisdiction,
    version: data.version,
    effectiveFrom: new Date(data.effective_from).toISOString(),
    householdAutoDefaults: canonicalizeStoredMonetaryRules(data.household_auto_defaults as unknown),
    householdPropertyDefaults: canonicalizeStoredMonetaryRules(
      data.household_property_defaults as unknown,
    ),
    vehicleOverrides,
    propertyOverrides,
  });

  return { id: data.id, version: data.version, mandate };
}

async function loadLegacyMandate(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<{ mandate: HouseholdCoverageMandateV2Type; version: number } | null> {
  const { data, error } = await supabase
    .from("coverage_requirements")
    .select("*")
    .eq("household_id", householdId)
    .eq("is_current", true)
    .single();

  if (error) {
    if (isNoRowsError(error)) return null;
    throwIfError(error, "loadLegacyMandate", "coverage_requirements");
  }

  if (!data) return null;

  const converted = expandedUnversionedMandateToV2(
    {
      auto_requirements: data.auto_requirements as Record<string, unknown>,
      property_requirements: data.property_requirements as Record<string, unknown>,
      vehicle_mandates: data.vehicle_mandates as Record<string, unknown>,
      property_mandates: data.property_mandates as Record<string, unknown>,
    },
    data.version,
    new Date().toISOString(),
  );

  return { mandate: validateMandate(converted), version: data.version };
}

export async function loadCurrentV2Mandate(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<CurrentV2Mandate | null> {
  const [mandateResult, switching] = await Promise.all([
    loadV2Mandate(supabase, householdId),
    loadSwitching(supabase, householdId),
  ]);

  if (!mandateResult) return null;

  if (!switching.id) {
    throw new MandateLoadError(
      "Current mandate exists but switching preferences are missing",
      "loadCurrentV2Mandate",
      "switching_preferences",
      "MISSING_SWITCHING",
    );
  }

  return {
    mandateId: mandateResult.id,
    mandateVersion: mandateResult.version,
    mandate: mandateResult.mandate,
    switchingPreferencesId: switching.id,
    switchingVersion: switching.version,
    switching: switching.switching,
  };
}

export async function loadHouseholdMandateV2(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<MandateLoadResult> {
  const [v2, switching] = await Promise.all([
    loadV2Mandate(supabase, householdId),
    loadSwitching(supabase, householdId),
  ]);

  if (v2) {
    return {
      source: "v2",
      mandate: v2.mandate,
      switching: switching.switching,
      versions: { mandateVersion: v2.version, switchingVersion: switching.version },
      mandateId: v2.id,
      switchingPreferencesId: switching.id ?? undefined,
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
  HouseholdCoverageMandateV2.parse(request.mandate);
  const switchingValidated = SwitchingPreferencesV2.parse(request.switching);

  const { data, error } = await supabase.rpc("persist_household_mandate_v2", {
    p_household_id: request.householdId,
    p_expected_mandate_version: request.expectedMandateVersion,
    p_expected_switching_version: request.expectedSwitchingVersion,
    p_household_auto_defaults: request.mandate.householdAutoDefaults as unknown as Json,
    p_household_property_defaults: request.mandate.householdPropertyDefaults as unknown as Json,
    p_vehicle_overrides: request.mandate.vehicleOverrides as unknown as Json,
    p_property_overrides: request.mandate.propertyOverrides as unknown as Json,
    p_switching_preferences: switchingValidated as unknown as Json,
    p_jurisdiction: request.mandate.jurisdiction,
    p_created_by: request.createdBy,
  });

  if (error) {
    if (error.message?.includes("STALE_VERSION")) {
      return { success: false, code: "STALE_VERSION", message: error.message };
    }
    if (error.message?.includes("Unauthorized")) {
      return { success: false, code: "UNAUTHORIZED", message: error.message };
    }
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
  mandate: HouseholdCoverageMandateV2Type,
  vehicleId: string,
): HouseholdCoverageMandateV2Type["householdAutoDefaults"] {
  const override = mandate.vehicleOverrides.find((o) => o.vehicleId === vehicleId);
  return resolveVehicleMandateV2(mandate.householdAutoDefaults, override);
}

export function resolveEffectivePropertyMandateV2(
  mandate: HouseholdCoverageMandateV2Type,
  propertyId: string,
): HouseholdCoverageMandateV2Type["householdPropertyDefaults"] {
  const override = mandate.propertyOverrides.find((o) => o.propertyId === propertyId);
  return resolvePropertyMandateV2(mandate.householdPropertyDefaults, override);
}

export {
  createDefaultHouseholdCoverageMandateV2,
  createDefaultSwitchingPreferencesV2,
  updateVehicleOverrideV2,
  updatePropertyOverrideV2,
  clearVehicleOverrideV2,
  clearPropertyOverrideV2,
} from "@autopilot/schemas";
