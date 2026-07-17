import type { ExtractedFactAssertion, ParsedConflict } from "../types.ts";
import { compareAssertionAuthority } from "./authority.ts";

export function resolveByAuthority(assertions: ExtractedFactAssertion[]): {
  selected: Record<string, ExtractedFactAssertion>;
  conflicts: ParsedConflict[];
} {
  const byPath: Record<string, ExtractedFactAssertion[]> = {};
  for (const a of assertions) {
    byPath[a.fieldPath] = byPath[a.fieldPath] ?? [];
    byPath[a.fieldPath].push(a);
  }

  const selected: Record<string, ExtractedFactAssertion> = {};
  const conflicts: ParsedConflict[] = [];

  for (const [fieldPath, list] of Object.entries(byPath)) {
    const sorted = [...list].sort(compareAssertionAuthority);
    const distinctValues = [...new Set(sorted.map((a) => JSON.stringify(a.normalizedValue)))];

    if (distinctValues.length <= 1) {
      selected[fieldPath] = sorted[0];
      continue;
    }

    const topAuthority = sorted[0].authority;
    const topGroup = sorted.filter((a) => a.authority === topAuthority);
    const topDistinct = [...new Set(topGroup.map((a) => JSON.stringify(a.normalizedValue)))].length;
    if (topDistinct === 1) {
      selected[fieldPath] = topGroup[0];
    }

    const selectedId = topDistinct === 1 ? topGroup[0].id : undefined;
    const authorities = [...new Set(sorted.map((a) => a.authority))].join(", ");
    conflicts.push({
      fieldPath,
      assertionIds: sorted.map((a) => a.id),
      selectedAssertionId: selectedId,
      reason: `Conflicting values across ${authorities}; ${selectedId ? `selected ${topGroup[0].authority}` : "equal authority tie requires review"}.`,
    });
  }

  return { selected, conflicts };
}

export function selectedValues(
  selected: Record<string, ExtractedFactAssertion>,
): ExtractedFactAssertion[] {
  return Object.values(selected);
}
