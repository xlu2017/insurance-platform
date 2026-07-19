import type {
  ExternalFileLifecycleStore,
  ExternalFileRecord,
  ProviderFileDeletionResult,
} from "./native-document-analysis.ts";

export class MemoryExternalFileLifecycleStore implements ExternalFileLifecycleStore {
  private records = new Map<string, ExternalFileRecord>();
  private emergencyCleanup: {
    providerFileId: string;
    policyDocumentId?: string;
    failureCategory?: string;
  }[] = [];

  async recordUpload(
    record: Omit<ExternalFileRecord, "id" | "uploadStartedAt" | "deletionAttempts">,
  ): Promise<ExternalFileRecord> {
    const rec: ExternalFileRecord = {
      ...record,
      id: crypto.randomUUID(),
      uploadStartedAt: new Date().toISOString(),
      deletionAttempts: 0,
    };
    this.records.set(rec.id, rec);
    return rec;
  }

  async markUploadCompleted(id: string, patch: Partial<ExternalFileRecord>): Promise<void> {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`File record ${id} not found`);
    Object.assign(rec, patch);
    rec.uploadCompletedAt = new Date().toISOString();
  }

  async recordDeletionAttempt(id: string, result: ProviderFileDeletionResult): Promise<void> {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`File record ${id} not found`);
    rec.deletionAttempts = result.attempts;
    if (result.deleted) {
      rec.deletionStatus = "deleted";
      rec.deletedAt = new Date().toISOString();
      rec.lastDeletionErrorCategory = undefined;
      rec.nextDeletionAttemptAt = undefined;
    } else {
      rec.lastDeletionErrorCategory = result.failureCategory;
      if (rec.deletionAttempts >= 3 && (result.statusCode ?? 0) >= 500) {
        rec.deletionStatus = "failed_permanently";
      } else if (!rec.nextDeletionAttemptAt) {
        rec.deletionStatus = "queued";
        const backoffMinutes = Math.min(5 * Math.pow(2, rec.deletionAttempts - 1), 60);
        const next = new Date();
        next.setMinutes(next.getMinutes() + backoffMinutes);
        rec.nextDeletionAttemptAt = next.toISOString();
      }
    }
  }

  async queueCleanup(
    id: string,
    failureCategory: string,
    nextAttemptAt: string,
    providerFileId?: string,
  ): Promise<void> {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`File record ${id} not found`);
    rec.deletionStatus = "queued";
    rec.lastDeletionErrorCategory = failureCategory;
    rec.nextDeletionAttemptAt = nextAttemptAt;
    if (providerFileId) {
      rec.providerFileId = providerFileId;
    }
  }

  async recordEmergencyCleanup(
    providerFileId: string,
    policyDocumentId?: string,
    failureCategory?: string,
  ): Promise<void> {
    this.emergencyCleanup.push({ providerFileId, policyDocumentId, failureCategory });
  }

  getRecords(): ExternalFileRecord[] {
    return Array.from(this.records.values());
  }

  getEmergencyCleanup(): {
    providerFileId: string;
    policyDocumentId?: string;
    failureCategory?: string;
  }[] {
    return this.emergencyCleanup;
  }
}
