import "react-native-url-polyfill/auto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@autopilot/database";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { getBypassHeaders, getSupabaseAnonKey, getSupabaseUrl } from "./config";

const memoryStore = new Map<string, string>();

const withFallback = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

const ls =
  typeof globalThis !== "undefined" && (globalThis as Record<string, unknown>).localStorage
    ? ((globalThis as unknown as { localStorage: Storage }).localStorage as Storage)
    : null;

const webStorage = {
  getItem: (key: string) => Promise.resolve(ls?.getItem(key) ?? null),
  setItem: (key: string, value: string) => {
    ls?.setItem(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    ls?.removeItem(key);
    return Promise.resolve();
  },
};

const secureStoreAdapter = {
  getItem: (key: string) =>
    Platform.OS === "web"
      ? webStorage.getItem(key)
      : withFallback(() => SecureStore.getItemAsync(key), memoryStore.get(key) ?? null),
  setItem: (key: string, value: string) =>
    Platform.OS === "web"
      ? webStorage.setItem(key, value)
      : withFallback(
          () => SecureStore.setItemAsync(key, value),
          (memoryStore.set(key, value), undefined),
        ),
  removeItem: (key: string) =>
    Platform.OS === "web"
      ? webStorage.removeItem(key)
      : withFallback(() => SecureStore.deleteItemAsync(key), (memoryStore.delete(key), undefined)),
};

let activeClient: SupabaseClient<Database> | null = null;

function createSupabaseClient(): SupabaseClient<Database> {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  const bypassHeaders = getBypassHeaders();

  if (!url || !key) {
    throw new Error(
      "Missing Supabase URL or anon key. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, " +
        "or provide a remote config endpoint with EXPO_PUBLIC_CONFIG_ENDPOINT.",
    );
  }

  return createClient<Database>(url, key, {
    auth: {
      storage: secureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: {
      headers: bypassHeaders,
    },
  });
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!activeClient) {
    activeClient = createSupabaseClient();
  }
  return activeClient;
}

export function resetSupabaseClient(): void {
  activeClient = null;
}

export const supabase = new Proxy<SupabaseClient<Database>>({} as SupabaseClient<Database>, {
  get: (_target, prop) => {
    const client = getSupabaseClient();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
}) as SupabaseClient<Database>;

// Backwards-compatible helpers that read the currently loaded config.
export function getSupabaseUrlString(): string {
  return getSupabaseUrl();
}

export function getSupabaseAnonKeyString(): string {
  return getSupabaseAnonKey();
}

export function getBypassTunnelHeaders(): Record<string, string> | undefined {
  return getBypassHeaders();
}
