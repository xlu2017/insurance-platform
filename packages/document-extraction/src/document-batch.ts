export function partitionDocumentDigests(
  documentIds: string[],
  digestByDocumentId: Record<string, string>,
  previouslyProcessedDigests: ReadonlySet<string>,
): { duplicateDocumentIds: string[]; newDocumentIds: string[] } {
  const duplicateDocumentIds: string[] = [];
  const newDocumentIds: string[] = [];
  for (const documentId of documentIds) {
    const digest = digestByDocumentId[documentId];
    if (!digest) throw new Error(`Missing digest for document ${documentId}`);
    if (previouslyProcessedDigests.has(digest)) duplicateDocumentIds.push(documentId);
    else newDocumentIds.push(documentId);
  }
  return { duplicateDocumentIds, newDocumentIds };
}
