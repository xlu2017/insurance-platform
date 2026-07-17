import { readFileSync } from "node:fs";
import { extractPdfPages } from "../extract.ts";
import type { DocumentLoader, UploadedDocument } from "../document-analyzer.ts";
import type { ExtractedPdf } from "../types.ts";

export class FileSystemDocumentLoader implements DocumentLoader {
  private includeImages: boolean;
  private imageScale: number;

  constructor(options: { includeImages?: boolean; imageScale?: number } = {}) {
    this.includeImages = options.includeImages ?? false;
    this.imageScale = options.imageScale ?? 2;
  }

  async load(document: UploadedDocument): Promise<ExtractedPdf> {
    const bytes = new Uint8Array(readFileSync(document.fileReference));
    return extractPdfPages({
      bytes,
      documentId: document.documentId,
      includeImages: this.includeImages,
      imageScale: this.imageScale,
    });
  }
}
