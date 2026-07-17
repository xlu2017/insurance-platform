import { z } from "zod";

export const ExtractedPdfPage = z.object({
  pageNumber: z.number().int().positive(),
  text: z.string(),
  items: z
    .array(
      z.object({
        text: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
    )
    .optional(),
});
export type ExtractedPdfPage = z.infer<typeof ExtractedPdfPage>;

export const ExtractedPdf = z.object({
  documentId: z.string(),
  fileDigest: z.string(),
  pageCount: z.number().int().nonnegative(),
  pages: z.array(ExtractedPdfPage),
});
export type ExtractedPdf = z.infer<typeof ExtractedPdf>;

export const AuthorityLevel = z.enum([
  "coverage_summary",
  "insurance_certificate",
  "invoice",
  "renewal_overview",
  "endorsement",
  "notice",
  "header_footer",
]);
export type AuthorityLevel = z.infer<typeof AuthorityLevel>;

export const ExtractedFactAssertion = z.object({
  id: z.string().uuid(),
  documentId: z.string(),
  pageNumber: z.number().int().positive(),
  entityScope: z.enum(["policy", "property", "vehicle", "coverage", "premium", "notice"]),
  fieldPath: z.string(),
  rawText: z.string(),
  parsedValue: z.unknown(),
  normalizedValue: z.unknown(),
  parserId: z.string(),
  parserVersion: z.string(),
  confidence: z.number().min(0).max(1),
  authority: AuthorityLevel,
});
export type ExtractedFactAssertion = z.infer<typeof ExtractedFactAssertion>;

export const ParsedInsurer = z.object({
  name: z.string(),
  address: z.string().optional(),
});

export const ParsedAgency = z.object({
  name: z.string(),
  address: z.string().optional(),
  phone: z.string().optional(),
});

export const ParsedPolicyTerm = z.object({
  effectiveDate: z.string().optional(),
  expiryDate: z.string().optional(),
  policyNumber: z.string().optional(),
  annualPremiumCents: z.number().int().nonnegative().optional(),
});

export const ParsedAssetAssertion = z.object({
  assetType: z.enum(["property", "vehicle"]),
  identityFingerprint: z.string(),
  displayLabel: z.string(),
  matchClassification: z
    .enum([
      "new",
      "exact_existing_match",
      "possible_existing_match",
      "new_identity_confirmation_required",
    ])
    .optional(),
  occupancy: z.enum(["principal_residence", "rental", "unknown"]).optional(),
  assertions: z.array(ExtractedFactAssertion),
});
export type ParsedAssetAssertion = z.infer<typeof ParsedAssetAssertion>;

export const ParsedCoverageAssertion = ExtractedFactAssertion;

export const ParsedConflict = z.object({
  fieldPath: z.string(),
  assertionIds: z.array(z.string().uuid()),
  selectedAssertionId: z.string().uuid().optional(),
  reason: z.string(),
});

export const ParsedInsuranceDocument = z.object({
  classification: z.enum(["home_policy_renewal", "auto_policy_renewal", "unsupported"]),
  insurer: ParsedInsurer.optional(),
  agency: ParsedAgency.optional(),
  policyTerms: z.array(ParsedPolicyTerm).default([]),
  assetAssertions: z.array(ParsedAssetAssertion).default([]),
  coverageAssertions: z.array(ParsedCoverageAssertion).default([]),
  notices: z.array(ExtractedFactAssertion).default([]),
  conflicts: z.array(ParsedConflict).default([]),
  parserId: z.string(),
  parserVersion: z.string(),
});
export type ParsedInsuranceDocument = z.infer<typeof ParsedInsuranceDocument>;

export interface InsuranceDocumentParser {
  id: string;
  version: string;
  canParse(document: ExtractedPdf): boolean;
  parse(document: ExtractedPdf): ParsedInsuranceDocument;
}
