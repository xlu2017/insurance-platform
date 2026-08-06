import { describe, expect, it } from "vitest";
import {
  buildDraftDecisionPayload,
  candidateDisplayLabel,
  computeCanonicalFingerprint,
  mapResolutionStatus,
  occupancyForEntity,
  parsePendingCandidateRecord,
  pendingRecordToEntityCandidate,
} from "../src/pending-candidate-builder.ts";
import type { DetectedInsuranceEntity, ExistingHouseholdAsset } from "../src/document-analyzer.ts";

describe("pending-candidate builder", () => {
  const existingVehicle: ExistingHouseholdAsset = {
    id: "veh-111",
    assetType: "vehicle",
    identityFingerprint: "vehicle:vin:WBA1234567890",
    displayLabel: "2019 BMW 330i",
  };
  const existingProperty: ExistingHouseholdAsset = {
    id: "prop-222",
    assetType: "property",
    identityFingerprint: "property:unit1|123mainst|toronto|on|M4B1B4",
    displayLabel: "123 Main St",
  };

  function makePendingRecord(input: {
    id?: string;
    assetType: "vehicle" | "property";
    fingerprint: string;
    draftDecision: string | null;
    draftIdentityConfirmed: boolean | null;
    draftExistingAssetId?: string | null;
    draftExistingAssetType?: "vehicle" | "property" | null;
    approvedAssetId?: string | null;
    approvedAssetType?: "vehicle" | "property" | null;
    selectedFacts?: Record<string, unknown>;
    caseId?: string | null;
  }) {
    return {
      id: input.id ?? "cand-1",
      asset_type: input.assetType,
      identity_fingerprint: input.fingerprint,
      display_label: "Test candidate",
      session_id: "session-1",
      source_document_ids: ["doc-1"],
      draft_decision: input.draftDecision,
      draft_identity_confirmed: input.draftIdentityConfirmed,
      draft_existing_asset_id: input.draftExistingAssetId ?? null,
      draft_existing_asset_type: input.draftExistingAssetType ?? null,
      approved_asset_id: input.approvedAssetId ?? null,
      approved_asset_type: input.approvedAssetType ?? null,
      selected_facts_json: input.selectedFacts ?? {
        identity: {},
        currentPolicy: {},
        candidateIdentity: {
          exactIdentityFingerprint: null,
          provisionalCandidateKey: input.fingerprint,
          identityStrength: "partial",
        },
      },
      conflicts_json: [],
      case_id: input.caseId ?? null,
    };
  }

  function makeMatchedPendingRecord(record: ReturnType<typeof makePendingRecord>) {
    return pendingRecordToEntityCandidate(record);
  }

  describe("parsePendingCandidateRecord", () => {
    it("parses a vehicle link_existing record with identity confirmed", () => {
      const row = makePendingRecord({
        assetType: "vehicle",
        fingerprint: "vehicle:vin:WBA1234567890",
        draftDecision: "link_existing",
        draftIdentityConfirmed: true,
        draftExistingAssetId: "veh-111",
        draftExistingAssetType: "vehicle",
        approvedAssetId: "veh-111",
        approvedAssetType: "vehicle",
      });
      const parsed = parsePendingCandidateRecord(row);
      expect(parsed.asset_type).toBe("vehicle");
      expect(parsed.draft_decision).toBe("link_existing");
      expect(parsed.draft_identity_confirmed).toBe(true);
      expect(parsed.draft_existing_asset_id).toBe("veh-111");
      expect(parsed.draft_existing_asset_type).toBe("vehicle");
      expect(parsed.approved_asset_id).toBe("veh-111");
      expect(parsed.approved_asset_type).toBe("vehicle");
    });

    it("parses a property link_existing record with identity not confirmed", () => {
      const row = makePendingRecord({
        assetType: "property",
        fingerprint: "property:unit1|123mainst|toronto|on|M4B1B4",
        draftDecision: "link_existing",
        draftIdentityConfirmed: false,
        draftExistingAssetId: "prop-222",
        draftExistingAssetType: "property",
      });
      const parsed = parsePendingCandidateRecord(row);
      expect(parsed.asset_type).toBe("property");
      expect(parsed.draft_decision).toBe("link_existing");
      expect(parsed.draft_identity_confirmed).toBe(false);
      expect(parsed.draft_existing_asset_id).toBe("prop-222");
      expect(parsed.draft_existing_asset_type).toBe("property");
    });

    it("parses approve_new, needs_correction and undecided records", () => {
      const approve = parsePendingCandidateRecord(
        makePendingRecord({
          assetType: "vehicle",
          fingerprint: "vehicle:vin:ABC",
          draftDecision: "approve_new",
          draftIdentityConfirmed: true,
        }),
      );
      const correction = parsePendingCandidateRecord(
        makePendingRecord({
          assetType: "vehicle",
          fingerprint: "vehicle:vin:DEF",
          draftDecision: "needs_correction",
          draftIdentityConfirmed: false,
        }),
      );
      const undecided = parsePendingCandidateRecord(
        makePendingRecord({
          assetType: "property",
          fingerprint: "property:unit1|456kingst|toronto|on|M5A1A1",
          draftDecision: "undecided",
          draftIdentityConfirmed: false,
        }),
      );
      expect(approve.draft_decision).toBe("approve_new");
      expect(approve.draft_identity_confirmed).toBe(true);
      expect(correction.draft_decision).toBe("needs_correction");
      expect(correction.draft_identity_confirmed).toBe(false);
      expect(undecided.draft_decision).toBe("undecided");
      expect(undecided.draft_identity_confirmed).toBe(false);
    });

    it("preserves approved asset lineage", () => {
      const row = makePendingRecord({
        assetType: "vehicle",
        fingerprint: "vehicle:vin:WBA1234567890",
        draftDecision: "link_existing",
        draftIdentityConfirmed: true,
        draftExistingAssetId: "veh-111",
        draftExistingAssetType: "vehicle",
        approvedAssetId: "veh-111",
        approvedAssetType: "vehicle",
      });
      const parsed = parsePendingCandidateRecord(row);
      const candidate = pendingRecordToEntityCandidate(parsed);
      expect(candidate.approvedAssetId).toBe("veh-111");
      expect(candidate.approvedAssetType).toBe("vehicle");
    });

    it("rejects an invalid row", () => {
      expect(() => parsePendingCandidateRecord(null)).toThrow();
      expect(() => parsePendingCandidateRecord({ id: "x" })).toThrow();
    });
  });

  describe("buildDraftDecisionPayload from parsed pending candidates", () => {
    const existingById = new Map([
      [existingVehicle.id, existingVehicle],
      [existingProperty.id, existingProperty],
    ]);

    it("preserves link_existing vehicle lineage for matches_pending_candidate", () => {
      const record = makePendingRecord({
        assetType: "vehicle",
        fingerprint: "vehicle:vin:WBA1234567890",
        draftDecision: "link_existing",
        draftIdentityConfirmed: true,
        draftExistingAssetId: existingVehicle.id,
        draftExistingAssetType: "vehicle",
      });
      const parsed = parsePendingCandidateRecord(record);
      const matched = pendingRecordToEntityCandidate(parsed);
      const payload = buildDraftDecisionPayload(
        existingById,
        "matches_pending_candidate",
        undefined,
        matched,
        "exact",
      );
      expect(payload._draftDecision).toBe("link_existing");
      expect(payload._draftExistingAssetId).toBe(existingVehicle.id);
      expect(payload._draftExistingAssetType).toBe("vehicle");
      expect(payload._draftIdentityConfirmed).toBe(true);
      expect(payload.existingAsset).toBeDefined();
      expect(payload.existingAsset?.id).toBe(existingVehicle.id);
      expect(payload.existingAsset?.asset_type).toBe("vehicle");
    });

    it("preserves link_existing property lineage for matches_pending_candidate", () => {
      const record = makePendingRecord({
        assetType: "property",
        fingerprint: existingProperty.identityFingerprint,
        draftDecision: "link_existing",
        draftIdentityConfirmed: true,
        draftExistingAssetId: existingProperty.id,
        draftExistingAssetType: "property",
      });
      const parsed = parsePendingCandidateRecord(record);
      const matched = pendingRecordToEntityCandidate(parsed);
      const payload = buildDraftDecisionPayload(
        existingById,
        "matches_pending_candidate",
        undefined,
        matched,
        "exact",
      );
      expect(payload._draftDecision).toBe("link_existing");
      expect(payload._draftExistingAssetId).toBe(existingProperty.id);
      expect(payload._draftExistingAssetType).toBe("property");
      expect(payload._draftIdentityConfirmed).toBe(true);
    });

    it("preserves approve_new decision for matches_pending_candidate", () => {
      const record = makePendingRecord({
        assetType: "vehicle",
        fingerprint: "vehicle:vin:ABC",
        draftDecision: "approve_new",
        draftIdentityConfirmed: true,
      });
      const parsed = parsePendingCandidateRecord(record);
      const matched = pendingRecordToEntityCandidate(parsed);
      const payload = buildDraftDecisionPayload(
        existingById,
        "matches_pending_candidate",
        undefined,
        matched,
        "partial",
      );
      expect(payload._draftDecision).toBe("approve_new");
      expect(payload._draftExistingAssetId).toBeUndefined();
      expect(payload._draftIdentityConfirmed).toBe(true);
      expect(payload.existingAsset).toBeUndefined();
    });

    it("preserves needs_correction decision for matches_pending_candidate", () => {
      const record = makePendingRecord({
        assetType: "vehicle",
        fingerprint: "vehicle:vin:DEF",
        draftDecision: "needs_correction",
        draftIdentityConfirmed: false,
      });
      const parsed = parsePendingCandidateRecord(record);
      const matched = pendingRecordToEntityCandidate(parsed);
      const payload = buildDraftDecisionPayload(
        existingById,
        "matches_pending_candidate",
        undefined,
        matched,
        "partial",
      );
      expect(payload._draftDecision).toBe("needs_correction");
      expect(payload._draftIdentityConfirmed).toBe(false);
      expect(payload.existingAsset).toBeUndefined();
    });

    it("preserves undecided decision for matches_pending_candidate", () => {
      const record = makePendingRecord({
        assetType: "property",
        fingerprint: "property:unit1|456kingst|toronto|on|M5A1A1",
        draftDecision: "undecided",
        draftIdentityConfirmed: false,
      });
      const parsed = parsePendingCandidateRecord(record);
      const matched = pendingRecordToEntityCandidate(parsed);
      const payload = buildDraftDecisionPayload(
        existingById,
        "matches_pending_candidate",
        undefined,
        matched,
        "partial",
      );
      expect(payload._draftDecision).toBe("undecided");
      expect(payload._draftIdentityConfirmed).toBe(false);
      expect(payload._draftExistingAssetId).toBeUndefined();
    });
  });

  describe("utility functions", () => {
    it("mapResolutionStatus maps status values correctly", () => {
      const base = {
        temporaryId: "t1",
        canonicalFingerprint: "f1",
        candidateIdentity: {
          exactIdentityFingerprint: null,
          provisionalCandidateKey: "f1",
          identityStrength: "partial" as const,
        },
        entityType: "vehicle" as const,
        displayLabel: "Test",
        identity: { vin: "ABC" },
        resolution: { status: "new" as const, confidence: 1, reasoning: "new" },
        currentPolicy: {},
        currentCoverage: {},
        mandateSuggestions: {},
        evidence: [],
        requiredConfirmations: [],
      };
      expect(mapResolutionStatus(base)).toBe("new");
      expect(
        mapResolutionStatus({
          ...base,
          resolution: {
            status: "possible_match_requires_confirmation" as const,
            confidence: 0.5,
            reasoning: "possible",
          },
        }),
      ).toBe("new_identity_confirmation_required");
      expect(
        mapResolutionStatus({
          ...base,
          resolution: {
            status: "possible_match_requires_confirmation" as const,
            confidence: 0.5,
            reasoning: "possible",
            matchedExistingEntityId: "veh-111",
          },
        }),
      ).toBe("possible_existing_match");
      expect(
        mapResolutionStatus({
          ...base,
          resolution: { status: "matches_existing" as const, confidence: 1, reasoning: "match" },
        }),
      ).toBe("exact_existing_match");
    });

    it("computeCanonicalFingerprint and occupancy helpers produce stable values", () => {
      const vehicle: DetectedInsuranceEntity = {
        temporaryId: "t1",
        canonicalFingerprint: "",
        candidateIdentity: {
          exactIdentityFingerprint: null,
          provisionalCandidateKey: "possible:t1",
          identityStrength: "partial",
        },
        entityType: "vehicle",
        displayLabel: "",
        identity: { vin: "WBA1234567890ABCD", year: 2019, make: "BMW", model: "330i" },
        resolution: { status: "new" as const, confidence: 1, reasoning: "new" },
        currentPolicy: {},
        currentCoverage: {},
        mandateSuggestions: {},
        evidence: [],
        requiredConfirmations: [],
      };
      const vehicleFingerprint = computeCanonicalFingerprint(vehicle);
      expect(vehicleFingerprint.length).toBeGreaterThan(0);
      expect(vehicleFingerprint.startsWith("vehicle:vin:")).toBe(true);
      expect(occupancyForEntity(vehicle)).toBeNull();
      expect(candidateDisplayLabel(vehicle)).toBe("2019 BMW 330i");

      const property: DetectedInsuranceEntity = {
        temporaryId: "t2",
        canonicalFingerprint: "",
        candidateIdentity: {
          exactIdentityFingerprint: null,
          provisionalCandidateKey: "possible:t2",
          identityStrength: "partial",
        },
        entityType: "property",
        displayLabel: "",
        identity: {
          fullAddress: "123 Main St",
          city: "Toronto",
          province: "ON",
          postalCode: "M4B 1B4",
          occupancy: "principal_residence",
        },
        resolution: { status: "new" as const, confidence: 1, reasoning: "new" },
        currentPolicy: {},
        currentCoverage: {},
        mandateSuggestions: {},
        evidence: [],
        requiredConfirmations: [],
      };
      const propertyFingerprint = computeCanonicalFingerprint(property);
      expect(propertyFingerprint.length).toBeGreaterThan(0);
      expect(occupancyForEntity(property)).toBe("principal_residence");
      expect(candidateDisplayLabel(property)).toContain("123 Main St");
    });
  });
});
