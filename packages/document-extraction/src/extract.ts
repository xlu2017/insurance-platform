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

function ensureCanvasPolyfills(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = PolyfillDOMMatrix as unknown as typeof globalThis.DOMMatrix;
  }
  const abProto = ArrayBuffer.prototype as unknown as Record<string, unknown>;
  if (typeof abProto.transferToFixedLength !== "function") {
    abProto.transferToFixedLength = function (this: ArrayBuffer) {
      return this.slice(0);
    };
  }
  if (typeof abProto.transfer !== "function") {
    abProto.transfer = function (this: ArrayBuffer) {
      return this.slice(0);
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CanvasModule = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Path2dModule = any;

let nodeCanvasModule: CanvasModule | undefined;
let path2dModule: Path2dModule | undefined;

async function initNodeCanvas(): Promise<{
  canvas: CanvasModule;
  path2d: Path2dModule;
}> {
  if (nodeCanvasModule && path2dModule) {
    return { canvas: nodeCanvasModule, path2d: path2dModule };
  }
  const [canvas, path2d] = await Promise.all([import("canvas"), import("path2d")]);
  nodeCanvasModule = canvas;
  path2dModule = path2d;
  path2d.applyPath2DToCanvasRenderingContext(
    canvas.CanvasRenderingContext2D as unknown as Parameters<
      typeof path2d.applyPath2DToCanvasRenderingContext
    >[0],
  );
  const g = globalThis as unknown as Record<string, unknown>;
  g.Path2D = path2d.Path2D;
  if (typeof g.Image === "undefined") {
    g.Image = canvas.Image;
  }
  return { canvas, path2d };
}

class NodeCanvasFactory {
  private canvas: CanvasModule;

  constructor(canvas: CanvasModule) {
    this.canvas = canvas;
  }

  create(width: number, height: number) {
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }
    const cvs = this.canvas.createCanvas(width, height);
    const ctx = cvs.getContext("2d");
    return { canvas: cvs, context: ctx };
  }

  reset(entry: { canvas: { width: number; height: number } }, width: number, height: number) {
    if (!entry.canvas) throw new Error("Canvas is not specified");
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    entry.canvas.width = width;
    entry.canvas.height = height;
  }

  destroy(entry: { canvas: { width: number; height: number } | null; context: unknown }) {
    if (!entry.canvas) throw new Error("Canvas is not specified");
    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.canvas = null as unknown as { width: number; height: number };
    entry.context = null;
  }
}

export interface ExtractPdfOptions {
  bytes: Uint8Array;
  documentId: string;
  includeImages?: boolean;
  imageScale?: number;
}

export async function extractPdfPages(options: ExtractPdfOptions): Promise<ExtractedPdf> {
  ensureCanvasPolyfills();
  const bytesArray = options.bytes;
  const buffer = await crypto.subtle.digest("SHA-256", bytesArray);
  const fileDigest = Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const includeImages = options.includeImages ?? false;
  const imageScale = options.imageScale ?? 2;
  const isDeno = typeof (globalThis as unknown as { Deno?: unknown }).Deno !== "undefined";

  let CanvasFactory: unknown = undefined;
  let canvasModule: CanvasModule | undefined;
  if (includeImages && !isDeno) {
    const init = await initNodeCanvas();
    canvasModule = init.canvas;
    CanvasFactory = class {
      create(w: number, h: number) {
        return new NodeCanvasFactory(init.canvas).create(w, h);
      }
      reset(entry: { canvas: { width: number; height: number } }, w: number, h: number) {
        return new NodeCanvasFactory(init.canvas).reset(entry, w, h);
      }
      destroy(entry: { canvas: { width: number; height: number } | null; context: unknown }) {
        return new NodeCanvasFactory(init.canvas).destroy(entry);
      }
    };
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (isDeno && typeof __PDF_WORKER_DATA_URL__ !== "undefined") {
    pdfjs.GlobalWorkerOptions.workerSrc = __PDF_WORKER_DATA_URL__;
  }
  const doc = await pdfjs.getDocument({
    data: bytesArray,
    useSystemFonts: true,
    isEvalSupported: false,
    CanvasFactory,
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

    let image: ExtractedPdfPage["image"] | undefined;
    if (includeImages && canvasModule) {
      image = await renderPageToImage(page, imageScale, canvasModule);
    }

    pages.push({
      pageNumber,
      text: parts.join("\n"),
      image,
      items,
    });
    await page.cleanup();
  }

  return {
    documentId: options.documentId,
    fileDigest,
    pageCount: doc.numPages,
    pages,
  };
}

export async function extractPdfText(bytes: Uint8Array, documentId: string): Promise<ExtractedPdf> {
  return extractPdfPages({ bytes, documentId, includeImages: false });
}

async function renderPageToImage(
  page: unknown,
  scale: number,
  canvasModule: CanvasModule,
): Promise<ExtractedPdfPage["image"] | undefined> {
  try {
    const viewport = (
      page as { getViewport: (opts: { scale: number }) => { width: number; height: number } }
    ).getViewport({ scale });
    const canvas = canvasModule.createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");
    await (
      page as {
        render: (opts: { canvasContext: unknown; viewport: unknown }) => {
          promise: Promise<unknown>;
        };
      }
    ).render({
      canvasContext: ctx,
      viewport,
    }).promise;
    const base64 = canvas.toDataURL("image/png").split(",")[1];
    return { mimeType: "image/png", base64 };
  } catch (e) {
    console.error("renderPageToImage error:", e);
    return undefined;
  }
}
