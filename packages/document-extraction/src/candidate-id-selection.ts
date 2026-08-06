import type { ExistingHouseholdAsset } from "./document-analyzer.ts";
import {
  buildDraftDecisionPayload,
  pendingRecordToEntityCandidate,
  type DraftDecisionPayload,
  type PendingCandidateRecord,
} from "./pending-candidate-builder.ts";

export interface CandidateSelectionResult {
  candidateId: string;
  action: "reuse" | "create-child" | "create-new";
  parentCandidateId?: string;
  draftPayload: DraftDecisionPayload;
}

export interface CandidateSelectionInput {
  currentSessionId: string;
  currentCaseId: string | null;
  currentHouseholdId: string;
  fingerprint: string;
  matchedPendingRecord?: PendingCandidateRecord;
  sameSessionFingerprintCandidate?: PendingCandidateRecord;
  existingById: Map<string, ExistingHouseholdAsset>;
  resolutionStatus: string;
  matchedExistingAsset?: ExistingHouseholdAsset;
  identityStrength?: "exact" | "partial" | "redacted" | "unknown";
  generateId?: () => string;
}

export function selectCandidateForPersistence(
  input: CandidateSelectionInput,
): CandidateSelectionResult {
  const {
    currentSessionId,
    currentHouseholdId,
    matchedPendingRecord,
    sameSessionFingerprintCandidate,
    existingById,
    resolutionStatus,
    matchedExistingAsset,
    identityStrength,
    generateId = () => globalThis.crypto.randomUUID(),
  } = input;

  if (matchedPendingRecord && matchedPendingRecord.household_id !== currentHouseholdId) {
    throw new Error(
      "CANDIDATE_HOUSEHOLD_CONFLICT: matched pending candidate belongs to another household",
    );
  }
  if (
    sameSessionFingerprintCandidate &&
    sameSessionFingerprintCandidate.household_id !== currentHouseholdId
  ) {
    throw new Error(
      "CANDIDATE_HOUSEHOLD_CONFLICT: fingerprint candidate belongs to another household",
    );
  }

  let reuseRecord: PendingCandidateRecord | undefined;
  let parentCandidateId: string | undefined;
  let action: "reuse" | "create-child" | "create-new";

  if (sameSessionFingerprintCandidate) {
    reuseRecord = sameSessionFingerprintCandidate;
    action = "reuse";
  } else if (matchedPendingRecord) {
    if (matchedPendingRecord.session_id === currentSessionId) {
      reuseRecord = matchedPendingRecord;
      action = "reuse";
    } else {
      reuseRecord = matchedPendingRecord;
      parentCandidateId = matchedPendingRecord.id;
      action = "create-child";
    }
  } else {
    action = "create-new";
  }

  const matchedPendingForDraft = reuseRecord
    ? pendingRecordToEntityCandidate(reuseRecord)
    : undefined;

  const draftPayload = buildDraftDecisionPayload(
    existingById,
    resolutionStatus,
    matchedExistingAsset,
    matchedPendingForDraft,
    identityStrength,
  );

  const candidateId = action === "reuse" && reuseRecord ? reuseRecord.id : generateId();

  return {
    candidateId,
    action,
    parentCandidateId,
    draftPayload,
  };
}
