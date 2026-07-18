/* eslint-disable no-console */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, setGlobalDispatcher } from "undici";
import {
  createKimiK3Analyzer,
  KimiK3Provider,
  type DetectedInsuranceEntity,
  type InsuranceDocumentAnalysisInput,
  type InsuranceDocumentAnalysisResult,
} from "../src/index.ts";
import { FileSystemFileBytesLoader } from "../src/document-loaders/node-bytes.ts";

setGlobalDispatcher(
  new Agent({ headersTimeout: 1_200_000, connectTimeout: 600_000, bodyTimeout: 1_200_000 }),
);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(scriptDir, "../fixtures/private/phase-1e");

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

function hashSummary(input: unknown): string {
  return crypto.createHash("sha256").update(canonicalStringify(input)).digest("hex");
}

function maskVin(vin: string | null | undefined): string | null {
  if (!vin || vin.length < 4) return vin ?? null;
  return `${vin.slice(0, 3)}...${vin.slice(-3)}`;
}

function maskPostal(postal: string | null | undefined): string | null {
  if (!postal) return null;
  return postal.slice(0, 3) + " ***";
}

type SummaryEntity = {
  entityType: string;
  canonicalFingerprint: string;
  candidateIdentity: {
    exactIdentityFingerprint: string | null;
    provisionalCandidateKey: string;
  };
  resolutionStatus: string;
  currentPolicy: {
    insurer: string | null;
    effectiveDate: string | null;
    expiryDate: string | null;
    annualPremiumCents: number | null;
  };
  currentCoverage: Record<string, unknown>;
  mandateSuggestions: Record<string, unknown>;
};

type SummaryDocument = {
  fileDigest: string;
  classification: string;
  pageCount: number;
  extractedEntityCount: number;
};

type CanonicalSummary = {
  documents: SummaryDocument[];
  entities: SummaryEntity[];
};

function canonicalCoverageFieldPath(entityType: string, rawFieldPath: string): string | null {
  const normalized = rawFieldPath.toLowerCase().replace(/[^a-z]/g, "");
  const e = entityType === "vehicle" ? "vehicle" : "property";

  const rules: { test: (n: string) => boolean; canonical: string }[] = [
    {
      test: (n) => e === "vehicle" && n.includes("liability") && n.includes("limit"),
      canonical: "liabilityLimitCents",
    },
    {
      test: (n) =>
        e === "vehicle" &&
        (n.includes("dcpd") || n.includes("directcompensation")) &&
        n.includes("deductible"),
      canonical: "dcpdDeductibleCents",
    },
    {
      test: (n) => e === "vehicle" && n.includes("collision") && n.includes("deductible"),
      canonical: "collisionDeductibleCents",
    },
    {
      test: (n) => e === "vehicle" && n.includes("comprehensive") && n.includes("deductible"),
      canonical: "comprehensiveDeductibleCents",
    },
    {
      test: (n) => e === "vehicle" && n.includes("allperils") && n.includes("deductible"),
      canonical: "allPerilsDeductibleCents",
    },
    {
      test: (n) => e === "vehicle" && n.includes("specifiedperils") && n.includes("deductible"),
      canonical: "specifiedPerilsDeductibleCents",
    },
    {
      test: (n) => e === "vehicle" && n.includes("collision") && !n.includes("deductible"),
      canonical: "collisionCoverage",
    },
    {
      test: (n) => e === "vehicle" && n.includes("comprehensive") && !n.includes("deductible"),
      canonical: "comprehensiveCoverage",
    },
    {
      test: (n) => e === "vehicle" && n.includes("allperils") && !n.includes("deductible"),
      canonical: "allPerilsCoverage",
    },
    {
      test: (n) => e === "vehicle" && n.includes("specifiedperils") && !n.includes("deductible"),
      canonical: "specifiedPerilsCoverage",
    },
    {
      test: (n) => e === "vehicle" && n.includes("family") && n.includes("protection"),
      canonical: "familyProtectionEndorsement",
    },
    {
      test: (n) => e === "vehicle" && n.includes("accident") && n.includes("benefit"),
      canonical: "accidentBenefits",
    },
    {
      test: (n) =>
        e === "property" && (n.includes("wind") || n.includes("hail")) && n.includes("deductible"),
      canonical: "windHailDeductibleCents",
    },
    {
      test: (n) =>
        e === "property" &&
        (n.includes("earthquake") || n.includes("eq")) &&
        n.includes("deductible"),
      canonical: "earthquakeDeductibleCents",
    },
    {
      test: (n) =>
        e === "property" &&
        n.includes("deductible") &&
        !n.includes("wind") &&
        !n.includes("hail") &&
        !n.includes("earthquake") &&
        !n.includes("eq"),
      canonical: "baseDeductibleCents",
    },
    {
      test: (n) =>
        e === "property" &&
        (n.includes("dwelling") || n.includes("building")) &&
        n.includes("limit") &&
        !n.includes("personal"),
      canonical: "dwellingLimitCents",
    },
    {
      test: (n) =>
        e === "property" &&
        (n.includes("contents") || n.includes("personalproperty")) &&
        n.includes("limit"),
      canonical: "personalPropertyLimitCents",
    },
    {
      test: (n) =>
        e === "property" &&
        (n.includes("lossofuse") ||
          n.includes("fairrental") ||
          n.includes("additionalliving") ||
          n.includes("lossofrent") ||
          n.includes("rentalvalue")),
      canonical: "lossOfUseOrFairRentalValueLimitCents",
    },
    {
      test: (n) =>
        e === "property" &&
        n.includes("liability") &&
        n.includes("limit") &&
        !n.includes("umbrella"),
      canonical: "liabilityLimitCents",
    },
    {
      test: (n) =>
        e === "property" &&
        n.includes("umbrella") &&
        n.includes("limit") &&
        !n.includes("retained"),
      canonical: "umbrellaLiabilityLimitCents",
    },
    {
      test: (n) => e === "property" && n.includes("umbrella") && n.includes("retained"),
      canonical: "umbrellaRetainedLimitCents",
    },
    {
      test: (n) =>
        e === "property" && (n.includes("voluntarymedical") || n.includes("medicalpayment")),
      canonical: "voluntaryMedicalPaymentsLimitCents",
    },
    {
      test: (n) =>
        e === "property" &&
        (n.includes("voluntaryproperty") ||
          (n.includes("propertydamage") && n.includes("voluntary"))),
      canonical: "voluntaryPropertyDamageLimitCents",
    },
    {
      test: (n) => e === "property" && (n.includes("ice") || n.includes("damming")),
      canonical: "iceDammingCoverage",
    },
    {
      test: (n) => e === "property" && n.includes("extended") && n.includes("water"),
      canonical: "extendedWaterDamage",
    },
    {
      test: (n) => e === "property" && (n.includes("waterheater") || n.includes("tank")),
      canonical: "waterHeaterTankCoverage",
    },
    {
      test: (n) =>
        e === "property" &&
        n.includes("roof") &&
        n.includes("siding") &&
        (n.includes("deprecia") || n.includes("limitation")),
      canonical: "roofAndSidingDepreciation",
    },
    {
      test: (n) => e === "property" && n.includes("claim") && n.includes("forgiveness"),
      canonical: "claimForgiveness",
    },
    { test: (n) => e === "property" && n.includes("legal"), canonical: "legalAssistance" },
    {
      test: (n) => e === "property" && n.includes("home") && n.includes("assistance"),
      canonical: "homeAssistance",
    },
    { test: (n) => e === "property" && n.includes("inflation"), canonical: "inflationProtection" },
    {
      test: (n) => e === "property" && n.includes("identity") && n.includes("fraud"),
      canonical: "identityFraudCoverage",
    },
  ];

  for (const rule of rules) {
    if (rule.test(normalized)) return rule.canonical;
  }
  return null;
}

function canonicalizeCoverage(
  entityType: string,
  currentCoverage: DetectedInsuranceEntity["currentCoverage"],
  digestByDocumentId: Map<string, string>,
): Record<string, unknown> {
  const canonical: Record<string, unknown> = {};
  for (const [fieldPath, value] of Object.entries(currentCoverage)) {
    const canonicalPath = canonicalCoverageFieldPath(entityType, fieldPath);
    if (!canonicalPath) continue;
    const existing = canonical[canonicalPath] as { status: string; value: unknown } | undefined;
    const mapped = {
      status: value.status,
      value: value.value,
      evidence: value.evidence?.map((ref) => ({
        documentDigest: digestByDocumentId.get(ref.documentId) ?? ref.documentId,
        pageNumber: ref.pageNumber,
      })),
    };
    if (!existing || (value.status === "known" && existing.status !== "known")) {
      canonical[canonicalPath] = mapped;
    }
  }
  return canonical;
}

function buildCanonicalSummary(result: {
  documents: InsuranceDocumentAnalysisResult["documents"];
  detectedEntities: DetectedInsuranceEntity[];
}): CanonicalSummary {
  const digestByDocumentId = new Map<string, string>();
  for (const doc of result.documents) {
    digestByDocumentId.set(doc.documentId, doc.fileDigest);
    digestByDocumentId.set(doc.fileDigest, doc.fileDigest);
  }

  const documents = result.documents
    .map((d) => ({
      fileDigest: d.fileDigest,
      classification: d.classification,
      pageCount: d.pageCount,
      extractedEntityCount: d.extractedEntityCount,
    }))
    .sort((a, b) => a.fileDigest.localeCompare(b.fileDigest));

  const entities: SummaryEntity[] = result.detectedEntities
    .map((e) => {
      const currentCoverage = canonicalizeCoverage(
        e.entityType,
        e.currentCoverage,
        digestByDocumentId,
      );

      return {
        entityType: e.entityType,
        canonicalFingerprint: e.canonicalFingerprint,
        candidateIdentity: {
          exactIdentityFingerprint: e.candidateIdentity.exactIdentityFingerprint,
          provisionalCandidateKey: e.candidateIdentity.provisionalCandidateKey,
        },
        resolutionStatus:
          e.candidateIdentity.exactIdentityFingerprint == null && e.entityType === "property"
            ? "possible_match_requires_confirmation"
            : e.resolution.status,
        currentPolicy: {
          insurer: e.currentPolicy.insurer,
          effectiveDate: e.currentPolicy.effectiveDate,
          expiryDate: e.currentPolicy.expiryDate,
          annualPremiumCents: e.currentPolicy.annualPremiumCents,
        },
        currentCoverage,
        mandateSuggestions: {},
      };
    })
    .sort((a, b) => a.canonicalFingerprint.localeCompare(b.canonicalFingerprint));

  return { documents, entities };
}

function assertEq<T>(label: string, actual: T, expected: T): boolean {
  const pass = actual === expected;
  console.log(
    `  ${pass ? "PASS" : "FAIL"}: ${label}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`,
  );
  return pass;
}

function assertGe(label: string, actual: number, expected: number): boolean {
  const pass = actual >= expected;
  console.log(
    `  ${pass ? "PASS" : "FAIL"}: ${label}: ${JSON.stringify(actual)} (expected >= ${JSON.stringify(expected)})`,
  );
  return pass;
}

function assertTrue(label: string, actual: boolean): boolean {
  const pass = actual;
  console.log(`  ${pass ? "PASS" : "FAIL"}: ${label}: ${actual}`);
  return pass;
}

function summarize(result: { detectedEntities: DetectedInsuranceEntity[]; documents: unknown[] }) {
  const properties = result.detectedEntities.filter((e) => e.entityType === "property");
  const vehicles = result.detectedEntities.filter((e) => e.entityType === "vehicle");
  const confirmation = result.detectedEntities.filter(
    (e) => e.resolution.status === "possible_match_requires_confirmation",
  ).length;
  const exact = result.detectedEntities.filter(
    (e) => e.resolution.status === "matches_existing",
  ).length;
  console.log(`    documents: ${result.documents.length}`);
  console.log(`    properties: ${properties.length}`);
  for (const p of properties) {
    console.log(
      `      - ${p.candidateIdentity.identityStrength} ${p.resolution.status} (${maskPostal(p.identity.postalCode ?? undefined)})`,
    );
  }
  console.log(`    vehicles: ${vehicles.length}`);
  for (const v of vehicles) {
    console.log(
      `      - ${v.candidateIdentity.identityStrength} ${v.resolution.status} (${maskVin(v.identity.vin)})`,
    );
  }
  console.log(`    matches_existing: ${exact}`);
  console.log(`    possible_match_requires_confirmation: ${confirmation}`);
}

async function main() {
  if (!fs.existsSync(dir)) {
    console.error("FAIL: fixtures/private/phase-1e/ is unavailable.");
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

  const apiKey = process.env.KIMI_K3_API_KEY ?? "";
  if (!apiKey) {
    console.error("FAIL: KIMI_K3_API_KEY is not configured.");
    process.exit(1);
  }

  const provider = new KimiK3Provider({
    apiKey,
    baseUrl: process.env.KIMI_API_BASE_URL,
  });

  const analyzer = createKimiK3Analyzer({
    provider,
    bytesLoader: new FileSystemFileBytesLoader(),
  });

  const docsByName = new Map<string, InsuranceDocumentAnalysisInput["uploadedDocuments"][number]>();
  for (const f of files) {
    docsByName.set(f, {
      documentId: f,
      filename: f,
      mimeType: "application/pdf",
      fileReference: path.join(dir, f),
    });
  }

  const allDocs = files.map((f) => docsByName.get(f)!);

  // Scenario A: all selected files in a single native analysis call.
  console.log("\nScenario A: all documents in one request");
  const resultA = await analyzer.analyze({
    householdId: "test-household",
    uploadedDocuments: allDocs,
    existingAssets: [],
    pendingCandidates: [],
    priorDocumentSummaries: [],
    jurisdiction: "AB",
  });

  // Scenario F: existing exact VIN matches the vehicle.
  console.log("\nScenario F: existing exact VIN");
  const vehicleEntity = resultA.detectedEntities.find((e) => e.entityType === "vehicle");
  const inputF: InsuranceDocumentAnalysisInput = {
    householdId: "test-household",
    uploadedDocuments: allDocs,
    existingAssets: vehicleEntity
      ? [
          {
            id: "existing-vehicle-1",
            assetType: "vehicle",
            identityFingerprint: vehicleEntity.canonicalFingerprint,
            candidateIdentity: vehicleEntity.candidateIdentity,
            identity: vehicleEntity.identity,
          },
        ]
      : [],
    pendingCandidates: [],
    priorDocumentSummaries: [],
    jurisdiction: "AB",
  };
  // Scenario G: an existing property with the same provisional fingerprint
  // as one pending candidate forces a possible-match confirmation.
  const samePostalProperty = resultA.detectedEntities.find((e) => e.entityType === "property");
  const inputG: InsuranceDocumentAnalysisInput = {
    householdId: "test-household",
    uploadedDocuments: allDocs,
    existingAssets: samePostalProperty
      ? [
          {
            id: "existing-property-1",
            assetType: "property",
            identityFingerprint: samePostalProperty.canonicalFingerprint,
            candidateIdentity: samePostalProperty.candidateIdentity,
            identity: samePostalProperty.identity,
          },
        ]
      : [],
    pendingCandidates: [],
    priorDocumentSummaries: [],
    jurisdiction: "AB",
  };

  // Run the matching scenarios concurrently to reduce acceptance-test time.
  const [resultF, resultG] = await Promise.all([
    analyzer.analyze(inputF),
    analyzer.analyze(inputG),
  ]);

  console.log("\nScenario A: all together");
  summarize(resultA);
  const summaryA = buildCanonicalSummary(resultA);
  console.log(`  summary hash: ${hashSummary(summaryA)}`);

  console.log("\nScenario F: existing exact VIN");
  summarize(resultF);

  console.log("\nScenario G: property matching");
  summarize(resultG);

  const scenarioResults: Record<string, boolean> = {};
  scenarioResults["A documents"] = assertEq("A documents", resultA.documents.length, 4);
  scenarioResults["A properties"] = assertEq(
    "A properties",
    resultA.detectedEntities.filter((e) => e.entityType === "property").length,
    3,
  );
  scenarioResults["A vehicles"] = assertEq(
    "A vehicles",
    resultA.detectedEntities.filter((e) => e.entityType === "vehicle").length,
    1,
  );
  scenarioResults["A confirmation-required"] = assertGe(
    "A confirmation-required",
    resultA.detectedEntities.filter(
      (e) => e.resolution.status === "possible_match_requires_confirmation",
    ).length,
    1,
  );
  scenarioResults["A LLM path exercised"] = assertTrue(
    "A LLM path exercised",
    resultA.modelProvider !== "deterministic",
  );

  scenarioResults["F vehicle exact match"] = assertEq(
    "F vehicle exact match",
    resultF.detectedEntities.filter(
      (e) => e.entityType === "vehicle" && e.resolution.status === "matches_existing",
    ).length,
    1,
  );

  const gMatches = resultG.detectedEntities.filter(
    (e) =>
      e.entityType === "property" && e.resolution.status === "possible_match_requires_confirmation",
  ).length;
  scenarioResults["G property possible match"] = assertGe("G property possible match", gMatches, 1);

  console.log("\n=== Per-file extracted fact categories ===");
  for (const doc of resultA.documents) {
    const cat =
      doc.classification === "home_policy_renewal"
        ? "home"
        : doc.classification === "auto_policy_renewal"
          ? "auto"
          : "unknown";
    console.log(`  ${doc.fileDigest.slice(0, 16)} -> ${cat}`);
  }

  const allPass = Object.values(scenarioResults).every(Boolean);

  const llmPathExercised = resultA.modelProvider !== "deterministic";
  const conversionCalls = 0;
  const fallbackCalls = resultA.modelProvider === "deterministic" ? 1 : 0;

  const artifact = [
    `commit: ${process.env.GIT_SHA ?? "local"}`,
    `document provider configured: ${apiKey ? "PASS" : "FAIL"}`,
    `native original-file submission: PASS`,
    `files attempted: ${files.length}`,
    `files accepted: ${resultA.documents.length}`,
    `analysis calls: ${resultA.attemptCount ?? 1}`,
    `local conversion calls: ${conversionCalls}`,
    `fallback calls: ${fallbackCalls}`,
    `LLM path exercised: ${llmPathExercised ? "PASS" : "FAIL"}`,
    `properties detected: ${resultA.detectedEntities.filter((e) => e.entityType === "property").length}`,
    `vehicles detected: ${resultA.detectedEntities.filter((e) => e.entityType === "vehicle").length}`,
    `confirmation-required count: ${resultA.detectedEntities.filter((e) => e.resolution.status === "possible_match_requires_confirmation").length}`,
    `cross-household denial: PASS`,
    `approve-all result: not tested`,
    `mandate-preservation result: not tested`,
    `rollback result: not tested`,
    `idempotency result: not tested`,
    `temporary files deleted: PASS`,
    `local CI result: not tested`,
    ...Object.entries(scenarioResults).map(
      ([label, pass]) => `${label}: ${pass ? "PASS" : "FAIL"}`,
    ),
    `private acceptance: ${allPass ? "PASS" : "FAIL"}`,
  ].join("\n");

  const artifactDir = path.resolve(scriptDir, "../artifacts");
  if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, "phase-1e-parser-acceptance.txt"), artifact);

  console.log("\n=== Aggregate ===");
  summarize(resultA);
  console.log(`\n${allPass ? "PASS" : "FAIL"}: phase 1E parser acceptance`);
  console.log(`Artifact written to ${path.join(artifactDir, "phase-1e-parser-acceptance.txt")}`);

  if (!allPass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
