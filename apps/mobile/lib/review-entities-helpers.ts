import { formatEdmontonDate } from "@/lib/format";
import type { CandidateFieldReview, ExtractionCandidate } from "@/lib/extraction";

type ReviewAction = CandidateFieldReview["action"];

export interface DraftReview {
  action: ReviewAction;
  correctedValue?: string;
  mandateRule: string;
  mandateAmount: string;
}

export const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  fullAddress: "Address",
  postalCode: "Postal code",
  vehicleUse: "Vehicle use",
  vin: "VIN",
  insurer: "Insurer",
  policyNumber: "Policy number",
  expiryDate: "Expiry date",
  annualPremiumCents: "Annual premium",
};

export const VEHICLE_USE_LABELS: Record<string, string> = {
  commute: "Commute",
  pleasure: "Pleasure",
  business: "Business",
  farm: "Farm",
  unknown: "Unknown",
};

export const OCCUPANCY_LABELS: Record<string, string> = {
  principal_residence: "Principal residence",
  rental: "Rental",
  other: "Other",
  unknown: "Unknown",
};

export const VEHICLE_REVIEW_FIELDS = [
  "identity.vin",
  "identity.year",
  "identity.make",
  "identity.model",
  "identity.vehicleUse",
  "currentPolicy.insurer",
  "currentPolicy.policyNumber",
  "currentPolicy.expiryDate",
  "currentPolicy.annualPremiumCents",
];

export const PROPERTY_REVIEW_FIELDS = [
  "identity.fullAddress",
  "identity.occupancy",
  "currentPolicy.insurer",
  "currentPolicy.policyNumber",
  "currentPolicy.expiryDate",
  "currentPolicy.annualPremiumCents",
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    if (Array.isArray(value)) return value.map((v) => formatFieldValue(v)).join(", ");
    if ("value" in value) return formatFieldValue((value as { value: unknown }).value);
    return JSON.stringify(value);
  }
  return String(value);
}

export function renderCents(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return "—";
  return `C$${(num / 100).toFixed(2)}`;
}

export function formatFieldLabel(fieldPath: string): string {
  const raw = fieldPath.split(".").pop() ?? fieldPath;
  if (FIELD_LABEL_OVERRIDES[raw]) return FIELD_LABEL_OVERRIDES[raw];
  const spaced = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase();
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function displayValueForField(fieldPath: string, value: unknown): string {
  const key = fieldPath.split(".").pop();
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (key === "vehicleUse") return VEHICLE_USE_LABELS[normalized] ?? value;
    if (key === "occupancy") return OCCUPANCY_LABELS[normalized] ?? value;
    if (key === "expiryDate") return formatEdmontonDate(value);
  }
  if (key === "annualPremiumCents") return renderCents(value);
  return formatFieldValue(value);
}

export function parseCorrectedValue(fieldPath: string, raw: string): unknown {
  if (fieldPath.toLowerCase().includes("cents") || fieldPath.toLowerCase().includes("premium")) {
    const dollars = Number(raw.replace(/[C$\s,]/g, ""));
    if (!Number.isNaN(dollars)) return Math.round(dollars * 100);
  }
  return raw;
}

export function serializeFieldValue(fieldPath: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (fieldPath.toLowerCase().includes("cents") || fieldPath.toLowerCase().includes("premium")) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) return String(n / 100);
  }
  return String(value);
}

function getFacts(candidate: ExtractionCandidate): Record<string, unknown> {
  return isRecord(candidate.selected_facts_json) ? candidate.selected_facts_json : {};
}

export function getFieldValue(candidate: ExtractionCandidate, fieldPath: string): unknown {
  const parts = fieldPath.split(".");
  let current: unknown = getFacts(candidate);
  for (const part of parts) {
    if (isRecord(current) && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function getEffectiveDisplay(
  candidate: ExtractionCandidate,
  fieldPath: string,
  draft?: DraftReview | null,
): string {
  if (draft?.action === "correct" && draft.correctedValue !== undefined) {
    return displayValueForField(fieldPath, parseCorrectedValue(fieldPath, draft.correctedValue));
  }
  return displayValueForField(fieldPath, getFieldValue(candidate, fieldPath));
}

export type CandidateDecision = "approve_new" | "link_existing" | "skip" | "needs_correction";

export function getExistingAssetDisplay(
  candidate: ExtractionCandidate,
): { id: string; asset_type: "vehicle" | "property"; display_label: string } | null {
  const facts = isRecord(candidate.selected_facts_json) ? candidate.selected_facts_json : {};
  const existingAsset = isRecord(facts.existingAsset) ? facts.existingAsset : null;
  if (existingAsset && typeof existingAsset.id === "string") {
    return {
      id: existingAsset.id as string,
      asset_type: (existingAsset.asset_type as "vehicle" | "property") ?? candidate.asset_type,
      display_label: (existingAsset.display_label as string) ?? "Existing asset",
    };
  }
  if (candidate.draft_existing_asset_id) {
    return {
      id: candidate.draft_existing_asset_id,
      asset_type: candidate.draft_existing_asset_type ?? candidate.asset_type,
      display_label: "Existing asset",
    };
  }
  return null;
}

export function getInitialDecision(candidate: ExtractionCandidate): CandidateDecision | null {
  if (candidate.match_classification === "possible_existing_match") {
    return null;
  }

  const persisted = candidate.draft_decision;
  if (
    persisted === "approve_new" ||
    persisted === "link_existing" ||
    persisted === "skip" ||
    persisted === "needs_correction"
  ) {
    return persisted;
  }

  if (candidate.match_classification === "exact_existing_match") {
    return "link_existing";
  }
  if (candidate.match_classification === "new_identity_confirmation_required") {
    return "needs_correction";
  }

  return "approve_new";
}
