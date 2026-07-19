import type {
  AuthorizationStore,
  DocumentProcessingAuthorization,
  OriginalFileInput,
} from "./native-document-analysis.ts";

export type PrivacyPreparationMode = "raw_original" | "sanitized_derivative";

export interface PrivacyPreparationResult {
  mode: PrivacyPreparationMode;
  file: OriginalFileInput;
  privacyAssessmentId: string;
}

export interface DocumentPrivacyPreparation {
  prepare(input: OriginalFileInput): Promise<PrivacyPreparationResult>;
  authorize(
    actorProfileId: string,
    authorizationStore: AuthorizationStore,
  ): Promise<DocumentProcessingAuthorization>;
}

export interface PrivacyGateConfig {
  externalDocumentProcessingEnabled: boolean;
  rawExternalDocumentProcessingApproved: boolean;
  privacyNoticeVersion: string;
  processorContractVersion: string;
  cleanupReadinessCheck?: () => Promise<boolean>;
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

export class ConfigAndConsentPrivacyPreparation implements DocumentPrivacyPreparation {
  private config: PrivacyGateConfig;
  private consent: ProcessingConsentCheck | undefined;

  constructor(config: PrivacyGateConfig, consent?: ProcessingConsentCheck) {
    this.config = config;
    this.consent = consent;
  }

  private async assertAuthorized(): Promise<void> {
    if (!this.config.externalDocumentProcessingEnabled) {
      throw new Error(
        "Document processing is not enabled. External document processing must be enabled by the operator.",
      );
    }
    if (!this.config.rawExternalDocumentProcessingApproved) {
      throw new Error(
        "Raw external document processing is not approved. Operator approval is required before transmitting original files.",
      );
    }
    if (!this.config.privacyNoticeVersion || !this.config.processorContractVersion) {
      throw new Error(
        "Privacy notice and processor contract versions must be configured before document processing.",
      );
    }
    if (!this.consent) {
      throw new Error(
        "Document processing consent is missing. The customer must provide explicit consent before analysis.",
      );
    }
    if (this.consent.withdrawnAt) {
      throw new Error("Document processing consent has been withdrawn.");
    }
    if (!this.consent.foreignProcessingAcknowledged) {
      throw new Error(
        "Foreign processing acknowledgement is required before documents can be analyzed externally.",
      );
    }
    if (!this.consent.automatedProcessingAcknowledged) {
      throw new Error(
        "Automated processing acknowledgement is required before documents can be analyzed.",
      );
    }
    if (!this.consent.rawProcessingApproved) {
      throw new Error("Raw document processing is not approved for this customer consent.");
    }
    if (this.consent.privacyNoticeVersion !== this.config.privacyNoticeVersion) {
      throw new Error("The recorded privacy notice version is out of date.");
    }
    if (this.consent.processorContractVersion !== this.config.processorContractVersion) {
      throw new Error("The recorded processor contract version is out of date.");
    }

    if (this.config.cleanupReadinessCheck) {
      const ready = await this.config.cleanupReadinessCheck();
      if (!ready) {
        throw new Error(
          "Cleanup worker readiness has not been verified. External processing is blocked.",
        );
      }
    }
  }

  async prepare(input: OriginalFileInput): Promise<PrivacyPreparationResult> {
    await this.assertAuthorized();
    const privacyAssessmentId = `privacy-${this.consent!.householdId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return {
      mode: "raw_original",
      file: input,
      privacyAssessmentId,
    };
  }

  async authorize(
    actorProfileId: string,
    authorizationStore: AuthorizationStore,
  ): Promise<DocumentProcessingAuthorization> {
    await this.assertAuthorized();
    return authorizationStore.createAuthorization({
      householdId: this.consent!.householdId,
      actorProfileId,
      consentId: this.consent!.id,
      purpose: this.consent!.purpose,
      privacyNoticeVersion: this.consent!.privacyNoticeVersion,
      processorContractVersion: this.consent!.processorContractVersion,
      foreignProcessingAcknowledged: this.consent!.foreignProcessingAcknowledged,
      automatedProcessingAcknowledged: this.consent!.automatedProcessingAcknowledged,
      rawProcessingApproved: this.consent!.rawProcessingApproved,
      externalProcessingEnabled: this.config.externalDocumentProcessingEnabled,
      authorizationResult: "authorized",
    });
  }
}

export function privacyPreparationConfigFromEnv(
  getEnv: (name: string) => string | undefined,
): PrivacyGateConfig {
  return {
    externalDocumentProcessingEnabled: getEnv("EXTERNAL_DOCUMENT_PROCESSING_ENABLED") === "true",
    rawExternalDocumentProcessingApproved:
      getEnv("RAW_EXTERNAL_DOCUMENT_PROCESSING_APPROVED") === "true",
    privacyNoticeVersion: getEnv("PRIVACY_NOTICE_VERSION") ?? "",
    processorContractVersion: getEnv("PROCESSOR_CONTRACT_VERSION") ?? "",
  };
}
