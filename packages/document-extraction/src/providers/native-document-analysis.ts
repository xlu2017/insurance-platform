export interface OriginalFileInput {
  documentId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export type DocumentInputMode =
  | "native_file_reference"
  | "native_image_reference"
  | "native_video_reference"
  | "provider_extracted_text"
  | "unsupported";

export interface ResolvedInputCapability {
  mimeType: string;
  mode: DocumentInputMode;
  supported: boolean;
  reason?: string;
}

export interface ResolvedDocumentModel {
  modelId: string;
  supportsImageInput: boolean;
  supportsVideoInput: boolean;
  supportsGenericFileInput: boolean;
  supportedReferenceSchemes: string[];
  providerMetadata: Record<string, unknown>;
}

export interface ProviderFileHandle {
  providerFileId: string;
  documentId: string;
  filename: string;
  mimeType: string;
  bytes: number;
  mode: DocumentInputMode;
  /** Provider-native reference, e.g. ms://<file_id>, used for image/video references. */
  reference?: string;
  status: string;
  statusDetails?: string;
  providerMetadata: Record<string, unknown>;
  /** In-memory provider-extracted content. Never persist or log this field. */
  transientExtractedContent?: string;
}

export interface ProviderUploadResult {
  status: "ready" | "rejected" | "failed" | "timed_out";
  handle?: ProviderFileHandle;
  errorCategory?: string;
}

export interface ProviderFileDeletionResult {
  deleted: boolean;
  attempts: number;
  statusCode?: number;
  failureCategory?: string;
}

export interface NativeDocumentAnalysisRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  files: ProviderFileHandle[];
  responseFormat?: { type: "json_object" | "json_schema" };
}

export interface NativeDocumentAnalysisProvider {
  readonly providerId: string;
  readonly baseUrl: string;
  resolveModel(): Promise<ResolvedDocumentModel>;
  resolveInputMode(input: OriginalFileInput): Promise<ResolvedInputCapability>;
  assertBatchFits?(inputs: OriginalFileInput[]): Promise<void>;
  uploadOriginalFile(
    input: OriginalFileInput,
    callbacks?: {
      onHandleCreated?: (handle: ProviderFileHandle) => void | Promise<void>;
    },
  ): Promise<ProviderUploadResult>;
  analyze(input: NativeDocumentAnalysisRequest): Promise<unknown>;
  deleteFile(
    handle: Pick<ProviderFileHandle, "providerFileId">,
  ): Promise<ProviderFileDeletionResult>;
}

export interface DocumentProcessingAuthorization {
  id: string;
  householdId: string;
  actorProfileId: string;
  consentId?: string;
  purpose: string;
  privacyNoticeVersion: string;
  processorContractVersion: string;
  foreignProcessingAcknowledged: boolean;
  automatedProcessingAcknowledged: boolean;
  rawProcessingApproved: boolean;
  externalProcessingEnabled: boolean;
  authorizationResult:
    | "authorized"
    | "denied"
    | "authorized_no_transmission"
    | "blocked_no_transmission"
    | "processing_started"
    | "processing_failed"
    | "analysis_persisted";
  authorizedAt: string;
  analysisRequestId?: string;
}

export interface ExternalFileRecord {
  id: string;
  authorizationId: string;
  analysisRequestId?: string;
  policyDocumentId: string;
  providerFileId: string;
  uploadStartedAt: string;
  uploadCompletedAt?: string;
  uploadStatus: "started" | "completed" | "failed" | "rejected";
  processingStatus?: "ready" | "rejected" | "failed" | "timed_out";
  deletionStatus?: "pending" | "deleted" | "queued" | "failed_permanently";
  deletionAttempts: number;
  lastDeletionErrorCategory?: string;
  nextDeletionAttemptAt?: string;
  deletedAt?: string;
}

export interface AuthorizationStore {
  createAuthorization(
    auth: Omit<DocumentProcessingAuthorization, "id" | "authorizedAt">,
  ): Promise<DocumentProcessingAuthorization>;
  updateAuthorization(id: string, patch: Partial<DocumentProcessingAuthorization>): Promise<void>;
}

export interface ExternalFileLifecycleStore {
  recordUpload(
    record: Omit<ExternalFileRecord, "id" | "uploadStartedAt" | "deletionAttempts">,
  ): Promise<ExternalFileRecord>;
  markUploadCompleted(id: string, patch: Partial<ExternalFileRecord>): Promise<void>;
  recordDeletionAttempt(id: string, result: ProviderFileDeletionResult): Promise<void>;
  queueCleanup(
    id: string,
    failureCategory: string,
    nextAttemptAt: string,
    providerFileId?: string,
  ): Promise<void>;
  recordEmergencyCleanup(
    providerFileId: string,
    policyDocumentId?: string,
    failureCategory?: string,
  ): Promise<void>;
}

export interface FileBytesLoader {
  load(document: {
    documentId: string;
    filename: string;
    mimeType: string;
    fileReference: string;
  }): Promise<OriginalFileInput>;
}

export class MemoryFileBytesLoader implements FileBytesLoader {
  private bytesByReference: Record<string, Uint8Array>;

  constructor(bytesByReference: Record<string, Uint8Array>) {
    this.bytesByReference = bytesByReference;
  }

  async load(document: {
    documentId: string;
    filename: string;
    mimeType: string;
    fileReference: string;
  }): Promise<OriginalFileInput> {
    const bytes = this.bytesByReference[document.fileReference];
    if (!bytes) {
      throw new Error(`Bytes not found for file reference ${document.fileReference}`);
    }
    return {
      documentId: document.documentId,
      filename: document.filename,
      mimeType: document.mimeType,
      bytes,
    };
  }
}

export type DocumentProcessingStatus =
  | "uploaded"
  | "processing"
  | "ready"
  | "unsupported"
  | "too_large"
  | "invalid_file"
  | "processing_failed"
  | "temporarily_unavailable";

export type PublicDocumentErrorCode =
  | "DOCUMENT_FILE_UNSUPPORTED"
  | "DOCUMENT_FILE_TOO_LARGE"
  | "DOCUMENT_PROCESSING_FAILED"
  | "DOCUMENT_ANALYSIS_UNAVAILABLE"
  | "DOCUMENT_ANALYSIS_FAILED"
  | "DOCUMENT_MODEL_UNAVAILABLE"
  | "DOCUMENT_PROCESSING_AUTHORIZATION_REQUIRED";

export interface PublicDocumentError {
  code: PublicDocumentErrorCode;
  message: string;
  retryable: boolean;
  supportReference: string;
}

export interface PublicAnalyzedDocument {
  documentId: string;
  fileDigest: string;
  classification: string;
  pageCount: number;
  extractedEntityCount: number;
}

export interface PublicAssetCandidate {
  id: string;
  entityType: "property" | "vehicle";
  displayLabel: string;
  identityFingerprint: string;
  matchClassification: string;
  sourceDocumentIds: string[];
}

export interface PublicAnalysisWarning {
  message: string;
  documentId?: string;
}

export interface PublicDocumentAnalysisResult {
  analysisId: string;
  status: "completed";
  documents: PublicAnalyzedDocument[];
  candidates: PublicAssetCandidate[];
  warnings: PublicAnalysisWarning[];
}
