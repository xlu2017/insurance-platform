import { describe, expect, it } from "vitest";
import {
  selectCandidateForPersistence,
  type CandidateSelectionInput,
} from "../src/candidate-id-selection.ts";
import type { ExistingHouseholdAsset, PendingEntityCandidate } from "../src/document-analyzer.ts";
import type { PendingCandidateRecord } from "../src/pending-candidate-builder.ts";

const HOUSEHOLD_ID = "11111111-1111-1111-1111-111111111111";
const SESSION_A = "22222222-2222-2222-2222-222222222222";
const SESSION_B = "33333333-3333-3333-3333-333333333333";
const CANDIDATE_X = "44444444-4444-4444-4444-444444444444";
const CANDIDATE_Y = "55555555-5555-5555-5555-555555555555";
const VEHICLE_ID = "66666666-6666-6666-6666-666666666666";
const FINGERPRINT = "vehicle:vin:1HGCM82633A123456";

function makeExistingAsset(): ExistingHouseholdAsset {
  return {
    id: VEHICLE_ID,
    assetType: "vehicle",
    identityFingerprint: FINGERPRINT,
    displayLabel: "2018 Honda Civic",
    identity: {
      year: 2018,
      make: "Honda",
      model: "Civic",
    },
  };
}

function makePendingRecord(overrides: Partial<PendingCandidateRecord>): PendingCandidateRecord {
  return {
    id: CANDIDATE_X,
    asset_type: "vehicle",
    identity_fingerprint: FINGERPRINT,
    display_label: "2018 Honda Civic",
    session_id: SESSION_A,
    source_document_ids: ["doc-1"],
    draft_decision: null,
    draft_identity_confirmed: null,
    draft_existing_asset_id: null,
    draft_existing_asset_type: null,
    approved_asset_id: null,
    approved_asset_type: null,
    selected_facts_json: {},
    conflicts_json: [],
    case_id: null,
    household_id: HOUSEHOLD_ID,
    ...overrides,
  } as PendingCandidateRecord;
}

function baseInput(overrides: Partial<CandidateSelectionInput> = {}): CandidateSelectionInput {
  return {
    currentSessionId: SESSION_B,
    currentCaseId: null,
    currentHouseholdId: HOUSEHOLD_ID,
    fingerprint: FINGERPRINT,
    existingById: new Map(),
    resolutionStatus: "matches_pending_candidate",
    identityStrength: "exact",
    generateId: () => CANDIDATE_Y,
    ...overrides,
  };
}

describe("selectCandidateForPersistence", () => {
  it("reuses the same-session matched pending candidate", () => {
    const record = makePendingRecord({ session_id: SESSION_B });
    const result = selectCandidateForPersistence(baseInput({ matchedPendingRecord: record }));
    expect(result.action).toBe("reuse");
    expect(result.candidateId).toBe(CANDIDATE_X);
    expect(result.parentCandidateId).toBeUndefined();
    expect(result.draftPayload._draftDecision).toBe("undecided");
  });

  it("creates a child when the matched pending candidate belongs to a different session in the same case", () => {
    const record = makePendingRecord({
      session_id: SESSION_A,
      case_id: "case-a",
      draft_decision: "link_existing",
      draft_identity_confirmed: true,
      draft_existing_asset_id: VEHICLE_ID,
      draft_existing_asset_type: "vehicle",
    });
    const existing = makeExistingAsset();
    const result = selectCandidateForPersistence(
      baseInput({
        currentCaseId: "case-a",
        matchedPendingRecord: record,
        existingById: new Map([[VEHICLE_ID, existing]]),
      }),
    );
    expect(result.action).toBe("create-child");
    expect(result.candidateId).toBe(CANDIDATE_Y);
    expect(result.parentCandidateId).toBe(CANDIDATE_X);
    expect(result.draftPayload._draftDecision).toBe("link_existing");
    expect(result.draftPayload._draftExistingAssetId).toBe(VEHICLE_ID);
    expect(result.draftPayload._draftExistingAssetType).toBe("vehicle");
    expect(result.draftPayload._draftIdentityConfirmed).toBe(true);
  });

  it("creates a child when the matched pending candidate is in a different case", () => {
    const record = makePendingRecord({
      session_id: SESSION_A,
      case_id: "case-a",
      draft_decision: "approve_new",
      draft_identity_confirmed: true,
    });
    const result = selectCandidateForPersistence(
      baseInput({
        currentCaseId: "case-b",
        matchedPendingRecord: record,
      }),
    );
    expect(result.action).toBe("create-child");
    expect(result.candidateId).toBe(CANDIDATE_Y);
    expect(result.parentCandidateId).toBe(CANDIDATE_X);
    expect(result.draftPayload._draftDecision).toBe("approve_new");
    expect(result.draftPayload._draftIdentityConfirmed).toBe(true);
  });

  it("creates a child when both sessions have a null case_id", () => {
    const record = makePendingRecord({
      session_id: SESSION_A,
      case_id: null,
      draft_decision: "needs_correction",
      draft_identity_confirmed: false,
    });
    const result = selectCandidateForPersistence(
      baseInput({ currentCaseId: null, matchedPendingRecord: record }),
    );
    expect(result.action).toBe("create-child");
    expect(result.candidateId).toBe(CANDIDATE_Y);
    expect(result.parentCandidateId).toBe(CANDIDATE_X);
    expect(result.draftPayload._draftDecision).toBe("needs_correction");
    expect(result.draftPayload._draftIdentityConfirmed).toBe(false);
  });

  it("rejects a cross-household candidate", () => {
    const record = makePendingRecord({
      session_id: SESSION_A,
      household_id: "other-household",
    });
    expect(() =>
      selectCandidateForPersistence(baseInput({ matchedPendingRecord: record })),
    ).toThrow(/CANDIDATE_HOUSEHOLD_CONFLICT/i);
  });

  it("reuses the same-session fingerprint candidate and keeps a stable id on retry", () => {
    const matched = makePendingRecord({
      id: CANDIDATE_X,
      session_id: SESSION_A,
    });
    const sameSession = makePendingRecord({
      id: CANDIDATE_Y,
      session_id: SESSION_B,
      draft_decision: "approve_new",
      draft_identity_confirmed: true,
    });
    const result = selectCandidateForPersistence(
      baseInput({
        currentSessionId: SESSION_B,
        matchedPendingRecord: matched,
        sameSessionFingerprintCandidate: sameSession,
      }),
    );
    expect(result.action).toBe("reuse");
    expect(result.candidateId).toBe(CANDIDATE_Y);
    expect(result.parentCandidateId).toBeUndefined();
    expect(result.draftPayload._draftDecision).toBe("approve_new");
  });

  it("creates a new candidate with no pending match", () => {
    const existing = makeExistingAsset();
    const result = selectCandidateForPersistence(
      baseInput({
        resolutionStatus: "matches_existing",
        matchedExistingAsset: existing,
        existingById: new Map([[VEHICLE_ID, existing]]),
      }),
    );
    expect(result.action).toBe("create-new");
    expect(result.candidateId).toBe(CANDIDATE_Y);
    expect(result.parentCandidateId).toBeUndefined();
    expect(result.draftPayload._draftDecision).toBe("link_existing");
    expect(result.draftPayload._draftExistingAssetId).toBe(VEHICLE_ID);
  });
});
