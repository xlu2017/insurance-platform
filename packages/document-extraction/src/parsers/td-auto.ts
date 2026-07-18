import type {
  AuthorityLevel,
  ExtractedCoveragePresence,
  ExtractedFactAssertion,
  ExtractedPdf,
  ParsedAssetAssertion,
  ParsedInsuranceDocument,
  ParsedPolicyNotice,
} from "../types.ts";
import { assertionId } from "./ids.ts";
import { normalizeVin, parseDateIso, parseMoneyCents, splitLines } from "./helpers.ts";
import { resolveByAuthority, selectedValues } from "./resolve.ts";

const ID = "TdSecurityNationalAlbertaAutoRenewalParserV1";
const VERSION = "1.0.0";

const KNOWN_MAKES = new Set([
  "MAZDA",
  "HONDA",
  "TOYOTA",
  "FORD",
  "CHEVROLET",
  "CHEVY",
  "BMW",
  "MERCEDES",
  "AUDI",
  "HYUNDAI",
  "KIA",
  "NISSAN",
  "VOLKSWAGEN",
  "VW",
  "JEEP",
  "DODGE",
  "CHRYSLER",
  "SUBARU",
  "LEXUS",
  "ACURA",
  "INFINITI",
  "LINCOLN",
  "GMC",
  "BUICK",
  "CADILLAC",
  "VOLVO",
  "LAND ROVER",
  "PORSCHE",
  "MINI",
  "SMART",
  "FIAT",
  "MITSUBISHI",
]);

const BODY_STYLE_TOKENS = new Set([
  "2DR",
  "3DR",
  "4DR",
  "5DR",
  "2D",
  "4D",
  "HATCHBACK",
  "SEDAN",
  "WAGON",
  "SUV",
  "TRUCK",
  "VAN",
  "CAB",
  "PICKUP",
  "COUPE",
  "CONVERTIBLE",
]);

export function canParseAuto(document: ExtractedPdf): boolean {
  const text = document.pages
    .map((p) => p.text)
    .join("\n")
    .toLowerCase();
  return (
    text.includes("security national insurance company") &&
    text.includes("auto insurance") &&
    text.includes("certificate of automobile insurance")
  );
}

function detectPageAuthority(text: string): AuthorityLevel {
  const t = text.toLowerCase();
  if (t.includes("certificate of automobile insurance")) return "insurance_certificate";
  if (t.includes("coverage summary page")) return "coverage_summary";
  if (t.includes("motor vehicle liability insurance card")) return "insurance_certificate";
  if (t.includes("invoice")) return "invoice";
  if (t.includes("overview of your") && t.includes("auto")) return "renewal_overview";
  if (t.includes("important information") || t.includes("notice")) return "notice";
  return "header_footer";
}

function nextNonEmpty(lines: string[], start: number, max = 5): string | null {
  for (let i = 1; i <= max && start + i < lines.length; i++) {
    const v = lines[start + i].trim();
    if (v.length > 0) return v;
  }
  return null;
}

function findAmountNear(lines: string[], start: number, maxDistance = 6): number | null {
  for (let i = 1; i <= maxDistance && start + i < lines.length; i++) {
    const line = lines[start + i].trim();
    const m = line.match(/\$([\d,]+(?:\.\d{2})?)/);
    if (m) {
      const val = parseMoneyCents(m[0]);
      if (val !== null) return val;
    }
  }
  return null;
}

function findVehicleUse(lines: string[], start: number): string | null {
  for (let i = 1; i <= 12 && start + i < lines.length; i++) {
    const t = lines[start + i].trim();
    if (t.length === 0) continue;
    if (/^(Pleasure|Business|Commute|Farm|To\/From Work|All Purpose)$/i.test(t)) {
      return t;
    }
  }
  return null;
}

function parseTermRange(text: string): { effective?: string; expiry?: string } {
  const m = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|-|–)\s*(\d{4}-\d{2}-\d{2})/);
  if (m) return { effective: m[1], expiry: m[2] };
  const m2 = text.match(/([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s*[-–]\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
  if (m2) {
    return {
      effective: parseDateIso(m2[1]) ?? undefined,
      expiry: parseDateIso(m2[2]) ?? undefined,
    };
  }
  return {};
}

function isPolicyNumberCandidate(value: string): boolean {
  const cleaned = value.replace(/\s/g, "");
  if (cleaned.length === 0) return false;
  if (!/^\d+$/.test(cleaned)) return false;
  if (cleaned.length < 5) return false;
  return true;
}

function findPolicyNumber(lines: string[], start: number): string | null {
  for (let i = 1; i <= 8 && start + i < lines.length; i++) {
    const v = lines[start + i].trim();
    if (v.length === 0) continue;
    if (isPolicyNumberCandidate(v)) return v.replace(/\s/g, "");
  }
  return null;
}

function splitModelString(
  input: string,
  knownMake?: string,
): {
  model: string;
  trim?: string;
  bodyStyle?: string;
} {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { model: input };

  let firstToken = tokens[0];
  let rest = tokens.slice(1);

  if (knownMake) {
    const makeUpper = knownMake.toUpperCase();
    const firstUpper = firstToken.toUpperCase();
    if (firstUpper === makeUpper && rest.length > 0) {
      firstToken = rest[0];
      rest = rest.slice(1);
    }
  }

  const bodyStyles: string[] = [];
  while (rest.length > 0 && BODY_STYLE_TOKENS.has(rest[rest.length - 1].toUpperCase())) {
    bodyStyles.unshift(rest.pop()!);
  }

  return {
    model: firstToken,
    trim: rest.length > 0 ? rest.join(" ") : undefined,
    bodyStyle: bodyStyles.length > 0 ? bodyStyles.join(" ") : undefined,
  };
}

function extractVehicleIdentity(lines: string[]): {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  bodyStyle?: string;
  vin?: string;
} | null {
  const fullText = lines.join("\n");

  // Primary certificate format: "2006 - MAZDA - MAZDA5 GT 5DR - VIN"
  const dashMatch = fullText.match(
    /(\d{4})\s*[-–]\s*([A-Z][A-Z0-9]*)\s*[-–]\s*(.+?)\s*[-–]\s*([A-HJ-NPR-Z0-9]{17})/i,
  );
  if (dashMatch) {
    const year = Number.parseInt(dashMatch[1], 10);
    const make = dashMatch[2].trim().toUpperCase();
    const modelString = dashMatch[3].trim();
    const vin = dashMatch[4].trim().toUpperCase();
    const normalized = normalizeVin(vin);
    if (normalized) {
      const { model, trim, bodyStyle } = splitModelString(modelString, make);
      return { year, make, model, trim, bodyStyle, vin: normalized.normalized };
    }
  }

  // Space-delimited single line: "2006 MAZDA MAZDA5 GT 5DR VIN"
  const spaceMatch = fullText.match(/(\d{4})\s+([A-Z][A-Z0-9]*)\s+(.+?)\s+([A-HJ-NPR-Z0-9]{17})/i);
  if (spaceMatch) {
    const year = Number.parseInt(spaceMatch[1], 10);
    const make = spaceMatch[2].trim().toUpperCase();
    const modelString = spaceMatch[3].trim();
    const vin = spaceMatch[4].trim().toUpperCase();
    const normalized = normalizeVin(vin);
    if (normalized) {
      const { model, trim, bodyStyle } = splitModelString(modelString, make);
      return { year, make, model, trim, bodyStyle, vin: normalized.normalized };
    }
  }

  // Pink card / multi-line format: model line, VIN line, year line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const vinMatch = line.match(/^([A-HJ-NPR-Z0-9]{17})$/);
    if (!vinMatch) continue;
    const vin = vinMatch[1].toUpperCase();
    const normalized = normalizeVin(vin);
    if (!normalized) continue;

    const candidates: string[] = [];
    if (i > 0) candidates.push(lines[i - 1].trim());
    if (i > 1) candidates.push(lines[i - 2].trim());
    if (i + 1 < lines.length) candidates.push(lines[i + 1].trim());

    let modelString: string | undefined;
    let make: string | undefined;
    let year: number | undefined;

    for (const c of candidates) {
      if (/^[A-Z][A-Z0-9\s]*(?:DR|SEDAN|HATCH|WAGON)?$/i.test(c) && c.length > 2) {
        modelString = c;
      }
      const yearMatch = c.match(/\b(\d{4})\b/);
      if (yearMatch) year = Number.parseInt(yearMatch[1], 10);
    }

    if (!modelString) continue;

    // Infer make from the model string if possible
    const firstToken = modelString.split(/\s+/)[0].toUpperCase();
    for (const known of KNOWN_MAKES) {
      if (firstToken.startsWith(known) && firstToken.length > known.length) {
        make = known;
        break;
      } else if (firstToken === known) {
        make = known;
        break;
      }
    }

    const { model, trim, bodyStyle } = splitModelString(modelString, make);
    return { year, make, model, trim, bodyStyle, vin: normalized.normalized };
  }

  return null;
}

function coverageStatusFromText(text: string): ExtractedCoveragePresence {
  const lower = text.toLowerCase();
  if (lower.includes("not covered") || lower.includes("not included")) return "not_included";
  if (lower.includes("not applicable")) return "not_applicable";
  if (lower.includes("included")) return "included";
  return "unknown";
}

function parsePhysicalDamageStatuses(
  lines: string[],
): Record<string, ExtractedCoveragePresence> | null {
  const text = lines.join("\n");
  if (!/All Perils/i.test(text) && !/Collision or Upset/i.test(text)) return null;

  // Find the "Limits and Amounts in Dollars" table row
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/Limits and Amounts in Dollars|Amount Deductible/i.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  const tokens: string[] = [];
  for (
    let i = start;
    i < lines.length && !/Premium in Dollars|Vehicle Premium|Endorsements/i.test(lines[i]);
    i++
  ) {
    const t = lines[i].trim();
    if (t.length > 0) tokens.push(t);
  }

  // Find the vehicle row beginning with "1"
  const rowStart = tokens.findIndex((t) => /^1$/.test(t));
  if (rowStart < 0 || rowStart + 6 >= tokens.length) return null;

  const statusTexts = tokens.slice(rowStart + 3, rowStart + 7);
  return {
    allPerils: coverageStatusFromText(statusTexts[0] ?? ""),
    collision: coverageStatusFromText(statusTexts[1] ?? ""),
    comprehensive: coverageStatusFromText(statusTexts[2] ?? ""),
    specifiedPerils: coverageStatusFromText(statusTexts[3] ?? ""),
  };
}

function extractNoticeKind(line: string, next: string): ParsedPolicyNotice["kind"] | null {
  const text = `${line} ${next}`.toLowerCase();
  if (
    text.includes("will change in the future") ||
    text.includes("will now appear") ||
    text.includes("will be eligible")
  ) {
    return "future_coverage_change";
  }
  if (
    text.includes("available to purchase") ||
    text.includes("contact us to add") ||
    text.includes("consider this coverage") ||
    text.includes("to purchase this coverage")
  ) {
    return "coverage_available_for_purchase";
  }
  if (text.includes("may be eligible")) return "eligibility_notice";
  if (
    text.includes("please contact us") ||
    text.includes("call us") ||
    text.includes("reach out to")
  ) {
    return "customer_action_required";
  }
  if (text.includes("if you do nothing") && text.includes("policy will renew"))
    return "renewal_information";
  if (text.includes("general description") || text.includes("this is not a complete description")) {
    return "general_explanation";
  }
  return null;
}

export async function parseAuto(document: ExtractedPdf): Promise<ParsedInsuranceDocument> {
  const allAssertions: ExtractedFactAssertion[] = [];
  const allNotices: ParsedPolicyNotice[] = [];
  const occurrenceIndex = new Map<string, number>();

  async function makeAssertion(
    fields: Omit<ExtractedFactAssertion, "id" | "parserId" | "parserVersion">,
  ): Promise<ExtractedFactAssertion> {
    const key = fields.fieldPath;
    const idx = occurrenceIndex.get(key) ?? 0;
    occurrenceIndex.set(key, idx + 1);
    const id = await assertionId({
      fileDigest: document.fileDigest,
      parserId: ID,
      parserVersion: VERSION,
      pageNumber: fields.pageNumber,
      fieldPath: fields.fieldPath,
      occurrenceIndex: idx,
      normalizedValue: fields.normalizedValue,
    });
    return { id, parserId: ID, parserVersion: VERSION, ...fields };
  }

  for (const page of document.pages) {
    const lines = splitLines(page.text);
    const authority = detectPageAuthority(page.text);

    const identity = extractVehicleIdentity(lines);
    if (identity?.vin) {
      const { year, make, model, trim, bodyStyle, vin } = identity;
      if (year) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "vehicle",
            fieldPath: "vehicle.year",
            rawText: String(year),
            parsedValue: year,
            normalizedValue: year,
            confidence: 0.99,
            authority: "insurance_certificate",
          }),
        );
      }
      if (make) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "vehicle",
            fieldPath: "vehicle.make",
            rawText: make,
            parsedValue: make,
            normalizedValue: make.toUpperCase(),
            confidence: 0.99,
            authority: "insurance_certificate",
          }),
        );
      }
      if (model) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "vehicle",
            fieldPath: "vehicle.model",
            rawText: model,
            parsedValue: model,
            normalizedValue: model.toUpperCase(),
            confidence: 0.99,
            authority: "insurance_certificate",
          }),
        );
      }
      if (trim) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "vehicle",
            fieldPath: "vehicle.trim",
            rawText: trim,
            parsedValue: trim,
            normalizedValue: trim.toUpperCase(),
            confidence: 0.95,
            authority: "insurance_certificate",
          }),
        );
      }
      if (bodyStyle) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "vehicle",
            fieldPath: "vehicle.bodyStyle",
            rawText: bodyStyle,
            parsedValue: bodyStyle,
            normalizedValue: bodyStyle.toUpperCase(),
            confidence: 0.95,
            authority: "insurance_certificate",
          }),
        );
      }
      allAssertions.push(
        await makeAssertion({
          documentId: document.documentId,
          pageNumber: page.pageNumber,
          entityScope: "vehicle",
          fieldPath: "vehicle.vin",
          rawText: vin,
          parsedValue: vin,
          normalizedValue: vin,
          confidence: 0.99,
          authority: "insurance_certificate",
        }),
      );
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lower = line.toLowerCase();

      if (lower.includes("renewal term")) {
        const next = nextNonEmpty(lines, i);
        const after = nextNonEmpty(lines, i + 1);
        const range = parseTermRange(`${next ?? ""} ${after ?? ""}`);
        if (range.effective) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.effectiveDate",
              rawText: `${next ?? ""} ${after ?? ""}`,
              parsedValue: range.effective,
              normalizedValue: range.effective,
              confidence: 0.9,
              authority,
            }),
          );
        }
        if (range.expiry) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.expiryDate",
              rawText: `${next ?? ""} ${after ?? ""}`,
              parsedValue: range.expiry,
              normalizedValue: range.expiry,
              confidence: 0.9,
              authority,
            }),
          );
        }
      }

      if (lower.startsWith("policy number") || lower.startsWith("policy no")) {
        const val = findPolicyNumber(lines, i);
        if (val) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.policyNumber",
              rawText: val,
              parsedValue: val,
              normalizedValue: val,
              confidence: 0.9,
              authority,
            }),
          );
        }
      }

      if (lower.startsWith("effective date")) {
        const val = nextNonEmpty(lines, i);
        if (val && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.effectiveDate",
              rawText: val,
              parsedValue: val.trim(),
              normalizedValue: val.trim(),
              confidence: 0.95,
              authority: "insurance_certificate",
            }),
          );
        }
      }

      if (lower.startsWith("expiry date")) {
        const val = nextNonEmpty(lines, i);
        if (val && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "policy",
              fieldPath: "policy.expiryDate",
              rawText: val,
              parsedValue: val.trim(),
              normalizedValue: val.trim(),
              confidence: 0.95,
              authority: "insurance_certificate",
            }),
          );
        }
      }

      if (
        lower.includes("total policy term insurance premium") ||
        lower.includes("policy term insurance premium")
      ) {
        const m = line.match(/\$([\d,]+(?:\.\d{2})?)/);
        if (m) {
          const cents = parseMoneyCents(m[0]);
          if (cents !== null) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "premium",
                fieldPath: "policy.annualPremiumCents",
                rawText: m[0],
                parsedValue: cents,
                normalizedValue: cents,
                confidence: 0.9,
                authority,
              }),
            );
          }
        }
      }

      if (
        lower.includes("use of") &&
        (lower.includes("vehicle") || lines[i + 1]?.toLowerCase().includes("vehicle"))
      ) {
        const use = findVehicleUse(lines, i);
        if (use) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "vehicle",
              fieldPath: "vehicle.vehicleUse",
              rawText: use,
              parsedValue: use,
              normalizedValue: use.toUpperCase(),
              confidence: 0.85,
              authority,
            }),
          );
        }
      }

      if (
        lower.includes("third party liability") ||
        (lower.includes("liability") && line.includes("$"))
      ) {
        const m = line.match(/\$([\d,]+(?:\.\d{2})?)/);
        if (m) {
          const cents = parseMoneyCents(m[0]);
          if (cents !== null && cents > 5000000) {
            // avoid small premium amounts
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath: "vehicle.thirdPartyLiabilityLimitCents",
                rawText: m[0],
                parsedValue: cents,
                normalizedValue: cents,
                confidence: 0.95,
                authority,
                coveragePresence: "included",
              }),
            );
          }
        }
      }

      if (lower.includes("direct compensation")) {
        const val = findAmountNear(lines, i);
        if (val !== null) {
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "coverage",
              fieldPath: "vehicle.directCompensationDeductibleCents",
              rawText: String(val),
              parsedValue: val,
              normalizedValue: val,
              confidence: 0.9,
              authority,
            }),
          );
        }
      }

      if (lower.includes("family protection")) {
        const searchText = lines.slice(i, i + 4).join(" ");
        const m = searchText.match(/\$([\d,]+(?:\.\d{2})?)/);
        const included =
          lower.includes("included") ||
          (m && parseMoneyCents(m[0]) !== null && parseMoneyCents(m[0])! > 0);
        if (included) {
          const premiumCents = m ? parseMoneyCents(m[0]) : null;
          allAssertions.push(
            await makeAssertion({
              documentId: document.documentId,
              pageNumber: page.pageNumber,
              entityScope: "coverage",
              fieldPath: "vehicle.familyProtectionIncluded",
              rawText: m ? m[0] : "included",
              parsedValue: premiumCents ?? "included",
              normalizedValue: premiumCents ?? "included",
              confidence: 0.9,
              authority,
              coveragePresence: "included",
            }),
          );
        }
      }
    }

    // Physical damage coverage statuses from the certificate table
    const physical = parsePhysicalDamageStatuses(lines);
    if (physical) {
      const map: [keyof typeof physical, string][] = [
        ["allPerils", "vehicle.allPerilsIncluded"],
        ["collision", "vehicle.collisionIncluded"],
        ["comprehensive", "vehicle.comprehensiveIncluded"],
        ["specifiedPerils", "vehicle.specifiedPerilsIncluded"],
      ];
      for (const [key, fieldPath] of map) {
        const presence = physical[key];
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "coverage",
            fieldPath,
            rawText: presence,
            parsedValue: presence,
            normalizedValue: presence,
            confidence: 0.9,
            authority,
            coveragePresence: presence,
          }),
        );
      }
    }

    // Fallback per-coverage status when table not found
    const coverageKeywords: { label: string; fieldPath: string }[] = [
      { label: "all perils", fieldPath: "vehicle.allPerilsIncluded" },
      { label: "collision or upset", fieldPath: "vehicle.collisionIncluded" },
      { label: "comprehensive", fieldPath: "vehicle.comprehensiveIncluded" },
      { label: "specified perils", fieldPath: "vehicle.specifiedPerilsIncluded" },
    ];
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      for (const { label, fieldPath } of coverageKeywords) {
        if (lower.includes(label)) {
          const nextText = lines.slice(i, i + 4).join(" ");
          const presence = coverageStatusFromText(nextText);
          // Avoid adding if table already provided it for this fieldPath on this page
          const already = allAssertions.some(
            (a) => a.fieldPath === fieldPath && a.pageNumber === page.pageNumber,
          );
          if (!already) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath,
                rawText: nextText,
                parsedValue: presence,
                normalizedValue: presence,
                confidence: 0.85,
                authority,
                coveragePresence: presence,
              }),
            );
          }
        }
      }
    }

    // Notice extraction
    if (authority !== "insurance_certificate" && authority !== "coverage_summary") {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const next = lines[i + 1]?.trim() ?? "";
        const kind = extractNoticeKind(line, next);
        if (kind) {
          allNotices.push({
            kind,
            text: line,
            pageNumber: page.pageNumber,
            authority,
          });
        }
      }
    }
  }

  const { selected, conflicts } = resolveByAuthority(allAssertions);

  const vin = selected["vehicle.vin"]?.normalizedValue as string | undefined;
  const year = selected["vehicle.year"]?.normalizedValue as number | undefined;
  const make = selected["vehicle.make"]?.normalizedValue as string | undefined;
  const model = selected["vehicle.model"]?.normalizedValue as string | undefined;
  const trim = selected["vehicle.trim"]?.normalizedValue as string | undefined;
  const bodyStyle = selected["vehicle.bodyStyle"]?.normalizedValue as string | undefined;

  const identityFingerprint = vin ? vin.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
  const displayLabel =
    [year ? String(year) : undefined, make, model, trim, bodyStyle].filter(Boolean).join(" ") ||
    identityFingerprint.slice(-4);

  const assetAssertions: ParsedAssetAssertion[] = [
    {
      assetType: "vehicle",
      identityFingerprint,
      displayLabel,
      matchClassification: vin ? "new" : "new_identity_confirmation_required",
      occupancy: undefined,
      assertions: selectedValues(selected),
    },
  ];

  const buildPolicyTerms = (s: Record<string, ExtractedFactAssertion>) => [
    {
      effectiveDate: s["policy.effectiveDate"]?.normalizedValue as string | undefined,
      expiryDate: s["policy.expiryDate"]?.normalizedValue as string | undefined,
      policyNumber: s["policy.policyNumber"]?.normalizedValue as string | undefined,
      annualPremiumCents: s["policy.annualPremiumCents"]?.normalizedValue as number | undefined,
    },
  ];

  const selectedMap: Record<string, string> = {};
  for (const [path, a] of Object.entries(selected)) {
    selectedMap[path] = a.id;
  }

  const result: ParsedInsuranceDocument = {
    classification: "auto_policy_renewal",
    insurer: { name: "Security National Insurance Company" },
    agency: { name: "TD Insurance Direct Agency Inc." },
    policyTerms: buildPolicyTerms(selected),
    assertions: allAssertions,
    selectedAssertions: selectedMap,
    conflicts,
    notices: allNotices,
    assetAssertions,
    coverageAssertions: selectedValues(selected),
    parserId: ID,
    parserVersion: VERSION,
    pageCount: document.pageCount,
  };

  return result;
}
