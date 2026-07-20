import type { HouseholdCoverageMandateV2 } from "@autopilot/schemas";
import {
  resolveEffectivePropertyMandateV2,
  resolveEffectiveVehicleMandateV2,
} from "@autopilot/database";
import type { CandidateFieldReview } from "./extraction";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getNestedValue(value: unknown, path: string | null | undefined): unknown {
  if (!path) return undefined;
  let cursor = value;
  for (const part of path.split(".")) {
    if (!isRecord(cursor) || !(part in cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  const leaf = parts.pop();
  if (!leaf) return;
  let cursor = target;
  for (const key of parts) {
    if (!isRecord(cursor[key])) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[leaf] = value;
}

export function initialCurrentMandateValue(
  item: CandidateFieldReview,
  mandate: HouseholdCoverageMandateV2,
  savedMandateVersion: number,
): unknown {
  if (item.current_mandate_value !== undefined && item.current_mandate_value !== null) {
    return item.current_mandate_value;
  }

  const linkedAssetId = item.asset_candidate?.draft_existing_asset_id ?? undefined;
  const defaults =
    item.asset_candidate?.asset_type === "vehicle"
      ? linkedAssetId
        ? resolveEffectiveVehicleMandateV2(mandate, linkedAssetId)
        : mandate.householdAutoDefaults
      : linkedAssetId
        ? resolveEffectivePropertyMandateV2(mandate, linkedAssetId)
        : mandate.householdPropertyDefaults;
  const saved = getNestedValue(defaults, item.mandate_path);
  if (savedMandateVersion > 0 || item.value_state !== "known") return saved;
  return item.document_implied_mandate_value ?? saved;
}

export function formatMandateValue(value: unknown): string {
  if (value === null || value === undefined) return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (isRecord(value)) {
    if (typeof value.amountCents === "number") {
      const rule = typeof value.rule === "string" ? `${value.rule.replaceAll("_", " ")} ` : "";
      return `${rule}$${(value.amountCents / 100).toLocaleString("en-CA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    if (typeof value.value === "string") {
      const preference =
        typeof value.preference === "string" ? `${value.preference.replaceAll("_", " ")}: ` : "";
      return `${preference}${value.value.replaceAll("_", " ")}`;
    }
    if (typeof value.rule === "string") return value.rule.replaceAll("_", " ");
  }
  return JSON.stringify(value);
}

export function editableMandateValue(value: unknown): string {
  if (isRecord(value) && typeof value.amountCents === "number") {
    return String(value.amountCents / 100);
  }
  if (isRecord(value) && typeof value.value === "string") return value.value;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return JSON.stringify(value ?? null);
}

export function parseEditableMandateValue(text: string, template: unknown): unknown {
  if (isRecord(template) && typeof template.amountCents === "number") {
    const dollars = Number(text.replaceAll(",", ""));
    return {
      ...template,
      amountCents: Number.isFinite(dollars) ? Math.max(0, Math.round(dollars * 100)) : 0,
    };
  }
  if (isRecord(template) && typeof template.value === "string") {
    return { ...template, value: text.trim().replaceAll(" ", "_") };
  }
  if (typeof template === "number") {
    const value = Number(text);
    return Number.isFinite(value) ? value : template;
  }
  if (typeof template === "string") return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function mandateValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export function buildCandidateMandateValues(
  items: CandidateFieldReview[],
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    if (!item.is_complete) {
      throw new Error("Every document-informed mandate specification must be completed");
    }
    if (item.material_conflict && item.action === "unresolved") {
      throw new Error("Material mandate conflicts must be resolved before approval");
    }
    if (!item.mandate_path || item.current_mandate_value === undefined) continue;
    const values = result.get(item.candidate_id) ?? {};
    setNestedValue(values, item.mandate_path, item.current_mandate_value);
    result.set(item.candidate_id, values);
  }
  return result;
}

export function visibleMandateItems(items: CandidateFieldReview[]): CandidateFieldReview[] {
  return items.filter(
    (item) =>
      item.value_state === "known" ||
      item.value_state === "absent" ||
      item.value_state === "not_applicable" ||
      item.value_state === "conflicting",
  );
}
