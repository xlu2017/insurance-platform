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

function normalizeSuggestion(
  displayName: string,
  latitude: number,
  longitude: number,
  source: string,
  address?: Record<string, string>,
): AddressSuggestion {
  return {
    displayName: displayName.replace(/,\s*Earth$/, ""),
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

  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`OpenCage responded ${response.status}`);
  }
  const data = (await response.json()) as { results?: OpenCageResult[] };
  return (data.results ?? []).map((r) =>
    normalizeSuggestion(r.formatted, r.geometry.lat, r.geometry.lng, "open_cage", r.components),
  );
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

  const merged = dedupeSuggestions(all, limit);
  return jsonResponse({
    found: merged.length > 0,
    query,
    results: merged,
    result: merged[0] ?? null,
  });
});
