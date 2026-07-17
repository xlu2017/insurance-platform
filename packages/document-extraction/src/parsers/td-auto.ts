import type { ExtractedFactAssertion, ExtractedPdf, ParsedInsuranceDocument } from "../types.ts";
import { parseDateIso, parseMoneyCents, splitLines } from "./helpers.ts";

const ID = "TdSecurityNationalAlbertaAutoRenewalParserV1";
const VERSION = "1.0.0";

const authorityOrder = [
  "coverage_summary",
  "insurance_certificate",
  "endorsement",
  "invoice",
  "renewal_overview",
  "notice",
  "header_footer",
] as const;

function authorityRank(a: string): number {
  return authorityOrder.indexOf(a as (typeof authorityOrder)[number]);
}

function uuid(): string {
  return crypto.randomUUID();
}

function assertion(fields: Omit<ExtractedFactAssertion, "id">): ExtractedFactAssertion {
  return { id: uuid(), ...fields };
}

function detectPageAuthority(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("certificate of automobile insurance")) return "insurance_certificate";
  if (t.includes("coverage summary page")) return "coverage_summary";
  if (t.includes("invoice")) return "invoice";
  if (t.includes("renewal")) return "renewal_overview";
  if (t.includes("important") || t.includes("notice")) return "notice";
  return "header_footer";
}

export function canParseAuto(document: ExtractedPdf): boolean {
  const text = document.pages
    .map((p) => p.text)
    .join("\n")
    .toLowerCase();
  return (
    text.includes("security national insurance company") &&
    text.includes("auto insurance renewal") &&
    text.includes("certificate of automobile insurance")
  );
}

export function parseAuto(document: ExtractedPdf): ParsedInsuranceDocument {
  const assertions: ExtractedFactAssertion[] = [];

  for (const page of document.pages) {
    const text = page.text;
    const lines = splitLines(text);
    const authority = detectPageAuthority(text);

    // Vehicle description line "2006 - MAZDA - MAZDA5 GT 5DR - VIN"
    const descMatch = text.match(
      /(\d{4})\s*-\s*([A-Z]+)\s*-\s*([^-\n]+)\s*-\s*([A-HJ-NPR-Z0-9]{17})/i,
    );
    if (descMatch) {
      const year = Number.parseInt(descMatch[1], 10);
      const make = descMatch[2].trim();
      const model = descMatch[3].trim();
      const vin = descMatch[4].trim().toUpperCase();
      assertions.push(
        assertion({
          documentId: document.documentId,
          pageNumber: page.pageNumber,
          entityScope: "vehicle",
          fieldPath: "vehicle.year",
          rawText: descMatch[1],
          parsedValue: year,
          normalizedValue: year,
          parserId: ID,
          parserVersion: VERSION,
          confidence: 0.99,
          authority: "insurance_certificate",
        }),
      );
      assertions.push(
        assertion({
          documentId: document.documentId,
          pageNumber: page.pageNumber,
          entityScope: "vehicle",
          fieldPath: "vehicle.make",
          rawText: make,
          parsedValue: make,
          normalizedValue: make,
          parserId: ID,
          parserVersion: VERSION,
          confidence: 0.99,
          authority: "insurance_certificate",
        }),
      );
      assertions.push(
        assertion({
          documentId: document.documentId,
          pageNumber: page.pageNumber,
          entityScope: "vehicle",
          fieldPath: "vehicle.model",
          rawText: model,
          parsedValue: model,
          normalizedValue: model,
          parserId: ID,
          parserVersion: VERSION,
          confidence: 0.99,
          authority: "insurance_certificate",
        }),
      );
      assertions.push(
        assertion({
          documentId: document.documentId,
          pageNumber: page.pageNumber,
          entityScope: "vehicle",
          fieldPath: "vehicle.vin",
          rawText: vin,
          parsedValue: vin,
          normalizedValue: vin,
          parserId: ID,
          parserVersion: VERSION,
          confidence: 0.99,
          authority: "insurance_certificate",
        }),
      );
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lower = line.toLowerCase();

      if (lower.includes("liability") && line.includes("$")) {
        const m = line.match(/\$([\d,]+(?:\.\d{2})?)/);
        if (m) {
          const cents = parseMoneyCents(m[0]);
          if (cents !== null) {
            assertions.push(
              assertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath: "vehicle.thirdPartyLiabilityLimitCents",
                rawText: m[0],
                parsedValue: cents,
                normalizedValue: cents,
                parserId: ID,
                parserVersion: VERSION,
                confidence: 0.95,
                authority: authority as ExtractedFactAssertion["authority"],
              }),
            );
          }
        }
      }

      if (lower.includes("direct compensation") && lower.includes("deductible")) {
        const next = lines[i + 1]?.trim();
        const val = parseMoneyCents(next ?? "");
        if (val !== null) {
          assertions.push(
            assertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "coverage",
              fieldPath: "vehicle.directCompensationDeductibleCents",
              rawText: next ?? line,
              parsedValue: val,
              normalizedValue: val,
              parserId: ID,
              parserVersion: VERSION,
              confidence: 0.9,
              authority: authority as ExtractedFactAssertion["authority"],
            }),
          );
        }
      }

      if (
        lower.includes("all perils") ||
        lower.includes("collision") ||
        lower.includes("comprehensive") ||
        lower.includes("specified perils")
      ) {
        const next = lines[i + 1]?.trim() ?? "";
        const notCovered =
          next.toLowerCase().includes("not covered") || next.toLowerCase().includes("not included");
        const included = next.toLowerCase() === "included";
        let fieldPath: string | null = null;
        if (lower.includes("all perils")) fieldPath = "vehicle.allPerilsIncluded";
        else if (lower.includes("collision")) fieldPath = "vehicle.collisionIncluded";
        else if (lower.includes("comprehensive")) fieldPath = "vehicle.comprehensiveIncluded";
        else if (lower.includes("specified perils")) fieldPath = "vehicle.specifiedPerilsIncluded";
        if (fieldPath && (notCovered || included)) {
          assertions.push(
            assertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "coverage",
              fieldPath,
              rawText: next,
              parsedValue: included,
              normalizedValue: included,
              parserId: ID,
              parserVersion: VERSION,
              confidence: 0.9,
              authority: authority as ExtractedFactAssertion["authority"],
            }),
          );
        }
      }

      if (lower.includes("family protection")) {
        const next = lines[i + 1]?.trim() ?? "";
        const included =
          next.toLowerCase().includes("included") || next.toLowerCase().startsWith("$");
        const amount = parseMoneyCents(next);
        assertions.push(
          assertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "coverage",
            fieldPath: "vehicle.familyProtectionIncluded",
            rawText: next,
            parsedValue: included || (amount !== null ? true : false),
            normalizedValue: included || (amount !== null ? true : false),
            parserId: ID,
            parserVersion: VERSION,
            confidence: 0.85,
            authority: authority as ExtractedFactAssertion["authority"],
          }),
        );
      }

      if (lower.startsWith("policy no")) {
        const val = lines[i + 1]?.trim();
        if (val && /^\d+$/.test(val.replace(/\s/g, ""))) {
          assertions.push(
            assertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.policyNumber",
              rawText: val,
              parsedValue: val,
              normalizedValue: val,
              parserId: ID,
              parserVersion: VERSION,
              confidence: 0.85,
              authority: authority as ExtractedFactAssertion["authority"],
            }),
          );
        }
      }

      if (lower.includes("effective date") && lines[i + 1]) {
        const val = lines[i + 1]?.trim();
        const date = parseDateIso(val ?? "");
        if (date) {
          assertions.push(
            assertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.effectiveDate",
              rawText: val,
              parsedValue: date,
              normalizedValue: date,
              parserId: ID,
              parserVersion: VERSION,
              confidence: 0.9,
              authority: authority as ExtractedFactAssertion["authority"],
            }),
          );
        }
      }

      if (lower.includes("expiry date") && lines[i + 1]) {
        const val = lines[i + 1]?.trim();
        const date = parseDateIso(val ?? "");
        if (date) {
          assertions.push(
            assertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.expiryDate",
              rawText: val,
              parsedValue: date,
              normalizedValue: date,
              parserId: ID,
              parserVersion: VERSION,
              confidence: 0.9,
              authority: authority as ExtractedFactAssertion["authority"],
            }),
          );
        }
      }

      if (lower.includes("annual premium") || lower.includes("total annual amount")) {
        const m = line.match(/\$([\d,]+\.\d{2})/);
        if (m) {
          const cents = parseMoneyCents(m[0]);
          if (cents !== null) {
            assertions.push(
              assertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "premium",
                fieldPath: "policy.annualPremiumCents",
                rawText: m[0],
                parsedValue: cents,
                normalizedValue: cents,
                parserId: ID,
                parserVersion: VERSION,
                confidence: 0.9,
                authority: authority as ExtractedFactAssertion["authority"],
              }),
            );
          }
        }
      }
    }
  }

  const { selected, conflicts } = resolveByAuthority(assertions);

  const vin = selected["vehicle.vin"]?.normalizedValue as string | undefined;
  const year = selected["vehicle.year"]?.normalizedValue as number | undefined;
  const make = selected["vehicle.make"]?.normalizedValue as string | undefined;
  const model = selected["vehicle.model"]?.normalizedValue as string | undefined;
  const identityFingerprint = vin ? vin.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  const displayLabel =
    [year, make, model].filter(Boolean).join(" ") || identityFingerprint.slice(-4);

  const assetAssertions = [
    {
      assetType: "vehicle" as const,
      identityFingerprint,
      displayLabel,
      matchClassification: "new" as const,
      occupancy: undefined,
      assertions: selectedValues(selected),
    },
  ];

  return {
    classification: "auto_policy_renewal",
    insurer: { name: "Security National Insurance Company" },
    agency: { name: "TD Insurance Direct Agency Inc." },
    policyTerms: buildPolicyTerms(selected),
    assetAssertions,
    coverageAssertions: selectedValues(selected),
    notices: [],
    conflicts,
    parserId: ID,
    parserVersion: VERSION,
  };
}

function resolveByAuthority(assertions: ExtractedFactAssertion[]): {
  selected: Record<string, ExtractedFactAssertion>;
  conflicts: {
    fieldPath: string;
    assertionIds: string[];
    selectedAssertionId?: string;
    reason: string;
  }[];
} {
  const byPath: Record<string, ExtractedFactAssertion[]> = {};
  for (const a of assertions) {
    byPath[a.fieldPath] = byPath[a.fieldPath] ?? [];
    byPath[a.fieldPath].push(a);
  }
  const selected: Record<string, ExtractedFactAssertion> = {};
  const conflicts: {
    fieldPath: string;
    assertionIds: string[];
    selectedAssertionId?: string;
    reason: string;
  }[] = [];
  for (const [path, list] of Object.entries(byPath)) {
    const sorted = [...list].sort(
      (a, b) => authorityRank(b.authority) - authorityRank(a.authority),
    );
    selected[path] = sorted[0];
    if (sorted.length > 1) {
      const disagree = sorted.filter(
        (a, idx) =>
          idx > 0 &&
          JSON.stringify(a.normalizedValue) !== JSON.stringify(sorted[0].normalizedValue),
      );
      if (disagree.length > 0) {
        conflicts.push({
          fieldPath: path,
          assertionIds: sorted.map((a) => a.id),
          selectedAssertionId: sorted[0].id,
          reason: `Conflicting values from ${disagree.map((a) => a.authority).join(", ")}; selected ${sorted[0].authority}.`,
        });
      }
    }
  }
  return { selected, conflicts };
}

function selectedValues(
  selected: Record<string, ExtractedFactAssertion>,
): ExtractedFactAssertion[] {
  return Object.values(selected);
}

function buildPolicyTerms(selected: Record<string, ExtractedFactAssertion>): {
  effectiveDate?: string;
  expiryDate?: string;
  policyNumber?: string;
  annualPremiumCents?: number;
}[] {
  return [
    {
      effectiveDate: selected["policy.effectiveDate"]?.normalizedValue as string | undefined,
      expiryDate: selected["policy.expiryDate"]?.normalizedValue as string | undefined,
      policyNumber: selected["policy.policyNumber"]?.normalizedValue as string | undefined,
      annualPremiumCents: selected["policy.annualPremiumCents"]?.normalizedValue as
        | number
        | undefined,
    },
  ];
}
