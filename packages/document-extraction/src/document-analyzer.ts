import { z } from "zod";
import type {
  ExistingAssetIdentity,
  ExtractedCoveragePresence,
  ExtractedPdf,
  ParsedAssetAssertion,
  ParsedInsuranceDocument,
} from "./types.ts";
import { parseDocument } from "./parsers/index.ts";
import { resolveParsedDocuments } from "./entity-resolution.ts";
import {
  buildPropertyIdentity,
  buildVehicleIdentity,
  type PropertyIdentityInput,
  type VehicleIdentityInput,
} from "./entity-identity.ts";
import type { InsuranceLlmProvider } from "./llm-contract.ts";

const AnalysisVersion = z.literal("1");

export const UploadedDocumentSchema = z
  .object({
    documentId: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    fileReference: z.string().min(1),
  })
  .strict();
export type UploadedDocument = z.infer<typeof UploadedDocumentSchema>;

export const ExistingHouseholdAssetSchema = z
  .object({
    id: z.string().min(1),
    assetType: z.enum(["property", "vehicle"]),
    identityFingerprint: z.string().min(1),
    displayLabel: z.string().optional(),
  })
  .strict();
export type ExistingHouseholdAsset = z.infer<typeof ExistingHouseholdAssetSchema>;

export const PendingEntityCandidateSchema = z
  .object({
    id: z.string().min(1),
    assetType: z.enum(["property", "vehicle"]),
    identityFingerprint: z.string().min(1),
  })
  .strict();
export type PendingEntityCandidate = z.infer<typeof PendingEntityCandidateSchema>;

export const PriorDocumentSummarySchema = z
  .object({
    documentId: z.string().min(1),
    fileDigest: z.string().min(1).optional(),
    classification: z.string().optional(),
    detectedEntityCount: z.number().int().nonnegative(),
  })
  .strict();
export type PriorDocumentSummary = z.infer<typeof PriorDocumentSummarySchema>;

export const InsuranceDocumentAnalysisInputSchema = z
  .object({
    householdId: z.string().min(1),
    uploadedDocuments: z.array(UploadedDocumentSchema).min(1),
    existingAssets: z.array(ExistingHouseholdAssetSchema).default([]),
    pendingCandidates: z.array(PendingEntityCandidateSchema).default([]),
    priorDocumentSummaries: z.array(PriorDocumentSummarySchema).default([]),
    jurisdiction: z.enum(["AB"]).default("AB"),
  })
  .strict();
export type InsuranceDocumentAnalysisInput = z.infer<typeof InsuranceDocumentAnalysisInputSchema>;

export const EvidenceReferenceSchema = z
  .object({
    documentId: z.string().min(1),
    pageNumber: z.number().int().positive().optional(),
    quotedLabel: z.string().optional(),
    evidenceSummary: z.string().min(1),
  })
  .strict();
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const ExtractedCurrentValueSchema = z
  .object({
    status: z.enum(["known", "unknown", "not_included", "not_applicable", "conflicting"]),
    value: z.unknown(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(EvidenceReferenceSchema).min(1).optional(),
    explanation: z.string().optional(),
  })
  .strict();
export type ExtractedCurrentValue = z.infer<typeof ExtractedCurrentValueSchema>;

export const DetectedEntityIdentitySchema = z
  .object({
    fullAddress: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    province: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    occupancy: z.enum(["principal_residence", "rental", "other", "unknown"]).nullable().optional(),
    vin: z.string().nullable().optional(),
    year: z.number().int().nullable().optional(),
    make: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    trim: z.string().nullable().optional(),
    vehicleUse: z.string().nullable().optional(),
  })
  .strict();
export type DetectedEntityIdentity = z.infer<typeof DetectedEntityIdentitySchema>;

export const EntityResolutionStatusSchema = z.enum([
  "new",
  "matches_existing",
  "matches_pending_candidate",
  "possible_match_requires_confirmation",
]);
export type EntityResolutionStatus = z.infer<typeof EntityResolutionStatusSchema>;

export const EntityResolutionSchema = z
  .object({
    status: EntityResolutionStatusSchema,
    matchedExistingEntityId: z.string().nullable().optional(),
    matchedPendingCandidateId: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().min(1),
  })
  .strict();
export type EntityResolution = z.infer<typeof EntityResolutionSchema>;

export const CurrentPolicySchema = z
  .object({
    insurer: z.string().nullable().optional(),
    policyNumber: z.string().nullable().optional(),
    effectiveDate: z.string().nullable().optional(),
    expiryDate: z.string().nullable().optional(),
    annualPremiumCents: z.number().int().nullable().optional(),
  })
  .strict();
export type CurrentPolicy = z.infer<typeof CurrentPolicySchema>;

export const MandateRuleSchema = z.union([
  z.object({ rule: z.literal("minimum"), amountCents: z.number().int() }).strict(),
  z.object({ rule: z.literal("maximum"), amountCents: z.number().int() }).strict(),
  z.object({ rule: z.literal("match_current_or_better"), value: z.string() }).strict(),
  z.object({ rule: z.literal("any"), reason: z.string().optional() }).strict(),
  z.object({ preference: z.literal("required"), value: z.string() }).strict(),
  z.object({ preference: z.literal("indifferent"), reason: z.string().optional() }).strict(),
]);
export type MandateRule = z.infer<typeof MandateRuleSchema>;

export const DetectedInsuranceEntitySchema = z
  .object({
    temporaryId: z.string().min(1),
    entityType: z.enum(["property", "vehicle"]),
    displayLabel: z.string().min(1),
    identity: DetectedEntityIdentitySchema,
    resolution: EntityResolutionSchema,
    currentPolicy: CurrentPolicySchema,
    currentCoverage: z.record(z.string().min(1), ExtractedCurrentValueSchema),
    mandateSuggestions: z.record(z.string().min(1), MandateRuleSchema),
    evidence: z.array(EvidenceReferenceSchema).default([]),
    requiredConfirmations: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type DetectedInsuranceEntity = z.infer<typeof DetectedInsuranceEntitySchema>;

export const AnalyzedDocumentSchema = z
  .object({
    documentId: z.string().min(1),
    fileDigest: z.string().min(1),
    classification: z.string().min(1),
    parserId: z.string().min(1),
    parserVersion: z.string().min(1),
    pageCount: z.number().int().nonnegative(),
    extractedEntityCount: z.number().int().nonnegative(),
  })
  .strict();
export type AnalyzedDocument = z.infer<typeof AnalyzedDocumentSchema>;

export const DetectedConflictSchema = z
  .object({
    fieldPath: z.string().min(1),
    entityRef: z.string().min(1),
    assertionIds: z.array(z.string().min(1)).min(1),
    explanation: z.string().min(1),
    requiresHumanResolution: z.boolean(),
  })
  .strict();
export type DetectedConflict = z.infer<typeof DetectedConflictSchema>;

export const AnalysisWarningSchema = z
  .object({
    message: z.string().min(1),
    documentId: z.string().optional(),
  })
  .strict();
export type AnalysisWarning = z.infer<typeof AnalysisWarningSchema>;

export const InsuranceDocumentAnalysisResultSchema = z
  .object({
    analysisVersion: AnalysisVersion,
    modelProvider: z.string().min(1),
    modelId: z.string().min(1),
    documents: z.array(AnalyzedDocumentSchema),
    detectedEntities: z.array(DetectedInsuranceEntitySchema),
    unresolvedConflicts: z.array(DetectedConflictSchema),
    warnings: z.array(AnalysisWarningSchema),
  })
  .strict();
export type InsuranceDocumentAnalysisResult = z.infer<typeof InsuranceDocumentAnalysisResultSchema>;

export interface DocumentLoader {
  load(document: UploadedDocument): Promise<ExtractedPdf>;
}

export interface InsuranceDocumentAnalyzer {
  analyze(input: InsuranceDocumentAnalysisInput): Promise<InsuranceDocumentAnalysisResult>;
}

function valueForFieldPath(
  assertions: ParsedAssetAssertion["assertions"],
  fieldPath: string,
): unknown {
  return assertions.find((a) => a.fieldPath === fieldPath)?.normalizedValue;
}

function confidenceFromPresence(presence?: ExtractedCoveragePresence): number {
  switch (presence) {
    case "included":
    case "not_included":
    case "not_applicable":
      return 0.95;
    case "unknown":
    default:
      return 0.5;
  }
}

function statusFromPresence(presence?: ExtractedCoveragePresence): ExtractedCurrentValue["status"] {
  switch (presence) {
    case "included":
      return "known";
    case "not_included":
      return "not_included";
    case "not_applicable":
      return "not_applicable";
    case "unknown":
    default:
      return "unknown";
  }
}

function buildCurrentCoverage(
  candidate: ParsedAssetAssertion,
  documentId: string,
): Record<string, ExtractedCurrentValue> {
  const coverage: Record<string, ExtractedCurrentValue> = {};
  for (const assertion of candidate.assertions) {
    if (
      assertion.entityScope !== "coverage" &&
      assertion.entityScope !== "premium" &&
      assertion.entityScope !== "policy" &&
      !assertion.fieldPath.startsWith("property.") &&
      !assertion.fieldPath.startsWith("vehicle.") &&
      !assertion.fieldPath.startsWith("auto.")
    ) {
      continue;
    }
    const status = statusFromPresence(assertion.coveragePresence);
    const value = assertion.normalizedValue ?? null;
    coverage[assertion.fieldPath] = {
      status,
      value,
      confidence: assertion.confidence ?? confidenceFromPresence(assertion.coveragePresence),
      evidence: [
        { documentId, pageNumber: assertion.pageNumber, evidenceSummary: assertion.rawText },
      ],
    };
  }
  return coverage;
}

function suggestMandate(
  fieldPath: string,
  current: ExtractedCurrentValue,
): MandateRule | undefined {
  if (current.status === "unknown" || current.status === "not_applicable") {
    return { rule: "any", reason: `current value is ${current.status}` };
  }

  if (current.status === "not_included") {
    return { preference: "indifferent", reason: "currently not included" };
  }

  const value = current.value;
  if (typeof value !== "number" || value <= 0) {
    return { rule: "any", reason: "no numeric value to preserve" };
  }

  if (fieldPath.endsWith("DeductibleCents")) {
    return { rule: "maximum", amountCents: value };
  }
  if (
    fieldPath.endsWith("LimitCents") ||
    fieldPath.endsWith("limitCents") ||
    fieldPath.includes("Liability")
  ) {
    return { rule: "minimum", amountCents: value };
  }
  if (fieldPath.includes("coverageForm") || fieldPath.includes("CoverageForm")) {
    return { rule: "match_current_or_better", value: String(value) };
  }

  return { preference: "required", value: String(value) };
}

function buildMandateSuggestions(
  currentCoverage: Record<string, ExtractedCurrentValue>,
): Record<string, MandateRule> {
  const suggestions: Record<string, MandateRule> = {};
  for (const [fieldPath, current] of Object.entries(currentCoverage)) {
    const rule = suggestMandate(fieldPath, current);
    if (rule) {
      suggestions[fieldPath] = rule;
    }
  }
  return suggestions;
}

function buildIdentity(candidate: ParsedAssetAssertion): DetectedEntityIdentity {
  if (candidate.assetType === "vehicle") {
    return {
      vin: String(valueForFieldPath(candidate.assertions, "vehicle.vin") ?? ""),
      year: Number(valueForFieldPath(candidate.assertions, "vehicle.year")),
      make: String(valueForFieldPath(candidate.assertions, "vehicle.make") ?? ""),
      model: String(valueForFieldPath(candidate.assertions, "vehicle.model") ?? ""),
      trim: String(valueForFieldPath(candidate.assertions, "vehicle.trim") ?? ""),
      vehicleUse: String(valueForFieldPath(candidate.assertions, "vehicle.vehicleUse") ?? ""),
    };
  }

  const occupancy = valueForFieldPath(candidate.assertions, "property.occupancy");
  return {
    fullAddress: String(valueForFieldPath(candidate.assertions, "property.streetAddress") ?? ""),
    city: String(valueForFieldPath(candidate.assertions, "property.city") ?? ""),
    province: String(valueForFieldPath(candidate.assertions, "property.province") ?? ""),
    postalCode: String(valueForFieldPath(candidate.assertions, "property.postalCode") ?? ""),
    occupancy:
      occupancy === "principal_residence" || occupancy === "rental" ? occupancy : "unknown",
  };
}

function buildCurrentPolicy(
  candidate: ParsedAssetAssertion,
  doc: ParsedInsuranceDocument,
): CurrentPolicy {
  const term = doc.policyTerms[0] ?? {};
  return {
    insurer: doc.insurer?.name ?? null,
    policyNumber: String(
      term.policyNumber ?? valueForFieldPath(candidate.assertions, "policy.policyNumber") ?? "",
    ),
    effectiveDate: term.effectiveDate ?? null,
    expiryDate: term.expiryDate ?? null,
    annualPremiumCents:
      Number(
        term.annualPremiumCents ??
          valueForFieldPath(candidate.assertions, "policy.annualPremiumCents") ??
          0,
      ) || null,
  };
}

function findPossibleMatch(
  candidate: ParsedAssetAssertion,
  existingByFingerprint: Map<string, ExistingHouseholdAsset>,
  pendingByFingerprint: Map<string, PendingEntityCandidate>,
): ExistingHouseholdAsset | PendingEntityCandidate | undefined {
  if (candidate.assetType === "property") {
    const postal = stringAssertion(candidate.assertions, "property.postalCode");
    if (postal) {
      for (const map of [existingByFingerprint, pendingByFingerprint]) {
        for (const value of map.values()) {
          if (
            value.assetType === "property" &&
            value.identityFingerprint.toUpperCase().includes(postal.toUpperCase())
          ) {
            return value;
          }
        }
      }
    }
  }
  if (candidate.assetType === "vehicle") {
    for (const map of [existingByFingerprint, pendingByFingerprint]) {
      const exact = map.get(candidate.identityFingerprint);
      if (exact) return exact;
    }
  }
  return undefined;
}

function mapResolution(
  candidate: ParsedAssetAssertion,
  existingByFingerprint: Map<string, ExistingHouseholdAsset>,
  pendingByFingerprint: Map<string, PendingEntityCandidate>,
): EntityResolution {
  if (candidate.matchClassification === "exact_existing_match") {
    const existing = existingByFingerprint.get(candidate.identityFingerprint);
    if (existing) {
      return {
        status: "matches_existing",
        matchedExistingEntityId: existing.id,
        confidence: 0.99,
        reasoning: "Exact identity fingerprint matches an existing household asset.",
      };
    }
    const pending = pendingByFingerprint.get(candidate.identityFingerprint);
    if (pending) {
      return {
        status: "matches_pending_candidate",
        matchedPendingCandidateId: pending.id,
        confidence: 0.99,
        reasoning: "Exact identity fingerprint matches a pending candidate from an earlier upload.",
      };
    }
  }

  if (candidate.matchClassification === "possible_existing_match") {
    const possible = findPossibleMatch(candidate, existingByFingerprint, pendingByFingerprint);
    if (possible && "identityFingerprint" in possible) {
      const isPending = !("displayLabel" in possible);
      return {
        status: "possible_match_requires_confirmation",
        ...(isPending
          ? { matchedPendingCandidateId: possible.id }
          : { matchedExistingEntityId: possible.id }),
        confidence: 0.75,
        reasoning:
          "A possible match was found based on a partial identity (postal code, year/make/model, etc.).",
      };
    }
    return {
      status: "possible_match_requires_confirmation",
      confidence: 0.75,
      reasoning:
        "A possible match was found based on a partial identity (postal code, year/make/model, etc.).",
    };
  }

  if (candidate.matchClassification === "new_identity_confirmation_required") {
    return {
      status: "possible_match_requires_confirmation",
      confidence: 0.5,
      reasoning:
        "Identity is partial or redacted and requires customer confirmation before it can be matched.",
    };
  }

  return {
    status: "new",
    confidence: 0.95,
    reasoning: "No existing or pending asset matches the normalized identity fingerprint.",
  };
}

function buildDetectedEntity(
  candidate: ParsedAssetAssertion,
  doc: ParsedInsuranceDocument,
  documentId: string,
  existingByFingerprint: Map<string, ExistingHouseholdAsset>,
  pendingByFingerprint: Map<string, PendingEntityCandidate>,
): DetectedInsuranceEntity {
  const currentCoverage = buildCurrentCoverage(candidate, documentId);
  const identity = buildIdentity(candidate);
  const requiredConfirmations: string[] = [];
  if (candidate.matchClassification === "new_identity_confirmation_required") {
    requiredConfirmations.push(
      "Confirm the insured address or VIN because the extracted identity is partial or redacted.",
    );
  }
  if (candidate.matchClassification === "possible_existing_match") {
    requiredConfirmations.push(
      "Confirm whether this asset matches an existing property or vehicle.",
    );
  }

  return {
    temporaryId: candidate.identityFingerprint,
    entityType: candidate.assetType,
    displayLabel: candidate.displayLabel,
    identity,
    resolution: mapResolution(candidate, existingByFingerprint, pendingByFingerprint),
    currentPolicy: buildCurrentPolicy(candidate, doc),
    currentCoverage,
    mandateSuggestions: buildMandateSuggestions(currentCoverage),
    evidence: candidate.assertions
      .filter((a) => a.entityScope !== "notice")
      .slice(0, 20)
      .map((a) => ({
        documentId,
        pageNumber: a.pageNumber,
        evidenceSummary: a.rawText ? `${a.fieldPath}: ${a.rawText.slice(0, 200)}` : a.fieldPath,
      })),
    requiredConfirmations,
  };
}

function buildAnalyzedDocument(doc: ParsedInsuranceDocument): AnalyzedDocument {
  return {
    documentId: doc.documentId ?? "unknown",
    fileDigest: doc.fileDigest ?? "unknown",
    classification: doc.classification,
    parserId: doc.parserId,
    parserVersion: doc.parserVersion,
    pageCount: 0,
    extractedEntityCount: doc.assetAssertions.length,
  };
}

function stringAssertion(
  assertions: ParsedAssetAssertion["assertions"],
  fieldPath: string,
): string | undefined {
  const value = assertions.find((a) => a.fieldPath === fieldPath)?.normalizedValue;
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return undefined;
}

function numberAssertion(
  assertions: ParsedAssetAssertion["assertions"],
  fieldPath: string,
): number | undefined {
  const value = assertions.find((a) => a.fieldPath === fieldPath)?.normalizedValue;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isRedactedOrPlaceholder(input?: string): boolean {
  if (!input) return true;
  const normalized = input.toUpperCase().replace(/\s+/g, " ");
  const markers = ["REDACTED", "WITHHELD", "NOT PROVIDED", "UNKNOWN", "XXXX", "****", "••••"];
  return markers.some((m) => normalized.includes(m)) || normalized === "";
}

function recomputePropertyIdentity(asset: ParsedAssetAssertion): {
  identityFingerprint: string;
  displayLabel: string;
  matchClassification: ParsedAssetAssertion["matchClassification"];
} {
  const street = stringAssertion(asset.assertions, "property.streetAddress");
  const city = stringAssertion(asset.assertions, "property.city");
  const province = stringAssertion(asset.assertions, "property.province");
  const postal = stringAssertion(asset.assertions, "property.postalCode");
  const occupancy = stringAssertion(
    asset.assertions,
    "property.occupancy",
  ) as PropertyIdentityInput["occupancy"];

  const input: PropertyIdentityInput = {
    addressLine1: street,
    city,
    province,
    postalCode: postal,
    occupancy,
    isRedacted: isRedactedOrPlaceholder(street),
  };
  const result = buildPropertyIdentity(input);
  const fingerprint = result.exactFingerprint ?? result.possibleMatchHint ?? "";
  const display =
    result.normalizedAddressLine1 && result.normalizedCity
      ? `${result.normalizedAddressLine1} ${result.normalizedCity} ${result.normalizedProvince ?? ""} ${result.normalizedPostalCode ?? ""}`.trim()
      : `${occupancy ?? ""} ${result.normalizedCity ?? city ?? ""} ${result.normalizedProvince ?? province ?? ""} ${result.normalizedPostalCode ?? postal ?? ""}`.trim();

  if (!fingerprint) {
    return {
      identityFingerprint: `property:unknown:${crypto.randomUUID()}`,
      displayLabel: display || "Unidentified property",
      matchClassification: "new_identity_confirmation_required",
    };
  }

  if (result.strength === "exact") {
    return {
      identityFingerprint: fingerprint,
      displayLabel: display || fingerprint,
      matchClassification: "new",
    };
  }
  if (result.strength === "confirmation_required") {
    return {
      identityFingerprint: fingerprint,
      displayLabel: display || fingerprint,
      matchClassification: "possible_existing_match",
    };
  }
  return {
    identityFingerprint: fingerprint,
    displayLabel: display || fingerprint,
    matchClassification: "new_identity_confirmation_required",
  };
}

function recomputeVehicleIdentity(asset: ParsedAssetAssertion): {
  identityFingerprint: string;
  displayLabel: string;
  matchClassification: ParsedAssetAssertion["matchClassification"];
} {
  const vin = stringAssertion(asset.assertions, "vehicle.vin");
  const year = numberAssertion(asset.assertions, "vehicle.year");
  const make = stringAssertion(asset.assertions, "vehicle.make");
  const model = stringAssertion(asset.assertions, "vehicle.model");
  const trim = stringAssertion(asset.assertions, "vehicle.trim");

  const input: VehicleIdentityInput = { vin, modelYear: year, make, model, trim };
  const result = buildVehicleIdentity(input);
  const fingerprint = result.exactFingerprint ?? result.possibleMatchHint ?? "";
  const display =
    result.normalizedVin && result.maskedVin
      ? `${year ?? ""} ${make ?? ""} ${model ?? ""} ${trim ?? ""} (${result.maskedVin})`.trim()
      : `${year ?? ""} ${make ?? ""} ${model ?? ""} ${trim ?? ""}`.trim();

  if (!fingerprint) {
    return {
      identityFingerprint: `vehicle:unknown:${crypto.randomUUID()}`,
      displayLabel: display || "Unidentified vehicle",
      matchClassification: "new_identity_confirmation_required",
    };
  }

  if (result.strength === "exact") {
    return {
      identityFingerprint: fingerprint,
      displayLabel: display || fingerprint,
      matchClassification: "new",
    };
  }
  if (result.strength === "possible") {
    return {
      identityFingerprint: fingerprint,
      displayLabel: display || fingerprint,
      matchClassification: "possible_existing_match",
    };
  }
  return {
    identityFingerprint: fingerprint,
    displayLabel: display || fingerprint,
    matchClassification: "new_identity_confirmation_required",
  };
}

function recomputeAssetIdentity(asset: ParsedAssetAssertion): ParsedAssetAssertion {
  const recomputed =
    asset.assetType === "property"
      ? recomputePropertyIdentity(asset)
      : recomputeVehicleIdentity(asset);
  const validClassifications: Array<ParsedAssetAssertion["matchClassification"]> = [
    "new",
    "exact_existing_match",
    "possible_existing_match",
    "new_identity_confirmation_required",
  ];
  const preserveClassification =
    asset.matchClassification && validClassifications.includes(asset.matchClassification);
  return {
    ...asset,
    identityFingerprint: recomputed.identityFingerprint,
    displayLabel: recomputed.displayLabel || asset.displayLabel,
    matchClassification: preserveClassification
      ? asset.matchClassification
      : recomputed.matchClassification,
  };
}

function recomputeDocumentIdentities(doc: ParsedInsuranceDocument): ParsedInsuranceDocument {
  return {
    ...doc,
    assetAssertions: doc.assetAssertions.map(recomputeAssetIdentity),
  };
}

export class LlmFirstDocumentAnalyzer implements InsuranceDocumentAnalyzer {
  private provider?: InsuranceLlmProvider;
  private loader: DocumentLoader | null;
  private fallbackToDeterministic: boolean;

  constructor(
    options: {
      provider?: InsuranceLlmProvider;
      loader?: DocumentLoader;
      fallbackToDeterministic?: boolean;
    } = {},
  ) {
    this.provider = options.provider;
    this.loader = options.loader ?? null;
    this.fallbackToDeterministic = options.fallbackToDeterministic ?? true;
  }

  private async analyzeWithLlm(
    input: InsuranceDocumentAnalysisInput,
    extractedDocs: ExtractedPdf[],
  ): Promise<InsuranceDocumentAnalysisResult | null> {
    if (!this.provider) return null;

    const request = buildLlmAnalysisRequest(input, extractedDocs);
    const basePrompt = buildInsuranceAnalysisSystemPrompt();
    let validationFeedback = "";

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const systemPrompt = validationFeedback
          ? `${basePrompt}\n\nYour previous response failed validation. Correct these errors and respond only with the corrected JSON object. Errors:\n${validationFeedback}`
          : basePrompt;
        const raw = await this.provider.extract(request, systemPrompt);
        const normalized = normalizeLlmAnalysisResult(raw, input, extractedDocs, this.provider);
        return InsuranceDocumentAnalysisResultSchema.parse(normalized);
      } catch (error) {
        validationFeedback =
          validationFeedback ||
          `${error instanceof Error ? error.message : String(error)}`.slice(0, 2000);
        if (attempt === 2) return null;
      }
    }

    return null;
  }

  async analyze(input: InsuranceDocumentAnalysisInput): Promise<InsuranceDocumentAnalysisResult> {
    InsuranceDocumentAnalysisInputSchema.parse(input);

    if (!this.loader) {
      throw new Error("DocumentLoader is required to analyze uploaded documents");
    }

    const extractedDocs: ExtractedPdf[] = [];
    const warnings: AnalysisWarning[] = [];

    for (const uploaded of input.uploadedDocuments) {
      try {
        extractedDocs.push(await this.loader.load(uploaded));
      } catch (error) {
        warnings.push({
          message: `Could not load ${uploaded.filename}: ${error instanceof Error ? error.message : String(error)}`,
          documentId: uploaded.documentId,
        });
      }
    }

    if (this.provider) {
      const llmResult = await this.analyzeWithLlm(input, extractedDocs);
      if (llmResult) {
        return llmResult;
      }
      if (!this.fallbackToDeterministic) {
        throw new Error("LLM analysis failed and deterministic fallback is disabled.");
      }
      warnings.push({
        message: "LLM analysis failed; falling back to deterministic extraction.",
      });
    }

    const parsedDocuments: ParsedInsuranceDocument[] = [];
    for (const extracted of extractedDocs) {
      try {
        parsedDocuments.push(await parseDocument(extracted));
      } catch (error) {
        warnings.push({
          message: `Deterministic extraction failed for ${extracted.documentId}: ${error instanceof Error ? error.message : String(error)}`,
          documentId: extracted.documentId,
        });
      }
    }

    const existingByFingerprint = new Map<string, ExistingHouseholdAsset>();
    for (const asset of input.existingAssets) {
      existingByFingerprint.set(asset.identityFingerprint, asset);
    }

    const pendingByFingerprint = new Map<string, PendingEntityCandidate>();
    for (const candidate of input.pendingCandidates) {
      pendingByFingerprint.set(candidate.identityFingerprint, candidate);
    }

    const allExisting: ExistingAssetIdentity[] = [
      ...input.existingAssets.map((a) => ({
        assetType: a.assetType,
        identityFingerprint: a.identityFingerprint,
      })),
      ...input.pendingCandidates.map((c) => ({
        assetType: c.assetType,
        identityFingerprint: c.identityFingerprint,
      })),
    ];

    const recomputedDocuments = parsedDocuments.map(recomputeDocumentIdentities);
    const resolved = resolveParsedDocuments({
      householdAssets: allExisting,
      parsedDocuments: recomputedDocuments,
    });

    const documents: AnalyzedDocument[] = resolved.documents.map((doc) =>
      buildAnalyzedDocument(doc),
    );

    const documentForCandidate = new Map<string, ParsedInsuranceDocument>();
    for (const doc of resolved.documents) {
      for (const asset of doc.assetAssertions) {
        documentForCandidate.set(asset.identityFingerprint, doc);
      }
    }

    const detectedEntities: DetectedInsuranceEntity[] = [];
    for (const candidate of resolved.candidates) {
      const doc = documentForCandidate.get(candidate.identityFingerprint) ?? resolved.documents[0];
      detectedEntities.push(
        buildDetectedEntity(
          candidate,
          doc,
          doc?.documentId ?? candidate.assertions[0]?.documentId ?? "unknown",
          existingByFingerprint,
          pendingByFingerprint,
        ),
      );
    }

    const unresolvedConflicts: DetectedConflict[] = resolved.conflicts.map((c) => ({
      fieldPath: c.fieldPath,
      entityRef: c.fieldPath,
      assertionIds: c.assertionIds,
      explanation: c.reason,
      requiresHumanResolution: true,
    }));

    const providerId = this.provider?.providerId ?? "deterministic";
    const modelId = this.provider?.modelId ?? "pdfjs-fallback";

    return InsuranceDocumentAnalysisResultSchema.parse({
      analysisVersion: "1" as const,
      modelProvider: providerId,
      modelId,
      documents,
      detectedEntities,
      unresolvedConflicts,
      warnings,
    });
  }
}

function buildLlmAnalysisRequest(
  input: InsuranceDocumentAnalysisInput,
  extractedDocs: ExtractedPdf[],
): unknown {
  return {
    jurisdiction: input.jurisdiction,
    uploadedDocuments: extractedDocs.map((doc) => {
      const meta = input.uploadedDocuments.find((u) => u.documentId === doc.documentId);
      return {
        documentId: doc.documentId,
        filename: meta?.filename ?? doc.documentId,
        mimeType: meta?.mimeType ?? "application/pdf",
        pageCount: doc.pageCount,
        pages: doc.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
      };
    }),
    existingAssets: input.existingAssets.map((a) => ({
      id: a.id,
      assetType: a.assetType,
      identityFingerprint: a.identityFingerprint,
    })),
    pendingCandidates: input.pendingCandidates.map((c) => ({
      id: c.id,
      assetType: c.assetType,
      identityFingerprint: c.identityFingerprint,
    })),
  };
}

const INSURANCE_ANALYSIS_SYSTEM_PROMPT = `You are an insurance document analyst. Read the uploaded policy PDFs (provided as page-level text) and produce a single JSON object that conforms to the schema below. Do not include markdown fences, commentary, or any keys not in the schema.

Core rules:
- Distinguish active coverage documents from informational notices, advertisements, and billing-only pages.
- A shared mailing address or correspondence address is NOT an insured property. Use only the address the policy actually covers.
- One customer may own multiple properties and vehicles. Do not merge assets unless they share the exact same VIN (vehicles) or the exact same full civic address (properties). A postal-code-only match is not enough.
- A policy number identifies a term, not an asset. The same asset may appear under different policy numbers across documents.
- For vehicles, VIN is the strongest identifier. For properties, the full civic address (street number, street name, city, province, postal code) is the strongest identifier.
- If a property address is redacted, partial, or only the postal code is visible, use resolution status "possible_match_requires_confirmation".
- If a document is a notice about future coverage, a discount notice, or promotional material, do not create an asset from it; instead add a warning.
- When a detected asset matches an existing asset in existingAssets or pendingCandidates, set resolution.status to "matches_existing" or "matches_pending_candidate" and include the matched id.
- Monetary values must be integer cents (e.g. $438,000 -> 43800000). Dates should be ISO strings (YYYY-MM-DD) when known.
- For mandate defaults, apply these semantic rules:
  * limit -> { rule: "minimum", amountCents: <current value in cents> }
  * deductible -> { rule: "maximum", amountCents: <current value in cents> }
  * coverage form/type -> { rule: "match_current_or_better", value: "<current value>" }
  * optional coverage that is included -> { rule: "required" } (omit value)
  * optional coverage that is not included, not applicable, or unknown -> { rule: "any", reason: "..." }
- Every known or conflicting value must include an evidence array entry with documentId and evidenceSummary. Unknown values do not need evidence.

Expected output JSON schema:
{
  "detectedEntities": [
    {
      "temporaryId": "unique stable opaque id for this candidate (string)",
      "entityType": "property" | "vehicle",
      "displayLabel": "human readable label e.g. '2006 Mazda Mazda5 GT' or '123 Main St NW Calgary AB T3A 0C2'",
      "identity": {
        "fullAddress": "string or null",
        "city": "string or null",
        "province": "string or null",
        "postalCode": "string or null",
        "occupancy": "principal_residence" | "rental" | "other" | "unknown" | null,
        "vin": "string or null",
        "year": integer or null,
        "make": "string or null",
        "model": "string or null",
        "trim": "string or null",
        "vehicleUse": "string or null"
      },
      "resolution": {
        "status": "new" | "matches_existing" | "matches_pending_candidate" | "possible_match_requires_confirmation",
        "matchedExistingEntityId": "string or null/omitted",
        "matchedPendingCandidateId": "string or null/omitted",
        "confidence": number between 0 and 1,
        "reasoning": "string"
      },
      "currentPolicy": {
        "insurer": "string or null",
        "policyNumber": "string or null",
        "effectiveDate": "YYYY-MM-DD or null",
        "expiryDate": "YYYY-MM-DD or null",
        "annualPremiumCents": integer or null
      },
      "currentCoverage": {
        "<field>": {
          "status": "known" | "unknown" | "not_included" | "not_applicable" | "conflicting",
          "value": any (number in cents for money, boolean for presence, string for form/type, null when unknown),
          "confidence": number between 0 and 1,
          "evidence": [{ "documentId": "...", "pageNumber": number, "quotedLabel": "...", "evidenceSummary": "..." }],
          "explanation": "string or omitted"
        }
      },
      "mandateSuggestions": {
        "<field>": { "rule": "minimum" | "maximum" | "match_current_or_better" | "required" | "any", "amountCents": integer, "value": "string", "reason": "string" } - use only the keys that match the rule
      },
      "evidence": [{ "documentId": "...", "pageNumber": number, "quotedLabel": "...", "evidenceSummary": "..." }],
      "requiredConfirmations": ["string"]
    }
  ],
  "unresolvedConflicts": [
    {
      "fieldPath": "string e.g. property.dwellingLimitCents",
      "entityRef": "temporaryId of the entity",
      "assertionIds": ["string"],
      "explanation": "string",
      "requiresHumanResolution": true
    }
  ],
  "warnings": [
    {
      "message": "string",
      "documentId": "string or omitted"
    }
  ]
}

Return only the JSON object.`;

function buildInsuranceAnalysisSystemPrompt(): string {
  return INSURANCE_ANALYSIS_SYSTEM_PROMPT;
}

function countEntitiesForDocument(documentId: string, entities: DetectedInsuranceEntity[]): number {
  return entities.filter((entity) => entity.evidence.some((e) => e.documentId === documentId))
    .length;
}

function documentClassification(documentId: string, entities: DetectedInsuranceEntity[]): string {
  const types = new Set(
    entities
      .filter((e) => e.evidence.some((ev) => ev.documentId === documentId))
      .map((e) => e.entityType),
  );
  if (types.has("vehicle") && types.has("property")) return "unknown";
  if (types.has("vehicle")) return "auto_policy_renewal";
  if (types.has("property")) return "home_policy_renewal";
  return "unknown";
}

function normalizeLlmAnalysisResult(
  raw: unknown,
  input: InsuranceDocumentAnalysisInput,
  extractedDocs: ExtractedPdf[],
  provider: InsuranceLlmProvider,
): unknown {
  if (!raw || typeof raw !== "object") {
    throw new Error("LLM response is not a JSON object");
  }

  const typed = raw as Record<string, unknown>;
  const detectedEntities = Array.isArray(typed.detectedEntities) ? typed.detectedEntities : [];
  const unresolvedConflicts = Array.isArray(typed.unresolvedConflicts)
    ? typed.unresolvedConflicts
    : [];
  const warnings = Array.isArray(typed.warnings) ? typed.warnings : [];

  // Enrich each detected entity with sensible defaults if the model omitted them.
  const enrichedEntities = detectedEntities.map((entity: unknown, index: number) => {
    if (!entity || typeof entity !== "object") {
      throw new Error(`detectedEntities[${index}] is not an object`);
    }
    const typedEntity = entity as Record<string, unknown>;
    const entityType =
      typedEntity.entityType === "property" || typedEntity.entityType === "vehicle"
        ? typedEntity.entityType
        : null;
    if (!entityType) {
      throw new Error(`detectedEntities[${index}] is missing a valid entityType`);
    }

    const temporaryId =
      typeof typedEntity.temporaryId === "string" && typedEntity.temporaryId.length > 0
        ? typedEntity.temporaryId
        : `llm-${entityType}-${index}`;
    const displayLabel =
      typeof typedEntity.displayLabel === "string" && typedEntity.displayLabel.length > 0
        ? typedEntity.displayLabel
        : temporaryId;

    const currentCoverage = (typedEntity.currentCoverage as Record<string, unknown>) ?? {};
    const normalizedCoverage: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(currentCoverage)) {
      if (value && typeof value === "object") {
        const typedValue = value as Record<string, unknown>;
        normalizedCoverage[key] = {
          status: ["known", "unknown", "not_included", "not_applicable", "conflicting"].includes(
            String(typedValue.status),
          )
            ? typedValue.status
            : "unknown",
          value: typedValue.value ?? null,
          confidence: typeof typedValue.confidence === "number" ? typedValue.confidence : 0.7,
          evidence: Array.isArray(typedValue.evidence) ? typedValue.evidence : [],
          explanation: typedValue.explanation ?? undefined,
        };
      }
    }

    const mandateSuggestions = (typedEntity.mandateSuggestions as Record<string, unknown>) ?? {};
    const normalizedMandates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mandateSuggestions)) {
      if (value && typeof value === "object") {
        const typedValue = value as Record<string, unknown>;
        const rule = typedValue.rule;
        const normalized: Record<string, unknown> = { rule };
        if (rule === "minimum" || rule === "maximum") {
          normalized.amountCents =
            typeof typedValue.amountCents === "number" ? typedValue.amountCents : 0;
        }
        if (rule === "match_current_or_better") {
          normalized.value = typeof typedValue.value === "string" ? typedValue.value : "";
        }
        if (rule === "any") {
          normalized.reason = typeof typedValue.reason === "string" ? typedValue.reason : "unknown";
        }
        normalizedMandates[key] = normalized;
      }
    }

    return {
      ...typedEntity,
      temporaryId,
      displayLabel,
      currentCoverage: normalizedCoverage,
      mandateSuggestions: normalizedMandates,
      evidence: Array.isArray(typedEntity.evidence) ? typedEntity.evidence : [],
      requiredConfirmations: Array.isArray(typedEntity.requiredConfirmations)
        ? typedEntity.requiredConfirmations
        : [],
    };
  });

  const documents: AnalyzedDocument[] = extractedDocs.map((doc) => ({
    documentId: doc.documentId,
    fileDigest: doc.fileDigest,
    classification: documentClassification(
      doc.documentId,
      enrichedEntities as DetectedInsuranceEntity[],
    ),
    parserId: provider.providerId,
    parserVersion: provider.modelId,
    pageCount: doc.pageCount,
    extractedEntityCount: countEntitiesForDocument(
      doc.documentId,
      enrichedEntities as DetectedInsuranceEntity[],
    ),
  }));

  return {
    analysisVersion: "1",
    modelProvider: provider.providerId,
    modelId: provider.modelId,
    documents,
    detectedEntities: enrichedEntities,
    unresolvedConflicts,
    warnings,
  };
}

export function createLlmFirstAnalyzer(options?: {
  provider?: InsuranceLlmProvider;
  loader?: DocumentLoader;
  fallbackToDeterministic?: boolean;
}): InsuranceDocumentAnalyzer {
  return new LlmFirstDocumentAnalyzer(options);
}
