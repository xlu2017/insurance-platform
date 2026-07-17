import { extractPdfText } from "../extract.ts";
import type { DocumentLoader, UploadedDocument } from "../document-analyzer.ts";
import type { ExtractedPdf } from "../types.ts";

export class MemoryDocumentLoader implements DocumentLoader {
  private readonly bytesByReference: Map<string, Uint8Array>;

  constructor(bytesByReference: Record<string, Uint8Array>) {
    this.bytesByReference = new Map(Object.entries(bytesByReference));
  }

  async load(document: UploadedDocument): Promise<ExtractedPdf> {
    const bytes = this.bytesByReference.get(document.fileReference);
    if (!bytes) {
      throw new Error(`Document bytes not found for reference ${document.fileReference}`);
    }
    return extractPdfText(bytes, document.documentId);
  }
}
