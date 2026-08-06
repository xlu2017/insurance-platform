export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export type CaseIdParseResult =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; value: string };

// Distinguishes an omitted case_id property from a present-but-invalid value.
export function parseCaseId(raw: unknown, isPresent: boolean): CaseIdParseResult {
  if (!isPresent) {
    return { kind: "none" };
  }
  if (raw === null || typeof raw !== "string") {
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

export const documentBatchStatuses = [
  "uploading_files",
  "checking_duplicates",
  "queued",
  "cancellation_requested",
  "waiting_for_predecessor",
  "reading_policy_documents",
  "comparing_policies",
  "validating_extracted_details",
  "ready_for_review",
  "additional_information_required",
  "processing_unavailable",
  "manual_review",
  "superseded",
] as const;

export type DocumentBatchStatus = (typeof documentBatchStatuses)[number];

// Batches that can accept additional uploads or retries.
export const resumableStatuses: DocumentBatchStatus[] = [
  "uploading_files",
  "additional_information_required",
];

// Batches the customer may need to see while they are active or in review.
export const relevantStatuses: DocumentBatchStatus[] = [
  "uploading_files",
  "checking_duplicates",
  "queued",
  "cancellation_requested",
  "waiting_for_predecessor",
  "reading_policy_documents",
  "comparing_policies",
  "validating_extracted_details",
  "ready_for_review",
  "additional_information_required",
  "processing_unavailable",
  "manual_review",
];

// Batches that have reached a final state.
export const terminalStatuses: DocumentBatchStatus[] = [
  "ready_for_review",
  "additional_information_required",
  "manual_review",
  "processing_unavailable",
  "superseded",
];

// Batches currently being processed by a worker.
export const activeStatuses: DocumentBatchStatus[] = [
  "reading_policy_documents",
  "comparing_policies",
  "validating_extracted_details",
];

// Batches blocked waiting for another batch or the queue.
export const waitingStatuses: DocumentBatchStatus[] = ["queued", "waiting_for_predecessor"];

// Batches the customer can review or act on.
export const reviewableStatuses: DocumentBatchStatus[] = [
  "ready_for_review",
  "additional_information_required",
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
