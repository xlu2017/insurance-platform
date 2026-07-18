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
  uploadOriginalFile(input: OriginalFileInput): Promise<ProviderUploadResult>;
  analyze(input: NativeDocumentAnalysisRequest): Promise<unknown>;
  deleteFile(handle: ProviderFileHandle): Promise<ProviderFileDeletionResult>;
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
  | "DOCUMENT_MODEL_UNAVAILABLE";

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
