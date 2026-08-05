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
    it("treats undefined and null as omitted", () => {
      expect(parseCaseId(undefined)).toEqual({ kind: "none" });
      expect(parseCaseId(null)).toEqual({ kind: "none" });
    });

    it("rejects empty and whitespace strings", () => {
      expect(parseCaseId("")).toEqual({ kind: "invalid", reason: "Invalid case_id" });
      expect(parseCaseId("   ")).toEqual({ kind: "invalid", reason: "Invalid case_id" });
    });

    it("rejects non-string values", () => {
      expect(parseCaseId(123)).toEqual({ kind: "invalid", reason: "Invalid case_id" });
      expect(parseCaseId({})).toEqual({ kind: "invalid", reason: "Invalid case_id" });
      expect(parseCaseId(["uuid"])).toEqual({ kind: "invalid", reason: "Invalid case_id" });
    });

    it("rejects malformed UUID strings", () => {
      expect(parseCaseId("not-a-uuid")).toEqual({ kind: "invalid", reason: "Invalid case_id" });
      expect(parseCaseId("00000000-0000-0000-0000-000000000000-extra")).toEqual({
        kind: "invalid",
        reason: "Invalid case_id",
      });
    });

    it("trims and returns valid UUIDs", () => {
      expect(parseCaseId("  a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11  ")).toEqual({
        kind: "valid",
        value: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      });
    });
  });
});
