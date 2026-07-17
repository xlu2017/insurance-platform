export type CurrentCoverageState = "known" | "unknown" | "not_applicable";

export type CurrentCoverage =
  | {
      kind: "limit" | "deductible";
      state: CurrentCoverageState;
      valueCents?: number;
    }
  | {
      kind: "coverage_form";
      state: CurrentCoverageState;
      value?: string;
    }
  | {
      kind: "optional_coverage";
      state: CurrentCoverageState;
      included?: boolean;
    };

export type MandateRule =
  | { type: "minimum"; valueCents: number }
  | { type: "maximum"; valueCents: number }
  | { type: "match_current_or_better"; value: string }
  | { type: "required" }
  | { type: "indifferent" }
  | {
      type: "no_requirement";
      reason: "unknown_current_value" | "not_applicable" | "invalid_current_value";
    };

export type MandateOrigin = "defaulted_from_current" | "customer_customized";

export interface DerivedMandate {
  origin: MandateOrigin;
  rule: MandateRule;
}

function noRequirement(
  reason: Extract<MandateRule, { type: "no_requirement" }>["reason"],
): DerivedMandate {
  return {
    origin: "defaulted_from_current",
    rule: { type: "no_requirement", reason },
  };
}

/**
 * Derives a conservative mandate from a customer-confirmed current coverage value.
 *
 * Unknown, inapplicable, blank, and invalid values never become zero, false, or an
 * invented requirement. The customer may subsequently customize the returned rule.
 */
export function deriveMandateDefault(current: CurrentCoverage): DerivedMandate {
  if (current.state === "unknown") {
    return noRequirement("unknown_current_value");
  }

  if (current.state === "not_applicable") {
    return noRequirement("not_applicable");
  }

  if (current.kind === "limit" || current.kind === "deductible") {
    if (
      current.valueCents === undefined ||
      !Number.isSafeInteger(current.valueCents) ||
      current.valueCents < 0
    ) {
      return noRequirement("invalid_current_value");
    }

    return {
      origin: "defaulted_from_current",
      rule:
        current.kind === "limit"
          ? { type: "minimum", valueCents: current.valueCents }
          : { type: "maximum", valueCents: current.valueCents },
    };
  }

  if (current.kind === "coverage_form") {
    const value = current.value?.trim();
    if (!value) {
      return noRequirement("invalid_current_value");
    }

    return {
      origin: "defaulted_from_current",
      rule: { type: "match_current_or_better", value },
    };
  }

  if (current.kind !== "optional_coverage" || current.included === undefined) {
    return noRequirement("invalid_current_value");
  }

  return {
    origin: "defaulted_from_current",
    rule: current.included ? { type: "required" } : { type: "indifferent" },
  };
}

/**
 * Re-derives a mandate after the customer corrects the current coverage only when
 * the mandate still originates from that current value. Customer-customized rules
 * are preserved byte-for-byte.
 */
export function reconcileMandateAfterCurrentCorrection(
  correctedCurrent: CurrentCoverage,
  existingMandate: DerivedMandate,
): DerivedMandate {
  if (existingMandate.origin === "customer_customized") {
    return existingMandate;
  }

  return deriveMandateDefault(correctedCurrent);
}
