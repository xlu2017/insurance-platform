export const DANGEROUS_MODE_DISCLOSURE_VERSION = "dangerous-mode-v1";

interface DenoEnv {
  get(name: string): string | undefined;
}

interface DenoLike {
  env?: DenoEnv;
}

interface ProcessLike {
  env?: Record<string, string | undefined>;
}

interface GlobalLike {
  Deno?: DenoLike;
  process?: ProcessLike;
}

function envValue(name: string): string | undefined {
  const g = globalThis as unknown as GlobalLike;

  if (g.Deno?.env?.get) {
    const value = g.Deno.env.get(name);
    if (value) return value;
  }

  if (g.process?.env?.[name]) {
    return g.process.env[name];
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
