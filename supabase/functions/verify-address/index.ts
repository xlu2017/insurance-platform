const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const PHOTON_URL = "https://photon.komoot.io/api";

interface AddressSuggestion {
  displayName: string;
  latitude: number;
  longitude: number;
  source: string;
  address?: Record<string, string>;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: Record<string, string>;
}

interface PhotonResult {
  features: Array<{
    properties: {
      name?: string;
      housenumber?: string;
      street?: string;
      city?: string;
      state?: string;
      country?: string;
      postcode?: string;
    };
    geometry: { coordinates: [number, number] };
  }>;
}

interface OpenCageResult {
  formatted: string;
  geometry: { lat: number; lng: number };
  components?: Record<string, string>;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stripPostalCode(displayName: string): string {
  // Remove Canadian-style postal codes (A1A 1A1 or A1A-1A1 or A1A1A1)
  const canadian = /,\s*[A-Za-z]\d[A-Za-z][\s-]?\d[A-Za-z]\d(?=\s*,|$)/g;
  // Remove US-style ZIP codes (12345 or 12345-6789)
  const usZip = /,\s*\d{5}(-\d{4})?(?=\s*,|$)/g;
  return displayName
    .replace(canadian, "")
    .replace(usZip, "")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*$/, "")
    .trim();
}

function stripLeadingNonLetters(displayName: string): string {
  const firstLetter = displayName.search(/[A-Za-z]/);
  if (firstLetter <= 0) return displayName;
  return displayName
    .slice(firstLetter)
    .replace(/^[\s,]+/, "")
    .trim();
}

function normalizeSuggestion(
  displayName: string,
  latitude: number,
  longitude: number,
  source: string,
  address?: Record<string, string>,
): AddressSuggestion {
  return {
    displayName: stripLeadingNonLetters(
      stripPostalCode(displayName.replace(/,\s*Earth$/, "")).trim(),
    ),
    latitude,
    longitude,
    source,
    address,
  };
}

function nominatimHeaders() {
  return {
    "User-Agent": "Mozilla/5.0 (compatible; InsuranceAutopilot/1.0; +https://example.com)",
    Accept: "application/json",
    Referer: "https://example.com/",
  };
}

async function nominatimSearch(query: string, limit: number): Promise<AddressSuggestion[]> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "ca");

  const response = await fetch(url.toString(), { headers: nominatimHeaders() });
  if (!response.ok) {
    throw new Error(`Nominatim responded ${response.status}`);
  }
  const results = (await response.json()) as NominatimResult[];
  return results.map((r) =>
    normalizeSuggestion(r.display_name, Number(r.lat), Number(r.lon), "nominatim", r.address),
  );
}

function photonDisplayName(properties: PhotonResult["features"][number]["properties"]): string {
  const parts = [
    properties.housenumber,
    properties.name,
    properties.street,
    properties.city,
    properties.state,
    properties.country,
    properties.postcode,
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts.join(", ");
}

async function photonSearch(query: string, limit: number): Promise<AddressSuggestion[]> {
  const url = new URL(PHOTON_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  // Restrict results to a bounding box that roughly covers Canada
  url.searchParams.set("bbox", "-141.0,41.0,-52.0,84.0");

  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Photon responded ${response.status}`);
  }
  const data = (await response.json()) as PhotonResult;
  return (data.features ?? []).map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    return normalizeSuggestion(photonDisplayName(f.properties), lat, lon, "photon", {
      house_number: f.properties.housenumber ?? "",
      road: f.properties.name ?? f.properties.street ?? "",
      city: f.properties.city ?? "",
      state: f.properties.state ?? "",
      postcode: f.properties.postcode ?? "",
      country: f.properties.country ?? "",
    });
  });
}

async function openCageSearch(query: string, limit: number): Promise<AddressSuggestion[]> {
  const apiKey = Deno.env.get("OPEN_CAGE_API_KEY");
  if (!apiKey) return [];
  const url = new URL("https://api.opencagedata.com/geocode/v1/json");
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("countrycode", "ca");

  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`OpenCage responded ${response.status}`);
  }
  const data = (await response.json()) as { results?: OpenCageResult[] };
  return (data.results ?? []).map((r) =>
    normalizeSuggestion(r.formatted, r.geometry.lat, r.geometry.lng, "open_cage", r.components),
  );
}

function isCanadianSuggestion(s: AddressSuggestion): boolean {
  const country = s.address?.country?.toLowerCase() ?? "";
  const countryCode = (s.address?.country_code ?? "").toLowerCase();
  return country === "canada" || countryCode === "ca";
}

function dedupeSuggestions(suggestions: AddressSuggestion[], limit: number): AddressSuggestion[] {
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const s of suggestions) {
    const key = `${s.latitude.toFixed(5)},${s.longitude.toFixed(5)}|${s.displayName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function extractLeadingNumericPrefix(query: string): string {
  // Capture the leading numeric token(s), allowing spaces and hyphens, e.g. "4015" or "4015-104"
  const match = query.match(/[0-9](?:[0-9\s-]*[0-9])?/);
  return match?.[0].trim() ?? "";
}

function prependHouseNumber(suggestion: AddressSuggestion, prefix: string): AddressSuggestion {
  if (!prefix) return suggestion;
  if (suggestion.displayName.toLowerCase().startsWith(prefix.toLowerCase())) return suggestion;
  return {
    ...suggestion,
    displayName: `${prefix} ${suggestion.displayName}`,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization header" }, 401);
  }

  let body: { q?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  const query = typeof body.q === "string" ? body.q.trim() : "";
  if (!query) {
    return jsonResponse({ error: "Address query is required" }, 400);
  }
  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 10);

  const settled = await Promise.allSettled([
    nominatimSearch(query, limit),
    photonSearch(query, limit),
    openCageSearch(query, limit),
  ]);

  const all: AddressSuggestion[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") {
      all.push(...r.value);
    }
  }

  const prefix = extractLeadingNumericPrefix(query);
  const merged = dedupeSuggestions(all.filter(isCanadianSuggestion), limit).map((s) =>
    prependHouseNumber(s, prefix),
  );
  return jsonResponse({
    found: merged.length > 0,
    query,
    results: merged,
    result: merged[0] ?? null,
  });
});
