import { createHash } from "node:crypto";
import type { ExtractedPdf, ExtractedPdfPage } from "./types.ts";

export async function extractPdfText(bytes: Uint8Array, documentId: string): Promise<ExtractedPdf> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    isEvalSupported: false,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;

  const pages: ExtractedPdfPage[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: ExtractedPdfPage["items"] = [];
    const parts: string[] = [];
    for (const item of content.items) {
      if (typeof item === "object" && item !== null && "str" in item) {
        const text = (item as { str: string }).str;
        const transform = (item as { transform?: number[] }).transform;
        items.push({
          text,
          x: transform ? transform[4] : undefined,
          y: transform ? transform[5] : undefined,
        });
        if (text.trim().length > 0) parts.push(text);
      }
    }
    pages.push({
      pageNumber,
      text: parts.join("\n"),
      items,
    });
    await page.cleanup();
  }

  const hash = createHash("sha256");
  hash.update(bytes);
  return {
    documentId,
    fileDigest: hash.digest("hex"),
    pageCount: doc.numPages,
    pages,
  };
}
