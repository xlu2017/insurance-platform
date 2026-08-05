import { describe, expect, it } from "vitest";
import {
  isUuid,
  parseCaseId,
  relevantStatuses,
  resumableStatuses,
  resolveLatestActionStatuses,
} from "../src/document-processing-contract";

describe("document-processing-batch action contract", () => {
  it("resumable statuses only include batches that accept more uploads", () => {
    expect(resumableStatuses).toEqual(["uploading_files", "additional_information_required"]);
  });

  it("relevant statuses include all customer-visible processing and review states", () => {
    expect(relevantStatuses).toContain("uploading_files");
    expect(relevantStatuses).toContain("checking_duplicates");
    expect(relevantStatuses).toContain("queued");
    expect(relevantStatuses).toContain("reading_policy_documents");
    expect(relevantStatuses).toContain("comparing_policies");
    expect(relevantStatuses).toContain("validating_extracted_details");
    expect(relevantStatuses).toContain("ready_for_review");
    expect(relevantStatuses).toContain("additional_information_required");
    expect(relevantStatuses).toContain("processing_unavailable");
    expect(relevantStatuses).toContain("manual_review");
    expect(relevantStatuses.length).toBeGreaterThan(resumableStatuses.length);
  });

  it("legacy latest actions resolve to resumable statuses", () => {
    for (const action of ["latest", "latest-for-case"]) {
      expect(resolveLatestActionStatuses(action)).toBe(resumableStatuses);
    }
  });

  it("explicit resumable actions resolve to resumable statuses", () => {
    for (const action of ["latest-resumable", "latest-resumable-for-case"]) {
      expect(resolveLatestActionStatuses(action)).toBe(resumableStatuses);
    }
  });

  it("relevant actions resolve to relevant statuses", () => {
    for (const action of ["latest-relevant", "latest-relevant-for-case"]) {
      expect(resolveLatestActionStatuses(action)).toBe(relevantStatuses);
    }
  });

  it("unknown actions resolve to null", () => {
    expect(resolveLatestActionStatuses("create")).toBeNull();
    expect(resolveLatestActionStatuses("submit")).toBeNull();
  });
});

describe("document-processing-batch parser contract", () => {
  it("rejects every present invalid case_id", () => {
    expect(parseCaseId("")).toEqual({ kind: "invalid", reason: "Invalid case_id" });
    expect(parseCaseId("   ")).toEqual({ kind: "invalid", reason: "Invalid case_id" });
    expect(parseCaseId(null)).toEqual({ kind: "none" });
    expect(parseCaseId(undefined)).toEqual({ kind: "none" });
    expect(parseCaseId(123)).toEqual({ kind: "invalid", reason: "Invalid case_id" });
    expect(parseCaseId({})).toEqual({ kind: "invalid", reason: "Invalid case_id" });
    expect(parseCaseId("not-a-uuid")).toEqual({ kind: "invalid", reason: "Invalid case_id" });
  });

  it("accepts a valid uuid and trims whitespace", () => {
    expect(parseCaseId("  a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11  ")).toEqual({
      kind: "valid",
      value: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    });
  });

  it("isUuid validates uuid shape", () => {
    expect(isUuid("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});
