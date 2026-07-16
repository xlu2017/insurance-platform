import type { DeductibleRule, LimitRule } from "@autopilot/schemas";

export type MonetaryRuleStatus =
  | "satisfied"
  | "below_minimum"
  | "above_maximum"
  | "not_exact"
  | "below_incumbent"
  | "above_incumbent_deductible"
  | "unknown_actual"
  | "unknown_incumbent";

export interface MonetaryRuleResult {
  satisfied: boolean;
  status: MonetaryRuleStatus;
}

export interface MonetaryRuleInput {
  rule: LimitRule | DeductibleRule;
  required: number;
  actual: number | null | undefined;
  incumbent: number | null | undefined;
  fieldKind: "limit" | "deductible";
}

export function evaluateMonetaryRule({
  rule,
  required,
  actual,
  incumbent,
  fieldKind,
}: MonetaryRuleInput): MonetaryRuleResult {
  if (rule === "any") {
    return { satisfied: true, status: "satisfied" };
  }

  if (actual === null || actual === undefined) {
    return { satisfied: false, status: "unknown_actual" };
  }

  if (rule === "minimum") {
    return actual >= required
      ? { satisfied: true, status: "satisfied" }
      : { satisfied: false, status: "below_minimum" };
  }

  if (rule === "maximum") {
    return actual <= required
      ? { satisfied: true, status: "satisfied" }
      : { satisfied: false, status: "above_maximum" };
  }

  if (rule === "exact") {
    return actual === required
      ? { satisfied: true, status: "satisfied" }
      : { satisfied: false, status: "not_exact" };
  }

  if (rule === "match_current_or_better") {
    if (incumbent === null || incumbent === undefined) {
      return { satisfied: false, status: "unknown_incumbent" };
    }
    if (fieldKind === "limit") {
      return actual >= incumbent
        ? { satisfied: true, status: "satisfied" }
        : { satisfied: false, status: "below_incumbent" };
    } else {
      return actual <= incumbent
        ? { satisfied: true, status: "satisfied" }
        : { satisfied: false, status: "above_incumbent_deductible" };
    }
  }

  return { satisfied: false, status: "unknown_actual" };
}
