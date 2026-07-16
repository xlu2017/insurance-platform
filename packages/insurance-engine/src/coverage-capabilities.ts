import type { AutoCoverageDetails, PropertyCoverageDetails } from "@autopilot/schemas";

export const autoFormCapabilities: Record<AutoCoverageDetails["coverageForm"], string[]> = {
  unknown: [],
  liability_only: ["third_party_liability"],
  collision: ["third_party_liability", "collision_damage"],
  comprehensive: ["third_party_liability", "comprehensive_perils"],
  specified_perils: ["third_party_liability", "specified_perils"],
  all_perils: [
    "third_party_liability",
    "collision_damage",
    "comprehensive_perils",
    "all_perils_extensions",
  ],
};

export const propertyFormCapabilities: Record<PropertyCoverageDetails["coverageForm"], string[]> = {
  unknown: [],
  basic: ["fire_lightning"],
  named_perils: ["fire_lightning", "named_perils"],
  broad: ["fire_lightning", "named_perils", "broad_perils"],
  comprehensive: ["fire_lightning", "named_perils", "broad_perils", "all_risks"],
};

function hasAllCapabilities(actual: string[], required: string[]): boolean {
  const set = new Set(actual);
  return required.every((c) => set.has(c));
}

export function autoFormMeetsOrExceeds(
  actual: AutoCoverageDetails["coverageForm"],
  required: AutoCoverageDetails["coverageForm"],
): boolean {
  return hasAllCapabilities(autoFormCapabilities[actual], autoFormCapabilities[required]);
}

export function propertyFormMeetsOrExceeds(
  actual: PropertyCoverageDetails["coverageForm"],
  required: PropertyCoverageDetails["coverageForm"],
): boolean {
  return hasAllCapabilities(propertyFormCapabilities[actual], propertyFormCapabilities[required]);
}
