export const DANGEROUS_MODE_DISCLOSURE_VERSION = "dangerous-mode-v1";

export interface DangerousModeEnablePolicyInput {
  explicitConfirmation: boolean;
  foreignProcessingAcknowledged: boolean;
  automatedProcessingAcknowledged: boolean;
  rawProcessingApproved: boolean;
  disclosureVersion: string;
  tokenIssuedAtSeconds: number | null;
  passwordAuthenticatedAtSeconds?: number | null;
}

export type DangerousModePolicyFailure =
  | "ACKNOWLEDGEMENTS_REQUIRED"
  | "DISCLOSURE_VERSION_MISMATCH"
  | "RECENT_REAUTHENTICATION_REQUIRED";

export function validateDangerousModeEnablePolicy(
  input: DangerousModeEnablePolicyInput,
  nowSeconds = Math.floor(Date.now() / 1000),
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

  const authenticatedAt = input.passwordAuthenticatedAtSeconds;
  if (
    !authenticatedAt ||
    nowSeconds - authenticatedAt > 5 * 60 ||
    authenticatedAt > nowSeconds + 30
  ) {
    return "RECENT_REAUTHENTICATION_REQUIRED";
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
