import fs from "node:fs";
import path from "node:path";
import { extractPdfText, parseDocument } from "../src/index.ts";

function maskVin(vin?: string): string {
  if (!vin) return "unknown";
  return `${vin.slice(0, 4)}••••${vin.slice(vin.length - 4)}`;
}

function maskPostal(postal?: string): string {
  if (!postal) return "unknown";
  const p = postal.replace(/\s/g, "");
  return `${p.slice(0, 2)}•• ${p.slice(p.length - 2)}`;
}

async function main() {
  const dir = path.resolve(process.cwd(), "fixtures/private/phase-1e");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  const documents: {
    file: string;
    classification: string;
    candidates: { type: string; label: string; classification: string }[];
  }[] = [];
  const allCandidates: {
    type: string;
    fingerprint: string;
    label: string;
    classification: string;
  }[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const bytes = new Uint8Array(fs.readFileSync(filePath));
    const extracted = await extractPdfText(bytes, file);
    const parsed = parseDocument(extracted);

    const candidates = parsed.assetAssertions.map((a) => ({
      type: a.assetType,
      label: a.displayLabel,
      fingerprint: a.identityFingerprint,
      classification: a.matchClassification,
    }));
    documents.push({ file, classification: parsed.classification, candidates });
    for (const c of candidates) {
      if (!allCandidates.some((x) => x.fingerprint === c.fingerprint && x.type === c.type)) {
        allCandidates.push({
          type: c.type,
          fingerprint: c.fingerprint,
          label: c.label,
          classification: c.classification,
        });
      }
    }
  }

  const properties = allCandidates.filter((c) => c.type === "property");
  const vehicles = allCandidates.filter((c) => c.type === "vehicle");
  const identityConfirmationRequired = allCandidates.filter(
    (c) => c.classification === "new_identity_confirmation_required",
  ).length;

  console.log("=== Private policy import report ===");
  for (const d of documents) {
    console.log(`\n${d.file} -> ${d.classification}`);
    for (const c of d.candidates) {
      const safeId = c.type === "vehicle" ? maskVin(c.fingerprint) : maskPostal(c.fingerprint);
      console.log(`  - ${c.type} (${c.classification}): ${c.label} (${safeId})`);
    }
  }

  console.log("\n=== Aggregate ===");
  console.log(`documents processed: ${documents.length}`);
  console.log(`property candidates: ${properties.length}`);
  console.log(`vehicle candidates: ${vehicles.length}`);
  console.log(`identity-confirmation-required: ${identityConfirmationRequired}`);
  console.log(
    `exact duplicate candidates: ${documents.flatMap((d) => d.candidates).length - allCandidates.length}`,
  );

  if (documents.length !== 4) {
    console.error("FAIL: expected 4 documents");
    process.exit(1);
  }
  if (properties.length !== 3) {
    console.error(`FAIL: expected 3 property candidates, got ${properties.length}`);
    process.exit(1);
  }
  if (vehicles.length !== 1) {
    console.error(`FAIL: expected 1 vehicle candidate, got ${vehicles.length}`);
    process.exit(1);
  }
  if (identityConfirmationRequired !== 1) {
    console.error(
      `FAIL: expected exactly 1 identity-confirmation-required, got ${identityConfirmationRequired}`,
    );
    process.exit(1);
  }

  console.log("\nPASS: four documents resolve to three properties and one vehicle");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
