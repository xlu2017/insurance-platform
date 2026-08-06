export function isUuid(value: string): boolean;

export type CaseIdParseResult =
  | { kind: "none" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; value: string };

export function parseCaseId(raw: unknown, isPresent: boolean): CaseIdParseResult;

export type DocumentBatchStatus =
  | "uploading_files"
  | "checking_duplicates"
  | "queued"
  | "cancellation_requested"
  | "waiting_for_predecessor"
  | "reading_policy_documents"
  | "comparing_policies"
  | "validating_extracted_details"
  | "ready_for_review"
  | "additional_information_required"
  | "processing_unavailable"
  | "manual_review"
  | "superseded";

export const documentBatchStatuses: DocumentBatchStatus[];
export const resumableStatuses: DocumentBatchStatus[];
export const relevantStatuses: DocumentBatchStatus[];
export const terminalStatuses: DocumentBatchStatus[];
export const activeStatuses: DocumentBatchStatus[];
export const waitingStatuses: DocumentBatchStatus[];
export const reviewableStatuses: DocumentBatchStatus[];

export function resolveLatestActionStatuses(action: string): string[] | null;
