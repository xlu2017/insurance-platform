export const DANGEROUS_MODE_DISCLOSURE_VERSION = "dangerous-mode-v1";

function envValue(name: string): string | undefined {
  try {
    const g = globalThis as any;
    if (g.Deno?.env?.get) {
      const value = g.Deno.env.get(name);
      if (value) return value;
    }
  } catch {
    // Deno may not be available or env access may be restricted.
  }

  try {
    const g = globalThis as any;
    if (g.process?.env?.[name]) {
      return g.process.env[name];
    }
  } catch {
    // process may not be available in some runtimes.
  }

  return undefined;
}

export function getPrivacyNoticeUrl(): string | undefined {
  return envValue("EXPO_PUBLIC_PRIVACY_NOTICE_URL") ?? envValue("PRIVACY_NOTICE_URL");
}

export function getProcessorContractVersion(): string | undefined {
  return (
    envValue("EXPO_PUBLIC_PROCESSOR_CONTRACT_VERSION") ?? envValue("PROCESSOR_CONTRACT_VERSION")
  );
}

export function getPrivacyNoticeVersion(): string {
  return DANGEROUS_MODE_DISCLOSURE_VERSION;
}
