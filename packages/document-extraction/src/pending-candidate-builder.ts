import type {
  CurrentPolicy,
  DetectedEntityIdentity,
  DetectedInsuranceEntity,
  ExistingHouseholdAsset,
  PendingEntityCandidate,
} from "./document-analyzer.ts";
import {
  buildPropertyIdentity,
  buildVehicleIdentity,
  type PropertyIdentityInput,
} from "./entity-identity.ts";

export interface ExistingAssetReference {
  id: string;
  asset_type: "vehicle" | "property";
  display_label: string;
}

export interface DraftDecisionPayload {
  _draftDecision?: string;
  _draftExistingAssetId?: string;
  _draftExistingAssetType?: string;
  _draftIdentityConfirmed?: boolean;
  existingAsset?: ExistingAssetReference;
}

export interface PendingCandidateRecord {
  id: string;
  asset_type: "vehicle" | "property";
  identity_fingerprint: string;
  display_label: string;
  session_id: string;
  household_id?: string;
  source_document_ids: string[];
  draft_decision: string | null;
  draft_identity_confirmed: boolean | null;
  draft_existing_asset_id: string | null;
  draft_existing_asset_type: "vehicle" | "property" | null;
  approved_asset_id: string | null;
  approved_asset_type: "vehicle" | "property" | null;
  selected_facts_json: Record<string, unknown>;
  conflicts_json: unknown[];
  case_id: string | null;
}

function unknownToString(value: unknown): string | null {
  if (typeof value === "string") return value;
  return null;
}

function unknownToStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : null))
      .filter((item): item is string => item !== null);
  }
  return [];
}

function unknownToBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function unknownToRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseAssetType(value: unknown): "vehicle" | "property" | null {
  if (value === "vehicle" || value === "property") return value;
  return null;
}

export function parsePendingCandidateRecord(row: unknown): PendingCandidateRecord {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Pending candidate row must be an object");
  }
  const record = row as Record<string, unknown>;

  const id = unknownToString(record.id);
  if (!id) throw new Error("Pending candidate row missing id");

  const rawAssetType = record.asset_type ?? record.assetType;
  const assetType = parseAssetType(rawAssetType);
  if (!assetType)
    throw new Error(`Pending candidate ${id} has invalid asset_type: ${rawAssetType}`);

  const identityFingerprint = unknownToString(
    record.identity_fingerprint ?? record.identityFingerprint,
  );
  if (!identityFingerprint) {
    throw new Error(`Pending candidate ${id} missing identity_fingerprint`);
  }

  const displayLabel = unknownToString(record.display_label ?? record.displayLabel) ?? "";
  const sessionId = unknownToString(record.session_id ?? record.sessionId) ?? "";
  const sourceDocumentIds = unknownToStringArray(
    record.source_document_ids ?? record.sourceDocumentIds,
  );
  const draftDecision = unknownToString(record.draft_decision ?? record.draftDecision);
  const draftIdentityConfirmed = unknownToBoolean(
    record.draft_identity_confirmed ?? record.draftIdentityConfirmed,
  );
  const draftExistingAssetId = unknownToString(
    record.draft_existing_asset_id ?? record.draftExistingAssetId,
  );
  const rawDraftExistingAssetType =
    record.draft_existing_asset_type ?? record.draftExistingAssetType;
  const draftExistingAssetType = parseAssetType(rawDraftExistingAssetType);
  const approvedAssetId = unknownToString(record.approved_asset_id ?? record.approvedAssetId);
  const rawApprovedAssetType = record.approved_asset_type ?? record.approvedAssetType;
  const approvedAssetType = parseAssetType(rawApprovedAssetType);
  const selectedFactsJson = unknownToRecord(record.selected_facts_json ?? record.selectedFactsJson);
  const conflictsJson = (
    Array.isArray(record.conflicts_json ?? record.conflictsJson)
      ? (record.conflicts_json ?? record.conflictsJson)
      : []
  ) as unknown[];
  const caseId = unknownToString(record.case_id ?? record.caseId);
  const householdId = unknownToString(record.household_id ?? record.householdId);

  return {
    id,
    asset_type: assetType,
    identity_fingerprint: identityFingerprint,
    display_label: displayLabel,
    session_id: sessionId,
    household_id: householdId ?? undefined,
    source_document_ids: sourceDocumentIds,
    draft_decision: draftDecision,
    draft_identity_confirmed: draftIdentityConfirmed,
    draft_existing_asset_id: draftExistingAssetId,
    draft_existing_asset_type: draftExistingAssetType,
    approved_asset_id: approvedAssetId,
    approved_asset_type: approvedAssetType,
    selected_facts_json: selectedFactsJson,
    conflicts_json: conflictsJson,
    case_id: caseId,
  };
}

export function pendingRecordToEntityCandidate(
  record: PendingCandidateRecord,
): PendingEntityCandidate {
  const facts = record.selected_facts_json;
  const identity = (facts.identity ?? {}) as DetectedEntityIdentity;
  const currentPolicy = (facts.currentPolicy ?? undefined) as CurrentPolicy | undefined;
  const candidateIdentity = (facts.candidateIdentity ?? undefined) as
    | {
        exactIdentityFingerprint: string | null;
        provisionalCandidateKey: string;
        identityStrength: string;
      }
    | undefined;

  return {
    id: record.id,
    assetType: record.asset_type,
    identityFingerprint: record.identity_fingerprint,
    displayLabel: record.display_label || undefined,
    candidateIdentity: candidateIdentity
      ? {
          exactIdentityFingerprint: candidateIdentity.exactIdentityFingerprint ?? null,
          provisionalCandidateKey: candidateIdentity.provisionalCandidateKey,
          identityStrength: validateIdentityStrength(candidateIdentity.identityStrength),
        }
      : undefined,
    identity,
    currentPolicy,
    sourceDocumentIds: record.source_document_ids,
    draftDecision: record.draft_decision as PendingEntityCandidate["draftDecision"],
    draftIdentityConfirmed: record.draft_identity_confirmed,
    draftExistingAssetId: record.draft_existing_asset_id,
    draftExistingAssetType:
      record.draft_existing_asset_type as PendingEntityCandidate["draftExistingAssetType"],
    approvedAssetId: record.approved_asset_id,
    approvedAssetType: record.approved_asset_type as PendingEntityCandidate["approvedAssetType"],
    selectedFactsJson: record.selected_facts_json,
    caseId: record.case_id,
  };
}

function validateIdentityStrength(
  value: string | undefined,
): "exact" | "partial" | "redacted" | "unknown" {
  if (value === "exact" || value === "partial" || value === "redacted" || value === "unknown") {
    return value;
  }
  if (value === "confirmation_required") return "partial";
  return "unknown";
}

export function mapResolutionStatus(entity: DetectedInsuranceEntity): string {
  const status = entity.resolution.status;
  if (status === "new") return "new";
  if (status === "possible_match_requires_confirmation") {
    if (entity.resolution.matchedExistingEntityId || entity.resolution.matchedPendingCandidateId) {
      return "possible_existing_match";
    }
    return "new_identity_confirmation_required";
  }
  if (status === "matches_existing" || status === "matches_pending_candidate") {
    return "exact_existing_match";
  }
  return "new";
}

export function occupancyForEntity(entity: DetectedInsuranceEntity): string | null {
  if (entity.entityType === "vehicle") return null;
  const value = entity.identity.occupancy;
  if (value === "principal_residence" || value === "rental" || value === "unknown") return value;
  return "unknown";
}

export function candidateDisplayLabel(entity: DetectedInsuranceEntity): string {
  if (entity.displayLabel && entity.displayLabel.trim().length > 0)
    return entity.displayLabel.trim();
  if (entity.entityType === "vehicle") {
    const { year, make, model, trim } = entity.identity;
    return [year, make, model, trim].filter(Boolean).join(" ") || "Unidentified vehicle";
  }
  const { fullAddress, city, province, postalCode } = entity.identity;
  const parts = [fullAddress, city, province, postalCode].filter(Boolean);
  const occupancy = entity.identity.occupancy;
  const label = parts.join(" ") || `${occupancy ?? "Property"} at ${city ?? "unknown"}`;
  return label;
}

export function isExactFingerprint(fingerprint: string): boolean {
  return (
    (fingerprint.startsWith("vehicle:vin:") && fingerprint.length > "vehicle:vin:".length) ||
    (fingerprint.startsWith("property:") && fingerprint.includes("|"))
  );
}

export function computeCanonicalFingerprint(entity: DetectedInsuranceEntity): string {
  if (entity.canonicalFingerprint && entity.canonicalFingerprint.length > 0) {
    return entity.canonicalFingerprint;
  }
  if (entity.entityType === "vehicle") {
    const identity = buildVehicleIdentity({
      vin: entity.identity.vin ?? undefined,
      modelYear: entity.identity.year ?? undefined,
      make: entity.identity.make ?? undefined,
      model: entity.identity.model ?? undefined,
      trim: entity.identity.trim ?? undefined,
    });
    if (identity.strength === "exact" && identity.exactFingerprint) {
      return identity.exactFingerprint;
    }
    return `possible:${entity.temporaryId}`;
  }
  const identity = buildPropertyIdentity({
    addressLine1: entity.identity.fullAddress ?? undefined,
    city: entity.identity.city ?? undefined,
    province: entity.identity.province ?? undefined,
    postalCode: entity.identity.postalCode ?? undefined,
    occupancy: (entity.identity.occupancy === "other" ? undefined : entity.identity.occupancy) as
      | PropertyIdentityInput["occupancy"]
      | undefined,
    isRedacted: false,
  });
  if (identity.strength === "exact" && identity.exactFingerprint) {
    return identity.exactFingerprint;
  }
  return `possible:${entity.temporaryId}`;
}

export function buildExistingAssetReference(
  existingById: Map<string, ExistingHouseholdAsset>,
  record?: {
    draftExistingAssetId?: string | null;
    draftExistingAssetType?: string | null;
    displayLabel?: string;
    assetType?: string;
  },
): ExistingAssetReference | undefined {
  if (!record?.draftExistingAssetId) return undefined;
  const asset = existingById.get(record.draftExistingAssetId);
  return {
    id: record.draftExistingAssetId,
    asset_type:
      (record.draftExistingAssetType as "vehicle" | "property") ??
      (record.assetType as "vehicle" | "property") ??
      "vehicle",
    display_label: asset?.displayLabel ?? record.displayLabel ?? "Existing asset",
  };
}

export function buildDraftDecisionPayload(
  existingById: Map<string, ExistingHouseholdAsset>,
  resolutionStatus: string,
  matchedExistingAsset: ExistingHouseholdAsset | undefined,
  matchedPendingRecord: PendingEntityCandidate | undefined,
  identityStrength: "exact" | "partial" | "unknown" | "redacted" | undefined,
): DraftDecisionPayload {
  const pendingExisting = matchedPendingRecord
    ? buildExistingAssetReference(existingById, {
        draftExistingAssetId: matchedPendingRecord.draftExistingAssetId,
        draftExistingAssetType: matchedPendingRecord.draftExistingAssetType,
        displayLabel: matchedPendingRecord.displayLabel,
        assetType: matchedPendingRecord.assetType,
      })
    : undefined;
  const pendingDecision = matchedPendingRecord?.draftDecision;

  if (resolutionStatus === "matches_existing" && matchedExistingAsset) {
    return {
      _draftDecision: "link_existing",
      _draftExistingAssetId: matchedExistingAsset.id,
      _draftExistingAssetType: matchedExistingAsset.assetType,
      _draftIdentityConfirmed: true,
      existingAsset: {
        id: matchedExistingAsset.id,
        asset_type: matchedExistingAsset.assetType,
        display_label: matchedExistingAsset.displayLabel ?? "Existing asset",
      },
    };
  }

  if (resolutionStatus === "matches_pending_candidate") {
    if (pendingExisting) {
      return {
        _draftDecision: "link_existing",
        _draftExistingAssetId: pendingExisting.id,
        _draftExistingAssetType: pendingExisting.asset_type,
        _draftIdentityConfirmed: matchedPendingRecord?.draftIdentityConfirmed ?? true,
        existingAsset: pendingExisting,
      };
    }
    if (pendingDecision && pendingDecision !== "undecided") {
      return {
        _draftDecision: pendingDecision,
        _draftIdentityConfirmed:
          matchedPendingRecord?.draftIdentityConfirmed ?? pendingDecision !== "needs_correction",
      };
    }
    return {
      _draftDecision: "undecided",
      _draftIdentityConfirmed: false,
    };
  }

  if (resolutionStatus === "possible_match_requires_confirmation") {
    if (matchedExistingAsset) {
      return {
        _draftDecision: "link_existing",
        _draftExistingAssetId: matchedExistingAsset.id,
        _draftExistingAssetType: matchedExistingAsset.assetType,
        _draftIdentityConfirmed: false,
        existingAsset: {
          id: matchedExistingAsset.id,
          asset_type: matchedExistingAsset.assetType,
          display_label: matchedExistingAsset.displayLabel ?? "Existing asset",
        },
      };
    }
    if (pendingExisting) {
      return {
        _draftDecision: "link_existing",
        _draftExistingAssetId: pendingExisting.id,
        _draftExistingAssetType: pendingExisting.asset_type,
        _draftIdentityConfirmed: false,
        existingAsset: pendingExisting,
      };
    }
    if (pendingDecision && pendingDecision !== "undecided") {
      return {
        _draftDecision: pendingDecision,
        _draftIdentityConfirmed: matchedPendingRecord?.draftIdentityConfirmed ?? false,
      };
    }
    return {
      _draftDecision: "needs_correction",
      _draftIdentityConfirmed: false,
    };
  }

  return {
    _draftDecision: "approve_new",
    _draftIdentityConfirmed: identityStrength === "exact",
  };
}
