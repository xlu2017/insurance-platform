import { describe, expect, it } from "vitest";
import {
  deriveMandateDefault,
  reconcileMandateAfterCurrentCorrection,
  type DerivedMandate,
} from "../src/mandate-defaults";

describe("deriveMandateDefault", () => {
  it("maps limits to minimums and deductibles to maximums", () => {
    expect(
      deriveMandateDefault({ kind: "limit", state: "known", valueCents: 43_800_000 }),
    ).toEqual({
      origin: "defaulted_from_current",
      rule: { type: "minimum", valueCents: 43_800_000 },
    });

    expect(
      deriveMandateDefault({ kind: "deductible", state: "known", valueCents: 200_000 }),
    ).toEqual({
      origin: "defaulted_from_current",
      rule: { type: "maximum", valueCents: 200_000 },
    });
  });

  it("maps coverage forms and optional coverage conservatively", () => {
    expect(
      deriveMandateDefault({
        kind: "coverage_form",
        state: "known",
        value: "  guaranteed_replacement_cost  ",
      }),
    ).toEqual({
      origin: "defaulted_from_current",
      rule: {
        type: "match_current_or_better",
        value: "guaranteed_replacement_cost",
      },
    });

    expect(
      deriveMandateDefault({ kind: "optional_coverage", state: "known", included: true }),
    ).toEqual({
      origin: "defaulted_from_current",
      rule: { type: "required" },
    });

    expect(
      deriveMandateDefault({ kind: "optional_coverage", state: "known", included: false }),
    ).toEqual({
      origin: "defaulted_from_current",
      rule: { type: "indifferent" },
    });
  });

  it("never invents zero or false for unknown and inapplicable values", () => {
    expect(deriveMandateDefault({ kind: "limit", state: "unknown" })).toEqual({
      origin: "defaulted_from_current",
      rule: { type: "no_requirement", reason: "unknown_current_value" },
    });

    expect(
      deriveMandateDefault({ kind: "optional_coverage", state: "not_applicable" }),
    ).toEqual({
      origin: "defaulted_from_current",
      rule: { type: "no_requirement", reason: "not_applicable" },
    });
  });

  it("rejects missing, negative, fractional, and unsafe numeric values", () => {
    for (const valueCents of [undefined, -1, 10.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        deriveMandateDefault({ kind: "limit", state: "known", valueCents }),
      ).toEqual({
        origin: "defaulted_from_current",
        rule: { type: "no_requirement", reason: "invalid_current_value" },
      });
    }
  });

  it("treats blank forms and unresolved optional coverage as invalid rather than guessing", () => {
    expect(
      deriveMandateDefault({ kind: "coverage_form", state: "known", value: "   " }),
    ).toEqual({
      origin: "defaulted_from_current",
      rule: { type: "no_requirement", reason: "invalid_current_value" },
    });

    expect(
      deriveMandateDefault({ kind: "optional_coverage", state: "known" }),
    ).toEqual({
      origin: "defaulted_from_current",
      rule: { type: "no_requirement", reason: "invalid_current_value" },
    });
  });
});

describe("reconcileMandateAfterCurrentCorrection", () => {
  it("updates a mandate that still defaults from the corrected current value", () => {
    const existing: DerivedMandate = {
      origin: "defaulted_from_current",
      rule: { type: "maximum", valueCents: 200_000 },
    };

    expect(
      reconcileMandateAfterCurrentCorrection(
        { kind: "deductible", state: "known", valueCents: 100_000 },
        existing,
      ),
    ).toEqual({
      origin: "defaulted_from_current",
      rule: { type: "maximum", valueCents: 100_000 },
    });
  });

  it("preserves a customer-customized mandate exactly", () => {
    const customized: DerivedMandate = {
      origin: "customer_customized",
      rule: { type: "maximum", valueCents: 50_000 },
    };

    expect(
      reconcileMandateAfterCurrentCorrection(
        { kind: "deductible", state: "known", valueCents: 250_000 },
        customized,
      ),
    ).toBe(customized);
  });
});
