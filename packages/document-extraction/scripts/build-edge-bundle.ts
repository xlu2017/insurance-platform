import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const packageDir = resolve(dirname(__filename), "..");
const root = resolve(packageDir, "..", "..");
const entry = resolve(packageDir, "scripts", "edge-entry.ts");
const outdir = resolve(root, "supabase", "functions", "_shared");
const outfile = resolve(outdir, "document-extraction.js");

const workerPath = resolve(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.mjs");

async function computeSourceHash(metafile: esbuild.Metafile): Promise<string> {
  const hash = createHash("sha256");
  const inputs = Object.keys(metafile.inputs).sort();
  for (const input of inputs) {
    hash.update(input);
    const contents = await readFile(resolve(packageDir, input));
    hash.update(contents);
  }
  return hash.digest("hex");
}

async function buildWorkerDataUrl(): Promise<string> {
  const bytes = await readFile(workerPath);
  const b64 = Buffer.from(bytes).toString("base64");
  return `data:application/javascript;base64,${b64}`;
}

const workerDataUrl = await buildWorkerDataUrl();

const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile,
  metafile: true,
  minify: false,
  sourcemap: false,
  define: {
    __PDF_WORKER_DATA_URL__: JSON.stringify(workerDataUrl),
  },
  banner: {
    js: "// This file is generated from packages/document-extraction. Do not edit manually.\n",
  },
  footer: {
    js: "// document-extraction-edge-bundle end\n",
  },
});

const hash = await computeSourceHash(result.metafile);
const banner = `// This file is generated from packages/document-extraction. Do not edit manually.\n// source-hash: ${hash}\n`;
const generated = await readFile(outfile, "utf8");
const sourceHashExport = `\nexport const __DOCUMENT_EXTRACTION_SOURCE_HASH__ = "${hash}";\n`;
await writeFile(
  outfile,
  banner + generated.replace(/^\/\/ This file is generated.*?\n/, "") + sourceHashExport,
);

process.stdout.write(
  `Edge bundle written to ${outfile} (${Object.keys(result.metafile.inputs).length} inputs, hash ${hash})\n`,
);
