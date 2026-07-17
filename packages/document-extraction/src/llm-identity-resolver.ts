import type { LlmAssertion, LlmAssetCandidate } from "./llm-contract.ts";
import type {
  LlmAssetIdentityResolutionInput,
  ResolvedLlmAssetIdentity,
} from "./llm-parsed-document-projection.ts";
import {
  buildPropertyIdentity,
  buildVehicleIdentity,
  type PropertyIdentityInput,
  type VehicleIdentityInput,
} from "./entity-identity.ts";

function stringValue(assertion: LlmAssertion): string | undefined {
  const raw = assertion.normalizedValue ?? assertion.value;
  if (typeof raw === "string") return raw;
  if (raw == null) return undefined;
  return String(raw);
}

function numberValue(assertion: LlmAssertion): number | undefined {
  const raw = assertion.normalizedValue ?? assertion.value;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string") {
    const parsed = Number(raw.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function fieldHint(fieldPath: string): string {
  return fieldPath.toLowerCase().replace(/[_.[\]]/g, "");
}

function isMailingOrCorrespondence(fieldPath: string): boolean {
  const hint = fieldHint(fieldPath);
  return (
    hint.includes("mail") ||
    hint.includes("correspondence") ||
    hint.includes("broker") ||
    hint.includes("agent")
  );
}

function isAddressLine1Field(fieldPath: string): boolean {
  const hint = fieldHint(fieldPath);
  return (
    (hint.includes("address") || hint.includes("civic") || hint.includes("street")) &&
    !isMailingOrCorrespondence(fieldPath)
  );
}

function extractPropertyInput(
  asset: LlmAssetCandidate,
  assertions: readonly LlmAssertion[],
): PropertyIdentityInput {
  const input: PropertyIdentityInput = {};

  for (const assertion of assertions) {
    const hint = fieldHint(assertion.fieldPath);
    if (isAddressLine1Field(assertion.fieldPath)) {
      input.addressLine1 = stringValue(assertion);
    } else if (hint.includes("unit") || hint.includes("apartment") || hint.includes("suite")) {
      input.unit = stringValue(assertion);
    } else if (hint.includes("city")) {
      input.city = stringValue(assertion);
    } else if (hint.includes("province") || hint.includes("state")) {
      input.province = stringValue(assertion);
    } else if (hint.includes("postal") || hint.includes("zip")) {
      input.postalCode = stringValue(assertion);
    } else if (hint.includes("occupancy") || hint.includes("occupant")) {
      const value = stringValue(assertion);
      if (value === "principal_residence" || value === "rental") {
        input.occupancy = value;
      } else if (value === "seasonal") {
        input.occupancy = "principal_residence";
      } else if (value === "vacant") {
        input.occupancy = "rental";
      } else {
        input.occupancy = "unknown";
      }
    }
  }

  if (asset.assetType === "property") {
    input.occupancy =
      asset.occupancy === "principal_residence" || asset.occupancy === "rental"
        ? asset.occupancy
        : "unknown";
    input.isRedacted =
      asset.insuredLocationStatus === "redacted" || asset.insuredLocationStatus === "partial";
  }

  return input;
}

function extractVehicleInput(
  asset: LlmAssetCandidate,
  assertions: readonly LlmAssertion[],
): VehicleIdentityInput {
  const input: VehicleIdentityInput = {};

  for (const assertion of assertions) {
    const hint = fieldHint(assertion.fieldPath);
    if (hint.includes("vin") && !hint.includes("equipment")) {
      input.vin = stringValue(assertion);
    } else if (hint.includes("modelyear") || hint.includes("year")) {
      input.modelYear = numberValue(assertion);
    } else if (hint.includes("make")) {
      input.make = stringValue(assertion);
    } else if (
      hint.includes("model") &&
      !hint.includes("modelyear") &&
      !hint.includes("model_year")
    ) {
      input.model = stringValue(assertion);
    } else if (hint.includes("trim")) {
      input.trim = stringValue(assertion);
    }
  }

  if (
    asset.assetType === "vehicle" &&
    (asset.vinStatus === "redacted" || asset.vinStatus === "partial")
  ) {
    input.vin = undefined;
  }

  return input;
}

function matchClassificationFromStrength(
  strength: "exact" | "possible" | "confirmation_required",
): ResolvedLlmAssetIdentity["matchClassification"] {
  switch (strength) {
    case "exact":
      return "new";
    case "possible":
      return "possible_existing_match";
    case "confirmation_required":
      return "new_identity_confirmation_required";
  }
}

/**
 * Resolves an LLM asset candidate to a deterministic identity fingerprint using
 * the same property/vehicle normalization rules as the local TD parsers. The LLM
 * is never allowed to emit an exact_existing_match classification; that decision
 * belongs to the caller after comparing with persisted household assets.
 */
export function resolveLlmAssetIdentity(
  input: LlmAssetIdentityResolutionInput,
): ResolvedLlmAssetIdentity {
  const { asset, identityAssertions } = input;

  if (asset.assetType === "property") {
    const propertyInput = extractPropertyInput(asset, identityAssertions);
    const result = buildPropertyIdentity(propertyInput);
    const fingerprint = result.exactFingerprint ?? result.possibleMatchHint ?? "";
    return {
      identityFingerprint: fingerprint,
      matchClassification:
        result.strength === "exact" ? "new" : matchClassificationFromStrength(result.strength),
    };
  }

  const vehicleInput = extractVehicleInput(asset, identityAssertions);
  const result = buildVehicleIdentity(vehicleInput);
  const fingerprint = result.exactFingerprint ?? result.possibleMatchHint ?? "";
  return {
    identityFingerprint: fingerprint,
    matchClassification:
      result.strength === "exact" ? "new" : matchClassificationFromStrength(result.strength),
  };
}
