import { z } from "zod";

export const ExtractedPdfImageSchema = z
  .object({
    mimeType: z.string().min(1),
    base64: z.string().min(1),
  })
  .strict();
export type ExtractedPdfImage = z.infer<typeof ExtractedPdfImageSchema>;

export const ExtractedPdfPage = z
  .object({
    pageNumber: z.number().int().positive(),
    text: z.string(),
    image: ExtractedPdfImageSchema.optional(),
    items: z
      .array(
        z
          .object({
            text: z.string(),
            x: z.number().optional(),
            y: z.number().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type ExtractedPdfPage = z.infer<typeof ExtractedPdfPage>;

export const ExtractedPdf = z
  .object({
    documentId: z.string(),
    fileDigest: z.string(),
    pageCount: z.number().int().nonnegative(),
    pages: z.array(ExtractedPdfPage),
  })
  .strict();
export type ExtractedPdf = z.infer<typeof ExtractedPdf>;

export const AuthorityLevel = z.enum([
  "coverage_summary",
  "insurance_certificate",
  "active_endorsement",
  "endorsement",
  "invoice",
  "renewal_overview",
  "notice",
  "informational_notice",
  "policy_wording",
  "header_footer",
  "unknown",
]);
export type AuthorityLevel = z.infer<typeof AuthorityLevel>;

export const AddressRole = z.enum([
  "insured_location",
  "mailing_address",
  "mortgagee_address",
  "agency_address",
  "payment_address",
  "unknown",
]);
export type AddressRole = z.infer<typeof AddressRole>;

export const ExtractedCoveragePresence = z.enum([
  "included",
  "not_included",
  "unknown",
  "not_applicable",
]);
export type ExtractedCoveragePresence = z.infer<typeof ExtractedCoveragePresence>;

export const ExtractedFactAssertion = z
  .object({
    id: z.string().min(1),
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
    addressRole: AddressRole.optional(),
    coveragePresence: ExtractedCoveragePresence.optional(),
  })
  .strict();
export type ExtractedFactAssertion = z.infer<typeof ExtractedFactAssertion>;

export const ParsedInsurer = z
  .object({
    name: z.string(),
    address: z.string().optional(),
  })
  .strict();

export const ParsedAgency = z
  .object({
    name: z.string(),
    address: z.string().optional(),
    phone: z.string().optional(),
  })
  .strict();

export const ParsedPolicyTerm = z
  .object({
    effectiveDate: z.string().optional(),
    expiryDate: z.string().optional(),
    policyNumber: z.string().optional(),
    annualPremiumCents: z.number().int().nonnegative().optional(),
  })
  .strict();

export const ParsedAssetAssertion = z
  .object({
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
  })
  .strict();
export type ParsedAssetAssertion = z.infer<typeof ParsedAssetAssertion>;

export const ParsedCoverageAssertion = ExtractedFactAssertion;

export const ParsedConflict = z
  .object({
    fieldPath: z.string(),
    assertionIds: z.array(z.string().min(1)),
    selectedAssertionId: z.string().min(1).optional(),
    reason: z.string(),
  })
  .strict();
export type ParsedConflict = z.infer<typeof ParsedConflict>;

export const PolicyNoticeKind = z.enum([
  "future_coverage_change",
  "coverage_available_for_purchase",
  "eligibility_notice",
  "general_explanation",
  "customer_action_required",
  "renewal_information",
]);
export type PolicyNoticeKind = z.infer<typeof PolicyNoticeKind>;

export const ParsedPolicyNotice = z
  .object({
    kind: PolicyNoticeKind,
    fieldPath: z.string().optional(),
    text: z.string(),
    pageNumber: z.number().int().positive(),
    authority: AuthorityLevel,
    assertionId: z.string().min(1).optional(),
  })
  .strict();
export type ParsedPolicyNotice = z.infer<typeof ParsedPolicyNotice>;

export const ParsedInsuranceDocument = z
  .object({
    classification: z.enum(["home_policy_renewal", "auto_policy_renewal", "unsupported"]),
    documentId: z.string().optional(),
    fileDigest: z.string().optional(),
    insurer: ParsedInsurer.optional(),
    agency: ParsedAgency.optional(),
    policyTerms: z.array(ParsedPolicyTerm).default([]),
    assertions: z.array(ExtractedFactAssertion).default([]),
    selectedAssertions: z.record(z.string(), z.string()).default({}),
    conflicts: z.array(ParsedConflict).default([]),
    notices: z.array(ParsedPolicyNotice).default([]),
    assetAssertions: z.array(ParsedAssetAssertion).default([]),
    coverageAssertions: z.array(ParsedCoverageAssertion).default([]),
    parserId: z.string(),
    parserVersion: z.string(),
  })
  .strict();
export type ParsedInsuranceDocument = z.infer<typeof ParsedInsuranceDocument>;

export interface InsuranceDocumentParser {
  id: string;
  version: string;
  canParse(document: ExtractedPdf): boolean;
  parse(document: ExtractedPdf): ParsedInsuranceDocument | Promise<ParsedInsuranceDocument>;
}

export interface ExistingAssetIdentity {
  assetType: "property" | "vehicle";
  identityFingerprint: string;
}

export interface EntityResolutionResult {
  candidates: ParsedAssetAssertion[];
  documents: ParsedInsuranceDocument[];
  conflicts: ParsedConflict[];
}
