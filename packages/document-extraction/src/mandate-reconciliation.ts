export type DocumentValueState = "known" | "absent" | "unknown" | "not_applicable" | "conflicting";

export interface CandidateForMandateReview {
  id: string;
  asset_type: "vehicle" | "property";
  selected_facts_json: Record<string, unknown>;
  conflicts_json?: unknown[];
}

export interface MandateReviewSeed {
  candidateId: string;
  fieldPath: string;
  specificationTitle: string;
  mandatePath: string;
  valueState: Exclude<DocumentValueState, "unknown">;
  originalExtractedValue: unknown;
  documentImpliedValue: unknown;
  documentImpliedMandateValue: unknown;
  sourceDocumentId?: string;
  sourcePageNumber?: number;
  sourceSection?: string;
  confidence?: number;
  conflictValues: unknown[];
  materialConflict: boolean;
}

type MandateFieldKind = "limit" | "deductible" | "preference" | "coverage_form";

interface MandateFieldDefinition {
  assetType: "vehicle" | "property";
  title: string;
  mandatePath: string;
  kind: MandateFieldKind;
  coverageFormValue?: string;
}

// These paths bridge the provider-neutral extraction contract to fields already
// represented by HouseholdCoverageMandateV2. Facts with no canonical V2 field
// remain policy facts and are not silently turned into mandates.
export const MANDATE_FIELD_DEFINITIONS: Record<string, MandateFieldDefinition> = {
  "vehicle.thirdPartyLiabilityLimitCents": {
    assetType: "vehicle",
    title: "Liability limit",
    mandatePath: "liability",
    kind: "limit",
  },
  "vehicle.collisionDeductibleCents": {
    assetType: "vehicle",
    title: "Collision deductible",
    mandatePath: "collisionDeductible",
    kind: "deductible",
  },
  "vehicle.comprehensiveDeductibleCents": {
    assetType: "vehicle",
    title: "Comprehensive deductible",
    mandatePath: "comprehensiveDeductible",
    kind: "deductible",
  },
  "vehicle.glassDeductibleCents": {
    assetType: "vehicle",
    title: "Glass deductible",
    mandatePath: "glassDeductible",
    kind: "deductible",
  },
  "vehicle.collisionIncluded": {
    assetType: "vehicle",
    title: "Auto coverage form",
    mandatePath: "coverageForm",
    kind: "coverage_form",
    coverageFormValue: "collision",
  },
  "vehicle.comprehensiveIncluded": {
    assetType: "vehicle",
    title: "Auto coverage form",
    mandatePath: "coverageForm",
    kind: "coverage_form",
    coverageFormValue: "comprehensive",
  },
  "vehicle.specifiedPerilsIncluded": {
    assetType: "vehicle",
    title: "Auto coverage form",
    mandatePath: "coverageForm",
    kind: "coverage_form",
    coverageFormValue: "specified_perils",
  },
  "vehicle.allPerilsIncluded": {
    assetType: "vehicle",
    title: "Auto coverage form",
    mandatePath: "coverageForm",
    kind: "coverage_form",
    coverageFormValue: "all_perils",
  },
  "vehicle.familyProtectionIncluded": {
    assetType: "vehicle",
    title: "Family protection",
    mandatePath: "endorsements.family_protection",
    kind: "preference",
  },
  "property.dwellingLimitCents": {
    assetType: "property",
    title: "Dwelling limit",
    mandatePath: "dwellingLimit",
    kind: "limit",
  },
  "property.contentsLimitCents": {
    assetType: "property",
    title: "Contents limit",
    mandatePath: "contentsLimit",
    kind: "limit",
  },
  "property.personalLiabilityLimitCents": {
    assetType: "property",
    title: "Personal liability limit",
    mandatePath: "personalLiabilityLimit",
    kind: "limit",
  },
  "property.fairRentalValueLimitCents": {
    assetType: "property",
    title: "Additional living or fair rental value limit",
    mandatePath: "additionalLivingExpenseLimit",
    kind: "limit",
  },
  "property.baseDeductibleCents": {
    assetType: "property",
    title: "Base deductible",
    mandatePath: "baseDeductible",
    kind: "deductible",
  },
  "property.waterDeductibleCents": {
    assetType: "property",
    title: "Water deductible",
    mandatePath: "waterDeductible",
    kind: "deductible",
  },
  "property.windHailDeductibleCents": {
    assetType: "property",
    title: "Wind and hail deductible",
    mandatePath: "windHailDeductible",
    kind: "deductible",
  },
  "property.earthquakeDeductibleCents": {
    assetType: "property",
    title: "Earthquake deductible",
    mandatePath: "earthquakeDeductible",
    kind: "deductible",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeDocumentValueState(status: unknown): DocumentValueState {
  switch (status) {
    case "known":
      return "known";
    case "not_included":
    case "explicitly_absent":
    case "absent":
      return "absent";
    case "not_applicable":
      return "not_applicable";
    case "conflicting":
      return "conflicting";
    default:
      return "unknown";
  }
}

function deriveMandateValue(
  definition: MandateFieldDefinition,
  state: DocumentValueState,
  documentValue: unknown,
  suggestion: unknown,
): unknown {
  if (state === "conflicting" || state === "unknown") return null;

  if (state === "not_applicable") {
    if (definition.kind === "preference") return "indifferent";
    if (definition.kind === "coverage_form") {
      return { preference: "indifferent", value: definition.coverageFormValue ?? "unknown" };
    }
    return { rule: "any" };
  }

  if (state === "absent") {
    if (definition.kind === "preference") return "prohibited";
    if (definition.kind === "coverage_form") {
      return { preference: "required", value: "liability_only" };
    }
    return { rule: "any" };
  }

  if (isRecord(suggestion) && typeof suggestion.rule === "string") {
    return suggestion;
  }

  if (definition.kind === "limit" && Number.isInteger(documentValue)) {
    return { rule: "minimum", amountCents: documentValue };
  }
  if (definition.kind === "deductible" && Number.isInteger(documentValue)) {
    return { rule: "maximum", amountCents: documentValue };
  }
  if (definition.kind === "preference" && typeof documentValue === "boolean") {
    return documentValue ? "required" : "prohibited";
  }
  if (definition.kind === "coverage_form" && typeof documentValue === "boolean") {
    return documentValue
      ? { preference: "required", value: definition.coverageFormValue ?? "unknown" }
      : { preference: "required", value: "liability_only" };
  }
  if (definition.kind === "coverage_form" && typeof documentValue === "string") {
    return { preference: "required", value: documentValue };
  }
  return null;
}

function seedPriority(seed: MandateReviewSeed): number {
  const statePriority = {
    conflicting: 500,
    known: 400,
    absent: 300,
    not_applicable: 200,
  }[seed.valueState];
  const formValue = isRecord(seed.documentImpliedMandateValue)
    ? seed.documentImpliedMandateValue.value
    : undefined;
  const formPriority =
    typeof formValue === "string"
      ? ({
          liability_only: 1,
          specified_perils: 2,
          collision: 3,
          comprehensive: 4,
          all_perils: 5,
        }[formValue] ?? 0)
      : 0;
  return statePriority + formPriority;
}

function extractConflictValues(
  definition: MandateFieldDefinition,
  currentValue: Record<string, unknown>,
  conflicts: unknown[],
): unknown[] {
  const sharedExplanation = conflicts.find(isRecord)?.explanation;
  if (Array.isArray(currentValue.alternatives)) {
    return currentValue.alternatives.filter(isRecord).map((alternative) => {
      const evidence = Array.isArray(alternative.evidence)
        ? alternative.evidence.find(isRecord)
        : undefined;
      const documentValue = alternative.normalizedValue ?? alternative.value;
      return {
        documentValue,
        mandateValue: deriveMandateValue(definition, "known", documentValue, undefined),
        sourceDocumentId:
          evidence && typeof evidence.documentId === "string" ? evidence.documentId : undefined,
        sourcePageNumber:
          evidence && Number.isInteger(evidence.pageNumber)
            ? (evidence.pageNumber as number)
            : undefined,
        sourceSection:
          evidence && typeof evidence.section === "string" ? evidence.section : undefined,
        explanation:
          typeof alternative.explanation === "string"
            ? alternative.explanation
            : typeof sharedExplanation === "string"
              ? sharedExplanation
              : undefined,
      };
    });
  }
  return conflicts.filter(isRecord).map((conflict) => ({
    explanation: conflict.explanation,
    assertionIds: conflict.assertionIds,
  }));
}

export function buildMandateReviewSeeds(
  candidates: CandidateForMandateReview[],
): MandateReviewSeed[] {
  const seeds = new Map<string, MandateReviewSeed>();

  for (const candidate of candidates) {
    const facts = candidate.selected_facts_json;
    const currentCoverage = isRecord(facts.currentCoverage) ? facts.currentCoverage : {};
    const suggestions = isRecord(facts.mandateSuggestions) ? facts.mandateSuggestions : {};
    const conflicts = Array.isArray(candidate.conflicts_json) ? candidate.conflicts_json : [];

    for (const fieldPath of Object.keys(currentCoverage).sort()) {
      const definition = MANDATE_FIELD_DEFINITIONS[fieldPath];
      if (!definition || definition.assetType !== candidate.asset_type) continue;

      const extracted = currentCoverage[fieldPath];
      if (!isRecord(extracted)) continue;
      const state = normalizeDocumentValueState(extracted.status);
      if (state === "unknown") continue;

      const relevantConflicts = conflicts.filter(
        (conflict) => isRecord(conflict) && conflict.fieldPath === fieldPath,
      );
      const alternatives = extractConflictValues(definition, extracted, relevantConflicts);
      const firstAlternative = alternatives.find(isRecord);
      const evidence = Array.isArray(extracted.evidence)
        ? extracted.evidence.find(isRecord)
        : undefined;
      const documentValue = extracted.value;

      const seed: MandateReviewSeed = {
        candidateId: candidate.id,
        fieldPath: `currentCoverage.${fieldPath}`,
        specificationTitle: definition.title,
        mandatePath: definition.mandatePath,
        valueState: state,
        originalExtractedValue: extracted,
        documentImpliedValue: documentValue,
        documentImpliedMandateValue: deriveMandateValue(
          definition,
          state,
          documentValue,
          suggestions[fieldPath],
        ),
        sourceDocumentId:
          evidence && typeof evidence.documentId === "string"
            ? evidence.documentId
            : firstAlternative && typeof firstAlternative.sourceDocumentId === "string"
              ? firstAlternative.sourceDocumentId
              : undefined,
        sourcePageNumber:
          evidence && Number.isInteger(evidence.pageNumber)
            ? (evidence.pageNumber as number)
            : firstAlternative && Number.isInteger(firstAlternative.sourcePageNumber)
              ? (firstAlternative.sourcePageNumber as number)
              : undefined,
        sourceSection:
          evidence && typeof evidence.section === "string"
            ? evidence.section
            : firstAlternative && typeof firstAlternative.sourceSection === "string"
              ? firstAlternative.sourceSection
              : undefined,
        confidence: typeof extracted.confidence === "number" ? extracted.confidence : undefined,
        conflictValues: alternatives,
        materialConflict:
          state === "conflicting" &&
          relevantConflicts.some(
            (conflict) => isRecord(conflict) && conflict.requiresHumanResolution === true,
          ),
      };
      const specificationKey = `${seed.candidateId}:${seed.mandatePath}`;
      const existing = seeds.get(specificationKey);
      if (!existing || seedPriority(seed) > seedPriority(existing)) {
        seeds.set(specificationKey, seed);
      }
    }
  }

  return Array.from(seeds.values()).sort((left, right) =>
    `${left.candidateId}:${left.mandatePath}`.localeCompare(
      `${right.candidateId}:${right.mandatePath}`,
    ),
  );
}

export interface CompletedMandateReviewValue {
  candidateId: string;
  mandatePath: string | null;
  currentMandateValue: unknown;
  isComplete: boolean;
  materialConflict: boolean;
  action: string;
}

function setNestedValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    const next = cursor[part];
    if (!isRecord(next)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

export function buildCandidateMandateValues(
  reviews: CompletedMandateReviewValue[],
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const review of reviews) {
    if (!review.isComplete) {
      throw new Error("Every document-informed mandate specification must be completed");
    }
    if (review.materialConflict && review.action === "unresolved") {
      throw new Error("Material mandate conflicts must be resolved before approval");
    }
    if (!review.mandatePath || review.currentMandateValue === undefined) continue;
    const candidateValues = result.get(review.candidateId) ?? {};
    setNestedValue(candidateValues, review.mandatePath, review.currentMandateValue);
    result.set(review.candidateId, candidateValues);
  }
  return result;
}
