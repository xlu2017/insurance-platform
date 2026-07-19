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
import type {
  DocumentProcessingAuthorization,
  ExternalFileLifecycleStore,
  FileBytesLoader,
  NativeDocumentAnalysisProvider,
  ExternalFileRecord,
  OriginalFileInput,
  ProviderFileDeletionResult,
  ProviderFileHandle,
  ProviderUploadResult,
} from "./providers/native-document-analysis.ts";

const AnalysisVersion = z.literal("1");

const GENERIC_PARSER_ID = "native-document-analysis";
const GENERIC_PARSER_VERSION = "1.0.0";

export const UploadedDocumentSchema = z
  .object({
    documentId: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    fileReference: z.string().min(1),
  })
  .strict();
export type UploadedDocument = z.infer<typeof UploadedDocumentSchema>;

export const CandidateIdentitySchema = z
  .object({
    exactIdentityFingerprint: z.string().nullable(),
    provisionalCandidateKey: z.string().min(1),
    identityStrength: z.enum(["exact", "partial", "redacted", "unknown"]),
  })
  .strict();
export type CandidateIdentity = z.infer<typeof CandidateIdentitySchema>;

export const ExistingHouseholdAssetSchema = z
  .object({
    id: z.string().min(1),
    assetType: z.enum(["property", "vehicle"]),
    identityFingerprint: z.string().min(1),
    displayLabel: z.string().optional(),
    candidateIdentity: z.lazy(() => CandidateIdentitySchema).optional(),
    identity: z.lazy(() => DetectedEntityIdentitySchema).optional(),
    currentPolicy: z.lazy(() => CurrentPolicySchema).optional(),
  })
  .strict();
export type ExistingHouseholdAsset = z.infer<typeof ExistingHouseholdAssetSchema>;

export const PendingEntityCandidateSchema = z
  .object({
    id: z.string().min(1),
    assetType: z.enum(["property", "vehicle"]),
    identityFingerprint: z.string().min(1),
    displayLabel: z.string().optional(),
    candidateIdentity: z.lazy(() => CandidateIdentitySchema).optional(),
    identity: z.lazy(() => DetectedEntityIdentitySchema).optional(),
    currentPolicy: z.lazy(() => CurrentPolicySchema).optional(),
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
  z.object({ rule: z.literal("minimum"), amountCents: z.number().int().positive() }).strict(),
  z.object({ rule: z.literal("maximum"), amountCents: z.number().int().nonnegative() }).strict(),
  z.object({ rule: z.literal("match_current_or_better"), value: z.string().min(1) }).strict(),
  z.object({ rule: z.literal("required") }).strict(),
  z.object({ rule: z.literal("any"), reason: z.string().optional() }).strict(),
]);
export type MandateRule = z.infer<typeof MandateRuleSchema>;

export const DetectedInsuranceEntitySchema = z
  .object({
    temporaryId: z.string().min(1),
    canonicalFingerprint: z.string().min(1),
    candidateIdentity: CandidateIdentitySchema,
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
    documentId: z.string().nullable().optional(),
  })
  .strict()
  .transform((w) => {
    const out: { message: string; documentId?: string } = { message: w.message };
    if (w.documentId) out.documentId = w.documentId;
    return out;
  });
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
    attemptedModelProvider: z.string().min(1).optional(),
    attemptedModelId: z.string().min(1).optional(),
    fallbackReason: z.string().optional(),
    rawResponse: z.unknown().nullable().optional(),
    attemptCount: z.number().int().positive().optional(),
    promptVersion: z.string().optional(),
    outputSchemaVersion: z.string().optional(),
    providerMetadata: z.unknown().optional(),
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

function authorityRank(authority: string): number {
  const order = [
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
  ];
  const index = order.indexOf(authority);
  return index === -1 ? order.length : index;
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

function isOptionalCoverageBoolean(fieldPath: string): boolean {
  return /Included$/i.test(fieldPath) || /Coverage$/i.test(fieldPath);
}

function buildCurrentCoverage(
  candidate: ParsedAssetAssertion,
  documentId: string,
): Record<string, ExtractedCurrentValue> {
  const coverage: Record<string, ExtractedCurrentValue> = {};
  const sorted = [...candidate.assertions].sort(
    (a, b) => authorityRank(a.authority) - authorityRank(b.authority),
  );
  for (const assertion of sorted) {
    if (assertion.entityScope !== "coverage") {
      continue;
    }

    const fieldPath = assertion.fieldPath;
    if (Object.prototype.hasOwnProperty.call(coverage, fieldPath)) {
      continue;
    }

    let status: ExtractedCurrentValue["status"];
    let value: unknown = null;
    const confidence = assertion.confidence;

    if (isOptionalCoverageBoolean(fieldPath)) {
      const presence = assertion.coveragePresence;
      status = statusFromPresence(presence);
      value = presence === "included" ? true : presence === "not_included" ? false : null;
    } else if (typeof assertion.normalizedValue === "number" && assertion.normalizedValue > 0) {
      status = "known";
      value = assertion.normalizedValue;
    } else if (
      typeof assertion.normalizedValue === "string" &&
      assertion.normalizedValue.length > 0
    ) {
      status = "known";
      value = assertion.normalizedValue;
    } else if (assertion.coveragePresence) {
      status = statusFromPresence(assertion.coveragePresence);
      value = null;
    } else {
      status = "unknown";
      value = null;
    }

    if (status === "unknown") {
      coverage[fieldPath] = { status, value, confidence };
    } else {
      coverage[fieldPath] = {
        status,
        value,
        confidence,
        evidence: [
          { documentId, pageNumber: assertion.pageNumber, evidenceSummary: assertion.rawText },
        ],
      };
    }
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
    return { rule: "any", reason: "currently not included" };
  }

  if (isOptionalCoverageBoolean(fieldPath) && current.status === "known") {
    return current.value === true
      ? { rule: "required" }
      : { rule: "any", reason: "currently not included" };
  }

  const value = current.value;
  if (typeof value !== "number" || value <= 0) {
    if (typeof value === "string" && String(value).length > 0) {
      if (fieldPath.includes("Form") || fieldPath.includes("form")) {
        return { rule: "match_current_or_better", value: String(value) };
      }
      return { rule: "any", reason: "no mandateable numeric or form value" };
    }
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
  if (fieldPath.includes("Form") || fieldPath.includes("form")) {
    return { rule: "match_current_or_better", value: String(value) };
  }

  return { rule: "any", reason: "field is not mandateable" };
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

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[,\s]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildIdentity(candidate: ParsedAssetAssertion): DetectedEntityIdentity {
  if (candidate.assetType === "vehicle") {
    return {
      vin: nullableString(valueForFieldPath(candidate.assertions, "vehicle.vin")),
      year: nullableNumber(valueForFieldPath(candidate.assertions, "vehicle.year")),
      make: nullableString(valueForFieldPath(candidate.assertions, "vehicle.make")),
      model: nullableString(valueForFieldPath(candidate.assertions, "vehicle.model")),
      trim: nullableString(valueForFieldPath(candidate.assertions, "vehicle.trim")),
      vehicleUse: nullableString(valueForFieldPath(candidate.assertions, "vehicle.vehicleUse")),
    };
  }

  const occupancy = valueForFieldPath(candidate.assertions, "property.occupancy");
  return {
    fullAddress: nullableString(valueForFieldPath(candidate.assertions, "property.streetAddress")),
    city: nullableString(valueForFieldPath(candidate.assertions, "property.city")),
    province: nullableString(valueForFieldPath(candidate.assertions, "property.province")),
    postalCode: nullableString(valueForFieldPath(candidate.assertions, "property.postalCode")),
    occupancy:
      occupancy === "principal_residence" || occupancy === "rental" ? occupancy : "unknown",
  };
}

function buildCurrentPolicy(
  candidate: ParsedAssetAssertion,
  doc: ParsedInsuranceDocument,
): CurrentPolicy {
  const term = doc.policyTerms[0] ?? {};
  const policyNumber = nullableString(
    term.policyNumber ?? valueForFieldPath(candidate.assertions, "policy.policyNumber"),
  );
  const premium = nullableNumber(
    term.annualPremiumCents ?? valueForFieldPath(candidate.assertions, "policy.annualPremiumCents"),
  );
  return {
    insurer: nullableString(doc.insurer?.name) ?? null,
    policyNumber,
    effectiveDate: nullableString(term.effectiveDate),
    expiryDate: nullableString(term.expiryDate),
    annualPremiumCents: premium,
  };
}

function findPossibleMatch(
  candidate: ParsedAssetAssertion,
  candidateFingerprint: string,
  existingByFingerprint: Map<string, ExistingHouseholdAsset>,
  pendingByFingerprint: Map<string, PendingEntityCandidate>,
): ExistingHouseholdAsset | PendingEntityCandidate | undefined {
  if (candidate.assetType === "vehicle") {
    for (const map of [existingByFingerprint, pendingByFingerprint]) {
      const exact = map.get(candidateFingerprint);
      if (exact) return exact;
    }
  }
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
  return undefined;
}

function mapResolution(
  candidate: ParsedAssetAssertion,
  candidateFingerprint: string,
  existingByFingerprint: Map<string, ExistingHouseholdAsset>,
  pendingByFingerprint: Map<string, PendingEntityCandidate>,
): EntityResolution {
  if (candidate.matchClassification === "exact_existing_match") {
    const existing = existingByFingerprint.get(candidateFingerprint);
    if (existing) {
      return {
        status: "matches_existing",
        matchedExistingEntityId: existing.id,
        confidence: 0.99,
        reasoning: "Exact identity fingerprint matches an existing household asset.",
      };
    }
    const pending = pendingByFingerprint.get(candidateFingerprint);
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
    const possible = findPossibleMatch(
      candidate,
      candidateFingerprint,
      existingByFingerprint,
      pendingByFingerprint,
    );
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

async function buildDetectedEntity(
  candidate: ParsedAssetAssertion,
  doc: ParsedInsuranceDocument,
  documentId: string,
  existingByFingerprint: Map<string, ExistingHouseholdAsset>,
  pendingByFingerprint: Map<string, PendingEntityCandidate>,
): Promise<DetectedInsuranceEntity> {
  const currentPolicy = buildCurrentPolicy(candidate, doc);
  const identity = buildIdentity(candidate);
  const candidateIdentity = await buildCandidateIdentity(identity, candidate.assetType);
  const canonicalFingerprint =
    candidateIdentity.exactIdentityFingerprint ?? candidateIdentity.provisionalCandidateKey;
  const currentCoverage = buildCurrentCoverage(candidate, documentId);
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
    temporaryId: generateOpaqueId(),
    canonicalFingerprint,
    candidateIdentity,
    entityType: candidate.assetType,
    displayLabel: candidate.displayLabel,
    identity,
    resolution: mapResolution(
      candidate,
      canonicalFingerprint,
      existingByFingerprint,
      pendingByFingerprint,
    ),
    currentPolicy,
    currentCoverage,
    mandateSuggestions: buildMandateSuggestions(currentCoverage),
    evidence: candidate.assertions
      .filter(
        (a) =>
          a.entityScope !== "notice" &&
          typeof a.rawText === "string" &&
          a.rawText.trim().length > 0,
      )
      .slice(0, 10)
      .map((a) => ({
        documentId,
        pageNumber: a.pageNumber,
        evidenceSummary: `${a.fieldPath}: ${a.rawText.trim().slice(0, 200)}`,
      })),
    requiredConfirmations,
  };
}

function buildAnalyzedDocument(doc: ParsedInsuranceDocument): AnalyzedDocument {
  return {
    documentId: doc.documentId ?? "unknown",
    fileDigest: doc.fileDigest ?? "unknown",
    classification: doc.classification,
    parserId: GENERIC_PARSER_ID,
    parserVersion: GENERIC_PARSER_VERSION,
    pageCount: doc.pageCount ?? 0,
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
    const fallback = display.toUpperCase().replace(/[^A-Z0-9]/g, "-") || "unidentified";
    return {
      identityFingerprint: `property:unknown:${fallback}`,
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
    const fallback = display.toUpperCase().replace(/[^A-Z0-9]/g, "-") || "unidentified";
    return {
      identityFingerprint: `vehicle:unknown:${fallback}`,
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

  private async analyzeSingleDocumentWithLlm(
    uploaded: InsuranceDocumentAnalysisInput["uploadedDocuments"][number],
    extractedDoc: ExtractedPdf,
    baseInput: InsuranceDocumentAnalysisInput,
  ): Promise<InsuranceDocumentAnalysisResult | null> {
    if (!this.provider) return null;

    const docInput: InsuranceDocumentAnalysisInput = {
      ...baseInput,
      uploadedDocuments: [uploaded],
    };
    const { content, documentIdMap } = buildLlmAnalysisRequest(docInput, [extractedDoc]);
    const basePrompt = buildInsuranceAnalysisSystemPrompt();
    let validationFeedback = "";

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const systemPrompt = validationFeedback
          ? `${basePrompt}\n\nYour previous response failed validation. Correct these errors and respond only with the corrected JSON object. Errors:\n${validationFeedback}`
          : basePrompt;
        const raw = await this.provider.extract({ content }, systemPrompt);
        const normalized = await normalizeLlmAnalysisResult(
          raw,
          docInput,
          [extractedDoc],
          this.provider,
          attempt,
          documentIdMap,
        );
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

  private async analyzeWithLlm(
    input: InsuranceDocumentAnalysisInput,
    extractedDocs: ExtractedPdf[],
  ): Promise<InsuranceDocumentAnalysisResult | null> {
    if (!this.provider) return null;

    const existingByFingerprint = new Map<string, ExistingHouseholdAsset>();
    for (const asset of input.existingAssets) {
      existingByFingerprint.set(asset.identityFingerprint, asset);
    }

    const allDocuments: AnalyzedDocument[] = [];
    const allDetected: DetectedInsuranceEntity[] = [];
    const allConflicts: DetectedConflict[] = [];
    const allWarnings: AnalysisWarning[] = [];
    const perDocTemporaryIdMap = new Map<string, string>();
    let totalAttempts = 0;

    for (let i = 0; i < extractedDocs.length; i++) {
      const extractedDoc = extractedDocs[i];
      const uploaded = input.uploadedDocuments[i];
      if (!uploaded) continue;

      const docResult = await this.analyzeSingleDocumentWithLlm(uploaded, extractedDoc, input);
      if (!docResult) {
        return null;
      }
      totalAttempts += docResult.attemptCount ?? 1;
      allDocuments.push(...docResult.documents);
      allWarnings.push(...docResult.warnings);

      for (const e of docResult.detectedEntities) {
        const existing = existingByFingerprint.get(e.canonicalFingerprint);
        if (
          existing &&
          isExactFingerprint(e.canonicalFingerprint) &&
          e.resolution.status !== "matches_existing"
        ) {
          e.resolution = {
            status: "matches_existing",
            matchedExistingEntityId: existing.id,
            confidence: 0.99,
            reasoning: "Exact identity fingerprint matches an existing household asset.",
          };
        }

        const kept = allDetected.find((d) => d.canonicalFingerprint === e.canonicalFingerprint);
        if (kept) {
          perDocTemporaryIdMap.set(e.temporaryId, kept.temporaryId);
          mergeDetectedEntities(kept, e);
        } else {
          allDetected.push(e);
          perDocTemporaryIdMap.set(e.temporaryId, e.temporaryId);
        }
      }

      for (const c of docResult.unresolvedConflicts) {
        const mappedRef = perDocTemporaryIdMap.get(c.entityRef);
        allConflicts.push({ ...c, entityRef: mappedRef ?? c.entityRef });
      }
    }

    markPossiblePropertyDuplicates(allDetected);

    const documentMap = new Map<string, AnalyzedDocument>();
    for (const d of allDocuments) {
      documentMap.set(d.documentId, d);
    }
    const finalDocuments = extractedDocs.map((d) => {
      const analyzed = documentMap.get(d.documentId);
      return {
        documentId: d.documentId,
        fileDigest: d.fileDigest,
        classification: analyzed?.classification ?? "unknown",
        parserId: analyzed?.parserId ?? GENERIC_PARSER_ID,
        parserVersion: analyzed?.parserVersion ?? GENERIC_PARSER_VERSION,
        pageCount: d.pageCount,
        extractedEntityCount: countEntitiesForDocument(d.documentId, allDetected),
      };
    });

    return InsuranceDocumentAnalysisResultSchema.parse({
      analysisVersion: "1",
      modelProvider: this.provider.providerId,
      modelId: this.provider.modelId,
      documents: finalDocuments,
      detectedEntities: allDetected,
      unresolvedConflicts: allConflicts,
      warnings: allWarnings,
      rawResponse: null,
      attemptCount: totalAttempts,
      promptVersion: "1.0.0",
      outputSchemaVersion: "1.0.0",
    });
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
        await buildDetectedEntity(
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

    const attempted = this.provider
      ? {
          attemptedModelProvider: this.provider.providerId,
          attemptedModelId: this.provider.modelId,
        }
      : {};

    return InsuranceDocumentAnalysisResultSchema.parse({
      analysisVersion: "1" as const,
      modelProvider: "deterministic",
      modelId: "pdfjs-fallback",
      ...attempted,
      fallbackReason: warnings.find((w) => w.message.includes("LLM analysis failed"))?.message,
      documents,
      detectedEntities,
      unresolvedConflicts,
      warnings,
      rawResponse: null,
      attemptCount: 1,
      promptVersion: "1.0.0",
      outputSchemaVersion: "1.0.0",
    });
  }
}

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type CandidateComparisonContext = {
  id: string;
  entityType: "property" | "vehicle";
  displayLabel?: string;
  identity: Partial<DetectedEntityIdentity>;
  currentPolicy?: Partial<CurrentPolicy>;
  exactIdentityFingerprint: string | null;
  provisionalCandidateKey: string;
};

export function buildCandidateContext(
  candidate: ExistingHouseholdAsset | PendingEntityCandidate,
): CandidateComparisonContext {
  return {
    id: candidate.id,
    entityType: candidate.assetType,
    displayLabel: candidate.identity
      ? buildDisplayLabel(candidate.identity, candidate.assetType)
      : candidate.displayLabel,
    identity: candidate.identity ? stripNullValues(candidate.identity) : {},
    currentPolicy: candidate.currentPolicy ? stripNullValues(candidate.currentPolicy) : undefined,
    exactIdentityFingerprint: candidate.candidateIdentity?.exactIdentityFingerprint ?? null,
    provisionalCandidateKey:
      candidate.candidateIdentity?.provisionalCandidateKey ?? candidate.identityFingerprint,
  };
}

export function stripNullValues<T extends Record<string, unknown>>(input: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  if (!ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function isMonetaryField(fieldPath: string): boolean {
  const normalized = fieldPath.toLowerCase().replace(/[^a-z]/g, "");
  return (
    normalized.includes("cents") ||
    normalized.includes("premium") ||
    normalized.includes("limit") ||
    normalized.includes("deductible")
  );
}

function isValidMonetaryCents(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validateCurrentPolicy(policy: CurrentPolicy): void {
  if (policy.effectiveDate && !isValidDate(policy.effectiveDate)) {
    throw new Error(
      `currentPolicy.effectiveDate ${JSON.stringify(policy.effectiveDate)} is not a valid ISO date`,
    );
  }
  if (policy.expiryDate && !isValidDate(policy.expiryDate)) {
    throw new Error(
      `currentPolicy.expiryDate ${JSON.stringify(policy.expiryDate)} is not a valid ISO date`,
    );
  }
  if (
    policy.annualPremiumCents !== null &&
    policy.annualPremiumCents !== undefined &&
    (!Number.isInteger(policy.annualPremiumCents) || policy.annualPremiumCents < 0)
  ) {
    throw new Error(`currentPolicy.annualPremiumCents must be a non-negative integer`);
  }
  if (
    policy.effectiveDate &&
    policy.expiryDate &&
    new Date(policy.effectiveDate) > new Date(policy.expiryDate)
  ) {
    throw new Error(`currentPolicy.effectiveDate must not be after expiryDate`);
  }
}

function validateEvidenceReference(
  ref: EvidenceReference,
  allowedDocumentIds: Set<string>,
  pageCountByDocumentId: Map<string, number>,
): void {
  if (!allowedDocumentIds.has(ref.documentId)) {
    throw new Error(`evidence references unknown documentId ${ref.documentId}`);
  }
  if (ref.pageNumber !== undefined) {
    const pageCount = pageCountByDocumentId.get(ref.documentId);
    if (pageCount === undefined || pageCount === 0) {
      throw new Error(
        `evidence pageNumber ${ref.pageNumber} is not valid for document ${ref.documentId} (no page reference available)`,
      );
    }
    if (ref.pageNumber < 1 || ref.pageNumber > pageCount) {
      throw new Error(
        `evidence pageNumber ${ref.pageNumber} is out of range for document ${ref.documentId} (pages ${pageCount})`,
      );
    }
  }
}

function buildDisplayLabel(
  identity: DetectedEntityIdentity,
  entityType: "property" | "vehicle",
): string | undefined {
  if (entityType === "vehicle") {
    const parts = [identity.year, identity.make, identity.model, identity.trim].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : undefined;
  }
  return identity.fullAddress ?? undefined;
}

function buildLlmAnalysisRequest(
  input: InsuranceDocumentAnalysisInput,
  extractedDocs: ExtractedPdf[],
): { content: LlmContentPart[]; documentIdMap: Map<string, string> } {
  const parts: LlmContentPart[] = [];
  const documentIdMap = new Map<string, string>();

  const documentAliases: string[] = [];
  for (let i = 0; i < extractedDocs.length; i++) {
    const doc = extractedDocs[i];
    const alias = `doc-${i + 1}`;
    documentIdMap.set(doc.documentId, doc.documentId);
    documentIdMap.set(alias, doc.documentId);
    documentAliases.push(`${alias} = ${alias}`);
  }

  const candidateContexts: CandidateComparisonContext[] = [
    ...input.existingAssets.map(buildCandidateContext),
    ...input.pendingCandidates.map(buildCandidateContext),
  ];

  parts.push({
    type: "text",
    text: `You are an insurance document analyst. Analyze the uploaded policy PDFs and produce a single JSON object conforming to the schema in the system prompt.\n\nJurisdiction: ${input.jurisdiction}\n\nDocument IDs (use ONLY these exact values for evidence documentId fields):\n${documentAliases.join("\n")}${candidateContexts.length > 0 ? `\n\nExisting and pending household candidates for comparison (use the exact "id" values for resolution.matchedExistingEntityId or resolution.matchedPendingCandidateId, and compare exactIdentityFingerprint/provisionalCandidateKey values before claiming a match):\n${JSON.stringify(candidateContexts, null, 2)}` : ""}\n\nThe pages below are provided as extracted text. When page images are available they are included after the text for the same page.`,
  });

  for (const doc of extractedDocs) {
    const alias = `doc-${extractedDocs.indexOf(doc) + 1}`;
    parts.push({
      type: "text",
      text: `\n--- ${alias} (${doc.pageCount} pages) ---`,
    });
    for (const page of doc.pages) {
      parts.push({
        type: "text",
        text: `\nPage ${page.pageNumber}:\n${page.text}`,
      });
      if (page.image) {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${page.image.mimeType};base64,${page.image.base64}` },
        });
      }
    }
  }

  return { content: parts, documentIdMap };
}

const INSURANCE_ANALYSIS_SYSTEM_PROMPT = `You are an insurance document analyst. Read the uploaded policy documents (provided as extracted document text) and produce a single JSON object that conforms to the schema below. Do not include markdown fences, commentary, or any keys not in the schema.

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

export function buildInsuranceAnalysisSystemPrompt(): string {
  return INSURANCE_ANALYSIS_SYSTEM_PROMPT;
}

function countEntitiesForDocument(documentId: string, entities: DetectedInsuranceEntity[]): number {
  return entities.filter((entity) => {
    if (entity.evidence.some((e) => e.documentId === documentId)) return true;
    return Object.values(entity.currentCoverage).some((cv) =>
      cv.evidence?.some((e) => e.documentId === documentId),
    );
  }).length;
}

function mergeDetectedEntities(target: DetectedInsuranceEntity, source: DetectedInsuranceEntity) {
  target.evidence.push(...source.evidence);
  for (const [fieldPath, value] of Object.entries(source.currentCoverage)) {
    const existing = target.currentCoverage[fieldPath];
    if (!existing || (value.confidence ?? 0) > (existing.confidence ?? 0)) {
      target.currentCoverage[fieldPath] = value;
    }
  }
  target.mandateSuggestions = { ...target.mandateSuggestions, ...source.mandateSuggestions };
  const required = new Set([...target.requiredConfirmations, ...source.requiredConfirmations]);
  target.requiredConfirmations = Array.from(required);
}

function markPossiblePropertyDuplicates(entities: DetectedInsuranceEntity[]) {
  const propertyGroups = new Map<string, DetectedInsuranceEntity[]>();
  for (const e of entities) {
    if (e.entityType !== "property") continue;
    if (isExactFingerprint(e.canonicalFingerprint)) continue;
    const postal = e.identity.postalCode?.toUpperCase().replace(/\s+/g, "");
    if (!postal) continue;
    const group = propertyGroups.get(postal) ?? [];
    group.push(e);
    propertyGroups.set(postal, group);
  }
  for (const group of propertyGroups.values()) {
    if (group.length <= 1) continue;
    for (const e of group) {
      e.resolution = {
        status: "possible_match_requires_confirmation",
        confidence: 0.5,
        reasoning: `Another pending property candidate shares postal code ${e.identity.postalCode}. Confirm whether they are the same property.`,
      };
      if (!e.requiredConfirmations.includes(e.resolution.reasoning)) {
        e.requiredConfirmations.push(e.resolution.reasoning);
      }
    }
  }
}

function documentClassification(documentId: string, entities: DetectedInsuranceEntity[]): string {
  const types = new Set(
    entities
      .filter((e) => {
        if (e.evidence.some((ev) => ev.documentId === documentId)) return true;
        return Object.values(e.currentCoverage).some((cv) =>
          cv.evidence?.some((ev) => ev.documentId === documentId),
        );
      })
      .map((e) => e.entityType),
  );
  if (types.has("vehicle") && types.has("property")) return "unknown";
  if (types.has("vehicle")) return "auto_policy_renewal";
  if (types.has("property")) return "home_policy_renewal";
  return "unknown";
}

function normalizeMandateRule(raw: unknown, fieldPath: string): MandateRule {
  if (!raw || typeof raw !== "object") {
    throw new Error(`mandateSuggestions.${fieldPath} is not an object`);
  }
  const typed = raw as Record<string, unknown>;
  const rule = typed.rule;
  if (rule === "minimum" || rule === "maximum") {
    const minAmount = rule === "minimum" ? 1 : 0;
    if (
      typeof typed.amountCents !== "number" ||
      typed.amountCents < minAmount ||
      !Number.isInteger(typed.amountCents)
    ) {
      throw new Error(
        `mandateSuggestions.${fieldPath}.${rule} requires an integer amountCents >= ${minAmount}`,
      );
    }
    return { rule, amountCents: typed.amountCents } as MandateRule;
  }
  if (rule === "match_current_or_better") {
    if (typeof typed.value !== "string" || typed.value.trim().length === 0) {
      throw new Error(`mandateSuggestions.${fieldPath}.${rule} requires a non-empty value`);
    }
    return { rule, value: typed.value.trim() } as MandateRule;
  }
  if (rule === "required") {
    return { rule: "required" } as MandateRule;
  }
  if (rule === "any") {
    return {
      rule: "any",
      reason: typeof typed.reason === "string" ? typed.reason : undefined,
    } as MandateRule;
  }
  throw new Error(`mandateSuggestions.${fieldPath} has unknown rule ${String(rule)}`);
}

function normalizeCurrentValue(
  raw: unknown,
  fieldPath: string,
  documentIdMap: Map<string, string>,
  allowedDocumentIds: Set<string>,
  pageCountByDocumentId: Map<string, number>,
): ExtractedCurrentValue {
  if (!raw || typeof raw !== "object") {
    throw new Error(`currentCoverage.${fieldPath} is not an object`);
  }
  const typed = raw as Record<string, unknown>;
  const status = String(typed.status);
  if (
    status !== "known" &&
    status !== "unknown" &&
    status !== "not_included" &&
    status !== "not_applicable" &&
    status !== "conflicting"
  ) {
    throw new Error(`currentCoverage.${fieldPath} has invalid status ${status}`);
  }
  if (typeof typed.confidence !== "number" || typed.confidence < 0 || typed.confidence > 1) {
    throw new Error(`currentCoverage.${fieldPath} requires a confidence number between 0 and 1`);
  }

  const value = Object.prototype.hasOwnProperty.call(typed, "value") ? typed.value : null;
  const explanation =
    typeof typed.explanation === "string" && typed.explanation.length > 0
      ? typed.explanation
      : undefined;

  if (status === "known" && value !== null && value !== undefined) {
    if (isMonetaryField(fieldPath) && !isValidMonetaryCents(value)) {
      throw new Error(
        `currentCoverage.${fieldPath} value ${JSON.stringify(value)} is not a valid non-negative integer cent amount`,
      );
    }
    if (typeof value === "string" && ISO_DATE_RE.test(value) && !isValidDate(value)) {
      throw new Error(
        `currentCoverage.${fieldPath} value ${JSON.stringify(value)} is not a valid date`,
      );
    }
  }

  let evidence: ExtractedCurrentValue["evidence"];
  if (Array.isArray(typed.evidence) && typed.evidence.length > 0) {
    evidence = typed.evidence.map((item, index) => {
      try {
        const ref = EvidenceReferenceSchema.parse(item);
        if (ref.documentId && documentIdMap.has(ref.documentId)) {
          const mapped = { ...ref, documentId: documentIdMap.get(ref.documentId)! };
          validateEvidenceReference(mapped, allowedDocumentIds, pageCountByDocumentId);
          return mapped;
        }
        validateEvidenceReference(ref, allowedDocumentIds, pageCountByDocumentId);
        return ref;
      } catch (err) {
        throw new Error(
          `currentCoverage.${fieldPath}.evidence[${index}] is invalid: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
  }

  if ((status === "known" || status === "conflicting") && (!evidence || evidence.length === 0)) {
    throw new Error(`currentCoverage.${fieldPath} status ${status} requires evidence`);
  }

  return evidence
    ? { status, value, confidence: typed.confidence, evidence, explanation }
    : { status, value, confidence: typed.confidence, explanation };
}

async function hashProvisionalKey(input: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(input).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of keys) {
    const value = input[key];
    ordered[key] = value === undefined ? null : value;
  }
  const text = new TextEncoder().encode(JSON.stringify(ordered));
  const digest = await crypto.subtle.digest("SHA-256", text);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `provisional:${hex.slice(0, 32)}`;
}

function isRedactedAddress(input: string | null | undefined): boolean {
  if (!input) return true;
  const normalized = input.toUpperCase().replace(/\s+/g, " ");
  if (normalized.trim().length === 0) return true;
  const markers = ["REDACTED", "WITHHELD", "NOT PROVIDED", "UNKNOWN", "XXXX", "****", "••••"];
  return markers.some((m) => normalized.includes(m));
}

export async function buildCandidateIdentity(
  identity: DetectedEntityIdentity,
  entityType: "property" | "vehicle",
): Promise<CandidateIdentity> {
  if (entityType === "vehicle") {
    const result = buildVehicleIdentity({
      vin: identity.vin ?? undefined,
      modelYear: identity.year ?? undefined,
      make: identity.make ?? undefined,
      model: identity.model ?? undefined,
      trim: identity.trim ?? undefined,
    });

    if (result.exactFingerprint) {
      return {
        exactIdentityFingerprint: result.exactFingerprint,
        provisionalCandidateKey: result.exactFingerprint,
        identityStrength: "exact",
      };
    }

    const key = await hashProvisionalKey({
      entityType,
      vin: result.normalizedVin?.toUpperCase().replace(/\s+/g, "") ?? null,
      year: identity.year,
      make: identity.make?.toLowerCase().trim() ?? null,
      model: identity.model?.toLowerCase().trim() ?? null,
      trim: identity.trim?.toLowerCase().trim() ?? null,
    });

    return {
      exactIdentityFingerprint: null,
      provisionalCandidateKey: key,
      identityStrength:
        identity.vin && !result.normalizedVin
          ? "redacted"
          : identity.year && identity.make && identity.model
            ? "partial"
            : "unknown",
    };
  }

  const redacted = identity.fullAddress ? isRedactedAddress(identity.fullAddress) : true;
  const result = buildPropertyIdentity({
    addressLine1: identity.fullAddress ?? undefined,
    city: identity.city ?? undefined,
    province: identity.province ?? undefined,
    postalCode: identity.postalCode ?? undefined,
    occupancy: (identity.occupancy === "other" ? undefined : identity.occupancy) as
      | PropertyIdentityInput["occupancy"]
      | undefined,
    isRedacted: redacted,
  });

  if (result.exactFingerprint) {
    return {
      exactIdentityFingerprint: result.exactFingerprint,
      provisionalCandidateKey: result.exactFingerprint,
      identityStrength: "exact",
    };
  }

  const keyInput: Record<string, unknown> = {
    entityType,
    city: result.normalizedCity?.toLowerCase() ?? null,
    province: result.normalizedProvince?.toLowerCase() ?? null,
    postalCode: result.normalizedPostalCode?.replace(/\s+/g, "") ?? null,
  };
  // Do not include partial/fullAddress in the provisional key because the model
  // often produces inconsistent partial addresses; city/province/postal are the
  // strongest stable non-exact identity facts.
  const key = await hashProvisionalKey(keyInput);

  const strength: CandidateIdentity["identityStrength"] = redacted
    ? "redacted"
    : identity.city && identity.province
      ? "partial"
      : identity.postalCode
        ? "partial"
        : "unknown";

  return {
    exactIdentityFingerprint: null,
    provisionalCandidateKey: key,
    identityStrength: strength,
  };
}

function isExactFingerprint(fingerprint: string): boolean {
  return (
    (fingerprint.startsWith("vehicle:vin:") && fingerprint.length > "vehicle:vin:".length) ||
    (fingerprint.startsWith("property:") && fingerprint.includes("|"))
  );
}

function resolveCanonicalFingerprint(
  candidateFingerprint: string,
  _entityType: "property" | "vehicle",
  resolution: EntityResolution,
  matchedExisting: ExistingHouseholdAsset | undefined,
  matchedPending: PendingEntityCandidate | undefined,
): string {
  const target = matchedExisting ?? matchedPending;
  if (
    !target ||
    (resolution.status !== "matches_existing" && resolution.status !== "matches_pending_candidate")
  ) {
    return candidateFingerprint;
  }

  const targetExact = isExactFingerprint(target.identityFingerprint);
  const candidateExact = isExactFingerprint(candidateFingerprint);

  if (targetExact && candidateExact && target.identityFingerprint === candidateFingerprint) {
    return target.identityFingerprint;
  }

  // Deterministic safety: only equal normalized VINs or full civic addresses
  // become automatic exact matches. Everything else is downgraded.
  resolution.status = "possible_match_requires_confirmation";
  resolution.confidence = Math.min(resolution.confidence, 0.5);
  resolution.reasoning = `Identity match requires confirmation: ${resolution.reasoning} (the match is not an exact VIN or full-address match).`;
  return candidateFingerprint;
}

function generateOpaqueId(): string {
  const cryptoGlobal = crypto as unknown as { randomUUID?: () => string };
  if (typeof cryptoGlobal.randomUUID === "function") {
    return cryptoGlobal.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export async function normalizeLlmAnalysisResult(
  raw: unknown,
  input: InsuranceDocumentAnalysisInput,
  extractedDocs: ExtractedPdf[],
  provider: { providerId: string; modelId: string },
  attemptCount: number,
  documentAliasMap: Map<string, string>,
): Promise<InsuranceDocumentAnalysisResult> {
  if (!raw || typeof raw !== "object") {
    throw new Error("LLM response is not a JSON object");
  }

  const typed = raw as Record<string, unknown>;
  if (!Array.isArray(typed.detectedEntities)) {
    throw new Error('LLM response missing required "detectedEntities" array');
  }
  const unresolvedConflicts = Array.isArray(typed.unresolvedConflicts)
    ? typed.unresolvedConflicts
    : [];
  const warnings = Array.isArray(typed.warnings) ? typed.warnings : [];

  const documentIdMap = new Map(documentAliasMap);
  for (const doc of input.priorDocumentSummaries) {
    documentIdMap.set(doc.documentId, doc.documentId);
  }

  const existingById = new Map<string, ExistingHouseholdAsset>();
  for (const asset of input.existingAssets) {
    existingById.set(asset.id, asset);
  }
  const pendingById = new Map<string, PendingEntityCandidate>();
  for (const candidate of input.pendingCandidates) {
    pendingById.set(candidate.id, candidate);
  }

  const existingByFingerprint = new Map<string, ExistingHouseholdAsset>();
  for (const asset of input.existingAssets) {
    existingByFingerprint.set(asset.identityFingerprint, asset);
  }
  const pendingByFingerprint = new Map<string, PendingEntityCandidate>();
  for (const candidate of input.pendingCandidates) {
    pendingByFingerprint.set(candidate.identityFingerprint, candidate);
  }

  // Build an opaque id map so the raw LLM temporary ids never leak PII and never repeat.
  const rawEntityIdMap = new Map<string, string>();
  for (let index = 0; index < typed.detectedEntities.length; index++) {
    const entity = typed.detectedEntities[index];
    if (!entity || typeof entity !== "object") {
      throw new Error(`detectedEntities[${index}] is not an object`);
    }
    const e = entity as Record<string, unknown>;
    if (typeof e.temporaryId !== "string" || e.temporaryId.trim().length === 0) {
      throw new Error(`detectedEntities[${index}] is missing a temporaryId`);
    }
    const rawId = e.temporaryId.trim();
    if (rawEntityIdMap.has(rawId)) {
      throw new Error(`detectedEntities[${index}] has duplicate temporaryId ${rawId}`);
    }
    rawEntityIdMap.set(rawId, generateOpaqueId());
  }

  const allowedDocumentIds = new Set(documentIdMap.values());
  const pageCountByDocumentId = new Map<string, number>();
  for (const doc of extractedDocs) {
    pageCountByDocumentId.set(doc.documentId, doc.pageCount);
  }
  for (const summary of input.priorDocumentSummaries) {
    if (summary.fileDigest && !pageCountByDocumentId.has(summary.documentId)) {
      pageCountByDocumentId.set(summary.documentId, 0);
    }
  }

  const enrichedEntities: DetectedInsuranceEntity[] = await Promise.all(
    typed.detectedEntities.map(async (entity: unknown, index: number) => {
      const e = entity as Record<string, unknown>;
      const entityType =
        e.entityType === "property" || e.entityType === "vehicle" ? e.entityType : null;
      if (!entityType) {
        throw new Error(`detectedEntities[${index}] is missing a valid entityType`);
      }

      const rawTemporaryId = e.temporaryId as string;
      const temporaryId = rawEntityIdMap.get(rawTemporaryId) ?? generateOpaqueId();
      const displayLabel =
        typeof e.displayLabel === "string" && e.displayLabel.trim().length > 0
          ? e.displayLabel.trim()
          : temporaryId;

      const identity = DetectedEntityIdentitySchema.parse(e.identity);
      const currentPolicy = CurrentPolicySchema.parse(e.currentPolicy);
      const candidateIdentity = await buildCandidateIdentity(identity, entityType);
      const candidateFingerprint =
        candidateIdentity.exactIdentityFingerprint ?? candidateIdentity.provisionalCandidateKey;

      const matchedExisting = existingByFingerprint.get(candidateFingerprint);
      const matchedPending = pendingByFingerprint.get(candidateFingerprint);
      const initialResolution: EntityResolution = matchedExisting
        ? {
            status: "matches_existing",
            matchedExistingEntityId: matchedExisting.id,
            confidence: 0.99,
            reasoning: "Exact identity fingerprint matches an existing household asset.",
          }
        : matchedPending
          ? {
              status: "matches_pending_candidate",
              matchedPendingCandidateId: matchedPending.id,
              confidence: 0.99,
              reasoning: "Exact identity fingerprint matches a pending candidate.",
            }
          : {
              status: candidateIdentity.exactIdentityFingerprint
                ? "new"
                : "possible_match_requires_confirmation",
              confidence: candidateIdentity.exactIdentityFingerprint ? 0.95 : 0.5,
              reasoning: candidateIdentity.exactIdentityFingerprint
                ? "No existing or pending asset matches the normalized identity fingerprint."
                : "Identity is partial or redacted and requires customer confirmation before it can be matched.",
            };

      const resolution = EntityResolutionSchema.parse(initialResolution);

      const canonicalFingerprint = resolveCanonicalFingerprint(
        candidateFingerprint,
        entityType,
        resolution,
        matchedExisting,
        matchedPending,
      );

      const rawCoverage = (e.currentCoverage as Record<string, unknown>) ?? {};
      const currentCoverage: Record<string, ExtractedCurrentValue> = {};
      for (const [fieldPath, rawValue] of Object.entries(rawCoverage)) {
        currentCoverage[fieldPath] = normalizeCurrentValue(
          rawValue,
          fieldPath,
          documentIdMap,
          allowedDocumentIds,
          pageCountByDocumentId,
        );
      }

      const rawMandates = (e.mandateSuggestions as Record<string, unknown>) ?? {};
      const mandateSuggestions: Record<string, MandateRule> = {};
      for (const [fieldPath, rawValue] of Object.entries(rawMandates)) {
        mandateSuggestions[fieldPath] = normalizeMandateRule(rawValue, fieldPath);
      }

      const evidence: EvidenceReference[] = Array.isArray(e.evidence)
        ? e.evidence
            .map((item, idx) => {
              try {
                const ref = EvidenceReferenceSchema.parse(item);
                const mappedId = ref.documentId ? documentIdMap.get(ref.documentId) : undefined;
                const mapped = mappedId ? { ...ref, documentId: mappedId } : ref;
                validateEvidenceReference(mapped, allowedDocumentIds, pageCountByDocumentId);
                return mapped;
              } catch (err) {
                throw new Error(
                  `detectedEntities[${index}].evidence[${idx}] is invalid: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            })
            .filter(
              (ref): ref is EvidenceReference =>
                typeof ref.evidenceSummary === "string" && ref.evidenceSummary.length > 0,
            )
        : [];

      validateCurrentPolicy(currentPolicy);

      const requiredConfirmations = Array.isArray(e.requiredConfirmations)
        ? e.requiredConfirmations.filter((x): x is string => typeof x === "string" && x.length > 0)
        : [];

      if (candidateIdentity.identityStrength === "redacted") {
        requiredConfirmations.push(
          "Confirm the insured civic address or VIN because the extracted identity is redacted.",
        );
      } else if (candidateIdentity.identityStrength === "partial") {
        requiredConfirmations.push(
          "Confirm the insured address or VIN because the extracted identity is partial.",
        );
      }

      if (resolution.status === "possible_match_requires_confirmation") {
        requiredConfirmations.push(resolution.reasoning);
      }

      return {
        temporaryId,
        canonicalFingerprint,
        candidateIdentity,
        entityType,
        displayLabel,
        identity,
        resolution,
        currentPolicy,
        currentCoverage,
        mandateSuggestions,
        evidence,
        requiredConfirmations,
      };
    }),
  );

  const normalizedConflicts: DetectedConflict[] = unresolvedConflicts.map((conflict, index) => {
    try {
      const parsed = DetectedConflictSchema.parse(conflict);
      const mappedId = rawEntityIdMap.get(parsed.entityRef);
      if (mappedId) {
        return { ...parsed, entityRef: mappedId };
      }
      return parsed;
    } catch (err) {
      throw new Error(
        `unresolvedConflicts[${index}] is invalid: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  const normalizedWarnings: AnalysisWarning[] = warnings.map((warning, index) => {
    try {
      return AnalysisWarningSchema.parse(warning);
    } catch (err) {
      throw new Error(
        `warnings[${index}] is invalid: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  const documents: AnalyzedDocument[] = extractedDocs.map((doc) => ({
    documentId: doc.documentId,
    fileDigest: doc.fileDigest,
    classification: documentClassification(doc.documentId, enrichedEntities),
    parserId: GENERIC_PARSER_ID,
    parserVersion: GENERIC_PARSER_VERSION,
    pageCount: doc.pageCount,
    extractedEntityCount: countEntitiesForDocument(doc.documentId, enrichedEntities),
  }));

  return {
    analysisVersion: "1",
    modelProvider: provider.providerId,
    modelId: provider.modelId,
    documents,
    detectedEntities: enrichedEntities,
    unresolvedConflicts: normalizedConflicts,
    warnings: normalizedWarnings,
    rawResponse: raw,
    attemptCount,
    promptVersion: "1.0.0",
    outputSchemaVersion: "1.0.0",
  };
}

export function createLlmFirstAnalyzer(options?: {
  provider?: InsuranceLlmProvider;
  loader?: DocumentLoader;
  fallbackToDeterministic?: boolean;
}): InsuranceDocumentAnalyzer {
  return new LlmFirstDocumentAnalyzer(options);
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

class NativeDocumentAnalyzer implements InsuranceDocumentAnalyzer {
  private provider: NativeDocumentAnalysisProvider;
  private bytesLoader: FileBytesLoader;
  private requireNativeInput: boolean;
  private authorization?: DocumentProcessingAuthorization;
  private fileLifecycleStore?: ExternalFileLifecycleStore;
  private lifecycleRecords = new Map<string, string>();

  constructor(options: {
    provider: NativeDocumentAnalysisProvider;
    bytesLoader: FileBytesLoader;
    requireNativeInput?: boolean;
    authorization?: DocumentProcessingAuthorization;
    fileLifecycleStore?: ExternalFileLifecycleStore;
  }) {
    this.provider = options.provider;
    this.bytesLoader = options.bytesLoader;
    this.requireNativeInput = options.requireNativeInput ?? true;
    this.authorization = options.authorization;
    this.fileLifecycleStore = options.fileLifecycleStore;
  }

  async analyze(input: InsuranceDocumentAnalysisInput): Promise<InsuranceDocumentAnalysisResult> {
    InsuranceDocumentAnalysisInputSchema.parse(input);

    if (!this.authorization || this.authorization.authorizationResult !== "authorized") {
      throw new Error("Document processing not authorized: consent required or withdrawn");
    }

    const originalInputs: OriginalFileInput[] = [];
    const fileDigestByDocumentId = new Map<string, string>();

    for (const uploaded of input.uploadedDocuments) {
      const original = await this.bytesLoader.load(uploaded);
      const digest = await sha256HexBytes(original.bytes);
      originalInputs.push(original);
      fileDigestByDocumentId.set(original.documentId, digest);
    }

    const resolved = await this.provider.resolveModel();

    let normalizedResult: InsuranceDocumentAnalysisResult | undefined;
    const allHandles: ProviderFileHandle[] = [];

    try {
      const capabilities = await Promise.all(
        originalInputs.map((o) => this.provider.resolveInputMode(o)),
      );
      for (let i = 0; i < originalInputs.length; i++) {
        const original = originalInputs[i];
        const capability = capabilities[i];
        if (
          !capability.supported ||
          capability.mode === "unsupported" ||
          (this.requireNativeInput && capability.mode === "provider_extracted_text")
        ) {
          throw new Error(
            `Unsupported file type for native document analysis: ${original.filename} (${capability.reason})`,
          );
        }
      }

      const settled = await Promise.allSettled(
        originalInputs.map((original) => this.uploadAndRecord(original)),
      );

      const uploadResults: ProviderUploadResult[] = [];
      const readyHandles: ProviderFileHandle[] = [];
      const uploadFailures: string[] = [];
      for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        if (result.status === "rejected") {
          uploadFailures.push(String(result.reason));
          continue;
        }
        const uploadResult = result.value;
        uploadResults[i] = uploadResult;
        if (uploadResult.handle) {
          allHandles.push(uploadResult.handle);
        }
        if (uploadResult.status !== "ready" || !uploadResult.handle) {
          uploadFailures.push(uploadResult.errorCategory ?? "upload_failed");
          continue;
        }
        if (this.requireNativeInput && uploadResult.handle.mode === "provider_extracted_text") {
          uploadFailures.push(
            `Unsupported file type for native document analysis: ${uploadResult.handle.filename} was converted to extracted text`,
          );
          continue;
        }
        readyHandles.push(uploadResult.handle);
      }

      if (uploadFailures.length > 0) {
        throw new Error(`Document upload failed: ${uploadFailures.join("; ")}`);
      }

      const syntheticExtractedDocs: ExtractedPdf[] = originalInputs.map((original, i) => ({
        documentId: original.documentId,
        fileDigest: fileDigestByDocumentId.get(original.documentId) ?? "unknown",
        pageCount:
          uploadResults[i]?.handle?.mode === "native_image_reference"
            ? 1
            : uploadResults[i]?.handle?.mode === "native_video_reference"
              ? 0
              : 0,
        pages: [],
      }));

      const documentAliasMap = new Map<string, string>();
      for (const doc of input.uploadedDocuments) {
        documentAliasMap.set(doc.documentId, doc.documentId);
      }
      for (const summary of input.priorDocumentSummaries) {
        documentAliasMap.set(summary.documentId, summary.documentId);
      }

      const candidateContexts: CandidateComparisonContext[] = [
        ...input.existingAssets.map(buildCandidateContext),
        ...input.pendingCandidates.map(buildCandidateContext),
      ];

      const baseUserPrompt = buildNativeAnalysisUserPrompt({
        jurisdiction: input.jurisdiction,
        documentIds: input.uploadedDocuments.map((d) => d.documentId),
        candidateContexts,
      });

      let validationFeedback = "";
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const userPrompt = validationFeedback
          ? `${baseUserPrompt}\n\nYour previous response failed validation. Correct these errors and respond only with the corrected JSON object. Errors:\n${validationFeedback}`
          : baseUserPrompt;

        const rawResult = await this.provider.analyze({
          model: resolved.modelId,
          systemPrompt: buildInsuranceAnalysisSystemPrompt(),
          userPrompt,
          files: readyHandles,
          responseFormat: { type: "json_object" },
        });

        try {
          normalizedResult = await normalizeLlmAnalysisResult(
            rawResult,
            input,
            syntheticExtractedDocs,
            { providerId: this.provider.providerId, modelId: resolved.modelId },
            attempt,
            documentAliasMap,
          );
          break;
        } catch (err) {
          lastError = err;
          validationFeedback =
            err instanceof Error ? err.message.slice(0, 2000) : String(err).slice(0, 2000);
          if (attempt === 2) break;
        }
      }

      if (!normalizedResult) {
        throw lastError ?? new Error("Document analysis failed after validation repair attempt");
      }
    } catch (err) {
      await this.deleteAll(allHandles);
      throw err;
    }

    const deletionResults = await this.deleteAll(allHandles);

    normalizedResult.modelProvider = GENERIC_PARSER_ID;
    normalizedResult.modelId = GENERIC_PARSER_VERSION;
    normalizedResult.providerMetadata = {
      providerId: this.provider.providerId,
      modelId: resolved.modelId,
      providerFiles: allHandles.map((h) => ({
        documentId: h.documentId,
        mode: h.mode,
        bytes: h.bytes,
      })),
      deletionResults,
    };
    return normalizedResult;
  }

  private async uploadAndRecord(original: OriginalFileInput): Promise<ProviderUploadResult> {
    if (this.fileLifecycleStore && this.authorization) {
      const record = await this.fileLifecycleStore.recordUpload({
        authorizationId: this.authorization.id,
        policyDocumentId: original.documentId,
        providerFileId: "pending",
        uploadStatus: "started",
      });
      this.lifecycleRecords.set(original.documentId, record.id);
    }

    let createdHandle: ProviderFileHandle | undefined;
    const recordHandle = (handle: ProviderFileHandle) => {
      createdHandle = handle;
      if (this.fileLifecycleStore && this.authorization) {
        const recordId = this.lifecycleRecords.get(original.documentId);
        if (recordId) {
          this.fileLifecycleStore
            .markUploadCompleted(recordId, {
              providerFileId: handle.providerFileId,
              uploadStatus: "completed",
            })
            .catch(() => {});
        }
      }
    };

    try {
      const result = await this.provider.uploadOriginalFile(original, {
        onHandleCreated: recordHandle,
      });

      if (this.fileLifecycleStore && this.authorization) {
        const recordId = this.lifecycleRecords.get(original.documentId);
        if (recordId) {
          const patch: Partial<ExternalFileRecord> = result.handle
            ? {
                providerFileId: result.handle.providerFileId,
                uploadStatus: "completed",
                processingStatus: result.status === "ready" ? "ready" : result.status,
              }
            : { uploadStatus: result.status === "rejected" ? "rejected" : "failed" };
          await this.fileLifecycleStore.markUploadCompleted(recordId, patch);
        }
      }

      return result;
    } catch (err) {
      if (this.fileLifecycleStore && this.authorization) {
        const recordId = this.lifecycleRecords.get(original.documentId);
        if (recordId) {
          const patch: Partial<ExternalFileRecord> = createdHandle
            ? {
                providerFileId: createdHandle.providerFileId,
                uploadStatus: "completed",
                processingStatus: "failed",
              }
            : { uploadStatus: "failed" };
          await this.fileLifecycleStore.markUploadCompleted(recordId, patch);
        }
      }
      if (createdHandle) {
        return {
          status: "failed",
          handle: createdHandle,
          errorCategory: err instanceof Error ? err.message : "upload_failed",
        };
      }
      throw err;
    }
  }

  private async deleteAll(handles: ProviderFileHandle[]): Promise<ProviderFileDeletionResult[]> {
    const results: ProviderFileDeletionResult[] = [];
    for (const handle of handles) {
      const result = await this.provider.deleteFile(handle);
      results.push(result);
      if (this.fileLifecycleStore && this.authorization) {
        const recordId = this.lifecycleRecords.get(handle.documentId);
        if (recordId) {
          await this.fileLifecycleStore.recordDeletionAttempt(recordId, result);
          if (!result.deleted) {
            const nextAttemptAt = new Date();
            nextAttemptAt.setMinutes(nextAttemptAt.getMinutes() + 5 * result.attempts);
            await this.fileLifecycleStore.queueCleanup(
              recordId,
              result.failureCategory ?? "deletion_failed",
              nextAttemptAt.toISOString(),
            );
          }
        }
      }
    }
    return results;
  }
}

function buildNativeAnalysisUserPrompt(args: {
  jurisdiction: string;
  documentIds: string[];
  candidateContexts: CandidateComparisonContext[];
}): string {
  const lines = [
    `Jurisdiction: ${args.jurisdiction}`,
    "",
    "Analyze the uploaded insurance documents and produce a single JSON object matching the schema in the system prompt.",
    "",
    `Use ONLY these document IDs for evidence: ${args.documentIds.join(", ")}`,
  ];

  if (args.candidateContexts.length > 0) {
    lines.push(
      "",
      "Existing and pending household candidates for comparison (use the exact 'id' values for resolution.matchedExistingEntityId or resolution.matchedPendingCandidateId, and compare exactIdentityFingerprint/provisionalCandidateKey values before claiming a match):",
      JSON.stringify(args.candidateContexts, null, 2),
    );
  }

  lines.push(
    "",
    "The documents are provided as native inputs. Do not invent values not supported by the documents.",
  );

  return lines.join("\n");
}

export function createNativeDocumentAnalyzer(options: {
  provider: NativeDocumentAnalysisProvider;
  bytesLoader: FileBytesLoader;
  requireNativeInput?: boolean;
  authorization?: DocumentProcessingAuthorization;
  fileLifecycleStore?: ExternalFileLifecycleStore;
}): InsuranceDocumentAnalyzer {
  return new NativeDocumentAnalyzer(options);
}

/** @deprecated Use createNativeDocumentAnalyzer instead. */
export const createKimiK3Analyzer = createNativeDocumentAnalyzer;
