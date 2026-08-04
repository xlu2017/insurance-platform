import {
  DANGEROUS_MODE_DISCLOSURE_VERSION,
  getPrivacyNoticeUrl,
  getPrivacyNoticeVersion,
  getProcessorContractVersion,
} from "@autopilot/schemas";

export {
  DANGEROUS_MODE_DISCLOSURE_VERSION,
  getPrivacyNoticeUrl,
  getPrivacyNoticeVersion,
  getProcessorContractVersion,
};

export interface DangerousModeEnablePolicyInput {
  explicitConfirmation: boolean;
  foreignProcessingAcknowledged: boolean;
  automatedProcessingAcknowledged: boolean;
  rawProcessingApproved: boolean;
  disclosureVersion: string;
}

export type DangerousModePolicyFailure =
  | "ACKNOWLEDGEMENTS_REQUIRED"
  | "DISCLOSURE_VERSION_MISMATCH";

export function validateDangerousModeEnablePolicy(
  input: DangerousModeEnablePolicyInput,
): DangerousModePolicyFailure | null {
  if (
    !input.explicitConfirmation ||
    !input.foreignProcessingAcknowledged ||
    !input.automatedProcessingAcknowledged ||
    !input.rawProcessingApproved
  ) {
    return "ACKNOWLEDGEMENTS_REQUIRED";
  }
  if (input.disclosureVersion !== DANGEROUS_MODE_DISCLOSURE_VERSION) {
    return "DISCLOSURE_VERSION_MISMATCH";
  }

  return null;
}

export function documentProcessingRoute(mode: "safe" | "dangerous"): {
  dispatchExternalProcessing: boolean;
  route: "manual_review" | "automatic_processing";
} {
  return mode === "dangerous"
    ? { dispatchExternalProcessing: true, route: "automatic_processing" }
    : { dispatchExternalProcessing: false, route: "manual_review" };
}
