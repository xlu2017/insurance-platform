import { describe, expect, it } from "vitest";
import { evaluateMonetaryRule } from "../src/rule-evaluator.ts";

describe("evaluateMonetaryRule", () => {
  it("satisfies 'any' regardless of actual", () => {
    expect(
      evaluateMonetaryRule({
        rule: "any",
        required: 0,
        actual: null,
        incumbent: undefined,
        fieldKind: "limit",
      }).status,
    ).toBe("satisfied");
  });

  it("flags below minimum", () => {
    const result = evaluateMonetaryRule({
      rule: "minimum",
      required: 100_000,
      actual: 80_000,
      incumbent: undefined,
      fieldKind: "limit",
    });
    expect(result.satisfied).toBe(false);
    expect(result.status).toBe("below_minimum");
  });

  it("flags above maximum for limit", () => {
    const result = evaluateMonetaryRule({
      rule: "maximum",
      required: 100_000,
      actual: 120_000,
      incumbent: undefined,
      fieldKind: "limit",
    });
    expect(result.satisfied).toBe(false);
    expect(result.status).toBe("above_maximum");
  });

  it("flags not exact", () => {
    const result = evaluateMonetaryRule({
      rule: "exact",
      required: 100_000,
      actual: 99_999,
      incumbent: undefined,
      fieldKind: "limit",
    });
    expect(result.satisfied).toBe(false);
    expect(result.status).toBe("not_exact");
  });

  it("flags unknown actual", () => {
    const result = evaluateMonetaryRule({
      rule: "minimum",
      required: 100_000,
      actual: null,
      incumbent: undefined,
      fieldKind: "limit",
    });
    expect(result.satisfied).toBe(false);
    expect(result.status).toBe("unknown_actual");
  });

  it("compares limits against incumbent (match_current_or_better)", () => {
    const worse = evaluateMonetaryRule({
      rule: "match_current_or_better",
      required: 0,
      actual: 80_000,
      incumbent: 100_000,
      fieldKind: "limit",
    });
    expect(worse.status).toBe("below_incumbent");
    const better = evaluateMonetaryRule({
      rule: "match_current_or_better",
      required: 0,
      actual: 120_000,
      incumbent: 100_000,
      fieldKind: "limit",
    });
    expect(better.status).toBe("satisfied");
  });

  it("compares deductibles against incumbent (lower is better)", () => {
    const worse = evaluateMonetaryRule({
      rule: "match_current_or_better",
      required: 0,
      actual: 1_000,
      incumbent: 500,
      fieldKind: "deductible",
    });
    expect(worse.status).toBe("above_incumbent_deductible");
    const better = evaluateMonetaryRule({
      rule: "match_current_or_better",
      required: 0,
      actual: 500,
      incumbent: 1_000,
      fieldKind: "deductible",
    });
    expect(better.status).toBe("satisfied");
  });

  it("flags unknown incumbent", () => {
    const result = evaluateMonetaryRule({
      rule: "match_current_or_better",
      required: 0,
      actual: 100_000,
      incumbent: undefined,
      fieldKind: "limit",
    });
    expect(result.status).toBe("unknown_incumbent");
  });
});
