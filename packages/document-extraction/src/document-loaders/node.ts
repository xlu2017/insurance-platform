import { readFileSync } from "node:fs";
import { extractPdfText } from "../extract.ts";
import type { DocumentLoader, UploadedDocument } from "../document-analyzer.ts";
import type { ExtractedPdf } from "../types.ts";

export class FileSystemDocumentLoader implements DocumentLoader {
  async load(document: UploadedDocument): Promise<ExtractedPdf> {
    const bytes = new Uint8Array(readFileSync(document.fileReference));
    return extractPdfText(bytes, document.documentId);
  }
}
