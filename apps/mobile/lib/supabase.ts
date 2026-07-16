import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@autopilot/database";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

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

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

export const supabase = createClient<Database>(
  SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  {
    auth: {
      storage: secureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
