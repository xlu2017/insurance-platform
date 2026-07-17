function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function deterministicId(seed: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  ).slice(0, 16);
  return formatUuid(digest);
}

export async function assertionId(input: {
  fileDigest: string;
  parserId: string;
  parserVersion: string;
  pageNumber: number;
  fieldPath: string;
  occurrenceIndex: number;
  normalizedValue: unknown;
}): Promise<string> {
  const seed = [
    input.fileDigest,
    input.parserId,
    input.parserVersion,
    String(input.pageNumber),
    input.fieldPath,
    String(input.occurrenceIndex),
    JSON.stringify(input.normalizedValue),
  ].join("|");
  return deterministicId(seed);
}
