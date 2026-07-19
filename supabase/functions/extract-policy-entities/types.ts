// Real Edge Function domain types matching the shared document-extraction package.
// Keep this file in sync with packages/document-extraction/src/document-analyzer.ts
// and packages/document-extraction/src/providers/*.

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

export interface ProcessingConsentCheck {
  id?: string;
  householdId: string;
  profileId?: string;
  purpose: string;
  privacyNoticeVersion: string;
  processorContractVersion: string;
  foreignProcessingAcknowledged: boolean;
  automatedProcessingAcknowledged: boolean;
  rawProcessingApproved: boolean;
  withdrawnAt?: string | null;
}

export interface EvidenceReference {
  documentId: string;
  pageNumber?: number;
  quotedLabel?: string;
  evidenceSummary: string;
}

export interface ExtractedCurrentValue {
  status: "known" | "unknown" | "not_included" | "not_applicable" | "conflicting";
  value: unknown;
  confidence: number;
  evidence?: EvidenceReference[];
  explanation?: string;
}

export interface DetectedEntityIdentity {
  fullAddress?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  occupancy?: "principal_residence" | "rental" | "other" | "unknown" | null;
  vin?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  vehicleUse?: string | null;
}

export interface EntityResolution {
  status:
    | "new"
    | "matches_existing"
    | "matches_pending_candidate"
    | "possible_match_requires_confirmation";
  matchedExistingEntityId?: string | null;
  matchedPendingCandidateId?: string | null;
  confidence: number;
  reasoning: string;
}

export interface CurrentPolicy {
  insurer?: string | null;
  policyNumber?: string | null;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  annualPremiumCents?: number | null;
}

export interface CandidateIdentity {
  exactIdentityFingerprint: string | null;
  provisionalCandidateKey: string;
  identityStrength: "exact" | "partial" | "redacted" | "unknown";
}

export interface DetectedInsuranceEntity {
  temporaryId: string;
  canonicalFingerprint: string;
  candidateIdentity: CandidateIdentity;
  entityType: "property" | "vehicle";
  displayLabel: string;
  identity: DetectedEntityIdentity;
  resolution: EntityResolution;
  currentPolicy: CurrentPolicy;
  currentCoverage: Record<string, ExtractedCurrentValue>;
  mandateSuggestions: Record<string, unknown>;
  evidence: EvidenceReference[];
  requiredConfirmations: string[];
}

export interface ExistingHouseholdAsset {
  id: string;
  assetType: "property" | "vehicle";
  identityFingerprint: string;
  displayLabel?: string;
  candidateIdentity?: CandidateIdentity;
  identity?: DetectedEntityIdentity;
  currentPolicy?: CurrentPolicy;
}

export interface PendingEntityCandidate {
  id: string;
  assetType: "property" | "vehicle";
  identityFingerprint: string;
  displayLabel?: string;
  candidateIdentity?: CandidateIdentity;
  identity?: DetectedEntityIdentity;
  currentPolicy?: CurrentPolicy;
}

export interface CandidateComparisonContext {
  id: string;
  entityType: "property" | "vehicle";
  displayLabel?: string;
  identity: Partial<DetectedEntityIdentity>;
  currentPolicy?: Partial<CurrentPolicy>;
  exactIdentityFingerprint: string | null;
  provisionalCandidateKey: string;
}

export interface UploadedDocument {
  documentId: string;
  filename: string;
  mimeType: string;
  fileReference: string;
}

export interface InsuranceDocumentAnalysisInput {
  householdId: string;
  uploadedDocuments: UploadedDocument[];
  existingAssets: ExistingHouseholdAsset[];
  pendingCandidates: PendingEntityCandidate[];
  priorDocumentSummaries: {
    documentId: string;
    fileDigest?: string;
    classification?: string;
    detectedEntityCount: number;
  }[];
  jurisdiction: "AB";
}
