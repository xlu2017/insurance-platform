import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AuthorizationStore,
  DocumentProcessingAuthorization,
  ExternalFileLifecycleStore,
  ExternalFileRecord,
  ProviderFileDeletionResult,
} from "./native-document-analysis.ts";

// The Supabase client is intentionally loosely typed because this adapter
// is shared between Node test runners and Deno Edge Functions.
export class SupabaseAuthorizationStore implements AuthorizationStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private admin: SupabaseClient<any, "public", any>) {}

  async createAuthorization(
    auth: Omit<DocumentProcessingAuthorization, "id" | "authorizedAt">,
  ): Promise<DocumentProcessingAuthorization> {
    const { data, error } = await this.admin
      .from("document_processing_authorizations")
      .insert({
        household_id: auth.householdId,
        actor_profile_id: auth.actorProfileId,
        consent_id: auth.consentId,
        purpose: auth.purpose,
        privacy_notice_version: auth.privacyNoticeVersion,
        processor_contract_version: auth.processorContractVersion,
        foreign_processing_acknowledged: auth.foreignProcessingAcknowledged,
        automated_processing_acknowledged: auth.automatedProcessingAcknowledged,
        raw_processing_approved: auth.rawProcessingApproved,
        external_processing_enabled: auth.externalProcessingEnabled,
        authorization_result: auth.authorizationResult,
      })
      .select()
      .single();
    if (error || !data) throw new Error("Failed to persist document processing authorization");
    return { ...auth, id: data.id, authorizedAt: new Date().toISOString() };
  }

  async updateAuthorization(
    id: string,
    patch: Partial<DocumentProcessingAuthorization>,
  ): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (patch.analysisRequestId !== undefined) {
      updates.analysis_request_id = patch.analysisRequestId;
    }
    if (patch.authorizationResult !== undefined) {
      updates.authorization_result = patch.authorizationResult;
    }
    if (Object.keys(updates).length === 0) return;
    const { error } = await this.admin
      .from("document_processing_authorizations")
      .update(updates)
      .eq("id", id);
    if (error) throw new Error("Failed to update authorization: " + error.message);
  }
}

export class SupabaseFileLifecycleStore implements ExternalFileLifecycleStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private admin: SupabaseClient<any, "public", any>) {}

  async recordUpload(
    record: Omit<ExternalFileRecord, "id" | "uploadStartedAt" | "deletionAttempts">,
  ): Promise<ExternalFileRecord> {
    const { data, error } = await this.admin
      .from("document_analysis_provider_files")
      .insert({
        authorization_id: record.authorizationId,
        analysis_request_id: record.analysisRequestId,
        policy_document_id: record.policyDocumentId,
        provider_file_id: record.providerFileId,
        upload_status: record.uploadStatus,
      })
      .select()
      .single();
    if (error || !data) throw new Error("Failed to record file upload: " + (error?.message ?? ""));
    return {
      ...record,
      id: data.id,
      uploadStartedAt: data.upload_started_at ?? new Date().toISOString(),
      deletionAttempts: 0,
    } as ExternalFileRecord;
  }

  async markUploadCompleted(id: string, patch: Partial<ExternalFileRecord>): Promise<void> {
    const updates: Record<string, unknown> = { upload_completed_at: new Date().toISOString() };
    if (patch.providerFileId !== undefined) updates.provider_file_id = patch.providerFileId;
    if (patch.uploadStatus !== undefined) updates.upload_status = patch.uploadStatus;
    if (patch.processingStatus !== undefined) updates.processing_status = patch.processingStatus;
    const { error } = await this.admin
      .from("document_analysis_provider_files")
      .update(updates)
      .eq("id", id);
    if (error) throw new Error("Failed to mark upload completed: " + error.message);
  }

  async recordDeletionAttempt(id: string, result: ProviderFileDeletionResult): Promise<void> {
    const record = await this.getRecord(id);
    const attempts = record.deletionAttempts + 1;
    const update: Record<string, unknown> = { deletion_attempts: attempts };
    if (result.deleted) {
      update.deletion_status = "deleted";
      update.deleted_at = new Date().toISOString();
      update.last_deletion_error_category = null;
      update.next_deletion_attempt_at = null;
    } else {
      update.last_deletion_error_category = result.failureCategory ?? null;
      if (attempts >= 3 && (result.statusCode ?? 0) >= 500) {
        update.deletion_status = "failed_permanently";
      } else if (!record.nextDeletionAttemptAt) {
        update.deletion_status = "queued";
        const backoffMinutes = Math.min(5 * Math.pow(2, attempts - 1), 60);
        const next = new Date();
        next.setMinutes(next.getMinutes() + backoffMinutes);
        update.next_deletion_attempt_at = next.toISOString();
      }
    }
    const { error } = await this.admin
      .from("document_analysis_provider_files")
      .update(update)
      .eq("id", id);
    if (error) throw new Error("Failed to record deletion attempt: " + error.message);
    await this.admin.from("document_analysis_cleanup_attempts").insert({
      file_id: id,
      status_code: result.statusCode ?? null,
      failure_category: result.failureCategory ?? null,
      success: result.deleted,
    });
  }

  async queueCleanup(
    id: string,
    failureCategory: string,
    nextAttemptAt: string,
    providerFileId?: string,
  ): Promise<void> {
    const update: Record<string, unknown> = {
      deletion_status: "queued",
      last_deletion_error_category: failureCategory,
      next_deletion_attempt_at: nextAttemptAt,
    };
    if (providerFileId) {
      update.provider_file_id = providerFileId;
    }
    const { error } = await this.admin
      .from("document_analysis_provider_files")
      .update(update)
      .eq("id", id);
    if (error) throw new Error("Failed to queue cleanup: " + error.message);
    await this.admin.from("document_analysis_cleanup_attempts").insert({
      file_id: id,
      failure_category: failureCategory,
      success: false,
      next_attempt_at: nextAttemptAt,
    });
  }

  private async getRecord(
    id: string,
  ): Promise<ExternalFileRecord & { deletionAttempts: number; nextDeletionAttemptAt?: string }> {
    const { data, error } = await this.admin
      .from("document_analysis_provider_files")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) throw new Error("Failed to load file record: " + (error?.message ?? ""));
    return {
      id: String(data.id),
      authorizationId: String(data.authorization_id),
      analysisRequestId: data.analysis_request_id ? String(data.analysis_request_id) : undefined,
      policyDocumentId: String(data.policy_document_id),
      providerFileId: String(data.provider_file_id),
      uploadStartedAt: String(data.upload_started_at),
      uploadCompletedAt: data.upload_completed_at ? String(data.upload_completed_at) : undefined,
      uploadStatus: String(data.upload_status),
      processingStatus: data.processing_status ? String(data.processing_status) : undefined,
      deletionStatus: data.deletion_status ? String(data.deletion_status) : undefined,
      deletedAt: data.deleted_at ? String(data.deleted_at) : undefined,
      deletionAttempts: Number(data.deletion_attempts ?? 0),
      lastDeletionErrorCategory: data.last_deletion_error_category
        ? String(data.last_deletion_error_category)
        : undefined,
      nextDeletionAttemptAt: data.next_deletion_attempt_at
        ? String(data.next_deletion_attempt_at)
        : undefined,
    } as ExternalFileRecord & { deletionAttempts: number; nextDeletionAttemptAt?: string };
  }
}
