import { normalizePostalCode, normalizeProvince, normalizeVin } from "./parsers/helpers.ts";

export type IdentityStrength = "exact" | "possible" | "confirmation_required";

export interface PropertyIdentityInput {
  addressLine1?: string | null;
  unit?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  occupancy?: "principal_residence" | "rental" | "unknown" | null;
  isRedacted?: boolean;
}

export interface VehicleIdentityInput {
  vin?: string | null;
  modelYear?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
}

export interface PropertyIdentityResult {
  strength: IdentityStrength;
  exactFingerprint: string | null;
  possibleMatchHint: string | null;
  requiresCustomerConfirmation: boolean;
  normalizedAddressLine1: string | null;
  normalizedUnit: string | null;
  normalizedCity: string | null;
  normalizedProvince: string | null;
  normalizedPostalCode: string | null;
  reasons: string[];
}

export interface VehicleIdentityResult {
  strength: IdentityStrength;
  exactFingerprint: string | null;
  possibleMatchHint: string | null;
  requiresCustomerConfirmation: boolean;
  normalizedVin: string | null;
  maskedVin: string | null;
  reasons: string[];
}

const STREET_SUFFIXES: Record<string, string> = {
  AVENUE: "AVE",
  BOULEVARD: "BLVD",
  CIRCLE: "CIR",
  COURT: "CT",
  CRESCENT: "CRES",
  DRIVE: "DR",
  GARDENS: "GDNS",
  GATE: "GT",
  HEIGHTS: "HTS",
  HIGHWAY: "HWY",
  LANE: "LN",
  PLACE: "PL",
  ROAD: "RD",
  STREET: "ST",
  TERRACE: "TER",
  TRAIL: "TRL",
};

const DIRECTIONALS: Record<string, string> = {
  NORTH: "N",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTH: "S",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
  EAST: "E",
  WEST: "W",
};

const REDACTION_MARKERS = [
  "REDACTED",
  "WITHHELD",
  "NOT PROVIDED",
  "UNKNOWN",
  "XXXX",
  "****",
  "••••",
];

function normalizeTokenText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[#.,'’/\\()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddressTokens(input: string): string {
  return normalizeTokenText(input)
    .split(" ")
    .filter(Boolean)
    .map((token) => DIRECTIONALS[token] ?? STREET_SUFFIXES[token] ?? token)
    .join(" ");
}

function isRedactedOrPlaceholder(input: string | null): boolean {
  if (!input) return true;
  const normalized = normalizeTokenText(input);
  if (!normalized) return true;
  return REDACTION_MARKERS.some((marker) => normalized.includes(marker));
}

function normalizeUnit(input?: string | null): string | null {
  if (!input || isRedactedOrPlaceholder(input)) return null;
  const normalized = normalizeTokenText(input).replace(/^(UNIT|SUITE|APT|APARTMENT)\s+/, "");
  return normalized || null;
}

function normalizeOptionalText(input?: string | null): string | null {
  if (!input || isRedactedOrPlaceholder(input)) return null;
  const normalized = normalizeTokenText(input);
  return normalized || null;
}

function joinFingerprintParts(parts: Array<string | null>): string {
  return parts.map((part) => part ?? "").join("|");
}

/**
 * Builds an exact property fingerprint only from a complete insured civic address.
 * Postal code, policy number, mailing address, or occupancy alone must never be
 * treated as an automatic property identity.
 */
export function buildPropertyIdentity(input: PropertyIdentityInput): PropertyIdentityResult {
  const reasons: string[] = [];
  const normalizedAddressLine1 =
    input.addressLine1 && !isRedactedOrPlaceholder(input.addressLine1)
      ? normalizeAddressTokens(input.addressLine1)
      : null;
  const normalizedUnit = normalizeUnit(input.unit);
  const normalizedCity = normalizeOptionalText(input.city);
  const normalizedProvince = input.province ? (normalizeProvince(input.province) ?? null) : null;
  const normalizedPostalCode = input.postalCode
    ? (normalizePostalCode(input.postalCode) ?? null)
    : null;

  if (input.isRedacted || !normalizedAddressLine1) {
    reasons.push("insured_civic_address_missing_or_redacted");
  }
  if (!normalizedCity) reasons.push("insured_city_missing");
  if (!normalizedProvince) reasons.push("insured_province_missing_or_invalid");
  if (!normalizedPostalCode) reasons.push("insured_postal_code_missing_or_invalid");

  const completeAddress =
    normalizedAddressLine1 && normalizedCity && normalizedProvince && normalizedPostalCode;

  const exactFingerprint = completeAddress
    ? `property:${joinFingerprintParts([
        normalizedUnit,
        normalizedAddressLine1,
        normalizedCity,
        normalizedProvince,
        normalizedPostalCode.replace(/\s/g, ""),
      ])}`
    : null;

  const occupancy = input.occupancy ?? "unknown";
  const possibleMatchHint = normalizedPostalCode
    ? `property-hint:${normalizedPostalCode.replace(/\s/g, "")}:${occupancy}`
    : null;

  if (exactFingerprint) {
    return {
      strength: "exact",
      exactFingerprint,
      possibleMatchHint,
      requiresCustomerConfirmation: false,
      normalizedAddressLine1,
      normalizedUnit,
      normalizedCity,
      normalizedProvince,
      normalizedPostalCode,
      reasons,
    };
  }

  return {
    strength: possibleMatchHint ? "confirmation_required" : "possible",
    exactFingerprint: null,
    possibleMatchHint,
    requiresCustomerConfirmation: true,
    normalizedAddressLine1,
    normalizedUnit,
    normalizedCity,
    normalizedProvince,
    normalizedPostalCode,
    reasons,
  };
}

/**
 * Uses a valid 17-character VIN as the only exact vehicle identity. A
 * year/make/model/trim hint may support a possible match, but must never trigger
 * an automatic merge.
 */
export function buildVehicleIdentity(input: VehicleIdentityInput): VehicleIdentityResult {
  const reasons: string[] = [];
  const vin = input.vin ? normalizeVin(input.vin) : null;

  if (vin) {
    return {
      strength: "exact",
      exactFingerprint: `vehicle:vin:${vin.normalized}`,
      possibleMatchHint: null,
      requiresCustomerConfirmation: false,
      normalizedVin: vin.normalized,
      maskedVin: vin.display,
      reasons,
    };
  }

  reasons.push(input.vin ? "vin_invalid" : "vin_missing");

  const make = normalizeOptionalText(input.make);
  const model = normalizeOptionalText(input.model);
  const trim = normalizeOptionalText(input.trim);
  const modelYear = input.modelYear && Number.isInteger(input.modelYear) ? input.modelYear : null;
  const possibleMatchHint =
    modelYear && make && model
      ? `vehicle-hint:${joinFingerprintParts([modelYear.toString(), make, model, trim])}`
      : null;

  if (!modelYear) reasons.push("model_year_missing_or_invalid");
  if (!make) reasons.push("make_missing");
  if (!model) reasons.push("model_missing");

  return {
    strength: possibleMatchHint ? "possible" : "confirmation_required",
    exactFingerprint: null,
    possibleMatchHint,
    requiresCustomerConfirmation: true,
    normalizedVin: null,
    maskedVin: null,
    reasons,
  };
}

/** Automatic merging is permitted only when both sides have the same exact fingerprint. */
export function canAutoMergeIdentity(
  left: Pick<PropertyIdentityResult | VehicleIdentityResult, "exactFingerprint">,
  right: Pick<PropertyIdentityResult | VehicleIdentityResult, "exactFingerprint">,
): boolean {
  return Boolean(
    left.exactFingerprint &&
      right.exactFingerprint &&
      left.exactFingerprint === right.exactFingerprint,
  );
}
