const STREET_ABBREVIATIONS: Record<string, string> = {
  st: "street",
  str: "street",
  ave: "avenue",
  av: "avenue",
  dr: "drive",
  rd: "road",
  blvd: "boulevard",
  bl: "boulevard",
  hwy: "highway",
  hway: "highway",
};

export function normalizeSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeAddressQuery(input: string): string {
  const normalized = normalizeSearch(input);
  const tokens = normalized.split(" ").map((token) => STREET_ABBREVIATIONS[token] ?? token);
  return tokens.join(" ");
}

export function matchesSearch(searchText: string, query: string): boolean {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  if (queryTokens.length === 0) return true;

  const normalizedSearch = normalizeSearch(searchText);
  if (normalizedSearch.includes(normalizedQuery)) return true;

  const searchTokens = normalizedSearch.split(" ").filter(Boolean);
  return queryTokens.every((q) => searchTokens.some((s) => s.includes(q) || q.includes(s)));
}
