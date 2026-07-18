import { readFile } from "node:fs/promises";
import type { FileBytesLoader, OriginalFileInput } from "../providers/native-document-analysis.ts";

export class FileSystemFileBytesLoader implements FileBytesLoader {
  async load(document: {
    documentId: string;
    filename: string;
    mimeType: string;
    fileReference: string;
  }): Promise<OriginalFileInput> {
    const bytes = await readFile(document.fileReference);
    return {
      documentId: document.documentId,
      filename: document.filename,
      mimeType: document.mimeType,
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    };
  }
}
