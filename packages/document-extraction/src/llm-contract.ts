import { z } from "zod";

export const LLM_EXTRACTION_SCHEMA_VERSION = 1 as const;
export const LLM_EXTRACTION_PROMPT_VERSION = "insurance-document-v1" as const;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const LlmFactStatusSchema = z.enum([
  "known",
  "unknown",
  "not_applicable",
  "conflicting",
  "requires_confirmation",
]);
export type LlmFactStatus = z.infer<typeof LlmFactStatusSchema>;

export const LlmTemporalApplicabilitySchema = z.enum([
  "current_term",
  "future_term",
  "historical",
  "general_information",
  "unknown",
]);

export const LlmCoverageActivitySchema = z.enum([
  "active",
  "explicitly_absent",
  "offered_not_active",
  "future_change",
  "general_description",
  "unknown",
]);

export const LlmSourceAuthoritySchema = z.enum([
  "coverage_summary",
  "insurance_certificate",
  "active_endorsement",
  "invoice",
  "renewal_overview",
  "informational_notice",
  "policy_wording",
  "header_footer",
  "unknown",
]);

export const LlmEvidenceSchema = z
  .object({
    documentId: z.string().min(1),
    pageNumber: z.number().int().positive(),
    evidenceText: z.string().trim().min(1).max(1500),
    authority: LlmSourceAuthoritySchema,
    boundingBox: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().nonnegative(),
        height: z.number().finite().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type LlmEvidence = z.infer<typeof LlmEvidenceSchema>;

export const LlmAlternativeValueSchema = z
  .object({
    value: JsonValueSchema,
    normalizedValue: JsonValueSchema.optional(),
    evidence: z.array(LlmEvidenceSchema).min(1),
  })
  .strict();

const LocalIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/, "Use a stable local identifier without whitespace");

export const LlmAssertionSchema = z
  .object({
    id: LocalIdSchema,
    entityRef: LocalIdSchema,
    fieldPath: z
      .string()
      .min(1)
      .max(240)
      .regex(/^[A-Za-z][A-Za-z0-9_.[\]-]*$/, "Use a dotted field path"),
    factKind: z.enum(["identity", "policy", "coverage", "premium", "notice", "underwriting"]),
    status: LlmFactStatusSchema,
    value: JsonValueSchema.optional(),
    normalizedValue: JsonValueSchema.optional(),
    confidence: z.number().min(0).max(1),
    temporalApplicability: LlmTemporalApplicabilitySchema,
    coverageActivity: LlmCoverageActivitySchema.optional(),
    evidence: z.array(LlmEvidenceSchema),
    alternatives: z.array(LlmAlternativeValueSchema).optional(),
    explanation: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((assertion, ctx) => {
    const hasValue = assertion.value !== undefined || assertion.normalizedValue !== undefined;

    if (
      (assertion.status === "known" || assertion.status === "requires_confirmation") &&
      !hasValue
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `${assertion.status} assertions require a value`,
      });
    }

    if (
      (assertion.status === "known" ||
        assertion.status === "not_applicable" ||
        assertion.status === "requires_confirmation") &&
      assertion.evidence.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidence"],
        message: `${assertion.status} assertions require page evidence`,
      });
    }

    if (assertion.status === "unknown" && hasValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "unknown assertions must not contain a guessed value",
      });
    }

    if (assertion.status === "conflicting" && (assertion.alternatives?.length ?? 0) < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["alternatives"],
        message: "conflicting assertions require at least two evidenced alternatives",
      });
    }
  });
export type LlmAssertion = z.infer<typeof LlmAssertionSchema>;

const LlmAssetCandidateBase = {
  localId: LocalIdSchema,
  displayLabel: z.string().trim().min(1).max(240),
  identityAssertionIds: z.array(LocalIdSchema).min(1),
  proposedMatchClassification: z.enum([
    "new",
    "possible_existing_match",
    "exact_existing_match_proposed",
    "identity_confirmation_required",
  ]),
  autoMergeAllowed: z.literal(false).default(false),
  rationale: z.string().trim().min(1).max(1000),
};

export const LlmPropertyCandidateSchema = z
  .object({
    ...LlmAssetCandidateBase,
    assetType: z.literal("property"),
    occupancy: z.enum(["principal_residence", "rental", "seasonal", "vacant", "unknown"]),
    insuredLocationStatus: z.enum(["complete", "partial", "redacted", "unknown"]),
  })
  .strict();

export const LlmVehicleCandidateSchema = z
  .object({
    ...LlmAssetCandidateBase,
    assetType: z.literal("vehicle"),
    vinStatus: z.enum(["valid_appearing", "partial", "redacted", "missing", "invalid_appearing"]),
  })
  .strict();

export const LlmAssetCandidateSchema = z.discriminatedUnion("assetType", [
  LlmPropertyCandidateSchema,
  LlmVehicleCandidateSchema,
]);
export type LlmAssetCandidate = z.infer<typeof LlmAssetCandidateSchema>;

export const LlmPolicyTermSchema = z
  .object({
    localId: LocalIdSchema,
    policyNumberAssertionId: LocalIdSchema.optional(),
    insurerAssertionId: LocalIdSchema.optional(),
    effectiveDateAssertionId: LocalIdSchema.optional(),
    expiryDateAssertionId: LocalIdSchema.optional(),
    premiumAssertionId: LocalIdSchema.optional(),
    insuredAssetRefs: z.array(LocalIdSchema).min(1),
  })
  .strict();

export const LlmConflictSchema = z
  .object({
    fieldPath: z.string().min(1),
    entityRef: LocalIdSchema,
    assertionIds: z.array(LocalIdSchema).min(2),
    explanation: z.string().trim().min(1).max(1000),
    requiresHumanResolution: z.boolean(),
  })
  .strict();

export const LlmModelIdentitySchema = z
  .object({
    provider: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(160),
    modelVersion: z.string().trim().min(1).max(160).optional(),
    promptVersion: z.literal(LLM_EXTRACTION_PROMPT_VERSION),
  })
  .strict();

export const LlmExtractionResultSchema = z
  .object({
    schemaVersion: z.literal(LLM_EXTRACTION_SCHEMA_VERSION),
    documentId: z.string().min(1),
    pass: z.enum(["discovery", "asset_coverage"]),
    classification: z.enum([
      "home_policy",
      "auto_policy",
      "combined_policy",
      "endorsement",
      "invoice",
      "proof_of_insurance",
      "unsupported",
      "unknown",
    ]),
    model: LlmModelIdentitySchema,
    assets: z.array(LlmAssetCandidateSchema),
    policyTerms: z.array(LlmPolicyTermSchema),
    assertions: z.array(LlmAssertionSchema),
    conflicts: z.array(LlmConflictSchema),
    warnings: z.array(z.string().trim().min(1).max(1000)),
  })
  .strict()
  .superRefine((result, ctx) => {
    const assertionIds = new Set(result.assertions.map((assertion) => assertion.id));
    const assetIds = new Set(result.assets.map((asset) => asset.localId));

    if (assertionIds.size !== result.assertions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assertions"],
        message: "assertion IDs must be unique",
      });
    }

    if (assetIds.size !== result.assets.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets"],
        message: "asset local IDs must be unique",
      });
    }

    for (const [assetIndex, asset] of result.assets.entries()) {
      for (const assertionId of asset.identityAssertionIds) {
        if (!assertionIds.has(assertionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["assets", assetIndex, "identityAssertionIds"],
            message: `unknown identity assertion ID: ${assertionId}`,
          });
        }
      }
    }

    for (const [termIndex, term] of result.policyTerms.entries()) {
      for (const assetRef of term.insuredAssetRefs) {
        if (!assetIds.has(assetRef)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["policyTerms", termIndex, "insuredAssetRefs"],
            message: `unknown insured asset reference: ${assetRef}`,
          });
        }
      }

      const assertionReferences = [
        term.policyNumberAssertionId,
        term.insurerAssertionId,
        term.effectiveDateAssertionId,
        term.expiryDateAssertionId,
        term.premiumAssertionId,
      ].filter((value): value is string => value !== undefined);

      for (const assertionId of assertionReferences) {
        if (!assertionIds.has(assertionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["policyTerms", termIndex],
            message: `unknown policy-term assertion ID: ${assertionId}`,
          });
        }
      }
    }

    for (const [conflictIndex, conflict] of result.conflicts.entries()) {
      for (const assertionId of conflict.assertionIds) {
        if (!assertionIds.has(assertionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["conflicts", conflictIndex, "assertionIds"],
            message: `unknown conflict assertion ID: ${assertionId}`,
          });
        }
      }
    }
  });
export type LlmExtractionResult = z.infer<typeof LlmExtractionResultSchema>;

export const LlmPageInputSchema = z
  .object({
    pageNumber: z.number().int().positive(),
    text: z.string(),
    imageRef: z.string().min(1).optional(),
  })
  .strict();

export const LlmExtractionPassSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("discovery"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("asset_coverage"),
      targetAssetLocalId: LocalIdSchema,
      relevantPageNumbers: z.array(z.number().int().positive()).min(1),
    })
    .strict(),
]);

export const LlmExtractionRequestSchema = z
  .object({
    documentId: z.string().min(1),
    fileDigest: z.string().regex(/^[a-f0-9]{64}$/i),
    pages: z.array(LlmPageInputSchema).min(1),
    pass: LlmExtractionPassSchema,
    requestedModel: z.string().min(1).optional(),
  })
  .strict();
export type LlmExtractionRequest = z.infer<typeof LlmExtractionRequestSchema>;

export interface InsuranceLlmProvider {
  readonly providerId: string;
  readonly modelId: string;
  extract(request: unknown, systemPrompt: string): Promise<unknown>;
}

export function parseLlmExtractionResult(
  raw: unknown,
  request: LlmExtractionRequest,
): LlmExtractionResult {
  const parsedRequest = LlmExtractionRequestSchema.parse(request);
  const result = LlmExtractionResultSchema.parse(raw);

  if (result.documentId !== parsedRequest.documentId) {
    throw new Error("LLM extraction result documentId does not match the request");
  }

  const pageNumbers = new Set(parsedRequest.pages.map((page) => page.pageNumber));
  for (const assertion of result.assertions) {
    for (const evidence of assertion.evidence) {
      if (evidence.documentId !== parsedRequest.documentId) {
        throw new Error(`Assertion ${assertion.id} cites a different document`);
      }
      if (!pageNumbers.has(evidence.pageNumber)) {
        throw new Error(
          `Assertion ${assertion.id} cites page ${evidence.pageNumber}, which was not provided`,
        );
      }
    }
  }

  const expectedPass = parsedRequest.pass.kind;
  if (result.pass !== expectedPass) {
    throw new Error(`LLM extraction result pass ${result.pass} does not match ${expectedPass}`);
  }

  return result;
}

const BASE_INSTRUCTIONS = `You extract structured facts from Canadian insurance documents.

Return only one JSON object matching schemaVersion 1. Do not return markdown, prose outside JSON, or invented fields.

Non-negotiable rules:
1. Never guess a value to complete the schema. Use status "unknown" when the document does not establish a fact.
2. Every known, not-applicable, or confirmation-required fact must cite the exact document page and a short evidenceText excerpt.
3. Distinguish the insured property location from the customer's mailing or correspondence address.
4. Treat policy number as a policy-term identifier, never as conclusive property or vehicle identity.
5. Treat a complete VIN as a vehicle identity fact, but do not decide automatic merging.
6. Set autoMergeAllowed to false for every asset. The application performs deterministic matching later.
7. Distinguish active current coverage from advertisements, eligibility statements, optional offers, general policy wording, and future changes.
8. Phrases such as "eligible", "available", "to purchase", "consider", or "contact us to add" do not establish active coverage.
9. Prefer an applicable coverage summary or automobile certificate over an overview, invoice, notice, header, or footer. Preserve material conflicts instead of silently choosing one.
10. Preserve explicit absence separately from unknown and not applicable.
11. Do not infer zero from a blank cell. Do not infer false from an omitted field.
12. Preserve monetary values as exact integer cents in normalizedValue when the currency amount is clear.
13. Preserve dates as YYYY-MM-DD in normalizedValue when the date is clear.
14. Use stable local IDs that contain no whitespace and are unique inside the response.
15. Keep customer names, addresses, policy numbers, account numbers, and VINs only in factual values required by the extraction result; never repeat them in warnings or explanations.
16. A redacted or partial property address requires customer confirmation and cannot be proposed as an exact match.
17. A year/make/model combination without a valid complete VIN is only a possible vehicle match.
18. If two pages materially disagree, emit evidenced assertions for both and add a conflict requiring human resolution.
19. Evidence must come from pages supplied in the request.
20. Do not perform database writes, mandate generation, recommendation logic, or customer authorization decisions.`;

const DISCOVERY_INSTRUCTIONS = `

This is the discovery pass. Identify document classification, policy terms, insured assets, and identity facts. Determine which page ranges appear relevant to each asset. Extract only enough coverage information to distinguish assets and route a later asset-specific coverage pass. A document may contain multiple assets. Do not assume one document equals one policy or one asset.`;

const ASSET_COVERAGE_INSTRUCTIONS = `

This is the asset_coverage pass. Extract current-term coverage, limits, deductibles, premiums, endorsements, exclusions, and material underwriting facts for the specified asset using the supplied relevant pages. Preserve active-versus-offered status and all page evidence. Do not emit facts for a different asset merely because they share a policyholder or mailing address.`;

export function buildInsuranceExtractionSystemPrompt(
  pass: LlmExtractionRequest["pass"]["kind"],
): string {
  return `${BASE_INSTRUCTIONS}${
    pass === "discovery" ? DISCOVERY_INSTRUCTIONS : ASSET_COVERAGE_INSTRUCTIONS
  }`;
}
