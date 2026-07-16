import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const packageDir = resolve(dirname(__filename), "..");
const root = resolve(packageDir, "..", "..");
const entry = resolve(packageDir, "scripts", "edge-entry.ts");
const outdir = resolve(root, "supabase", "functions", "recommendation-generator", "_shared");
const outfile = resolve(outdir, "autopilot.js");

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
  banner: {
    js: "// This file is generated from packages/insurance-engine. Do not edit manually.\n",
  },
  footer: {
    js: "// autopilot-edge-bundle end\n",
  },
});

const hash = await computeSourceHash(result.metafile);
const banner = `// This file is generated from packages/insurance-engine. Do not edit manually.\n// source-hash: ${hash}\n`;
const generated = await readFile(outfile, "utf8");
await writeFile(outfile, banner + generated.replace(/^\/\/ This file is generated.*?\n/, ""));

process.stdout.write(
  `Edge bundle written to ${outfile} (${Object.keys(result.metafile.inputs).length} inputs, hash ${hash})\n`,
);
