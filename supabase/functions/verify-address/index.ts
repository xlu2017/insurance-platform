import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing authorization header" }, 401);
  }

  let body: { q?: string } = {};
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

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; InsuranceAutopilot/1.0; +https://example.com)",
        Accept: "application/json",
        Referer: "https://example.com/",
      },
    });
    if (!response.ok) {
      return jsonResponse({ error: `Address service responded ${response.status}` }, 502);
    }
    const results = (await response.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      address?: Record<string, string>;
    }>;
    const formatted = results.map((r) => ({
      displayName: r.display_name,
      latitude: Number(r.lat),
      longitude: Number(r.lon),
      address: r.address,
    }));
    return jsonResponse({
      found: formatted.length > 0,
      query,
      results: formatted,
      result: formatted[0] ?? null,
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Address lookup failed" },
      502,
    );
  }
});
