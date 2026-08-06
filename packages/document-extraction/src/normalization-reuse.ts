export interface DocumentNormalization {
  id: string;
  policy_document_id: string;
  content_sha256: string;
  normalization_schema_version: string;
  analyzer_version: string;
  status: string;
  model_provider: string | null;
  model_id: string | null;
  prompt_version: string | null;
  classification: string;
  normalized_output_json: Record<string, unknown>;
  normalized_entities_json: unknown[];
  conflicts_json: unknown[];
  evidence_json: unknown[];
}

export interface NormalizationReuseItem {
  policyDocumentId: string;
  batchItemId?: string;
  contentSha256: string;
}

export interface ReusableMatch {
  item: NormalizationReuseItem;
  normalization: DocumentNormalization;
}

export interface PartitionedDocuments {
  reusable: ReusableMatch[];
  providerRequired: NormalizationReuseItem[];
}

export function selectCompatibleNormalization(
  item: NormalizationReuseItem,
  normalizations: DocumentNormalization[],
  schemaVersion: string,
  analyzerVersion: string,
): DocumentNormalization | undefined {
  return normalizations.find(
    (n) =>
      n.content_sha256 === item.contentSha256 &&
      n.normalization_schema_version === schemaVersion &&
      n.analyzer_version === analyzerVersion &&
      n.status === "complete",
  );
}

export function partitionDocumentsByNormalization(
  items: NormalizationReuseItem[],
  normalizations: DocumentNormalization[],
  schemaVersion: string,
  analyzerVersion: string,
): PartitionedDocuments {
  const reusable: ReusableMatch[] = [];
  const providerRequired: NormalizationReuseItem[] = [];

  for (const item of items) {
    const match = selectCompatibleNormalization(
      item,
      normalizations,
      schemaVersion,
      analyzerVersion,
    );
    if (match) {
      reusable.push({ item, normalization: match });
    } else {
      providerRequired.push(item);
    }
  }

  return { reusable, providerRequired };
}
