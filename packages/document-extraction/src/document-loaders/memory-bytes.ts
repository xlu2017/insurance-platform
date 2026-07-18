import type { FileBytesLoader, OriginalFileInput } from "../providers/native-document-analysis.ts";

export class MemoryFileBytesLoader implements FileBytesLoader {
  private readonly bytesByReference: Map<string, Uint8Array>;

  constructor(bytesByReference: Record<string, Uint8Array>) {
    this.bytesByReference = new Map(Object.entries(bytesByReference));
  }

  async load(document: {
    documentId: string;
    filename: string;
    mimeType: string;
    fileReference: string;
  }): Promise<OriginalFileInput> {
    const bytes = this.bytesByReference.get(document.fileReference);
    if (!bytes) {
      throw new Error(`Document bytes not found for reference ${document.fileReference}`);
    }
    return {
      documentId: document.documentId,
      filename: document.filename,
      mimeType: document.mimeType,
      bytes,
    };
  }
}
