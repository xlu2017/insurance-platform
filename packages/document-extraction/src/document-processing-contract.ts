export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export type CaseIdParseResult =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; value: string };

export function parseCaseId(raw: unknown): CaseIdParseResult {
  if (raw === undefined || raw === null) {
    return { kind: "none" };
  }
  if (typeof raw !== "string") {
    return { kind: "invalid", reason: "Invalid case_id" };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { kind: "invalid", reason: "Invalid case_id" };
  }
  if (!isUuid(trimmed)) {
    return { kind: "invalid", reason: "Invalid case_id" };
  }
  return { kind: "valid", value: trimmed };
}

// Legacy actions look for batches that accept additional uploads.
export const resumableStatuses = ["uploading_files", "additional_information_required"];

// Expanded recovery actions show the latest batch the customer must see,
// including processing and review states.
export const relevantStatuses = [
  "uploading_files",
  "checking_duplicates",
  "queued",
  "reading_policy_documents",
  "comparing_policies",
  "validating_extracted_details",
  "ready_for_review",
  "additional_information_required",
  "processing_unavailable",
  "manual_review",
];

// Maps a batch-recovery action to the status set it queries.
export function resolveLatestActionStatuses(action: string): string[] | null {
  if (
    action === "latest" ||
    action === "latest-for-case" ||
    action === "latest-resumable" ||
    action === "latest-resumable-for-case"
  ) {
    return resumableStatuses;
  }
  if (action === "latest-relevant" || action === "latest-relevant-for-case") {
    return relevantStatuses;
  }
  return null;
}
