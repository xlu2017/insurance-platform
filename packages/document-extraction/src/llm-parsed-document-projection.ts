import {
  ParsedInsuranceDocument,
  type ExtractedFactAssertion,
  type ParsedAssetAssertion,
} from "./types.ts";
import type {
  LlmAssertion,
  LlmAssetCandidate,
  LlmEvidence,
  LlmExtractionResult,
} from "./llm-contract.ts";
import type { LlmExtractionRun } from "./llm-extraction-runner.ts";

export const LLM_PARSED_DOCUMENT_PROJECTION_VERSION = 1 as const;

export interface ResolvedLlmAssetIdentity {
  /** Empty or null means the identity remains unresolved and requires confirmation. */
  identityFingerprint?: string | null;
  /** Only deterministic application code may return exact_existing_match. */
  matchClassification?: ParsedAssetAssertion["matchClassification"];
}

export interface LlmAssetIdentityResolutionInput {
  documentId: string;
  asset: LlmAssetCandidate;
  identityAssertions: readonly LlmAssertion[];
  allAssetAssertions: readonly LlmAssertion[];
}

export interface ProjectLlmRunOptions {
  resolveAssetIdentity?: (
    input: LlmAssetIdentityResolutionInput,
  ) => ResolvedLlmAssetIdentity | Promise<ResolvedLlmAssetIdentity>;
}

export interface ProjectedLlmParsedDocument {
  document: ParsedInsuranceDocument;
  warnings: readonly string[];
  /** Maps pass-scoped LLM assertion IDs to generated evidence assertion UUIDs. */
  assertionIdsBySourceKey: Readonly<Record<string, readonly string[]>>;
}

interface ResultSource {
  scope: string;
  result: LlmExtractionResult;
}

interface FlatAssertion {
  sourceKey: string;
  sourceLocalId: string;
  entityRef: string;
  factKind: LlmAssertion["factKind"];
  fieldPath: string;
  parsedValue: unknown;
  normalizedValue: unknown;
  confidence: number;
  evidence: LlmEvidence;
  evidenceIndex: number;
  alternativeIndex?: number;
  parserId: string;
  parserVersion: string;
}

const AUTHORITY_MAP: Record<
  LlmEvidence["authority"],
  ExtractedFactAssertion["authority"]
> = {
  coverage_summary: "coverage_summary",
  insurance_certificate: "insurance_certificate",
  active_endorsement: "endorsement",
  invoice: "invoice",
  renewal_overview: "renewal_overview",
  informational_notice: "notice",
  policy_wording: "notice",
  header_footer: "header_footer",
  unknown: "header_footer",
};

function sourceKey(scope: string, localAssertionId: string): string {
  return `${scope}:${localAssertionId}`;
}

function comparableValue(assertion: LlmAssertion): unknown {
  return assertion.normalizedValue !== undefined
    ? assertion.normalizedValue
    : assertion.value;
}

function assertionParserId(result: LlmExtractionResult): string {
  return `llm:${result.model.provider}:${result.model.model}`;
}

function assertionParserVersion(result: LlmExtractionResult): string {
  return [
    `schema-${result.schemaVersion}`,
    `prompt-${result.model.promptVersion}`,
    `projection-${LLM_PARSED_DOCUMENT_PROJECTION_VERSION}`,
    result.model.modelVersion ? `model-${result.model.modelVersion}` : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(":");
}

function flattenResult(source: ResultSource, warnings: string[]): FlatAssertion[] {
  const flattened: FlatAssertion[] = [];
  const parserId = assertionParserId(source.result);
  const parserVersion = assertionParserVersion(source.result);

  for (const assertion of source.result.assertions) {
    const key = sourceKey(source.scope, assertion.id);

    if (assertion.status === "conflicting") {
      for (const [alternativeIndex, alternative] of (assertion.alternatives ?? []).entries()) {
        for (const [evidenceIndex, evidence] of alternative.evidence.entries()) {
          flattened.push({
            sourceKey: key,
            sourceLocalId: assertion.id,
            entityRef: assertion.entityRef,
            factKind: assertion.factKind,
            fieldPath: assertion.fieldPath,
            parsedValue: alternative.value,
            normalizedValue: alternative.normalizedValue ?? alternative.value,
            confidence: assertion.confidence,
            evidence,
            evidenceIndex,
            alternativeIndex,
            parserId,
            parserVersion,
          });
        }
      }
      continue;
    }

    if (assertion.evidence.length === 0) {
      warnings.push(`omitted_assertion_without_evidence:${key}`);
      continue;
    }

    const value = comparableValue(assertion);
    for (const [evidenceIndex, evidence] of assertion.evidence.entries()) {
      flattened.push({
        sourceKey: key,
        sourceLocalId: assertion.id,
        entityRef: assertion.entityRef,
        factKind: assertion.factKind,
        fieldPath: assertion.fieldPath,
        parsedValue: assertion.value ?? null,
        normalizedValue: value ?? null,
        confidence: assertion.confidence,
        evidence,
        evidenceIndex,
        parserId,
        parserVersion,
      });
    }
  }

  return flattened;
}

async function deterministicUuid(seed: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  ).slice(0, 16);

  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;

  const hex = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function entityScopeFor(
  assertion: FlatAssertion,
  assetTypeByLocalId: ReadonlyMap<string, "property" | "vehicle">,
): ExtractedFactAssertion["entityScope"] {
  if (
    assertion.factKind === "policy" ||
    assertion.factKind === "coverage" ||
    assertion.factKind === "premium" ||
    assertion.factKind === "notice"
  ) {
    return assertion.factKind;
  }

  return assetTypeByLocalId.get(assertion.entityRef) ?? "policy";
}

function mapProposedMatch(
  proposed: LlmAssetCandidate["proposedMatchClassification"],
): ParsedAssetAssertion["matchClassification"] {
  switch (proposed) {
    case "new":
      return "new";
    case "possible_existing_match":
    case "exact_existing_match_proposed":
      return "possible_existing_match";
    case "identity_confirmation_required":
      return "new_identity_confirmation_required";
  }
}

function mapOccupancy(
  asset: LlmAssetCandidate,
): ParsedAssetAssertion["occupancy"] {
  if (asset.assetType !== "property") return undefined;
  if (asset.occupancy === "principal_residence" || asset.occupancy === "rental") {
    return asset.occupancy;
  }
  return "unknown";
}

function mapClassification(
  discovery: LlmExtractionResult,
  warnings: string[],
): ParsedInsuranceDocument["classification"] {
  if (discovery.classification === "home_policy") return "home_policy_renewal";
  if (discovery.classification === "auto_policy") return "auto_policy_renewal";

  if (discovery.classification === "combined_policy") {
    const assetTypes = new Set(discovery.assets.map((asset) => asset.assetType));
    if (assetTypes.size === 1 && assetTypes.has("property")) {
      return "home_policy_renewal";
    }
    if (assetTypes.size === 1 && assetTypes.has("vehicle")) {
      return "auto_policy_renewal";
    }
    warnings.push("combined_home_auto_document_projected_as_unsupported");
  }

  return "unsupported";
}

function assertionValueById(
  result: LlmExtractionResult,
  assertionId: string | undefined,
): unknown {
  if (!assertionId) return undefined;
  const assertion = result.assertions.find((candidate) => candidate.id === assertionId);
  return assertion ? comparableValue(assertion) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonNegativeCents(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function findStringAssertion(
  sources: readonly ResultSource[],
  patterns: readonly RegExp[],
): string | undefined {
  for (const source of sources) {
    for (const assertion of source.result.assertions) {
      if (!patterns.some((pattern) => pattern.test(assertion.fieldPath))) continue;
      const value = stringValue(comparableValue(assertion));
      if (value) return value;
    }
  }
  return undefined;
}

function stableValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;

  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
    .join(",")}}`;
}

function collectSources(run: LlmExtractionRun): ResultSource[] {
  return [
    { scope: "discovery", result: run.discovery },
    ...[...run.coverageByAssetLocalId.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([assetLocalId, result]) => ({
        scope: `coverage:${assetLocalId}`,
        result,
      })),
  ];
}

/**
 * Projects a validated provider-neutral LLM run into the parser model already used
 * by document-set and specification-review code.
 *
 * The projection is deliberately conservative:
 * - LLM exact-match proposals are downgraded to possible matches;
 * - unresolved deterministic identity produces an empty fingerprint and mandatory confirmation;
 * - one parser assertion is emitted per cited evidence location;
 * - conflicting alternatives and cross-pass value disagreements become explicit conflicts;
 * - assertions without page evidence are omitted rather than fabricated.
 */
export async function projectLlmRunToParsedDocument(
  run: LlmExtractionRun,
  options: ProjectLlmRunOptions = {},
): Promise<ProjectedLlmParsedDocument> {
  const warnings = [
    ...run.discovery.warnings.map((warning) => `discovery:${warning}`),
    ...[...run.coverageByAssetLocalId.entries()].flatMap(([assetLocalId, result]) =>
      result.warnings.map((warning) => `coverage:${assetLocalId}:${warning}`),
    ),
    ...run.skippedAssetLocalIds.map((assetLocalId) =>
      `coverage_pass_skipped:${assetLocalId}`,
    ),
  ];
  const sources = collectSources(run);

  for (const source of sources) {
    if (source.result.documentId !== run.discovery.documentId) {
      throw new Error(`Projection received a foreign document in ${source.scope}`);
    }
  }

  const assetTypeByLocalId = new Map(
    run.discovery.assets.map((asset) => [asset.localId, asset.assetType] as const),
  );
  const flatAssertions = sources.flatMap((source) => flattenResult(source, warnings));
  const projectedAssertions = await Promise.all(
    flatAssertions.map(async (assertion): Promise<ExtractedFactAssertion> => {
      const idSeed = [
        run.discovery.documentId,
        assertion.sourceKey,
        assertion.fieldPath,
        assertion.alternativeIndex ?? "direct",
        assertion.evidenceIndex,
        assertion.evidence.pageNumber,
        assertion.evidence.evidenceText,
      ].join("|");

      return {
        id: await deterministicUuid(idSeed),
        documentId: run.discovery.documentId,
        pageNumber: assertion.evidence.pageNumber,
        entityScope: entityScopeFor(assertion, assetTypeByLocalId),
        fieldPath: assertion.fieldPath,
        rawText: assertion.evidence.evidenceText,
        parsedValue: assertion.parsedValue,
        normalizedValue: assertion.normalizedValue,
        parserId: assertion.parserId,
        parserVersion: assertion.parserVersion,
        confidence: assertion.confidence,
        authority: AUTHORITY_MAP[assertion.evidence.authority],
      };
    }),
  );

  const assertionIdsBySourceKeyMutable = new Map<string, string[]>();
  flatAssertions.forEach((assertion, index) => {
    const projected = projectedAssertions[index];
    if (!projected) return;
    const ids = assertionIdsBySourceKeyMutable.get(assertion.sourceKey) ?? [];
    ids.push(projected.id);
    assertionIdsBySourceKeyMutable.set(assertion.sourceKey, ids);
  });

  const originalAssertionsByAsset = new Map<string, LlmAssertion[]>();
  for (const source of sources) {
    for (const assertion of source.result.assertions) {
      if (!assetTypeByLocalId.has(assertion.entityRef)) continue;
      const assertions = originalAssertionsByAsset.get(assertion.entityRef) ?? [];
      assertions.push(assertion);
      originalAssertionsByAsset.set(assertion.entityRef, assertions);
    }
  }

  const assets: ParsedAssetAssertion[] = [];
  for (const asset of run.discovery.assets) {
    const allAssetAssertions = originalAssertionsByAsset.get(asset.localId) ?? [];
    const identityAssertions = allAssetAssertions.filter(
      (assertion) => assertion.factKind === "identity",
    );
    const resolved = options.resolveAssetIdentity
      ? await options.resolveAssetIdentity({
          documentId: run.discovery.documentId,
          asset,
          identityAssertions,
          allAssetAssertions,
        })
      : {};
    const fingerprint = resolved.identityFingerprint?.trim() ?? "";

    if (!fingerprint) warnings.push(`identity_unresolved:${asset.localId}`);

    assets.push({
      assetType: asset.assetType,
      identityFingerprint: fingerprint,
      displayLabel: asset.displayLabel,
      matchClassification: fingerprint
        ? (resolved.matchClassification ?? mapProposedMatch(asset.proposedMatchClassification))
        : "new_identity_confirmation_required",
      occupancy: mapOccupancy(asset),
      assertions: flatAssertions
        .map((assertion, index) => ({ assertion, projected: projectedAssertions[index] }))
        .filter(
          (entry): entry is { assertion: FlatAssertion; projected: ExtractedFactAssertion } =>
            entry.projected !== undefined && entry.assertion.entityRef === asset.localId,
        )
        .map((entry) => entry.projected),
    });
  }

  const policyTerms: ParsedInsuranceDocument["policyTerms"] = [];
  const seenPolicyTerms = new Set<string>();
  for (const source of sources) {
    for (const term of source.result.policyTerms) {
      const projectedTerm: ParsedInsuranceDocument["policyTerms"][number] = {
        effectiveDate: stringValue(
          assertionValueById(source.result, term.effectiveDateAssertionId),
        ),
        expiryDate: stringValue(
          assertionValueById(source.result, term.expiryDateAssertionId),
        ),
        policyNumber: stringValue(
          assertionValueById(source.result, term.policyNumberAssertionId),
        ),
        annualPremiumCents: nonNegativeCents(
          assertionValueById(source.result, term.premiumAssertionId),
        ),
      };
      const key = stableValue(projectedTerm);
      if (seenPolicyTerms.has(key)) continue;
      seenPolicyTerms.add(key);
      policyTerms.push(projectedTerm);
    }
  }

  const conflicts: ParsedInsuranceDocument["conflicts"] = [];
  const conflictKeys = new Set<string>();
  const addConflict = (
    fieldPath: string,
    assertionIds: string[],
    reason: string,
  ): void => {
    const uniqueIds = [...new Set(assertionIds)];
    if (uniqueIds.length < 2) return;
    const key = `${fieldPath}|${[...uniqueIds].sort().join("|")}`;
    if (conflictKeys.has(key)) return;
    conflictKeys.add(key);
    conflicts.push({ fieldPath, assertionIds: uniqueIds, reason });
  };

  for (const source of sources) {
    for (const conflict of source.result.conflicts) {
      addConflict(
        conflict.fieldPath,
        conflict.assertionIds.flatMap(
          (assertionId) =>
            assertionIdsBySourceKeyMutable.get(sourceKey(source.scope, assertionId)) ?? [],
        ),
        conflict.explanation,
      );
    }

    for (const assertion of source.result.assertions) {
      if (assertion.status !== "conflicting") continue;
      addConflict(
        assertion.fieldPath,
        assertionIdsBySourceKeyMutable.get(sourceKey(source.scope, assertion.id)) ?? [],
        assertion.explanation ?? "The document contains conflicting evidenced values.",
      );
    }
  }

  const projectedByFieldAndEntity = new Map<
    string,
    Array<{ id: string; value: unknown }>
  >();
  flatAssertions.forEach((assertion, index) => {
    const projected = projectedAssertions[index];
    if (!projected) return;
    const key = `${assertion.entityRef}|${assertion.fieldPath}`;
    const values = projectedByFieldAndEntity.get(key) ?? [];
    values.push({ id: projected.id, value: projected.normalizedValue });
    projectedByFieldAndEntity.set(key, values);
  });

  for (const [key, assertions] of projectedByFieldAndEntity) {
    const distinctValues = new Set(assertions.map((assertion) => stableValue(assertion.value)));
    if (distinctValues.size < 2) continue;
    const fieldPath = key.slice(key.indexOf("|") + 1);
    addConflict(
      fieldPath,
      assertions.map((assertion) => assertion.id),
      "Discovery and asset-coverage passes produced different evidenced values.",
    );
  }

  const insurerName = findStringAssertion(sources, [
    /(?:^|\.)insurer\.name$/i,
    /(?:^|\.)carrierName$/i,
  ]);
  const agencyName = findStringAssertion(sources, [
    /(?:^|\.)agency\.name$/i,
    /(?:^|\.)brokerName$/i,
  ]);

  const parserId = assertionParserId(run.discovery);
  const parserVersion = assertionParserVersion(run.discovery);
  const document = ParsedInsuranceDocument.parse({
    classification: mapClassification(run.discovery, warnings),
    insurer: insurerName ? { name: insurerName } : undefined,
    agency: agencyName ? { name: agencyName } : undefined,
    policyTerms,
    assetAssertions: assets,
    coverageAssertions: flatAssertions
      .map((assertion, index) => ({ assertion, projected: projectedAssertions[index] }))
      .filter(
        (entry): entry is { assertion: FlatAssertion; projected: ExtractedFactAssertion } =>
          entry.projected !== undefined &&
          (entry.assertion.factKind === "coverage" ||
            entry.assertion.factKind === "premium"),
      )
      .map((entry) => entry.projected),
    notices: flatAssertions
      .map((assertion, index) => ({ assertion, projected: projectedAssertions[index] }))
      .filter(
        (entry): entry is { assertion: FlatAssertion; projected: ExtractedFactAssertion } =>
          entry.projected !== undefined && entry.assertion.factKind === "notice",
      )
      .map((entry) => entry.projected),
    conflicts,
    parserId,
    parserVersion,
  });

  return {
    document,
    warnings,
    assertionIdsBySourceKey: Object.fromEntries(
      [...assertionIdsBySourceKeyMutable.entries()].map(([key, ids]) => [
        key,
        Object.freeze([...ids]),
      ]),
    ),
  };
}
