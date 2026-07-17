import type {
  PersistedRecommendationOption,
  RecommendationInputSnapshot,
} from "@autopilot/schemas";
import type { EngineResult } from "./types.ts";
import type { z } from "zod";

interface CanonicalizableObject {
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is CanonicalizableObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortPrimitives(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function isRecordArray(value: unknown[]): value is Record<string, unknown>[] {
  return value.length > 0 && value.every((x) => isPlainObject(x));
}

function sortByKey<T extends CanonicalizableObject>(items: T[], key: keyof T): T[] {
  return [...items].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
}

function sortByPath<T extends { path: unknown[] }>(items: T[]): T[] {
  return [...items].sort((a, b) => JSON.stringify(a.path).localeCompare(JSON.stringify(b.path)));
}

function sortByRank<T extends { rank: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.rank - b.rank);
}

/**
 * Recursively canonicalize a value for stable SHA-256 digest computation.
 *
 * Rules:
 * - Object keys are sorted lexicographically.
 * - Unordered sets (arrays of objects with stable identifiers) are sorted by those identifiers.
 * - Ranked option arrays are sorted by `rank`.
 * - Validation-error / preference details are sorted by `path` or by `scope` then `item`.
 * - Primitive arrays are sorted to produce a stable set representation.
 * - Ordered arrays that do not match the above patterns are preserved.
 * - `generatedAt` is excluded from the canonical form so request time does not affect the digest.
 * - `undefined` values are omitted; `null` is retained.
 */
export function canonicalizeForDigest(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    const canonicalized = value.map(canonicalizeForDigest).filter((x) => x !== undefined);
    if (canonicalized.length === 0) return [];

    if (isRecordArray(canonicalized)) {
      const first = canonicalized[0]!;
      if ("rank" in first) {
        return sortByRank(canonicalized as Array<{ rank: number } & Record<string, unknown>>).map(
          canonicalizeForDigest,
        );
      }
      if ("id" in first) {
        return sortByKey(canonicalized, "id").map(canonicalizeForDigest);
      }
      if ("path" in first) {
        return sortByPath(
          canonicalized as Array<{ path: unknown[] } & Record<string, unknown>>,
        ).map(canonicalizeForDigest);
      }
      if ("scope" in first && "item" in first) {
        return [...canonicalized]
          .sort((a, b) => {
            const scopeA = String(a.scope);
            const scopeB = String(b.scope);
            if (scopeA !== scopeB) return scopeA.localeCompare(scopeB);
            return String(a.item).localeCompare(String(b.item));
          })
          .map(canonicalizeForDigest);
      }
    }

    if (
      canonicalized.every(
        (x) =>
          typeof x === "string" || typeof x === "number" || typeof x === "boolean" || x === null,
      )
    ) {
      return [...canonicalized].sort(sortPrimitives);
    }

    return canonicalized;
  }

  const obj = value as CanonicalizableObject;
  const sorted: CanonicalizableObject = {};
  for (const key of Object.keys(obj).sort()) {
    if (key === "generatedAt") continue;
    const child = canonicalizeForDigest(obj[key]);
    if (child !== undefined) {
      sorted[key] = child;
    }
  }
  return sorted;
}

export function canonicalSerializeRecommendationInput(
  snapshot: RecommendationInputSnapshot,
  engineVersion: string,
  engineSourceHash: string,
): { canonical: unknown; canonicalJson: string } {
  const canonical = canonicalizeForDigest({
    ...snapshot,
    engineVersion,
    engineSourceHash,
  });
  return { canonical, canonicalJson: JSON.stringify(canonical) };
}

export function canonicalSerializeRecommendationOutput(
  result: EngineResult,
  recommendedOption: PersistedRecommendationOption,
  rankedOptions: PersistedRecommendationOption[],
  rejectedOptions: PersistedRecommendationOption[],
): { canonical: unknown; canonicalJson: string } {
  const canonical = canonicalizeForDigest({
    incumbentTotalCents: result.incumbentTotalCents,
    recommendedOption,
    rankedOptions,
    rejectedOptions,
  });
  return { canonical, canonicalJson: JSON.stringify(canonical) };
}

/**
 * Cross-check that a canonical JSON string is stable: parse it and re-canonicalize;
 * the result must be byte-for-byte identical to the supplied string.
 */
export function verifyCanonicalString(canonicalJson: string): boolean {
  try {
    const parsed = JSON.parse(canonicalJson);
    const recomputed = JSON.stringify(canonicalizeForDigest(parsed));
    return recomputed === canonicalJson;
  } catch {
    return false;
  }
}

/**
 * Validate a value against a strict Zod schema, canonicalize the parsed value,
 * and verify the resulting JSON string matches the supplied canonical string byte-for-byte.
 */
export function verifyCanonicalPair<T>(
  schema: z.ZodType<T>,
  value: unknown,
  canonicalJson: string,
): { valid: boolean; error?: string } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { valid: false, error: parsed.error.message };
  }
  try {
    const recomputed = JSON.stringify(canonicalizeForDigest(parsed.data as unknown));
    if (recomputed !== canonicalJson) {
      return { valid: false, error: "Canonical string does not match regenerated canonical JSON" };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}
