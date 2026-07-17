import type {
  AddressRole,
  AuthorityLevel,
  ExtractedCoveragePresence,
  ExtractedFactAssertion,
  ExtractedPdf,
  ParsedAssetAssertion,
  ParsedInsuranceDocument,
  ParsedPolicyNotice,
} from "../types.ts";
import { assertionId } from "./ids.ts";
import {
  normalizePostalCode,
  normalizeProvince,
  parseDateIso,
  parseMoneyCents,
  splitLines,
} from "./helpers.ts";
import { resolveByAuthority, selectedValues } from "./resolve.ts";

const ID = "TdSecurityNationalHomeRenewalParserV1";
const VERSION = "1.0.0";

export function canParseHome(document: ExtractedPdf): boolean {
  const text = document.pages
    .map((p) => p.text)
    .join("\n")
    .toLowerCase();
  return (
    text.includes("security national insurance company") &&
    text.includes("home insurance") &&
    (text.includes("your rental home package") || text.includes("your homeowner package"))
  );
}

const directionTokens = new Set(["N", "S", "E", "W", "NW", "NE", "SW", "SE"]);

function detectPageAuthority(text: string): AuthorityLevel {
  const t = text.toLowerCase();
  const hasCoverageLines = /coverage\s+[a-z]\s*[-–]\s*.+?:/i.test(text);
  const hasPackageSolution = /million\s+solution/i.test(text);
  const isPackageOrSummary =
    t.includes("coverage summary page") ||
    t.includes("your rental home package") ||
    t.includes("your homeowner package");
  if (
    t.includes("insurance issued by") ||
    t.includes("certificate of insurance") ||
    t.includes("insurance certificate")
  ) {
    return "insurance_certificate";
  }
  if (isPackageOrSummary && (hasCoverageLines || hasPackageSolution)) return "coverage_summary";
  if (t.includes("endorsement")) return "active_endorsement";
  if (t.includes("invoice")) return "invoice";
  if (t.includes("overview of your") && t.includes("renewal")) return "renewal_overview";
  if (
    t.includes("important information") ||
    t.includes("updates to your coverage") ||
    t.includes("changes to your coverage")
  ) {
    return "notice";
  }
  if (t.includes("notice")) return "notice";
  return "header_footer";
}

function nextNonEmpty(lines: string[], start: number, max = 5): string | null {
  for (let i = 1; i <= max && start + i < lines.length; i++) {
    const v = lines[start + i].trim();
    if (v.length > 0) return v;
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

function isPolicyNumberCandidate(value: string): boolean {
  const cleaned = value.replace(/\s/g, "");
  if (cleaned.length === 0) return false;
  if (!/^\d+$/.test(cleaned)) return false;
  if (cleaned.length < 4) return false;
  return true;
}

function findPolicyNumber(lines: string[], start: number): string | null {
  for (let i = 1; i <= 4 && start + i < lines.length; i++) {
    const v = lines[start + i].trim();
    if (v.length === 0) continue;
    if (isPolicyNumberCandidate(v)) return v.replace(/\s/g, "");
  }
  return null;
}

function stripAddressRolePrefix(s: string): string {
  return s
    .replace(
      /^(?:YOUR\s+)?(?:RENTAL\s+HOME|HOMEOWNER(?:,\s*PRINCIPAL\s+RESIDENCE)?|PRINCIPAL\s+RESIDENCE)\s*(?:PACKAGE)?\s*[:\s-]+\s*/i,
      "",
    )
    .trim();
}

function parseAddressParts(text: string): {
  beforeCity: string;
  city: string;
  province: string;
  postalCode: string;
} | null {
  const m = text.match(
    /^(.*?)\s*,?\s*([A-Za-z][A-Za-z\s]{1,40}?)\s+(AB|BC|ON|QC)\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d)/i,
  );
  if (!m) return null;
  return {
    beforeCity: m[1].trim(),
    city: m[2].trim().replace(/,\s*$/, "").trim(),
    province: m[3].toUpperCase(),
    postalCode: m[4].toUpperCase().replace(/\s/g, ""),
  };
}

function isRedactedStreet(street: string | undefined): boolean {
  if (!street) return true;
  const cleaned = street.replace(/[^A-Za-z0-9]/g, " ").trim();
  if (cleaned.length < 2) return true;
  if (/placeholder|redacted|removed|xxxx|\*+|0000|•/.test(cleaned.toLowerCase())) return true;
  const tokens = cleaned.split(/\s+/).filter((w) => !directionTokens.has(w.toUpperCase()));
  if (tokens.length === 0) return true;
  const hasWord = tokens.some((w) => /^[A-Za-z]{2,}$/.test(w));
  const hasNumber = tokens.some((w) => /\d/.test(w));
  if (!hasWord && !hasNumber) return true;
  if (!hasWord) return true;
  return false;
}

function detectAddressRole(lines: string[], i: number): AddressRole | null {
  const prev = lines[i - 1]?.trim() ?? "";
  const lowerPrev = prev.toLowerCase();
  const lowerCurr = lines[i].toLowerCase();
  if (
    lowerPrev.includes("your rental home package") ||
    lowerCurr.startsWith("rental home") ||
    lowerPrev.startsWith("rental home")
  ) {
    return "insured_location";
  }
  if (
    lowerPrev.includes("your homeowner package") ||
    lowerCurr.startsWith("homeowner") ||
    lowerCurr.startsWith("principal residence") ||
    lowerPrev.startsWith("homeowner") ||
    lowerPrev.startsWith("principal residence")
  ) {
    return "insured_location";
  }
  if (lowerCurr.includes("mortgagee") || lowerPrev.includes("mortgagee"))
    return "mortgagee_address";
  if (lowerCurr.includes("payment") || lowerPrev.includes("payment")) return "payment_address";
  if (lowerCurr.includes("agency")) return "agency_address";
  if (i < 4) {
    const lookahead = lines.slice(i + 1, i + 6).join(" ");
    if (/Page\s+\d+\s+of/i.test(lookahead)) return "mailing_address";
  }
  return null;
}

function addressLabelOccupancy(
  role: AddressRole,
  line: string,
  prev?: string,
): "rental" | "principal_residence" | undefined {
  if (role !== "insured_location") return undefined;
  const sources = [line, prev ?? ""].map((s) => s.toLowerCase());
  for (const lower of sources) {
    if (lower.includes("rental home")) return "rental";
    if (lower.includes("homeowner") || lower.includes("principal residence"))
      return "principal_residence";
  }
  return undefined;
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

function coveragePresenceFromRest(rest: string, amount: number | null): ExtractedCoveragePresence {
  const lower = rest.toLowerCase();
  if (lower.includes("not covered") || lower.includes("not included")) return "not_included";
  if (lower.includes("not applicable")) return "not_applicable";
  if (lower.includes("included")) return "included";
  if (amount !== null && amount > 0) return "included";
  if (lower.includes("unknown") || lower.includes("not shown")) return "unknown";
  return "unknown";
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

export async function parseHome(document: ExtractedPdf): Promise<ParsedInsuranceDocument> {
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
    return {
      id,
      parserId: ID,
      parserVersion: VERSION,
      ...fields,
    };
  }

  for (const page of document.pages) {
    const lines = splitLines(page.text);
    const authority = detectPageAuthority(page.text);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lower = line.toLowerCase();

      if (lower.startsWith("renewal date")) {
        const val = nextNonEmpty(lines, i);
        if (val) {
          const date = parseDateIso(val);
          if (date) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "policy",
                fieldPath: "policy.renewalDate",
                rawText: val,
                parsedValue: date,
                normalizedValue: date,
                confidence: 0.9,
                authority,
              }),
            );
          }
        }
      }

      if (lower.startsWith("term of your coverage")) {
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
              confidence: 0.95,
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
              confidence: 0.95,
              authority,
            }),
          );
        }
      }

      if (lower.startsWith("policy number")) {
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
              confidence: val === "0000" ? 0.3 : 0.9,
              authority,
            }),
          );
        }
      }

      if (lower.includes("your term premium") || lower.includes("your total term premium")) {
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
    }

    // Address extraction
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const parsed = parseAddressParts(line);
      if (!parsed) continue;
      const role = detectAddressRole(lines, i);
      if (!role) continue;

      const streetRaw = stripAddressRolePrefix(parsed.beforeCity);
      const redacted = isRedactedStreet(streetRaw);
      const province = normalizeProvince(parsed.province);
      const postalCode = normalizePostalCode(parsed.postalCode);
      const city = parsed.city.toUpperCase() === "CALGARY" ? "Calgary" : parsed.city;

      if (postalCode) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.postalCode",
            rawText: parsed.postalCode,
            parsedValue: postalCode,
            normalizedValue: postalCode,
            confidence: redacted ? 0.5 : 0.95,
            authority,
            addressRole: role,
          }),
        );
      }
      if (province) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.province",
            rawText: parsed.province,
            parsedValue: province,
            normalizedValue: province,
            confidence: redacted ? 0.5 : 0.95,
            authority,
            addressRole: role,
          }),
        );
      }
      if (city) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.city",
            rawText: city,
            parsedValue: city,
            normalizedValue: city,
            confidence: redacted ? 0.5 : 0.95,
            authority,
            addressRole: role,
          }),
        );
      }
      if (streetRaw) {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.streetAddress",
            rawText: streetRaw,
            parsedValue: streetRaw,
            normalizedValue: streetRaw,
            confidence: redacted ? 0.4 : 0.95,
            authority,
            addressRole: role,
          }),
        );
      }

      const occupancy = addressLabelOccupancy(role, line, lines[i - 1]);
      if (occupancy && role === "insured_location") {
        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "property",
            fieldPath: "property.occupancy",
            rawText: occupancy,
            parsedValue: occupancy,
            normalizedValue: occupancy,
            confidence: 0.95,
            authority,
          }),
        );
      }
    }

    // Package solution amount (package limit) detection
    let packageLimitCents: number | undefined;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/million\s+solution/i.test(line)) {
        const nextText = lines.slice(i + 1, i + 6).join(" ");
        const m = nextText.match(/\$([\d,]+(?:\.\d{2})?)/);
        if (m) packageLimitCents = parseMoneyCents(m[0]) ?? undefined;
      }
    }

    // Coverage and deductible extraction
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lower = line.toLowerCase();

      const covMatch = line.match(/^Coverage\s+([A-Z])\s*[-–]\s*(.+?)\s*:\s*(.*)$/i);
      if (covMatch) {
        const label = covMatch[2].trim();
        const rest = covMatch[3].trim();
        const fieldPath = fieldForCoverageLabel(label);
        if (!fieldPath) continue;

        const amount = parseMoneyCents(rest);
        let presence = coveragePresenceFromRest(rest, amount);
        let value: unknown = amount;

        if (
          fieldPath === "property.dwellingLimitCents" &&
          packageLimitCents &&
          (presence === "included" || amount === null)
        ) {
          value = packageLimitCents;
          presence = "included";
        }

        if (amount !== null && amount > 0) {
          value = amount;
        } else if (presence === "included") {
          value = null;
        } else {
          value = null;
        }

        allAssertions.push(
          await makeAssertion({
            documentId: document.documentId,
            pageNumber: page.pageNumber,
            entityScope: "coverage",
            fieldPath,
            rawText: line,
            parsedValue: value,
            normalizedValue: value,
            confidence: 0.9,
            authority,
            coveragePresence: presence,
          }),
        );
      }

      if (lower.startsWith("base deductible")) {
        const next = nextNonEmpty(lines, i);
        if (next) {
          const val = parseMoneyCents(next);
          if (val !== null) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath: "property.baseDeductibleCents",
                rawText: next,
                parsedValue: val,
                normalizedValue: val,
                confidence: 0.9,
                authority,
              }),
            );
          }
        }
      }

      const windHailMatch =
        lower.match(/^wind\s*(?:and|&|\/)\s*hail\s*deductible/i) ||
        lower.match(/windstorm.*hail.*deductible/i);
      if (windHailMatch) {
        const next = nextNonEmpty(lines, i);
        if (next) {
          const val = parseMoneyCents(next);
          if (val !== null) {
            allAssertions.push(
              await makeAssertion({
                documentId: document.documentId,
                pageNumber: page.pageNumber,
                entityScope: "coverage",
                fieldPath: "property.windHailDeductibleCents",
                rawText: next,
                parsedValue: val,
                normalizedValue: val,
                confidence: 0.9,
                authority,
              }),
            );
          }
        }
      }

      if (lower.match(/^windstorm:/i) || lower.match(/^hail:/i)) {
        const searchText = lines.slice(i, i + 6).join(" ");
        const m = searchText.match(/Deductible:\s*\$([\d,]+(?:\.\d{2})?)/i);
        if (m) {
          const val = parseMoneyCents(m[0]);
          if (val !== null) {
            // Only add if a standalone wind/hail deductible is not already present for this page
            const already = allAssertions.some(
              (a) =>
                a.fieldPath === "property.windHailDeductibleCents" &&
                a.pageNumber === page.pageNumber,
            );
            if (!already) {
              allAssertions.push(
                await makeAssertion({
                  documentId: document.documentId,
                  pageNumber: page.pageNumber,
                  entityScope: "coverage",
                  fieldPath: "property.windHailDeductibleCents",
                  rawText: m[0],
                  parsedValue: val,
                  normalizedValue: val,
                  confidence: 0.85,
                  authority,
                }),
              );
            }
          }
        }
      }
    }

    // Notice extraction
    if (authority !== "coverage_summary" && authority !== "insurance_certificate") {
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

  const insuredLocationAssertions = selectedValues(selected).filter(
    (a) => a.addressRole === "insured_location",
  );
  const postalCode = selected["property.postalCode"]?.normalizedValue as string | undefined;
  const city = selected["property.city"]?.normalizedValue as string | undefined;
  const province = selected["property.province"]?.normalizedValue as string | undefined;
  const streetAddress = selected["property.streetAddress"]?.normalizedValue as string | undefined;
  const occupancy =
    (selected["property.occupancy"]?.normalizedValue as ParsedAssetAssertion["occupancy"]) ??
    "unknown";
  const policyNumber = selected["policy.policyNumber"]?.normalizedValue as string | undefined;

  const hasInsuredStreet = selectedValues(selected).some(
    (a) => a.fieldPath === "property.streetAddress" && a.addressRole === "insured_location",
  );
  const addressRedacted =
    !hasInsuredStreet ||
    insuredLocationAssertions.some(
      (a) =>
        a.fieldPath === "property.streetAddress" && isRedactedStreet(a.normalizedValue as string),
    );
  const policyRedacted = !policyNumber || policyNumber === "0000";

  const displayLabel = `${city ?? ""} ${province ?? ""} ${postalCode ?? ""}`.trim();
  const identityFingerprint =
    normalizeAddress(
      `${streetAddress ?? ""} ${city ?? ""} ${province ?? ""} ${postalCode ?? ""}`.trim(),
    ) ||
    normalizeAddress(
      `${occupancy} ${city ?? ""} ${province ?? ""} ${postalCode ?? ""} ${policyNumber ?? ""}`.trim(),
    );

  let matchClassification: ParsedAssetAssertion["matchClassification"] = "new";
  if (policyRedacted || (occupancy === "principal_residence" && addressRedacted)) {
    matchClassification = "new_identity_confirmation_required";
  }

  const assetAssertions: ParsedAssetAssertion[] = [
    {
      assetType: "property",
      identityFingerprint,
      displayLabel,
      matchClassification,
      occupancy,
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
    classification: "home_policy_renewal",
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
  };

  return result;
}
