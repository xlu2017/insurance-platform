import { useQuery } from "@tanstack/react-query";
import {
  getPrivacyNoticeVersion,
  getProcessorContractVersion,
} from "@/lib/document-processing-config";
import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

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

export const documentBatchStatusLabels: Record<DocumentBatchStatus, string> = {
  uploading_files: "Uploading files",
  checking_duplicates: "Checking your documents",
  queued: "Preparing your review",
  cancellation_requested: "Restart requested",
  waiting_for_predecessor: "Waiting for current processing",
  reading_policy_documents: "Reading your policies",
  comparing_policies: "Comparing policy details",
  validating_extracted_details: "Preparing your review",
  ready_for_review: "Ready to confirm",
  additional_information_required: "Additional information required",
  processing_unavailable: "Processing unavailable",
  manual_review: "Sent for review",
  superseded: "Superseded",
};

export const documentBatchStatusTooltips: Record<DocumentBatchStatus, string> = {
  uploading_files: "Documents are still being uploaded.",
  checking_duplicates: "Checking for duplicate documents.",
  queued: "Documents are queued for processing.",
  cancellation_requested: "A restart was requested; current work will be reused.",
  waiting_for_predecessor: "Waiting for the current processing to finish first.",
  reading_policy_documents: "Reading the uploaded policy documents.",
  comparing_policies: "Comparing the extracted policy details.",
  validating_extracted_details: "Validating the extracted information.",
  ready_for_review: "Extracted information is ready for review.",
  additional_information_required: "More information or documents are needed.",
  processing_unavailable: "Processing could not be completed.",
  manual_review: "Documents sent for manual review.",
  superseded: "This batch was replaced by a newer processing run.",
};

export interface DocumentBatchSummary {
  id: string;
  session_id: string;
  case_id: string | null;
  status: DocumentBatchStatus;
  automatic_processing: boolean;
  document_count: number;
  unique_document_count: number;
  deduplicated_count: number;
  retryable: boolean;
  is_terminal: boolean;
  created_at: string;
  processing_started_at: string | null;
}

export const additionalUploadAllowedStatuses: Set<DocumentBatchStatus> = new Set([
  "uploading_files",
  "additional_information_required",
]);

export function batchAllowsAdditionalUploads(
  batch: DocumentBatchSummary | null | undefined,
): boolean {
  return !batch || additionalUploadAllowedStatuses.has(batch.status);
}

export function documentItemStatusLabel(
  uploadStatus: string,
  batch: DocumentBatchSummary | null | undefined,
): string {
  if (uploadStatus === "pending") return "Pending";
  if (uploadStatus === "uploading") return "Uploading files";
  if (uploadStatus === "failed") return "Upload failed";
  const uploadPrefix = uploadStatus === "deduplicated" ? "Already uploaded · " : "";
  if (!batch) return `${uploadPrefix}Uploaded`;
  return `${uploadPrefix}${documentBatchStatusLabels[batch.status]}`;
}

export async function loadLatestDocumentBatch(
  householdId: string,
): Promise<DocumentBatchSummary | null> {
  const { data, error } = await invokeEdgeFunction<DocumentBatchSummary | null>(
    "document-processing-batch",
    { action: "latest-relevant", household_id: householdId },
  );
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function loadLatestResumableDocumentBatch(
  householdId: string,
): Promise<DocumentBatchSummary | null> {
  const { data, error } = await invokeEdgeFunction<DocumentBatchSummary | null>(
    "document-processing-batch",
    { action: "latest-resumable", household_id: householdId },
  );
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function loadDocumentBatchForCase(
  householdId: string,
  caseId: string,
): Promise<DocumentBatchSummary | null> {
  const { data, error } = await invokeEdgeFunction<DocumentBatchSummary | null>(
    "document-processing-batch",
    { action: "latest-resumable-for-case", household_id: householdId, case_id: caseId },
  );
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function loadRelevantDocumentBatchForCase(
  householdId: string,
  caseId: string,
): Promise<DocumentBatchSummary | null> {
  const { data, error } = await invokeEdgeFunction<DocumentBatchSummary | null>(
    "document-processing-batch",
    { action: "latest-relevant-for-case", household_id: householdId, case_id: caseId },
  );
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function createDocumentBatch(input: {
  householdId: string;
  caseId?: string;
  clientRequestId?: string;
}): Promise<DocumentBatchSummary> {
  const { data, error } = await invokeEdgeFunction<DocumentBatchSummary>(
    "document-processing-batch",
    {
      action: "create",
      household_id: input.householdId,
      case_id: input.caseId,
      client_request_id: input.clientRequestId,
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

export async function loadDocumentBatchBySession(
  householdId: string,
  sessionId: string,
): Promise<DocumentBatchSummary | null> {
  const { data, error } = await invokeEdgeFunction<DocumentBatchSummary | null>(
    "document-processing-batch",
    { action: "status", household_id: householdId, session_id: sessionId },
  );
  if (error) throw new Error(error.message);
  return data ?? null;
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

export interface UploadPlanEstimate {
  lowerSeconds: number;
  upperSeconds: number;
  reviewPasses: number;
}

export interface UploadPlanWaitEstimate extends UploadPlanEstimate {
  currentLowerSeconds: number;
  currentUpperSeconds: number;
  queuedLowerSeconds: number;
  queuedUpperSeconds: number;
}

export interface ExactDuplicateDocument {
  policyDocumentId: string;
  normalizationId: string;
  originalFilename: string | null;
}

export interface UploadPlan {
  activeBatchId: string | null;
  activeStatus: DocumentBatchStatus | null;
  activeBatchGeneration: number | null;
  newUploadCount: number;
  reusableNormalizationCount: number;
  newNormalizationCount: number;
  unfinishedCurrentCount: number;
  exactDuplicateDocuments: ExactDuplicateDocument[];
  restartEstimate: UploadPlanEstimate | null;
  waitEstimate: UploadPlanWaitEstimate | null;
}

export async function planDocumentUpload(input: {
  householdId: string;
  caseId?: string;
  newPolicyDocumentIds?: string[];
}): Promise<UploadPlan> {
  const { data, error } = await invokeEdgeFunction<UploadPlan>("document-processing-batch", {
    action: "plan",
    household_id: input.householdId,
    case_id: input.caseId,
    new_policy_document_ids: input.newPolicyDocumentIds ?? [],
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Failed to plan document upload");
  return {
    activeBatchId: data.activeBatchId ?? null,
    activeStatus: (data.activeStatus as DocumentBatchStatus | null) ?? null,
    activeBatchGeneration: data.activeBatchGeneration ?? null,
    newUploadCount: data.newUploadCount ?? 0,
    reusableNormalizationCount: data.reusableNormalizationCount ?? 0,
    newNormalizationCount: data.newNormalizationCount ?? 0,
    unfinishedCurrentCount: data.unfinishedCurrentCount ?? 0,
    exactDuplicateDocuments: data.exactDuplicateDocuments ?? [],
    restartEstimate: data.restartEstimate,
    waitEstimate: data.waitEstimate,
  };
}

export async function supersedeDocumentBatch(input: {
  householdId: string;
  activeBatchId: string;
  continuationRequestId: string;
  newPolicyDocumentIds?: string[];
}): Promise<{ new_batch_id: string; new_session_id: string; superseded_batch_id: string }> {
  const { data, error } = await invokeEdgeFunction<{
    new_batch_id: string;
    new_session_id: string;
    superseded_batch_id: string;
  }>("document-processing-batch", {
    action: "supersede",
    household_id: input.householdId,
    batch_id: input.activeBatchId,
    continuation_request_id: input.continuationRequestId,
    new_policy_document_ids: input.newPolicyDocumentIds ?? [],
  });
  if (error) throw new Error(error.message);
  if (!data?.new_batch_id) throw new Error("Failed to supersede document batch");
  return data;
}

export async function queueSuccessorDocumentBatch(input: {
  householdId: string;
  predecessorBatchId: string;
  continuationRequestId: string;
  newPolicyDocumentIds?: string[];
}): Promise<{ new_batch_id: string; new_session_id: string; predecessor_batch_id: string }> {
  const { data, error } = await invokeEdgeFunction<{
    new_batch_id: string;
    new_session_id: string;
    predecessor_batch_id: string;
  }>("document-processing-batch", {
    action: "queue-successor",
    household_id: input.householdId,
    batch_id: input.predecessorBatchId,
    continuation_request_id: input.continuationRequestId,
    new_policy_document_ids: input.newPolicyDocumentIds ?? [],
  });
  if (error) throw new Error(error.message);
  if (!data?.new_batch_id) throw new Error("Failed to queue successor document batch");
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

export async function recordDocumentProcessingConsent(input: {
  householdId: string;
  profileId: string;
  purpose?: string;
  privacyNoticeVersion?: string;
  processorContractVersion?: string;
  foreignProcessingAcknowledged?: boolean;
  automatedProcessingAcknowledged?: boolean;
  rawProcessingApproved?: boolean;
  authorityBasis?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("record_document_processing_consent", {
    p_household_id: input.householdId,
    p_profile_id: input.profileId,
    p_purpose: input.purpose ?? "insurance_policy_extraction",
    p_privacy_notice_version: input.privacyNoticeVersion ?? getPrivacyNoticeVersion(),
    p_processor_contract_version:
      input.processorContractVersion ?? getProcessorContractVersion() ?? "",
    p_foreign_processing_acknowledged: input.foreignProcessingAcknowledged ?? true,
    p_automated_processing_acknowledged: input.automatedProcessingAcknowledged ?? true,
    p_raw_processing_approved: input.rawProcessingApproved ?? true,
    p_authority_basis: input.authorityBasis ?? "household_owner",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Failed to record document processing consent");
  return data as string;
}

export function createClientRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function useReviewSessions(householdId: string | undefined) {
  return useQuery({
    queryKey: ["review-sessions", householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<DocumentBatchSummary[]> => {
      const { data, error } = await invokeEdgeFunction<DocumentBatchSummary[]>(
        "document-processing-batch",
        { action: "list", household_id: householdId },
      );
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
