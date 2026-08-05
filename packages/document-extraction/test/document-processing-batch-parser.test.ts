import { describe, expect, it } from "vitest";
import { isUuid, parseCaseId } from "../src/document-processing-contract";

describe("document-processing-batch contract parser", () => {
  describe("isUuid", () => {
    it("accepts lowercase and uppercase UUIDs", () => {
      expect(isUuid("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")).toBe(true);
      expect(isUuid("A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11")).toBe(true);
    });

    it("rejects malformed identifiers", () => {
      expect(isUuid("not-a-uuid")).toBe(false);
      expect(isUuid("")).toBe(false);
      expect(isUuid("a0eebc999c0b4ef8bb6d6bb9bd380a11")).toBe(false);
      expect(isUuid(" a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 ")).toBe(false);
    });
  });

  describe("parseCaseId", () => {
    it("treats an omitted property as none", () => {
      expect(parseCaseId(undefined, false)).toEqual({ kind: "none" });
    });

    it("treats a present null as invalid", () => {
      expect(parseCaseId(null, true)).toEqual({ kind: "invalid", reason: "Invalid case_id" });
    });

    it("rejects empty and whitespace strings", () => {
      expect(parseCaseId("", true)).toEqual({ kind: "invalid", reason: "Invalid case_id" });
      expect(parseCaseId("   ", true)).toEqual({ kind: "invalid", reason: "Invalid case_id" });
    });

    it("rejects non-string values", () => {
      expect(parseCaseId(123, true)).toEqual({ kind: "invalid", reason: "Invalid case_id" });
      expect(parseCaseId({}, true)).toEqual({ kind: "invalid", reason: "Invalid case_id" });
      expect(parseCaseId(["uuid"], true)).toEqual({ kind: "invalid", reason: "Invalid case_id" });
    });

    it("rejects malformed UUID strings", () => {
      expect(parseCaseId("not-a-uuid", true)).toEqual({
        kind: "invalid",
        reason: "Invalid case_id",
      });
      expect(parseCaseId("00000000-0000-0000-0000-000000000000-extra", true)).toEqual({
        kind: "invalid",
        reason: "Invalid case_id",
      });
    });

    it("trims and returns valid UUIDs", () => {
      expect(parseCaseId("  a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11  ", true)).toEqual({
        kind: "valid",
        value: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      });
    });
  });
});
