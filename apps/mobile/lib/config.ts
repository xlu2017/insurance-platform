import Constants from "expo-constants";

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  demoEmail?: string;
  demoPassword?: string;
}

let cached: AppConfig | null = null;
let loadPromise: Promise<AppConfig | null> | null = null;

export function getConfig(): AppConfig | null {
  return cached;
}

export function setConfig(config: AppConfig | null): void {
  cached = config;
}

export function getSupabaseUrl(): string {
  return cached?.supabaseUrl || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
}

export function getSupabaseAnonKey(): string {
  return cached?.supabaseAnonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
}

export function getDemoCredentials(): { email?: string; password?: string } {
  return {
    email: cached?.demoEmail || process.env.EXPO_PUBLIC_DEMO_EMAIL,
    password: cached?.demoPassword || process.env.EXPO_PUBLIC_DEMO_PASSWORD,
  };
}

export function getBypassHeaders(): Record<string, string> | undefined {
  const url = getSupabaseUrl();
  return url.includes(".loca.lt") ? { "Bypass-Tunnel-Reminder": "true" } : undefined;
}

function getConfigEndpoint(): string | undefined {
  return (
    process.env.EXPO_PUBLIC_CONFIG_ENDPOINT ||
    (Constants.expoConfig?.extra?.configEndpoint as string | undefined)
  );
}

// Dev/demo only: fetches unsigned JSON config (e.g. from a local tunnel) to
// point the app at a backend without rebuilding. It only carries the public
// anon key and demo credentials — never ship a production endpoint here.
export async function loadRemoteConfig(options?: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<AppConfig | null> {
  const endpoint = getConfigEndpoint();
  if (!endpoint) {
    return null;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10_000);

    const onAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", onAbort);

    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (endpoint.includes(".loca.lt")) {
        headers["Bypass-Tunnel-Reminder"] = "true";
      }
      const res = await fetch(endpoint, {
        signal: controller.signal,
        headers,
      });
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as unknown;
      if (!isAppConfig(data)) {
        return null;
      }
      cached = data;
      return cached;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener("abort", onAbort);
    }
  })();

  return loadPromise;
}

function isAppConfig(value: unknown): value is AppConfig {
  const candidate = value as Record<string, unknown> | undefined;
  return (
    candidate != null &&
    typeof candidate.supabaseUrl === "string" &&
    candidate.supabaseUrl.length > 0 &&
    typeof candidate.supabaseAnonKey === "string" &&
    candidate.supabaseAnonKey.length > 0
  );
}
