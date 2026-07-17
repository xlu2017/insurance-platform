import type { ExtractedPdf, ExtractedPdfPage } from "./types.ts";

declare const __PDF_WORKER_DATA_URL__: string | undefined;

class PolyfillDOMMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;

  constructor(init?: number[] | string | PolyfillDOMMatrix) {
    if (init instanceof PolyfillDOMMatrix) {
      this.a = init.a;
      this.b = init.b;
      this.c = init.c;
      this.d = init.d;
      this.e = init.e;
      this.f = init.f;
    } else if (Array.isArray(init) && init.length === 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = init;
    } else if (typeof init === "string") {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
    } else {
      this.a = 1;
      this.b = 0;
      this.c = 0;
      this.d = 1;
      this.e = 0;
      this.f = 0;
    }
  }

  multiplySelf(other: PolyfillDOMMatrix): PolyfillDOMMatrix {
    const a = this.a * other.a + this.c * other.b;
    const b = this.b * other.a + this.d * other.b;
    const c = this.a * other.c + this.c * other.d;
    const d = this.b * other.c + this.d * other.d;
    const e = this.a * other.e + this.c * other.f + this.e;
    const f = this.b * other.e + this.d * other.f + this.f;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  preMultiplySelf(other: PolyfillDOMMatrix): PolyfillDOMMatrix {
    return this.multiplySelf(other);
  }

  translateSelf(x: number, y: number): PolyfillDOMMatrix {
    return this.multiplySelf(new PolyfillDOMMatrix([1, 0, 0, 1, x, y]));
  }

  scaleSelf(x: number, y?: number): PolyfillDOMMatrix {
    return this.multiplySelf(new PolyfillDOMMatrix([x, 0, 0, y ?? x, 0, 0]));
  }

  invertSelf(): PolyfillDOMMatrix {
    const det = this.a * this.d - this.b * this.c;
    if (det === 0) return this;
    const a = this.d / det;
    const b = -this.b / det;
    const c = -this.c / det;
    const d = this.a / det;
    const e = (this.c * this.f - this.d * this.e) / det;
    const f = (this.b * this.e - this.a * this.f) / det;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  setTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): PolyfillDOMMatrix {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  translate(x: number, y: number): PolyfillDOMMatrix {
    return new PolyfillDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).translateSelf(
      x,
      y,
    );
  }

  scale(x: number, y?: number): PolyfillDOMMatrix {
    return new PolyfillDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).scaleSelf(x, y);
  }
}

class PolyfillPath2D {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  addPath(_path: unknown, _matrix?: unknown): void {
    // no-op; text extraction does not need path rendering
  }
}

function ensureCanvasPolyfills(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = PolyfillDOMMatrix as unknown as typeof globalThis.DOMMatrix;
  }
  if (typeof g.Path2D === "undefined") {
    g.Path2D = PolyfillPath2D as unknown as typeof globalThis.Path2D;
  }
}

export async function extractPdfText(bytes: Uint8Array, documentId: string): Promise<ExtractedPdf> {
  ensureCanvasPolyfills();
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
  const fileDigest = Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (
    typeof (globalThis as unknown as { Deno?: unknown }).Deno !== "undefined" &&
    typeof __PDF_WORKER_DATA_URL__ !== "undefined"
  ) {
    pdfjs.GlobalWorkerOptions.workerSrc = __PDF_WORKER_DATA_URL__;
  }
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

  return {
    documentId,
    fileDigest,
    pageCount: doc.numPages,
    pages,
  };
}
