import { DIRECTION_MAP, STREET_TYPE_MAP, UNIT_MAP } from "./address-maps.ts";

export interface ParsedAddress {
  country: string | null;
  civicNumber: string | null;
  streetName: string | null;
  canonicalStreetType: string | null;
  predirectional: string | null;
  postdirectional: string | null;
  unitType: string | null;
  unitNumber: string | null;
  municipality: string | null;
  region: string | null;
  postalCode: string | null;
  displayName: string;
  originalInput: string;
}

const POSTAL_CODE_REGEX = /[A-Za-z]\d[A-Za-z][\s-]?\d[A-Za-z]\d|\d{5}(-\d{4})?/g;

function normalizeToken(token: string): string {
  return token
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/^[.,]+|[.,]+$/g, "")
    .trim();
}

function tokenize(text: string): string[] {
  return text
    .split(/[\s\/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function expandContractions(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (lower === "st.") {
      out.push("st");
    } else if (lower === "ave.") {
      out.push("ave");
    } else if (lower === "dr.") {
      out.push("dr");
    } else if (lower === "blvd.") {
      out.push("blvd");
    } else if (lower === "no." || lower === "no") {
      out.push("no");
    } else if (t.startsWith("#") && t.length > 1) {
      out.push("#", t.slice(1));
    } else {
      out.push(t);
    }
  }
  return out;
}

function stripPostalCodes(text: string): { text: string; postalCodes: string[] } {
  const postalCodes: string[] = [];
  let cleaned = text.replace(POSTAL_CODE_REGEX, (match) => {
    postalCodes.push(match.replace(/\s+/g, " ").trim().toUpperCase());
    return "";
  });
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return { text: cleaned, postalCodes };
}

interface StreetParse {
  civicNumber: string | null;
  unitType: string | null;
  unitNumber: string | null;
  predirectional: string | null;
  streetName: string | null;
  canonicalStreetType: string | null;
  postdirectional: string | null;
}

function isNumericToken(t: string): boolean {
  return /^\d+([\-/]\d+)?$/.test(t);
}

function parseStreetLine(line: string): StreetParse {
  const { text: cleaned } = stripPostalCodes(line);
  let tokens = tokenize(cleaned);
  tokens = expandContractions(tokens);

  let civicNumber: string | null = null;
  let unitType: string | null = null;
  let unitNumber: string | null = null;

  // Civic number at the start, possibly hyphenated with unit (e.g. 4015-104)
  if (tokens.length > 0 && isNumericToken(tokens[0])) {
    const first = tokens.shift()!;
    if (first.includes("-")) {
      const [house, unit] = first.split("-");
      civicNumber = house;
      unitNumber = unit;
      unitType = "UNIT";
    } else {
      civicNumber = first;
    }
  }

  // Unit designators (APT 4, SUITE #4, NO 4, #4, etc.)
  for (let i = 0; i < tokens.length - 1; i++) {
    const raw = tokens[i];
    const norm = normalizeToken(raw);
    const next = tokens[i + 1];
    const nextNorm = normalizeToken(next);

    if (norm === "#" || norm === "NO") {
      if (/^\d+$/.test(nextNorm) || next.startsWith("#")) {
        unitType = unitType ?? "UNIT";
        unitNumber = next.replace(/^#/, "").trim();
        tokens.splice(i, 2);
        i--;
        continue;
      }
    }

    if (UNIT_MAP[norm] && /^\d+$/.test(nextNorm)) {
      unitType = UNIT_MAP[norm];
      unitNumber = next;
      tokens.splice(i, 2);
      i--;
    }
  }

  // Predirectional at the start (e.g. "NW 8 Street")
  let predirectional: string | null = null;
  if (tokens.length > 0) {
    const first = normalizeToken(tokens[0]);
    if (DIRECTION_MAP[first] && !STREET_TYPE_MAP[first] && tokens.length > 1) {
      predirectional = DIRECTION_MAP[first];
      tokens.shift();
    }
  }

  // Postdirectional at the end (e.g. "8 Pine Dr NW")
  let postdirectional: string | null = null;
  if (tokens.length > 0) {
    const last = normalizeToken(tokens[tokens.length - 1]);
    if (DIRECTION_MAP[last]) {
      postdirectional = DIRECTION_MAP[last];
      tokens.pop();
    }
  }

  // Suffix street type (e.g. "Drive", "Dr", "St", "Trail")
  let canonicalStreetType: string | null = null;
  if (tokens.length > 0) {
    const last = normalizeToken(tokens[tokens.length - 1]);
    if (STREET_TYPE_MAP[last]) {
      canonicalStreetType = STREET_TYPE_MAP[last];
      tokens.pop();
    }
  }

  // Preposed street type for French-style addresses (e.g. "10 rue Principale O")
  if (!canonicalStreetType && tokens.length > 1) {
    const first = normalizeToken(tokens[0]);
    const last = normalizeToken(tokens[tokens.length - 1]);
    if (STREET_TYPE_MAP[first] && !STREET_TYPE_MAP[last]) {
      canonicalStreetType = STREET_TYPE_MAP[first];
      tokens.shift();
    }
  }

  const streetName = tokens.length > 0 ? tokens.join(" ") : null;

  return {
    civicNumber,
    unitType,
    unitNumber,
    predirectional,
    streetName,
    canonicalStreetType,
    postdirectional,
  };
}

function inferCountry(parts: string[]): string | null {
  for (const p of parts) {
    const norm = normalizeToken(p);
    if (norm === "CANADA" || norm === "CA") return "Canada";
    if (
      norm === "UNITED STATES" ||
      norm === "USA" ||
      norm === "US" ||
      norm === "UNITED STATES OF AMERICA"
    ) {
      return "United States";
    }
  }
  return null;
}

function splitAddressParts(raw: string): { streetLine: string; rest: string[] } {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const streetLine = parts[0] ?? raw;
  return { streetLine, rest: parts.slice(1) };
}

function cleanRegion(part: string): string | null {
  const norm = normalizeToken(part);
  if (norm.length === 0 || ["CANADA", "UNITED STATES", "USA", "US", "CA"].includes(norm)) {
    return null;
  }
  // common abbreviations to full names could go here; for now keep original
  return part.trim();
}

function cleanMunicipality(part: string): string | null {
  const trimmed = part.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseAddress(
  raw: string,
  components?: Record<string, string | undefined>,
): ParsedAddress {
  const { text: withoutPostal, postalCodes } = stripPostalCodes(raw);
  const { streetLine, rest } = splitAddressParts(withoutPostal);
  const parsedStreet = parseStreetLine(streetLine);

  let municipality: string | null = null;
  let region: string | null = null;
  let country: string | null = null;

  if (components) {
    municipality = components.city ?? components.town ?? components.village ?? null;
    region = components.state ?? components.province ?? null;
    country = components.country ?? null;
  }

  if (!municipality && rest.length > 0) municipality = cleanMunicipality(rest[0]);
  if (!region && rest.length > 1) region = cleanRegion(rest[1]);
  if (!country && rest.length > 2) country = cleanRegion(rest[2]) ?? inferCountry(rest);
  if (!country) country = inferCountry(rest) ?? components?.country ?? null;

  const postalCode = postalCodes[0] ?? components?.postcode ?? components?.postal_code ?? null;

  const displayName = buildDisplayName({
    ...parsedStreet,
    municipality,
    region,
    country,
    postalCode,
  });

  return {
    ...parsedStreet,
    municipality,
    region,
    country,
    postalCode,
    displayName,
    originalInput: raw,
  };
}

interface DisplayParts {
  civicNumber: string | null;
  unitType: string | null;
  unitNumber: string | null;
  predirectional: string | null;
  streetName: string | null;
  canonicalStreetType: string | null;
  postdirectional: string | null;
  municipality: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function buildDisplayName(parts: DisplayParts): string {
  const streetParts: string[] = [];
  if (parts.civicNumber) streetParts.push(parts.civicNumber);
  if (parts.predirectional) streetParts.push(parts.predirectional);
  if (parts.unitType && parts.unitNumber) {
    streetParts.push(`${titleCase(parts.unitType)} ${parts.unitNumber}`);
  }
  if (parts.streetName) streetParts.push(parts.streetName);
  if (parts.canonicalStreetType) streetParts.push(titleCase(parts.canonicalStreetType));
  if (parts.postdirectional) streetParts.push(parts.postdirectional);

  const segments: string[] = [];
  if (streetParts.length > 0) segments.push(streetParts.join(" "));
  if (parts.municipality) segments.push(parts.municipality);
  if (parts.region) segments.push(parts.region);
  if (parts.country) segments.push(parts.country);
  if (parts.postalCode) segments.push(parts.postalCode);

  return segments.join(", ");
}
