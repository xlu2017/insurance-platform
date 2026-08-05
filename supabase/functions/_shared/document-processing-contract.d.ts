export function isUuid(value: string): boolean;

export type CaseIdParseResult =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; value: string };

export function parseCaseId(raw: unknown): CaseIdParseResult;

export const resumableStatuses: string[];
export const relevantStatuses: string[];

export function resolveLatestActionStatuses(action: string): string[] | null;
