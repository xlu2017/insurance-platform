import {
  type LlmAssertion,
  type LlmExtractionRequest,
  type LlmExtractionResult,
  parseLlmExtractionResult,
} from "./llm-contract.ts";
import { normalizePostalCode, normalizeVin, parseDateIso } from "./parsers/helpers.ts";

export const LLM_SEMANTIC_VALIDATION_VERSION = 1 as const;

export type LlmSemanticIssueSeverity = "error" | "warning";

export type LlmSemanticIssueCode =
  | "EVIDENCE_TEXT_NOT_FOUND"
  | "EVIDENCE_PAGE_NOT_PROVIDED"
  | "DUPLICATE_FIELD_ASSERTION"
  | "UNDECLARED_CONFLICT"
  | "INVALID_CONFLICT_REFERENCE"
  | "CONFLICT_FIELD_MISMATCH"
  | "CONFLICT_ENTITY_MISMATCH"
  | "IDENTITY_ASSERTION_KIND_MISMATCH"
  | "IDENTITY_ASSERTION_ENTITY_MISMATCH"
  | "INVALID_MONEY_CENTS"
  | "INVALID_ISO_DATE"
  | "INVALID_VIN"
  | "INVALID_POSTAL_CODE"
  | "POLICY_TERM_DATE_ORDER"
  | "NOT_APPLICABLE_HAS_VALUE"
  | "TEMPORAL_ACTIVITY_CONTRADICTION"
  | "ACTIVE_COVERAGE_WITHOUT_CURRENT_TERM"
  | "ASSET_COVERAGE_TARGET_MISSING"
  | "ASSET_COVERAGE_OTHER_ASSET_INCLUDED"
  | "UNREFERENCED_ASSERTION_ENTITY"
  | "LOW_CONFIDENCE_EXACT_MATCH_PROPOSAL";

export interface LlmSemanticIssue {
  severity: LlmSemanticIssueSeverity;
  code: LlmSemanticIssueCode;
  path: Array<string | number>;
  message: string;
  assertionId?: string;
  entityRef?: string;
}

export interface LlmSemanticValidationResult {
  validationVersion: typeof LLM_SEMANTIC_VALIDATION_VERSION;
  valid: boolean;
  issues: LlmSemanticIssue[];
}

export class LlmSemanticValidationError extends Error {
  readonly issues: LlmSemanticIssue[];

  constructor(issues: LlmSemanticIssue[]) {
    super(
      `LLM extraction failed semantic validation with ${issues.filter((issue) => issue.severity === "error").length} error(s)`,
    );
    this.name = "LlmSemanticValidationError";
    this.issues = issues;
  }
}

function canonicalText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && valuesEqual(left[key], right[key]))
    );
  }
  return false;
}

function knownComparableValue(assertion: LlmAssertion): unknown {
  return assertion.normalizedValue !== undefined ? assertion.normalizedValue : assertion.value;
}

function isMoneyCentsField(fieldPath: string): boolean {
  return /(?:^|\.)(?:annualPremiumCents|premiumCents|feeCents|amountCents|limitCents|deductibleCents)$/i.test(
    fieldPath,
  );
}

function isDateField(fieldPath: string): boolean {
  return /(?:^|\.)(?:effectiveDate|expiryDate|renewalDate|date)$/i.test(fieldPath);
}

function isVinField(fieldPath: string): boolean {
  return /(?:^|\.)vin$/i.test(fieldPath);
}

function isPostalCodeField(fieldPath: string): boolean {
  return /(?:^|\.)postalCode$/i.test(fieldPath);
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDateIso(value);
  if (parsed !== value) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function addIssue(
  issues: LlmSemanticIssue[],
  issue: Omit<LlmSemanticIssue, "severity"> & { severity?: LlmSemanticIssueSeverity },
): void {
  issues.push({ ...issue, severity: issue.severity ?? "error" });
}

function validateEvidence(
  result: LlmExtractionResult,
  request: LlmExtractionRequest,
  issues: LlmSemanticIssue[],
): void {
  const pages = new Map(request.pages.map((page) => [page.pageNumber, canonicalText(page.text)]));

  result.assertions.forEach((assertion, assertionIndex) => {
    assertion.evidence.forEach((evidence, evidenceIndex) => {
      const pageText = pages.get(evidence.pageNumber);
      if (pageText === undefined) {
        addIssue(issues, {
          code: "EVIDENCE_PAGE_NOT_PROVIDED",
          path: ["assertions", assertionIndex, "evidence", evidenceIndex, "pageNumber"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `Evidence cites page ${evidence.pageNumber}, which was not supplied to the model`,
        });
        return;
      }

      const excerpt = canonicalText(evidence.evidenceText);
      if (excerpt.length < 3 || !pageText.includes(excerpt)) {
        addIssue(issues, {
          code: "EVIDENCE_TEXT_NOT_FOUND",
          path: ["assertions", assertionIndex, "evidence", evidenceIndex, "evidenceText"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `Evidence excerpt for ${assertion.fieldPath} was not found on supplied page ${evidence.pageNumber}`,
        });
      }
    });
  });
}

function validateFieldValues(result: LlmExtractionResult, issues: LlmSemanticIssue[]): void {
  result.assertions.forEach((assertion, assertionIndex) => {
    const value = knownComparableValue(assertion);

    if (
      assertion.status === "not_applicable" &&
      value !== undefined &&
      value !== null &&
      value !== false
    ) {
      addIssue(issues, {
        code: "NOT_APPLICABLE_HAS_VALUE",
        path: ["assertions", assertionIndex, "normalizedValue"],
        assertionId: assertion.id,
        entityRef: assertion.entityRef,
        message: `${assertion.fieldPath} is not applicable but contains a substantive value`,
      });
    }

    if (value !== undefined && isMoneyCentsField(assertion.fieldPath)) {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        addIssue(issues, {
          code: "INVALID_MONEY_CENTS",
          path: ["assertions", assertionIndex, "normalizedValue"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `${assertion.fieldPath} must be a non-negative safe integer number of cents`,
        });
      }
    }

    if (value !== undefined && isDateField(assertion.fieldPath)) {
      if (typeof value !== "string" || !isValidIsoDate(value)) {
        addIssue(issues, {
          code: "INVALID_ISO_DATE",
          path: ["assertions", assertionIndex, "normalizedValue"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `${assertion.fieldPath} must be a real ISO calendar date in YYYY-MM-DD form`,
        });
      }
    }

    if (value !== undefined && isVinField(assertion.fieldPath)) {
      if (typeof value !== "string") {
        addIssue(issues, {
          code: "INVALID_VIN",
          path: ["assertions", assertionIndex, "normalizedValue"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `${assertion.fieldPath} is not a string VIN`,
        });
      } else {
        const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
        const normalized = normalizeVin(value);
        if (!normalized || normalized.normalized !== compact) {
          addIssue(issues, {
            code: "INVALID_VIN",
            path: ["assertions", assertionIndex, "normalizedValue"],
            assertionId: assertion.id,
            entityRef: assertion.entityRef,
            message: `${assertion.fieldPath} is not a valid normalized 17-character VIN`,
          });
        }
      }
    }

    if (value !== undefined && isPostalCodeField(assertion.fieldPath)) {
      if (typeof value !== "string") {
        addIssue(issues, {
          code: "INVALID_POSTAL_CODE",
          path: ["assertions", assertionIndex, "normalizedValue"],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `${assertion.fieldPath} is not a string postal code`,
        });
      } else {
        const normalized = normalizePostalCode(value);
        if (!normalized || normalized !== value.toUpperCase()) {
          addIssue(issues, {
            code: "INVALID_POSTAL_CODE",
            path: ["assertions", assertionIndex, "normalizedValue"],
            assertionId: assertion.id,
            entityRef: assertion.entityRef,
            message: `${assertion.fieldPath} must be a normalized Canadian postal code such as T3A 0G9`,
          });
        }
      }
    }

    if (
      assertion.coverageActivity === "future_change" &&
      assertion.temporalApplicability === "current_term"
    ) {
      addIssue(issues, {
        code: "TEMPORAL_ACTIVITY_CONTRADICTION",
        path: ["assertions", assertionIndex],
        assertionId: assertion.id,
        entityRef: assertion.entityRef,
        message: "A future coverage change cannot apply to the current term",
      });
    }

    if (
      assertion.coverageActivity === "active" &&
      assertion.temporalApplicability !== "current_term"
    ) {
      addIssue(issues, {
        code: "ACTIVE_COVERAGE_WITHOUT_CURRENT_TERM",
        path: ["assertions", assertionIndex],
        assertionId: assertion.id,
        entityRef: assertion.entityRef,
        message: "Active coverage must be identified as applying to the current term",
      });
    }
  });
}

function validateIdentityReferences(result: LlmExtractionResult, issues: LlmSemanticIssue[]): void {
  const assertions = new Map(result.assertions.map((assertion) => [assertion.id, assertion]));

  result.assets.forEach((asset, assetIndex) => {
    asset.identityAssertionIds.forEach((assertionId, referenceIndex) => {
      const assertion = assertions.get(assertionId);
      if (!assertion) return;

      if (assertion.factKind !== "identity") {
        addIssue(issues, {
          code: "IDENTITY_ASSERTION_KIND_MISMATCH",
          path: ["assets", assetIndex, "identityAssertionIds", referenceIndex],
          assertionId,
          entityRef: asset.localId,
          message: `Asset identity reference ${assertionId} points to a ${assertion.factKind} assertion`,
        });
      }

      if (assertion.entityRef !== asset.localId) {
        addIssue(issues, {
          code: "IDENTITY_ASSERTION_ENTITY_MISMATCH",
          path: ["assets", assetIndex, "identityAssertionIds", referenceIndex],
          assertionId,
          entityRef: asset.localId,
          message: `Identity assertion ${assertionId} belongs to ${assertion.entityRef}, not ${asset.localId}`,
        });
      }
    });

    if (
      asset.proposedMatchClassification === "exact_existing_match_proposed" &&
      asset.identityAssertionIds.some((id) => (assertions.get(id)?.confidence ?? 0) < 0.95)
    ) {
      addIssue(issues, {
        severity: "warning",
        code: "LOW_CONFIDENCE_EXACT_MATCH_PROPOSAL",
        path: ["assets", assetIndex, "proposedMatchClassification"],
        entityRef: asset.localId,
        message: "An exact-match proposal contains an identity assertion below 0.95 confidence",
      });
    }
  });
}

function validateDuplicateAndConflictSemantics(
  result: LlmExtractionResult,
  issues: LlmSemanticIssue[],
): void {
  const grouped = new Map<string, Array<{ assertion: LlmAssertion; index: number }>>();
  result.assertions.forEach((assertion, index) => {
    const key = `${assertion.entityRef}|${assertion.fieldPath}|${assertion.temporalApplicability}`;
    const group = grouped.get(key) ?? [];
    group.push({ assertion, index });
    grouped.set(key, group);
  });

  const declaredConflictAssertions = new Set(
    result.conflicts.flatMap((conflict) => conflict.assertionIds),
  );

  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    const known = group.filter(({ assertion }) =>
      ["known", "requires_confirmation"].includes(assertion.status),
    );
    if (known.length < 2) continue;

    const [firstKnown] = known;
    if (!firstKnown) continue;
    const firstValue = knownComparableValue(firstKnown.assertion);
    const allEqual = known.every(({ assertion }) =>
      valuesEqual(firstValue, knownComparableValue(assertion)),
    );

    if (allEqual) {
      known.slice(1).forEach(({ assertion, index }) => {
        addIssue(issues, {
          severity: "warning",
          code: "DUPLICATE_FIELD_ASSERTION",
          path: ["assertions", index],
          assertionId: assertion.id,
          entityRef: assertion.entityRef,
          message: `Duplicate assertion for ${assertion.fieldPath} should be represented as additional evidence on one assertion`,
        });
      });
      continue;
    }

    const allDeclared = known.every(({ assertion }) =>
      declaredConflictAssertions.has(assertion.id),
    );
    if (!allDeclared) {
      addIssue(issues, {
        code: "UNDECLARED_CONFLICT",
        path: ["assertions", firstKnown.index],
        assertionId: firstKnown.assertion.id,
        entityRef: firstKnown.assertion.entityRef,
        message: `Different values for ${firstKnown.assertion.fieldPath} require an explicit conflict`,
      });
    }
  }

  const assertionById = new Map(result.assertions.map((assertion) => [assertion.id, assertion]));
  result.conflicts.forEach((conflict, conflictIndex) => {
    const referenced = conflict.assertionIds
      .map((id) => assertionById.get(id))
      .filter((assertion): assertion is LlmAssertion => assertion !== undefined);

    if (referenced.length !== conflict.assertionIds.length) {
      addIssue(issues, {
        code: "INVALID_CONFLICT_REFERENCE",
        path: ["conflicts", conflictIndex, "assertionIds"],
        entityRef: conflict.entityRef,
        message: "Conflict references an assertion that does not exist",
      });
      return;
    }

    if (referenced.some((assertion) => assertion.fieldPath !== conflict.fieldPath)) {
      addIssue(issues, {
        code: "CONFLICT_FIELD_MISMATCH",
        path: ["conflicts", conflictIndex, "fieldPath"],
        entityRef: conflict.entityRef,
        message: "Every assertion in a conflict must use the conflict fieldPath",
      });
    }

    if (referenced.some((assertion) => assertion.entityRef !== conflict.entityRef)) {
      addIssue(issues, {
        code: "CONFLICT_ENTITY_MISMATCH",
        path: ["conflicts", conflictIndex, "entityRef"],
        entityRef: conflict.entityRef,
        message: "Every assertion in a conflict must belong to the same entity",
      });
    }
  });
}

function validatePolicyTermDates(result: LlmExtractionResult, issues: LlmSemanticIssue[]): void {
  const assertions = new Map(result.assertions.map((assertion) => [assertion.id, assertion]));

  result.policyTerms.forEach((term, termIndex) => {
    const effective = term.effectiveDateAssertionId
      ? assertions.get(term.effectiveDateAssertionId)
      : undefined;
    const expiry = term.expiryDateAssertionId
      ? assertions.get(term.expiryDateAssertionId)
      : undefined;
    const effectiveValue = effective ? knownComparableValue(effective) : undefined;
    const expiryValue = expiry ? knownComparableValue(expiry) : undefined;

    if (
      typeof effectiveValue === "string" &&
      typeof expiryValue === "string" &&
      isValidIsoDate(effectiveValue) &&
      isValidIsoDate(expiryValue) &&
      effectiveValue >= expiryValue
    ) {
      addIssue(issues, {
        code: "POLICY_TERM_DATE_ORDER",
        path: ["policyTerms", termIndex],
        entityRef: term.localId,
        message: `Policy effective date ${effectiveValue} must be before expiry date ${expiryValue}`,
      });
    }
  });
}

function validatePassScope(
  result: LlmExtractionResult,
  request: LlmExtractionRequest,
  issues: LlmSemanticIssue[],
): void {
  if (request.pass.kind !== "asset_coverage") return;

  const target = request.pass.targetAssetLocalId;
  const assetIds = new Set(result.assets.map((asset) => asset.localId));
  if (!assetIds.has(target)) {
    addIssue(issues, {
      code: "ASSET_COVERAGE_TARGET_MISSING",
      path: ["assets"],
      entityRef: target,
      message: `Asset-coverage result does not include target asset ${target}`,
    });
  }

  result.assets.forEach((asset, index) => {
    if (asset.localId !== target) {
      addIssue(issues, {
        code: "ASSET_COVERAGE_OTHER_ASSET_INCLUDED",
        path: ["assets", index],
        entityRef: asset.localId,
        message: `Asset-coverage pass for ${target} must not emit another asset ${asset.localId}`,
      });
    }
  });

  const declaredEntities = new Set([
    ...result.assets.map((asset) => asset.localId),
    ...result.policyTerms.map((term) => term.localId),
  ]);
  result.assertions.forEach((assertion, index) => {
    if (!declaredEntities.has(assertion.entityRef)) {
      addIssue(issues, {
        code: "UNREFERENCED_ASSERTION_ENTITY",
        path: ["assertions", index, "entityRef"],
        assertionId: assertion.id,
        entityRef: assertion.entityRef,
        message: `Assertion entityRef ${assertion.entityRef} is not declared in the extraction result`,
      });
    }
  });
}

/**
 * Performs deterministic checks that are intentionally outside the LLM schema.
 * This function never mutates, matches, merges, persists, or derives mandates.
 */
export function validateLlmExtractionSemantics(
  raw: unknown,
  request: LlmExtractionRequest,
): LlmSemanticValidationResult {
  const result = parseLlmExtractionResult(raw, request);
  const issues: LlmSemanticIssue[] = [];

  validateEvidence(result, request, issues);
  validateFieldValues(result, issues);
  validateIdentityReferences(result, issues);
  validateDuplicateAndConflictSemantics(result, issues);
  validatePolicyTermDates(result, issues);
  validatePassScope(result, request, issues);

  return {
    validationVersion: LLM_SEMANTIC_VALIDATION_VERSION,
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

export function assertLlmExtractionSemantics(
  raw: unknown,
  request: LlmExtractionRequest,
): LlmExtractionResult {
  const result = parseLlmExtractionResult(raw, request);
  const validation = validateLlmExtractionSemantics(result, request);
  if (!validation.valid) throw new LlmSemanticValidationError(validation.issues);
  return result;
}
