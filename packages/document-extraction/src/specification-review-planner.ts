import type { ExtractedFactAssertion } from "./types.ts";

export type SpecificationReviewStatus =
  | "ready_for_confirmation"
  | "conflicting"
  | "missing_value";

export interface SpecificationEvidence {
  assertionId: string;
  documentId: string;
  pageNumber: number;
  rawText: string;
  authority: ExtractedFactAssertion["authority"];
  confidence: number;
  parsedValue: unknown;
  normalizedValue: unknown;
}

export interface SpecificationReviewRow {
  /** Stable within one extraction result; suitable for React keys and draft persistence. */
  id: string;
  fieldPath: string;
  status: SpecificationReviewStatus;
  /** Every imported specification must be explicitly confirmed by the customer. */
  requiresConfirmation: true;
  /** The assertion currently selected as the source of truth, when selection is safe. */
  selectedAssertionId?: string;
  /** Extracted present-day policy value shown to the customer. */
  currentValue?: unknown;
  /** Initial mandate value. The UI may edit this independently from currentValue. */
  mandatedValue?: unknown;
  evidence: SpecificationEvidence[];
  reason?: string;
}

export interface SpecificationConflictInput {
  fieldPath: string;
  assertionIds: string[];
  selectedAssertionId?: string;
  reason: string;
}

export interface BuildSpecificationReviewRowsInput {
  /** Assertions must already be scoped to the asset being reviewed. */
  assertions: ExtractedFactAssertion[];
  conflicts?: SpecificationConflictInput[];
}

const authorityPriority: Record<ExtractedFactAssertion["authority"], number> = {
  insurance_certificate: 70,
  coverage_summary: 60,
  endorsement: 50,
  renewal_overview: 40,
  invoice: 30,
  notice: 20,
  header_footer: 10,
};

function hasUsableValue(assertion: ExtractedFactAssertion): boolean {
  return assertion.normalizedValue !== undefined && assertion.normalizedValue !== null;
}

function compareAssertions(a: ExtractedFactAssertion, b: ExtractedFactAssertion): number {
  const authorityDifference = authorityPriority[b.authority] - authorityPriority[a.authority];
  if (authorityDifference !== 0) return authorityDifference;

  const confidenceDifference = b.confidence - a.confidence;
  if (confidenceDifference !== 0) return confidenceDifference;

  const pageDifference = a.pageNumber - b.pageNumber;
  if (pageDifference !== 0) return pageDifference;

  return a.id.localeCompare(b.id);
}

function toEvidence(assertion: ExtractedFactAssertion): SpecificationEvidence {
  return {
    assertionId: assertion.id,
    documentId: assertion.documentId,
    pageNumber: assertion.pageNumber,
    rawText: assertion.rawText,
    authority: assertion.authority,
    confidence: assertion.confidence,
    parsedValue: assertion.parsedValue,
    normalizedValue: assertion.normalizedValue,
  };
}

function stableRowId(fieldPath: string): string {
  return `specification:${fieldPath}`;
}

/**
 * Converts already asset-scoped extraction assertions into customer review rows.
 *
 * Safety properties:
 * - never combines different field paths;
 * - never silently resolves an unresolved parser conflict;
 * - defaults mandatedValue to currentValue only when a source assertion is selected;
 * - preserves all source evidence for UI display and audit persistence;
 * - requires explicit customer confirmation for every row.
 *
 * This function performs no database writes and does not create mandates.
 */
export function buildSpecificationReviewRows(
  input: BuildSpecificationReviewRowsInput,
): SpecificationReviewRow[] {
  const assertionsById = new Map(input.assertions.map((assertion) => [assertion.id, assertion]));
  const assertionsByField = new Map<string, ExtractedFactAssertion[]>();

  for (const assertion of input.assertions) {
    const fieldAssertions = assertionsByField.get(assertion.fieldPath) ?? [];
    fieldAssertions.push(assertion);
    assertionsByField.set(assertion.fieldPath, fieldAssertions);
  }

  const conflictsByField = new Map(
    (input.conflicts ?? []).map((conflict) => [conflict.fieldPath, conflict]),
  );

  const fieldPaths = new Set([
    ...assertionsByField.keys(),
    ...conflictsByField.keys(),
  ]);

  return [...fieldPaths]
    .sort((a, b) => a.localeCompare(b))
    .map((fieldPath): SpecificationReviewRow => {
      const fieldAssertions = [...(assertionsByField.get(fieldPath) ?? [])].sort(
        compareAssertions,
      );
      const evidence = fieldAssertions.map(toEvidence);
      const conflict = conflictsByField.get(fieldPath);

      if (conflict) {
        const selected = conflict.selectedAssertionId
          ? assertionsById.get(conflict.selectedAssertionId)
          : undefined;
        const selectedBelongsToField = selected?.fieldPath === fieldPath;
        const selectedIsConflictMember = selected
          ? conflict.assertionIds.includes(selected.id)
          : false;
        const usableSelection =
          selected && selectedBelongsToField && selectedIsConflictMember && hasUsableValue(selected)
            ? selected
            : undefined;

        return {
          id: stableRowId(fieldPath),
          fieldPath,
          status: usableSelection ? "ready_for_confirmation" : "conflicting",
          requiresConfirmation: true,
          selectedAssertionId: usableSelection?.id,
          currentValue: usableSelection?.normalizedValue,
          mandatedValue: usableSelection?.normalizedValue,
          evidence,
          reason: usableSelection
            ? `Parser conflict resolved to assertion ${usableSelection.id}; customer confirmation remains required.`
            : conflict.reason,
        };
      }

      const selected = fieldAssertions.find(hasUsableValue);
      if (!selected) {
        return {
          id: stableRowId(fieldPath),
          fieldPath,
          status: "missing_value",
          requiresConfirmation: true,
          evidence,
          reason: "No usable normalized value was extracted for this specification.",
        };
      }

      return {
        id: stableRowId(fieldPath),
        fieldPath,
        status: "ready_for_confirmation",
        requiresConfirmation: true,
        selectedAssertionId: selected.id,
        currentValue: selected.normalizedValue,
        mandatedValue: selected.normalizedValue,
        evidence,
      };
    });
}
