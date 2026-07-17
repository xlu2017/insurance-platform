import { describe, expect, it } from "vitest";
import {
  normalizePostalCode,
  normalizeProvince,
  parseMoneyCents,
  parseDateIso,
} from "../src/parsers/helpers";

describe("parser helpers", () => {
  it("normalizes postal codes", () => {
    expect(normalizePostalCode("T3A0Z4")).toBe("T3A 0Z4");
    expect(normalizePostalCode("t3a 0z4")).toBe("T3A 0Z4");
    expect(normalizePostalCode("not a postal")).toBeUndefined();
  });

  it("normalizes provinces", () => {
    expect(normalizeProvince("AB")).toBe("AB");
    expect(normalizeProvince("Alberta")).toBe("AB");
    expect(normalizeProvince("ON")).toBe("ON");
    expect(normalizeProvince("Quebec")).toBe("QC");
    expect(normalizeProvince("California")).toBeUndefined();
  });

  it("parses money as cents", () => {
    expect(parseMoneyCents("$1,234.56")).toBe(123456);
    expect(parseMoneyCents("$0")).toBe(0);
    expect(parseMoneyCents("free")).toBeNull();
  });

  it("parses ISO dates", () => {
    expect(parseDateIso("2025-09-24")).toBe("2025-09-24");
    expect(parseDateIso("September 24, 2025")).toBe("2025-09-24");
    expect(parseDateIso("n/a")).toBeNull();
  });
});
