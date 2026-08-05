import { supabase } from "@/lib/supabase";
import {
  autoCoverageFormOptions,
  formatCad,
  propertyCoverageFormOptions,
  propertySettlementOptions,
} from "@/lib/mandate";

type CoverageDetails = Record<string, unknown>;

export type CompareAssetType = "vehicle" | "property";

export interface CompareAsset {
  id: string;
  type: CompareAssetType;
  displayName: string;
  coverageDetails: CoverageDetails;
}

export interface CoverageSpec {
  key: string;
  label: string;
  format: "money" | "boolean" | "text" | "coverageForm" | "settlementBasis";
}

function extractValue(raw: unknown): unknown {
  if (raw !== null && typeof raw === "object" && "value" in raw) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

const KEY_ALIASES: Record<string, string[]> = {
  thirdPartyLiabilityCents: [
    "thirdPartyLiabilityLimitCents",
    "liabilityLimitCents",
    "liabilityLimit",
  ],
  collisionDeductibleCents: [
    "directCompensationPropertyDamageDeductibleCents",
    "collisionDeductibleCents",
  ],
  comprehensiveDeductibleCents: ["allPerilsDeductibleCents", "comprehensiveDeductibleCents"],
  baseDeductibleCents: ["baseDeductible"],
  dwellingLimitCents: ["dwellingBuildingLimit"],
  contentsLimitCents: ["personalPropertyLimitCents", "contentsLimit"],
  personalLiabilityLimitCents: ["personalLiabilityLimit"],
  additionalLivingExpenseLimitCents: [
    "additionalLivingExpensesLimitCents",
    "additionalLivingExpenseLimit",
  ],
  voluntaryMedicalPaymentsLimitCents: ["voluntaryMedicalPaymentsLimit"],
  voluntaryPropertyDamageLimitCents: ["voluntaryPropertyDamageLimit"],
  windHailDeductibleCents: ["windstormAndHailDeductibleCents", "windAndHailDeductible"],
  familyProtectionIncluded: ["familyProtectionEndorsement", "familyProtection"],
  collisionIncluded: ["collisionOrUpset", "collision"],
  comprehensiveIncluded: ["comprehensive", "allPerils", "specifiedPerils"],
  overlandWaterIncluded: ["waterDamageCoverage", "overlandWater"],
  sewerBackupIncluded: ["sewerBackup"],
  earthquakeIncluded: ["earthquake"],
  windHailIncluded: ["windstormAndHail", "windHail"],
  homeSystemsIncluded: ["homeSystems"],
  equipmentBreakdownIncluded: ["equipmentBreakdown"],
  serviceLineIncluded: ["serviceLine"],
  bylawCoverageIncluded: ["bylawCoverage"],
  cyberCoverageIncluded: ["cyberCoverage"],
  scheduledValuablesIncluded: ["scheduledValuables"],
  homeBusinessIncluded: ["homeBusiness"],
  shortTermRentalPermissionIncluded: ["shortTermRentalPermission"],
  claimsForgivenessIncluded: ["claimsForgiveness"],
  roadsideAssistanceIncluded: ["roadsideAssistance"],
  glassCoverageIncluded: ["glassCoverage"],
  accidentForgivenessIncluded: ["accidentForgiveness"],
  rentalVehicleCoverageIncluded: ["rentalVehicleCoverage"],
  nonOwnedAutomobileIncluded: ["nonOwnedAutomobile"],
  depreciationWaiverIncluded: ["depreciationWaiver"],
  oemPartsIncluded: ["oemParts"],
  disappearingDeductibleIncluded: ["disappearingDeductible"],
  telematicsRequired: ["telematics"],
};

function getCoverageState(details: CoverageDetails, key: string): string | undefined {
  const raw = details[key];
  if (raw !== null && typeof raw === "object" && "status" in raw) {
    return String((raw as { status: unknown }).status);
  }
  const state = (details._coverageState as Record<string, unknown> | undefined)?.[key];
  if (state !== undefined) return String(state);

  const aliases = KEY_ALIASES[key] ?? [];
  for (const alias of aliases) {
    const rawAlias = details[alias];
    if (rawAlias !== null && typeof rawAlias === "object" && "status" in rawAlias) {
      return String((rawAlias as { status: unknown }).status);
    }
    const aliasState = (details._coverageState as Record<string, unknown> | undefined)?.[alias];
    if (aliasState !== undefined) return String(aliasState);
  }
  return undefined;
}

function getValue(details: CoverageDetails, key: string): unknown {
  const direct = details[key];
  if (direct !== undefined && direct !== null) return extractValue(direct);

  const aliases = KEY_ALIASES[key] ?? [];
  for (const alias of aliases) {
    const raw = details[alias];
    if (raw !== undefined && raw !== null) return extractValue(raw);
  }

  if (key.endsWith("Cents")) {
    const alt = details[key.replace(/Cents$/, "")];
    if (alt !== undefined && alt !== null) return extractValue(alt);
  }
  if (key.endsWith("Included")) {
    const alt = details[key.replace(/Included$/, "")];
    if (alt !== undefined && alt !== null) return extractValue(alt);
  }
  return undefined;
}

function labelFor(options: { value: string; label: string }[], value: unknown): string {
  if (value === undefined || value === null) return "—";
  const str = String(value);
  return options.find((o) => o.value === str)?.label ?? str;
}

function formatValue(
  spec: CoverageSpec,
  raw: unknown,
  type?: CompareAssetType,
  state?: string,
): string {
  if (state === "not_included") return "Not included";
  if (state === "unknown") return "Unknown";
  if (state === "not_applicable") return "Not applicable";
  if (state === "conflicting") return "Needs review";

  if (raw === undefined || raw === null) return "—";

  if (spec.format === "money") {
    const num = typeof raw === "number" ? raw : Number(raw);
    if (Number.isNaN(num)) return "—";
    return formatCad(num);
  }

  if (spec.format === "boolean") {
    if (typeof raw === "boolean") return raw ? "Included" : "Not included";
    const str = String(raw).toLowerCase();
    if (["true", "yes", "included"].includes(str)) return "Included";
    if (["false", "no", "not included"].includes(str)) return "Not included";
    return labelFor(
      [
        { value: "true", label: "Included" },
        { value: "false", label: "Not included" },
      ],
      raw,
    );
  }

  if (spec.format === "coverageForm") {
    const options = type === "property" ? propertyCoverageFormOptions : autoCoverageFormOptions;
    return labelFor(options, raw);
  }

  if (spec.format === "settlementBasis") {
    return labelFor(propertySettlementOptions, raw);
  }

  return String(raw);
}

export function getCellValue(
  details: CoverageDetails,
  spec: CoverageSpec,
  type?: CompareAssetType,
): string {
  const raw = getValue(details, spec.key);
  const state = getCoverageState(details, spec.key);
  return formatValue(spec, raw, type, state);
}

export const autoCoverageSpecs: CoverageSpec[] = [
  { key: "coverageForm", label: "Coverage form", format: "coverageForm" },
  { key: "thirdPartyLiabilityCents", label: "Liability limit", format: "money" },
  { key: "collisionDeductibleCents", label: "Collision deductible", format: "money" },
  { key: "comprehensiveDeductibleCents", label: "Comprehensive deductible", format: "money" },
  { key: "glassDeductibleCents", label: "Glass deductible", format: "money" },
  { key: "accidentForgivenessIncluded", label: "Accident forgiveness", format: "boolean" },
  { key: "rentalVehicleCoverageIncluded", label: "Rental vehicle", format: "boolean" },
  { key: "nonOwnedAutomobileIncluded", label: "Non-owned automobile", format: "boolean" },
  { key: "familyProtectionIncluded", label: "Family protection", format: "boolean" },
  { key: "depreciationWaiverIncluded", label: "Depreciation waiver", format: "boolean" },
  { key: "oemPartsIncluded", label: "OEM parts", format: "boolean" },
  { key: "roadsideAssistanceIncluded", label: "Roadside assistance", format: "boolean" },
  { key: "disappearingDeductibleIncluded", label: "Disappearing deductible", format: "boolean" },
  { key: "glassCoverageIncluded", label: "Glass coverage", format: "boolean" },
  { key: "telematicsRequired", label: "Telematics", format: "boolean" },
  { key: "collisionIncluded", label: "Collision", format: "boolean" },
  { key: "comprehensiveIncluded", label: "Comprehensive", format: "boolean" },
];

export const propertyCoverageSpecs: CoverageSpec[] = [
  { key: "coverageForm", label: "Coverage form", format: "coverageForm" },
  { key: "settlementBasis", label: "Settlement basis", format: "settlementBasis" },
  { key: "dwellingLimitCents", label: "Dwelling limit", format: "money" },
  { key: "contentsLimitCents", label: "Contents limit", format: "money" },
  { key: "detachedStructuresLimitCents", label: "Detached structures limit", format: "money" },
  { key: "personalLiabilityLimitCents", label: "Personal liability limit", format: "money" },
  {
    key: "additionalLivingExpenseLimitCents",
    label: "Additional living expense limit",
    format: "money",
  },
  { key: "baseDeductibleCents", label: "Base deductible", format: "money" },
  { key: "waterDeductibleCents", label: "Water deductible", format: "money" },
  { key: "windHailDeductibleCents", label: "Wind/hail deductible", format: "money" },
  { key: "earthquakeDeductibleCents", label: "Earthquake deductible", format: "money" },
  { key: "sewerBackupIncluded", label: "Sewer backup", format: "boolean" },
  { key: "sewerBackupLimitCents", label: "Sewer backup limit", format: "money" },
  { key: "sewerBackupDeductibleCents", label: "Sewer backup deductible", format: "money" },
  { key: "overlandWaterIncluded", label: "Overland water", format: "boolean" },
  { key: "overlandWaterLimitCents", label: "Overland water limit", format: "money" },
  { key: "overlandWaterDeductibleCents", label: "Overland water deductible", format: "money" },
  { key: "groundwaterIncluded", label: "Groundwater / seepage", format: "boolean" },
  { key: "iceDamIncluded", label: "Roof ice dam", format: "boolean" },
  { key: "equipmentBreakdownIncluded", label: "Equipment breakdown", format: "boolean" },
  { key: "serviceLineIncluded", label: "Service line", format: "boolean" },
  { key: "bylawCoverageIncluded", label: "Bylaw coverage", format: "boolean" },
  { key: "homeSystemsIncluded", label: "Home systems", format: "boolean" },
  { key: "cyberCoverageIncluded", label: "Cyber", format: "boolean" },
  { key: "scheduledValuablesIncluded", label: "Scheduled valuables", format: "boolean" },
  { key: "homeBusinessIncluded", label: "Home business", format: "boolean" },
  {
    key: "shortTermRentalPermissionIncluded",
    label: "Short-term rental permission",
    format: "boolean",
  },
  { key: "claimsForgivenessIncluded", label: "Claims forgiveness", format: "boolean" },
  { key: "earthquakeIncluded", label: "Earthquake", format: "boolean" },
  { key: "windHailIncluded", label: "Wind/hail", format: "boolean" },
];

export const coverageSpecsByType: Record<CompareAssetType, CoverageSpec[]> = {
  vehicle: autoCoverageSpecs,
  property: propertyCoverageSpecs,
};

interface PolicyAssetLinkRow {
  asset_id: string;
  asset_type: CompareAssetType;
  policy_id: string;
  policies: { coverage_details: CoverageDetails } | { coverage_details: CoverageDetails }[] | null;
}

export async function loadCompareAssets(householdId: string): Promise<CompareAsset[]> {
  const [{ data: vehicles, error: vehiclesError }, { data: properties, error: propertiesError }] =
    await Promise.all([
      supabase.from("vehicles").select("id, year, make, model").eq("household_id", householdId),
      supabase
        .from("properties")
        .select("id, address_line1, city, postal_code")
        .eq("household_id", householdId),
    ]);

  if (vehiclesError) throw vehiclesError;
  if (propertiesError) throw propertiesError;

  const vehicleMap = new Map(
    (vehicles ?? []).map((v) => [
      v.id,
      { type: "vehicle" as const, display: `${v.year} ${v.make} ${v.model}` },
    ]),
  );
  const propertyMap = new Map(
    (properties ?? []).map((p) => [p.id, { type: "property" as const, display: p.address_line1 }]),
  );

  // Canonical current policy per asset comes from policy_asset_links, never from an
  // unordered approved-candidate map. This guarantees comparison always reflects the
  // current policy and never restores a value the customer corrected or rejected.
  const { data: links, error: linksError } = await supabase
    .from("policy_asset_links")
    .select("asset_id, asset_type, policy_id, policies(coverage_details)")
    .eq("household_id", householdId)
    .eq("is_current", true);

  if (linksError) throw linksError;

  const coverageByAsset = new Map<string, CoverageDetails>();
  for (const link of (links as unknown as PolicyAssetLinkRow[]) ?? []) {
    if (!link.asset_id || !link.asset_type) continue;
    const policy = Array.isArray(link.policies) ? link.policies[0] : link.policies;
    const coverage = (policy?.coverage_details ?? {}) as CoverageDetails;
    coverageByAsset.set(`${link.asset_type}:${link.asset_id}`, coverage);
  }

  const assets: CompareAsset[] = [];

  for (const [id, info] of vehicleMap.entries()) {
    assets.push({
      id,
      type: "vehicle",
      displayName: info.display,
      coverageDetails: coverageByAsset.get(`vehicle:${id}`) ?? {},
    });
  }

  for (const [id, info] of propertyMap.entries()) {
    assets.push({
      id,
      type: "property",
      displayName: info.display,
      coverageDetails: coverageByAsset.get(`property:${id}`) ?? {},
    });
  }

  return assets;
}
