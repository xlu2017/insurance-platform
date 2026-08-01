// Platform-specific mobile adapter for document-processing configuration.
//
// Expo only inlines EXPO_PUBLIC_* variables when they are accessed statically
// with dot notation in source code. Dynamic access through node_modules packages
// may not be transformed, so the mobile app reads values here and re-exports the
// shared constants from @autopilot/schemas.
import {
  DANGEROUS_MODE_DISCLOSURE_VERSION,
  getPrivacyNoticeVersion as getPrivacyNoticeVersionBase,
} from "@autopilot/schemas";

export { DANGEROUS_MODE_DISCLOSURE_VERSION };

export function getPrivacyNoticeVersion(): string {
  return getPrivacyNoticeVersionBase();
}

export function getPrivacyNoticeUrl(): string | undefined {
  return process.env.EXPO_PUBLIC_PRIVACY_NOTICE_URL;
}

export function getProcessorContractVersion(): string | undefined {
  return process.env.EXPO_PUBLIC_PROCESSOR_CONTRACT_VERSION;
}
