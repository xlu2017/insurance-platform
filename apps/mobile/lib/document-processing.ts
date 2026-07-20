import { invokeEdgeFunction } from "./edge-functions";

export type DocumentBatchStatus =
  | "uploading_files"
  | "checking_duplicates"
  | "queued"
  | "reading_policy_documents"
  | "comparing_policies"
  | "validating_extracted_details"
  | "ready_for_review"
  | "additional_information_required"
  | "processing_unavailable"
  | "manual_review";

export const documentBatchStatusLabels: Record<DocumentBatchStatus, string> = {
  uploading_files: "Uploading files",
  checking_duplicates: "Checking for duplicates",
  queued: "Reading policy documents",
  reading_policy_documents: "Reading policy documents",
  comparing_policies: "Comparing policies",
  validating_extracted_details: "Validating extracted details",
  ready_for_review: "Ready for review",
  additional_information_required: "Additional information required",
  processing_unavailable: "Processing unavailable",
  manual_review: "Reading policy documents",
};

export interface DocumentBatchSummary {
  id: string;
  session_id: string;
  status: DocumentBatchStatus;
  automatic_processing: boolean;
  document_count: number;
  unique_document_count: number;
  deduplicated_count: number;
  retryable: boolean;
  is_terminal: boolean;
  created_at: string;
}

export function documentItemStatusLabel(
  uploadStatus: string,
  batch: DocumentBatchSummary | null | undefined,
): string {
  if (uploadStatus === "pending") return "Pending";
  if (uploadStatus === "uploading") return "Uploading files";
  if (uploadStatus === "failed") return "Upload failed";
  const uploadPrefix = uploadStatus === "deduplicated" ? "Deduplicated · " : "";
  if (!batch) return `${uploadPrefix}Uploaded`;
  return `${uploadPrefix}${documentBatchStatusLabels[batch.status]}`;
}

export async function loadLatestDocumentBatch(
  householdId: string,
): Promise<DocumentBatchSummary | null> {
  const { data, error } = await invokeEdgeFunction<DocumentBatchSummary | null>(
    "document-processing-batch",
    { action: "latest", household_id: householdId },
  );
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function createDocumentBatch(
  householdId: string,
  clientRequestId: string,
): Promise<DocumentBatchSummary> {
  const { data, error } = await invokeEdgeFunction<DocumentBatchSummary>(
    "document-processing-batch",
    {
      action: "create",
      household_id: householdId,
      client_request_id: clientRequestId,
    },
  );
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Failed to create document processing batch");
  return data;
}

export async function submitDocumentBatch(
  householdId: string,
  batchId: string,
): Promise<DocumentBatchSummary> {
  const { data, error } = await invokeEdgeFunction<DocumentBatchSummary>(
    "document-processing-batch",
    {
      action: "submit",
      household_id: householdId,
      batch_id: batchId,
    },
  );
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Failed to submit document processing batch");
  return data;
}

export async function retryDocumentBatch(
  householdId: string,
  batchId: string,
): Promise<DocumentBatchSummary> {
  const { data, error } = await invokeEdgeFunction<DocumentBatchSummary>(
    "document-processing-batch",
    {
      action: "retry",
      household_id: householdId,
      batch_id: batchId,
    },
  );
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Failed to retry document processing");
  return data;
}

export async function loadDocumentBatch(
  householdId: string,
  batchId: string,
): Promise<DocumentBatchSummary> {
  const { data, error } = await invokeEdgeFunction<DocumentBatchSummary>(
    "document-processing-batch",
    {
      action: "status",
      household_id: householdId,
      batch_id: batchId,
    },
  );
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("Document processing batch not found");
  return data;
}

export interface DangerousModeSetting {
  enabled: boolean;
  disclosure_version: string;
  enabled_at?: string | null;
}

export async function loadDangerousModeSetting(householdId: string): Promise<DangerousModeSetting> {
  const { data, error } = await invokeEdgeFunction<DangerousModeSetting>("dangerous-mode-setting", {
    action: "get",
    household_id: householdId,
  });
  if (error) throw new Error(error.message);
  return data ?? { enabled: false, disclosure_version: "dangerous-mode-v1" };
}

export async function updateDangerousModeSetting(input: {
  householdId: string;
  enabled: boolean;
  explicitConfirmation: boolean;
  foreignProcessingAcknowledged: boolean;
  automatedProcessingAcknowledged: boolean;
  rawProcessingApproved: boolean;
  disclosureVersion: string;
}): Promise<DangerousModeSetting> {
  const { data, error } = await invokeEdgeFunction<DangerousModeSetting>("dangerous-mode-setting", {
    action: input.enabled ? "enable" : "disable",
    household_id: input.householdId,
    explicit_confirmation: input.explicitConfirmation,
    foreign_processing_acknowledged: input.foreignProcessingAcknowledged,
    automated_processing_acknowledged: input.automatedProcessingAcknowledged,
    raw_processing_approved: input.rawProcessingApproved,
    disclosure_version: input.disclosureVersion,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Failed to update Dangerous mode");
  return data;
}

export function createClientRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
