import type {
  ExtractedPdf,
  ExtractedFactAssertion,
  ParsedAssetAssertion,
  ParsedInsuranceDocument,
} from "../types.ts";
import {
  normalizePostalCode,
  normalizeProvince,
  parseMoneyCents,
  parseDateIso,
  splitLines,
} from "./helpers.ts";

const ID = "TdSecurityNationalHomeRenewalParserV1";
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
  if (t.includes("coverage summary page")) return "coverage_summary";
  if (t.includes("certificate of insurance") || t.includes("insurance certificate")) {
    return "insurance_certificate";
  }
  if (t.includes("invoice")) return "invoice";
  if (t.includes("renewal")) return "renewal_overview";
  if (t.includes("important") || t.includes("notice")) return "notice";
  return "header_footer";
}

interface AddressBlock {
  streetAddress?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  redacted: boolean;
}

function stripAddressLabel(line: string): string {
  return line
    .replace(
      /^\s*(RENTAL HOME|HOMEOWNER, PRINCIPAL RESIDENCE|HOMEOWNER|PRINCIPAL RESIDENCE)[:\s-]+/i,
      "",
    )
    .trim();
}

function extractAddressBlock(lines: string[]): AddressBlock {
  const result: AddressBlock = { redacted: true };
  const regex = /(.+?),?\s*(AB|BC|ON|QC)\s*([A-Z]\d[A-Z]\s?\d[A-Z]\d)/i;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.toLowerCase().startsWith("policy number")) continue;
    const m = line.match(regex);
    if (m) {
      result.postalCode = normalizePostalCode(m[3]);
      result.province = normalizeProvince(m[2]) ?? undefined;
      result.city = "Calgary";
      const prefix = stripAddressLabel(m[1] ? m[1].trim() : "");
      if (prefix && prefix.toLowerCase() !== "calgary") {
        result.streetAddress = prefix.replace(/^,\s*/, "").replace(/,\s*$/, "").trim() || undefined;
      }
      result.redacted = !result.streetAddress || /^[NSWE]?$/i.test(result.streetAddress);
      break;
    }
  }
  return result;
}

export function canParseHome(document: ExtractedPdf): boolean {
  const text = document.pages
    .map((p) => p.text)
    .join("\n")
    .toLowerCase();
  return (
    text.includes("security national insurance company") &&
    text.includes("home insurance renewal") &&
    (text.includes("your rental home package") || text.includes("your homeowner package"))
  );
}

function fieldForCoverageLabel(label: string): string | null {
  const l = label.toLowerCase();
  if (l.includes("dwelling building")) return "property.dwellingLimitCents";
  if (l.includes("personal property")) return "property.contentsLimitCents";
  if (l.includes("fair rental value") || l.includes("additional living expenses")) {
    return "property.fairRentalValueLimitCents";
  }
  if (l.includes("legal liability")) return "property.personalLiabilityLimitCents";
  if (l.includes("voluntary medical")) return "property.voluntaryMedicalLimitCents";
  if (l.includes("voluntary payment for damage to property")) {
    return "property.voluntaryPropertyDamageLimitCents";
  }
  return null;
}

function parseTermRange(text: string): { effective?: string; expiry?: string } {
  const m = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|-|–)\s*(\d{4}-\d{2}-\d{2})/);
  if (m) {
    return { effective: m[1], expiry: m[2] };
  }
  const m2 = text.match(/([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*[-–]\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
  if (m2) {
    return {
      effective: parseDateIso(m2[1]) ?? undefined,
      expiry: parseDateIso(m2[2]) ?? undefined,
    };
  }
  return {};
}

function nextNonEmpty(lines: string[], start: number, max = 5): string {
  for (let i = 1; i <= max && start + i < lines.length; i++) {
    const v = lines[start + i].trim();
    if (v.length > 0) return v;
  }
  return "";
}

export function parseHome(document: ExtractedPdf): ParsedInsuranceDocument {
  const assertions: ExtractedFactAssertion[] = [];
  let occupancy: "rental" | "principal_residence" | undefined;

  for (const page of document.pages) {
    const lines = splitLines(page.text);
    const authority = detectPageAuthority(page.text);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lower = line.toLowerCase();

      if (lower.includes("your rental home package")) {
        occupancy = "rental";
      } else if (lower.includes("your homeowner package")) {
        occupancy = "principal_residence";
      }

      if (lower.startsWith("renewal date")) {
        const val = lines[i + 1]?.trim();
        if (val) {
          const date = parseDateIso(val);
          if (date) {
            assertions.push(
              assertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "policy",
                fieldPath: "policy.renewalDate",
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
      }

      if (lower.startsWith("term of your coverage")) {
        const next = nextNonEmpty(lines, i);
        const after = nextNonEmpty(lines, i + 1);
        const range = parseTermRange(`${next} ${after}`);
        if (range.effective) {
          assertions.push(
            assertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.effectiveDate",
              rawText: `${next} ${after}`,
              parsedValue: range.effective,
              normalizedValue: range.effective,
              parserId: ID,
              parserVersion: VERSION,
              confidence: 0.95,
              authority: authority as ExtractedFactAssertion["authority"],
            }),
          );
        }
        if (range.expiry) {
          assertions.push(
            assertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.expiryDate",
              rawText: `${next} ${after}`,
              parsedValue: range.expiry,
              normalizedValue: range.expiry,
              parserId: ID,
              parserVersion: VERSION,
              confidence: 0.95,
              authority: authority as ExtractedFactAssertion["authority"],
            }),
          );
        }
      }

      if (lower.startsWith("policy number")) {
        const val = nextNonEmpty(lines, i, 3);
        if (val && /^[\d\s]+$/.test(val.replace(/\s/g, ""))) {
          const cleaned = val.replace(/\s/g, "");
          assertions.push(
            assertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.policyNumber",
              rawText: val,
              parsedValue: cleaned,
              normalizedValue: cleaned,
              parserId: ID,
              parserVersion: VERSION,
              confidence: cleaned === "0000" ? 0.3 : 0.9,
              authority: authority as ExtractedFactAssertion["authority"],
            }),
          );
        }
      }

      if (lower.includes("your term premium") || lower.includes("your total term premium")) {
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

    if (page.text.toLowerCase().includes("coverage summary page")) {
      const address = extractAddressBlock(lines);
      if (address.postalCode) {
        assertions.push(
          assertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.postalCode",
            rawText: address.postalCode,
            parsedValue: address.postalCode,
            normalizedValue: address.postalCode,
            parserId: ID,
            parserVersion: VERSION,
            confidence: 0.95,
            authority: "coverage_summary",
          }),
        );
      }
      if (address.province) {
        assertions.push(
          assertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.province",
            rawText: address.province,
            parsedValue: address.province,
            normalizedValue: address.province,
            parserId: ID,
            parserVersion: VERSION,
            confidence: 0.95,
            authority: "coverage_summary",
          }),
        );
      }
      if (address.city) {
        assertions.push(
          assertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.city",
            rawText: address.city,
            parsedValue: address.city,
            normalizedValue: address.city,
            parserId: ID,
            parserVersion: VERSION,
            confidence: 0.95,
            authority: "coverage_summary",
          }),
        );
      }
      if (address.streetAddress) {
        assertions.push(
          assertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.streetAddress",
            rawText: address.streetAddress,
            parsedValue: address.streetAddress,
            normalizedValue: address.streetAddress,
            parserId: ID,
            parserVersion: VERSION,
            confidence: address.redacted ? 0.4 : 0.95,
            authority: "coverage_summary",
          }),
        );
      }

      // Look for a package solution amount such as "$3 - Million Solution™: ... $3,000,000"
      let packageAmountCents: number | undefined;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/million\s+solution/i.test(line)) {
          const nextLines = lines.slice(i + 1, i + 6).join(" ");
          const m = nextLines.match(/\$([\d,]+(?:\.\d{2})?)/);
          if (m) packageAmountCents = parseMoneyCents(m[0]) ?? undefined;
        }
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const covMatch = line.match(/Coverage\s+([A-Z])\s*-\s*(.+?):\s*(.+)/i);
        if (covMatch) {
          const label = covMatch[2].trim();
          const rawValue = covMatch[3].trim();
          const amount = parseMoneyCents(rawValue);
          const included = rawValue.toLowerCase() === "included";
          const fieldPath = fieldForCoverageLabel(label);
          if (fieldPath === "property.dwellingLimitCents" && included && packageAmountCents) {
            // Package solution where dwelling is "Included" under a global limit.
            assertions.push(
              assertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath,
                rawText: line,
                parsedValue: packageAmountCents,
                normalizedValue: packageAmountCents,
                parserId: ID,
                parserVersion: VERSION,
                confidence: 0.9,
                authority: "coverage_summary",
              }),
            );
            continue;
          }
          if (fieldPath && (amount !== null || included)) {
            assertions.push(
              assertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath,
                rawText: line,
                parsedValue: amount ?? included,
                normalizedValue: amount ?? included,
                parserId: ID,
                parserVersion: VERSION,
                confidence: amount !== null ? 0.95 : 0.7,
                authority: "coverage_summary",
              }),
            );
          }
        }

        if (line.toLowerCase().startsWith("base deductible")) {
          const next = lines[i + 1]?.trim();
          const val = parseMoneyCents(next ?? "");
          if (val !== null) {
            assertions.push(
              assertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath: "property.baseDeductibleCents",
                rawText: next,
                parsedValue: val,
                normalizedValue: val,
                parserId: ID,
                parserVersion: VERSION,
                confidence: 0.9,
                authority: "coverage_summary",
              }),
            );
          }
        }

        if (/wind.*hail.*deductible/i.test(line)) {
          const next = lines[i + 1]?.trim();
          const val = parseMoneyCents(next ?? "");
          if (val !== null) {
            assertions.push(
              assertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath: "property.windHailDeductibleCents",
                rawText: next,
                parsedValue: val,
                normalizedValue: val,
                parserId: ID,
                parserVersion: VERSION,
                confidence: 0.9,
                authority: "coverage_summary",
              }),
            );
          }
        }
      }
    }
  }

  if (occupancy) {
    assertions.push(
      assertion({
        documentId: document.documentId,
        pageNumber: 1,
        entityScope: "property",
        fieldPath: "property.occupancy",
        rawText: occupancy,
        parsedValue: occupancy,
        normalizedValue: occupancy,
        parserId: ID,
        parserVersion: VERSION,
        confidence: 0.95,
        authority: "renewal_overview",
      }),
    );
  }

  const { selected, conflicts } = resolveByAuthority(assertions);

  const postal = selected["property.postalCode"]?.normalizedValue as string | undefined;
  const city = selected["property.city"]?.normalizedValue as string | undefined;
  const province = selected["property.province"]?.normalizedValue as string | undefined;
  const street = selected["property.streetAddress"]?.normalizedValue as string | undefined;
  const occ = (selected["property.occupancy"]?.normalizedValue as string) ?? "unknown";

  const policyNumber = selected["policy.policyNumber"]?.normalizedValue as string | undefined;
  const addressRedacted = !street || /^[NSWE]?$/i.test(street);
  const policyRedacted = policyNumber === "0000";

  const identityFingerprint = normalizeAddress(
    `${street ?? ""} ${city ?? ""} ${province ?? ""} ${postal ?? ""}`,
  );
  const displayLabel = `${city ?? ""} ${province ?? ""} ${postal ?? ""}`.trim();

  let matchClassification: string;
  if (policyRedacted) {
    matchClassification = "new_identity_confirmation_required";
  } else if (occ === "rental" && postal) {
    matchClassification = "new";
  } else if (occ === "principal_residence" && addressRedacted) {
    matchClassification = "new_identity_confirmation_required";
  } else {
    matchClassification = "new";
  }

  const assetAssertions = [
    {
      assetType: "property" as const,
      identityFingerprint,
      displayLabel,
      matchClassification: matchClassification as ParsedAssetAssertion["matchClassification"],
      occupancy: occ as ParsedAssetAssertion["occupancy"],
      assertions: selectedValues(selected),
    },
  ];

  return {
    classification: "home_policy_renewal",
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

function normalizeAddress(input: string): string {
  return input
    .toUpperCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bSTREET\b/g, "ST")
    .replace(/\bAVENUE\b/g, "AVE")
    .replace(/\bDRIVE\b/g, "DR")
    .replace(/\bROAD\b/g, "RD")
    .replace(/\bCOURT\b/g, "CT")
    .replace(/\bNORTH\b/g, "N")
    .replace(/\bSOUTH\b/g, "S")
    .replace(/\bEAST\b/g, "E")
    .replace(/\bWEST\b/g, "W")
    .trim();
}
