/* eslint-disable no-console */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createLlmFirstAnalyzer,
  HttpLlmProvider,
  type InsuranceDocumentAnalysisInput,
  type InsuranceDocumentAnalysisResult,
  type InsuranceDocumentAnalyzer,
  type UploadedDocument,
} from "../src/index.ts";
import { FileSystemDocumentLoader } from "../src/document-loaders/node.ts";

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
  return `{${pairs.join(",")}}`;
}

function canonicalDigest(result: InsuranceDocumentAnalysisResult): string {
  const digestByDocumentId = new Map<string, string>();
  for (const doc of result.documents) {
    digestByDocumentId.set(doc.documentId, doc.fileDigest);
  }

  const documents = result.documents
    .map((d) => ({
      fileDigest: d.fileDigest,
      classification: d.classification,
      pageCount: d.pageCount,
      extractedEntityCount: d.extractedEntityCount,
    }))
    .sort((a, b) => a.fileDigest.localeCompare(b.fileDigest));

  const entities = result.detectedEntities
    .map((e) => {
      const coverage: Record<string, unknown> = {};
      for (const [fieldPath, current] of Object.entries(e.currentCoverage)) {
        const evidence = current.evidence?.map((ref) => ({
          documentDigest: digestByDocumentId.get(ref.documentId ?? "") ?? ref.documentId,
          pageNumber: ref.pageNumber,
          evidenceSummary: ref.evidenceSummary ? "[REDACTED]" : undefined,
        }));
        coverage[fieldPath] = evidence
          ? {
              status: current.status,
              value: current.value,
              confidence: current.confidence,
              evidence,
            }
          : { status: current.status, value: current.value, confidence: current.confidence };
      }
      return {
        entityType: e.entityType,
        identityFingerprint: e.temporaryId,
        resolution: e.resolution.status,
        currentCoverage: coverage,
        mandateSuggestions: e.mandateSuggestions,
      };
    })
    .sort((a, b) => a.identityFingerprint.localeCompare(b.identityFingerprint));

  const normalized = {
    documents,
    entities,
    conflicts: result.unresolvedConflicts.map((c) => c.fieldPath).sort(),
    warnings: result.warnings.map((w) => w.message).sort(),
  };

  return crypto.createHash("sha256").update(canonicalStringify(normalized)).digest("hex");
}

function sanitizedSummary(result: InsuranceDocumentAnalysisResult): string {
  const properties = result.detectedEntities.filter((e) => e.entityType === "property").length;
  const vehicles = result.detectedEntities.filter((e) => e.entityType === "vehicle").length;
  const confirmation = result.detectedEntities.filter(
    (e) => e.resolution.status === "possible_match_requires_confirmation",
  ).length;
  const documents = result.documents.map((d) => ({
    classification: d.classification,
    pageCount: d.pageCount,
  }));
  return canonicalStringify({
    documents,
    properties,
    vehicles,
    confirmationRequired: confirmation,
    conflicts: result.unresolvedConflicts.length,
    warnings: result.warnings.length,
  });
}

function assertEq<T>(label: string, actual: T, expected: T) {
  const pass = actual === expected;
  console.log(
    `  ${pass ? "PASS" : "FAIL"}: ${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`,
  );
  return pass;
}

async function runAnalyzer(
  analyzer: InsuranceDocumentAnalyzer,
  docs: UploadedDocument[],
): Promise<InsuranceDocumentAnalysisResult> {
  const input: InsuranceDocumentAnalysisInput = {
    householdId: "test-household",
    uploadedDocuments: docs,
    existingAssets: [],
    pendingCandidates: [],
    priorDocumentSummaries: [],
    jurisdiction: "AB",
  };
  return analyzer.analyze(input);
}

function summarize(result: InsuranceDocumentAnalysisResult) {
  const properties = result.detectedEntities.filter((e) => e.entityType === "property");
  const vehicles = result.detectedEntities.filter((e) => e.entityType === "vehicle");
  const confirmation = result.detectedEntities.filter(
    (e) => e.resolution.status === "possible_match_requires_confirmation",
  ).length;
  const exact = result.detectedEntities.filter(
    (e) => e.resolution.status === "matches_existing",
  ).length;
  const possible = result.detectedEntities.filter(
    (e) =>
      e.resolution.status === "possible_match_requires_confirmation" &&
      e.resolution.matchedExistingEntityId == null,
  ).length;
  console.log(`    documents: ${result.documents.length}`);
  console.log(`    properties: ${properties.length}`);
  for (const p of properties) {
    console.log(
      `      - ${p.temporaryId} -> ${p.resolution.status} (postal: ${p.identity.postalCode ?? "n/a"})`,
    );
  }
  console.log(`    vehicles: ${vehicles.length}`);
  for (const v of vehicles) {
    console.log(`      - ${v.temporaryId} -> ${v.resolution.status}`);
  }
  console.log(`    matches_existing: ${exact}`);
  console.log(`    possible_match_requires_confirmation: ${possible + confirmation}`);
  console.log(`    unresolved conflicts: ${result.unresolvedConflicts.length}`);
}

async function main() {
  const dir = path.resolve(process.cwd(), "fixtures/private/phase-1e");
  if (!fs.existsSync(dir)) {
    console.error(
      "FAIL: fixtures/private/phase-1e/ is unavailable. Place the four private PDFs there.",
    );
    process.exit(1);
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();

  if (files.length === 0) {
    console.error("FAIL: fixtures/private/phase-1e/ contains no PDFs.");
    process.exit(1);
  }

  const provider =
    process.env.LLM_API_URL && process.env.LLM_API_KEY
      ? new HttpLlmProvider({
          apiUrl: process.env.LLM_API_URL,
          apiKey: process.env.LLM_API_KEY,
          model: process.env.LLM_MODEL || "deepseek-chat",
          providerId: process.env.LLM_PROVIDER || "http-llm-provider",
        })
      : undefined;

  const analyzer = createLlmFirstAnalyzer({
    provider,
    loader: new FileSystemDocumentLoader({ includeImages: !!provider }),
    fallbackToDeterministic: true,
  });

  const allDocs: UploadedDocument[] = files.map((f) => ({
    documentId: f,
    filename: f,
    mimeType: "application/pdf",
    fileReference: path.join(dir, f),
  }));

  // Scenario A: all together
  console.log("\nScenario A: all together");
  const resultA = await runAnalyzer(analyzer, allDocs);
  summarize(resultA);
  const hashA = canonicalDigest(resultA);
  const summaryA = sanitizedSummary(resultA);
  console.log(`  digest: ${hashA}`);
  console.log(`  summary: ${summaryA}`);

  // Scenario B: separate processing
  console.log("\nScenario B: separate processing");
  let pending: { id: string; assetType: "property" | "vehicle"; identityFingerprint: string }[] =
    [];
  for (const doc of allDocs) {
    const input: InsuranceDocumentAnalysisInput = {
      householdId: "test-household",
      uploadedDocuments: [doc],
      existingAssets: [],
      pendingCandidates: pending,
      priorDocumentSummaries: [],
      jurisdiction: "AB",
    };
    const r = await analyzer.analyze(input);
    pending = r.detectedEntities.map((e) => ({
      id: e.temporaryId,
      assetType: e.entityType,
      identityFingerprint: e.temporaryId,
    }));
    if (doc === allDocs[allDocs.length - 1]) {
      summarize(r);
      const hashB = canonicalDigest(r);
      const summaryB = sanitizedSummary(r);
      console.log(`  digest: ${hashB}`);
      console.log(`  summary: ${summaryB}`);
    }
  }

  // Scenario C: reverse order
  console.log("\nScenario C: reverse order");
  const resultC = await runAnalyzer(analyzer, [...allDocs].reverse());
  summarize(resultC);
  const hashC = canonicalDigest(resultC);
  const summaryC = sanitizedSummary(resultC);
  console.log(`  digest: ${hashC}`);
  console.log(`  summary: ${summaryC}`);

  // Scenario D: renamed files
  console.log("\nScenario D: renamed files");
  const renamedDocs = allDocs.map((d, i) => ({ ...d, documentId: `renamed-${i}-${d.filename}` }));
  const resultD = await runAnalyzer(analyzer, renamedDocs);
  summarize(resultD);
  const hashD = canonicalDigest(resultD);
  const summaryD = sanitizedSummary(resultD);
  console.log(`  digest: ${hashD}`);
  console.log(`  summary: ${summaryD}`);

  // Scenario E: duplicate uploads
  console.log("\nScenario E: duplicate uploads");
  const dupDocs: UploadedDocument[] = [];
  for (const doc of allDocs) {
    dupDocs.push({ ...doc, documentId: `upload-1-${doc.filename}` });
    dupDocs.push({ ...doc, documentId: `upload-2-${doc.filename}` });
  }
  const resultE = await runAnalyzer(analyzer, dupDocs);
  summarize(resultE);
  const hashE = canonicalDigest(resultE);
  const summaryE = sanitizedSummary(resultE);
  console.log(`  digest: ${hashE}`);
  console.log(`  summary: ${summaryE}`);

  let allPass = true;
  allPass =
    assertEq(
      "A properties",
      resultA.detectedEntities.filter((e) => e.entityType === "property").length,
      3,
    ) && allPass;
  allPass =
    assertEq(
      "A vehicles",
      resultA.detectedEntities.filter((e) => e.entityType === "vehicle").length,
      1,
    ) && allPass;
  allPass =
    assertEq(
      "A confirmation-required",
      resultA.detectedEntities.filter(
        (e) => e.resolution.status === "possible_match_requires_confirmation",
      ).length,
      1,
    ) && allPass;
  allPass = assertEq("A documents", resultA.documents.length, 4) && allPass;

  // Scenario F: existing vehicle with same VIN
  console.log("\nScenario F: existing vehicle with same VIN");
  const vehicle = resultA.detectedEntities.find((e) => e.entityType === "vehicle");
  if (!vehicle) {
    console.error("FAIL: could not find vehicle for scenario F");
    process.exit(1);
  }
  const inputF: InsuranceDocumentAnalysisInput = {
    householdId: "test-household",
    uploadedDocuments: allDocs,
    existingAssets: [
      { id: "existing-vehicle-1", assetType: "vehicle", identityFingerprint: vehicle.temporaryId },
    ],
    pendingCandidates: [],
    priorDocumentSummaries: [],
    jurisdiction: "AB",
  };
  const resultF = await analyzer.analyze(inputF);
  summarize(resultF);
  allPass =
    assertEq(
      "F vehicle exact match",
      resultF.detectedEntities.filter(
        (e) => e.entityType === "vehicle" && e.resolution.status === "matches_existing",
      ).length,
      1,
    ) && allPass;

  // Scenario G: property matching
  console.log("\nScenario G: property matching");
  const properties = resultA.detectedEntities.filter((e) => e.entityType === "property");
  const exactProperty = properties.find((p) => !p.temporaryId.startsWith("property-hint:"));
  const samePostalProperty = properties.find((p) => p.identity.postalCode?.includes("0Z4"));
  if (!exactProperty || !samePostalProperty) {
    console.error("FAIL: could not derive property fingerprints for scenario G");
    process.exit(1);
  }
  const inputG: InsuranceDocumentAnalysisInput = {
    householdId: "test-household",
    uploadedDocuments: allDocs,
    existingAssets: [
      {
        id: "existing-exact",
        assetType: "property",
        identityFingerprint: exactProperty.temporaryId,
      },
      {
        id: "existing-same-postal",
        assetType: "property",
        identityFingerprint: `property:${samePostalProperty.identity.postalCode}`,
      },
      { id: "existing-mailing", assetType: "property", identityFingerprint: "property:MAILING" },
    ],
    pendingCandidates: [],
    priorDocumentSummaries: [],
    jurisdiction: "AB",
  };
  const resultG = await analyzer.analyze(inputG);
  summarize(resultG);
  allPass =
    assertEq(
      "G exact match",
      resultG.detectedEntities.filter(
        (e) => e.entityType === "property" && e.resolution.status === "matches_existing",
      ).length,
      1,
    ) && allPass;
  allPass =
    assertEq(
      "G redacted/confirmation",
      resultG.detectedEntities.filter(
        (e) =>
          e.entityType === "property" &&
          e.resolution.status === "possible_match_requires_confirmation",
      ).length,
      2,
    ) && allPass;

  // Per-file category pass/fail
  console.log("\n=== Per-file extracted fact categories ===");
  for (const doc of resultA.documents) {
    const file = doc.documentId;
    const cat =
      doc.classification === "home_policy_renewal"
        ? "home"
        : doc.classification === "auto_policy_renewal"
          ? "auto"
          : "unknown";
    console.log(`  ${file} -> ${cat}`);
  }

  const artifact = [
    `commit: ${process.env.GIT_SHA ?? "local"}`,
    `provider: ${provider ? provider.providerId : "deterministic"}`,
    `model: ${provider ? provider.modelId : "pdfjs-fallback"}`,
    `private PDF count: ${files.length}`,
    `A digest: ${hashA}`,
    `A summary: ${summaryA}`,
    `C digest: ${hashC}`,
    `D digest: ${hashD}`,
    `E digest: ${hashE}`,
    `A result: ${resultA.documents.length} documents, ${resultA.detectedEntities.filter((e) => e.entityType === "property").length} properties, ${resultA.detectedEntities.filter((e) => e.entityType === "vehicle").length} vehicles, ${resultA.detectedEntities.filter((e) => e.resolution.status === "possible_match_requires_confirmation").length} confirmation-required`,
    `private acceptance: ${allPass ? "PASS" : "FAIL"}`,
  ].join("\n");

  const artifactDir = path.resolve(process.cwd(), "artifacts");
  if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "phase-1e-parser-acceptance.txt"), artifact);

  console.log("\n=== Aggregate ===");
  summarize(resultA);
  console.log(`\n${allPass ? "PASS" : "FAIL"}: phase 1E parser acceptance`);

  if (!allPass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
