import type {
  AnalyzedDocument,
  DetectedConflict,
  DetectedInsuranceEntity,
  EvidenceReference,
  InsuranceDocumentAnalysisResult,
} from "./document-analyzer.ts";
import type { DocumentNormalization, NormalizationReuseItem } from "./normalization-reuse.ts";

export const DEFAULT_NORMALIZATION_SCHEMA_VERSION = "1.0.0";
export const DEFAULT_ANALYZER_VERSION = "default-v1";

export interface NormalizationPersistencePayload {
  policyDocumentId: string;
  batchItemId: string;
  contentSha256: string;
  classification: string;
  modelProvider: string;
  modelId: string;
  promptVersion: string;
  normalizationSchemaVersion: string;
  analyzerVersion: string;
  normalizedOutputJson: Record<string, unknown>;
  normalizedEntitiesJson: DetectedInsuranceEntity[];
  conflictsJson: DetectedConflict[];
  evidenceJson: EvidenceReference[];
}

function documentEvidenceForEntity(
  entity: DetectedInsuranceEntity,
  policyDocumentId: string,
): EvidenceReference[] {
  const out: EvidenceReference[] = [];

  for (const ref of entity.evidence ?? []) {
    if (ref.documentId === policyDocumentId) {
      out.push(ref);
    }
  }

  for (const coverage of Object.values(entity.currentCoverage ?? {})) {
    if (!coverage || typeof coverage !== "object") continue;
    const coverageRecord = coverage as Record<string, unknown>;
    const evidence = coverageRecord.evidence;
    if (Array.isArray(evidence)) {
      for (const ref of evidence) {
        if (ref && (ref as EvidenceReference).documentId === policyDocumentId) {
          out.push(ref as EvidenceReference);
        }
      }
    }
  }

  return out;
}

function perDocumentEntities(
  analysis: InsuranceDocumentAnalysisResult,
  policyDocumentId: string,
): DetectedInsuranceEntity[] {
  return analysis.detectedEntities.filter((entity) =>
    entity.evidence.some((ref) => ref.documentId === policyDocumentId),
  );
}

function perDocumentConflicts(
  analysis: InsuranceDocumentAnalysisResult,
  entityTemporaryIds: Set<string>,
): DetectedConflict[] {
  return analysis.unresolvedConflicts.filter((conflict) =>
    entityTemporaryIds.has(conflict.entityRef),
  );
}

export function buildNormalizationPersistencePayload(
  analysis: InsuranceDocumentAnalysisResult,
  item: NormalizationReuseItem,
  options: {
    modelProvider: string;
    modelId: string;
    promptVersion: string;
    schemaVersion?: string;
    analyzerVersion?: string;
  },
): NormalizationPersistencePayload {
  const analyzedDoc = analysis.documents.find((d) => d.documentId === item.policyDocumentId);
  const classification = analyzedDoc?.classification ?? "unknown";

  const entities = perDocumentEntities(analysis, item.policyDocumentId);
  const entityTemporaryIds = new Set(entities.map((e) => e.temporaryId));
  const conflicts = perDocumentConflicts(analysis, entityTemporaryIds);

  const evidence: EvidenceReference[] = [];
  for (const entity of entities) {
    for (const ref of documentEvidenceForEntity(entity, item.policyDocumentId)) {
      evidence.push(ref);
    }
  }

  const firstPolicy = entities[0]?.currentPolicy;
  const identifiedAssets = entities
    .map((e) => e.displayLabel)
    .filter((label): label is string => typeof label === "string" && label.length > 0);

  const normalizedOutputJson: Record<string, unknown> = {
    documentId: item.policyDocumentId,
    fileDigest: item.contentSha256,
    classification,
    pageCount: analyzedDoc?.pageCount ?? 0,
    parserId: analyzedDoc?.parserId ?? options.modelProvider,
    parserVersion:
      analyzedDoc?.parserVersion ?? options.analyzerVersion ?? DEFAULT_ANALYZER_VERSION,
    policy: {
      insurer: firstPolicy?.insurer ?? null,
      policyNumber: firstPolicy?.policyNumber ?? null,
      effectiveDate: firstPolicy?.effectiveDate ?? null,
      expiryDate: firstPolicy?.expiryDate ?? null,
    },
    identifiedAssets,
    processingVersion: `${options.modelProvider}/${options.modelId}/${options.schemaVersion ?? DEFAULT_NORMALIZATION_SCHEMA_VERSION}/${options.promptVersion}`,
  };

  return {
    policyDocumentId: item.policyDocumentId,
    batchItemId: item.batchItemId ?? "",
    contentSha256: item.contentSha256,
    classification,
    modelProvider: options.modelProvider,
    modelId: options.modelId,
    promptVersion: options.promptVersion,
    normalizationSchemaVersion: options.schemaVersion ?? DEFAULT_NORMALIZATION_SCHEMA_VERSION,
    analyzerVersion: options.analyzerVersion ?? DEFAULT_ANALYZER_VERSION,
    normalizedOutputJson,
    normalizedEntitiesJson: entities,
    conflictsJson: conflicts,
    evidenceJson: evidence,
  };
}

export interface ProjectedAnalysis extends InsuranceDocumentAnalysisResult {
  documents: AnalyzedDocument[];
}

export function projectNormalizationForCandidateDerivation(
  normalizations: (DocumentNormalization & { policyDocumentId?: string })[],
  options: { idPrefix?: string; keepDocumentIds?: boolean } = {},
): ProjectedAnalysis {
  const prefix = options.idPrefix ?? "n";
  let counter = 0;
  const temporaryIdMap = new Map<string, string>();

  function nextTemporaryId(oldId: string): string {
    if (!temporaryIdMap.has(oldId)) {
      temporaryIdMap.set(oldId, `${prefix}:${counter++}:${oldId}`);
    }
    return temporaryIdMap.get(oldId)!;
  }

  const documents: AnalyzedDocument[] = [];
  const detectedEntities: DetectedInsuranceEntity[] = [];
  const unresolvedConflicts: DetectedConflict[] = [];

  for (const n of normalizations) {
    const policyDocumentId = n.policy_document_id;

    const doc: AnalyzedDocument = {
      documentId: policyDocumentId,
      fileDigest: n.content_sha256,
      classification: n.classification,
      parserId:
        typeof n.normalized_output_json.parserId === "string"
          ? n.normalized_output_json.parserId
          : (n.model_provider ?? "unknown"),
      parserVersion:
        typeof n.normalized_output_json.parserVersion === "string"
          ? n.normalized_output_json.parserVersion
          : (n.analyzer_version ?? "unknown"),
      pageCount:
        typeof n.normalized_output_json.pageCount === "number"
          ? n.normalized_output_json.pageCount
          : 0,
      extractedEntityCount: Array.isArray(n.normalized_entities_json)
        ? n.normalized_entities_json.length
        : 0,
    };
    documents.push(doc);

    const entities = (
      Array.isArray(n.normalized_entities_json) ? n.normalized_entities_json : []
    ) as DetectedInsuranceEntity[];
    for (const entity of entities) {
      const newId = nextTemporaryId(entity.temporaryId);
      const newEntity: DetectedInsuranceEntity = {
        ...entity,
        temporaryId: newId,
        evidence: entity.evidence.map((ref) => ({ ...ref, documentId: policyDocumentId })),
      };
      detectedEntities.push(newEntity);
    }

    const conflicts = (
      Array.isArray(n.conflicts_json) ? n.conflicts_json : []
    ) as DetectedConflict[];
    for (const conflict of conflicts) {
      const newEntityRef = temporaryIdMap.get(conflict.entityRef) ?? conflict.entityRef;
      unresolvedConflicts.push({ ...conflict, entityRef: newEntityRef });
    }
  }

  return {
    analysisVersion: "1",
    modelProvider: "normalization_projection",
    modelId: "normalization_projection",
    documents,
    detectedEntities,
    unresolvedConflicts,
    warnings: [],
    promptVersion: "1.0.0",
    outputSchemaVersion: "1.0.0",
    attemptCount: 1,
    providerMetadata: {},
  };
}

export function combineAnalysisWithProjectedNormalizations(
  providerAnalysis: InsuranceDocumentAnalysisResult,
  projectedNormalizations: ProjectedAnalysis,
): ProjectedAnalysis {
  const merged: ProjectedAnalysis = {
    analysisVersion: providerAnalysis.analysisVersion,
    modelProvider: providerAnalysis.modelProvider,
    modelId: providerAnalysis.modelId,
    documents: [...projectedNormalizations.documents],
    detectedEntities: [...projectedNormalizations.detectedEntities],
    unresolvedConflicts: [...projectedNormalizations.unresolvedConflicts],
    warnings: [...(providerAnalysis.warnings ?? []), ...(projectedNormalizations.warnings ?? [])],
    promptVersion: providerAnalysis.promptVersion ?? "1.0.0",
    outputSchemaVersion: providerAnalysis.outputSchemaVersion ?? "1.0.0",
    attemptCount: providerAnalysis.attemptCount ?? 1,
    providerMetadata: providerAnalysis.providerMetadata ?? {},
  };

  for (const doc of providerAnalysis.documents) {
    if (!merged.documents.some((d) => d.documentId === doc.documentId)) {
      merged.documents.push(doc);
    }
  }
  for (const entity of providerAnalysis.detectedEntities) {
    if (!merged.detectedEntities.some((e) => e.temporaryId === entity.temporaryId)) {
      merged.detectedEntities.push(entity);
    }
  }
  for (const conflict of providerAnalysis.unresolvedConflicts) {
    if (
      !merged.unresolvedConflicts.some(
        (c) => c.fieldPath === conflict.fieldPath && c.entityRef === conflict.entityRef,
      )
    ) {
      merged.unresolvedConflicts.push(conflict);
    }
  }

  return merged;
}
