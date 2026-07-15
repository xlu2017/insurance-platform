import type { ProductLine } from "@autopilot/schemas";

export interface ExtractedPolicyValues {
  productLine: ProductLine;
  insurerName: string;
  policyNumber: string | null;
  annualPremiumCents: number;
  renewalDate: string | null;
  liabilityLimitCents: number | null;
  dwellingLimitCents: number | null;
  baseDeductibleCents: number | null;
  collisionDeductibleCents: number | null;
  comprehensiveDeductibleCents: number | null;
}

/**
 * Document extraction abstraction. The MVP ships `manual` (operations staff
 * key values from the document) and `mock` (deterministic sample values for
 * testing). An AI or document-intelligence provider can be added later by
 * implementing this interface and registering it in `extractionProviders`
 * — no OCR dependency is required by the platform.
 */
export interface DocumentExtractionProvider {
  readonly name: "manual" | "mock";
  /** Returns pre-filled values, or null when a human must enter everything. */
  extract(documentId: string): Promise<ExtractedPolicyValues | null>;
}

export const manualExtractionProvider: DocumentExtractionProvider = {
  name: "manual",
  extract: () => Promise.resolve(null),
};

export const mockExtractionProvider: DocumentExtractionProvider = {
  name: "mock",
  extract: (documentId: string) =>
    Promise.resolve({
      productLine: "auto",
      insurerName: "Prairie Shield Insurance",
      policyNumber: `MOCK-${documentId.slice(0, 8).toUpperCase()}`,
      annualPremiumCents: 200_000,
      renewalDate: "2026-09-01",
      liabilityLimitCents: 200_000_000,
      dwellingLimitCents: null,
      baseDeductibleCents: null,
      collisionDeductibleCents: 50_000,
      comprehensiveDeductibleCents: 50_000,
    }),
};

export const extractionProviders: Record<string, DocumentExtractionProvider> = {
  manual: manualExtractionProvider,
  mock: mockExtractionProvider,
};

export function getExtractionProvider(name?: string): DocumentExtractionProvider {
  return extractionProviders[name ?? "manual"] ?? manualExtractionProvider;
}
