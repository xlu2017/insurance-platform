import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const secureStoreAdapter = {
  getItem: (key: string) =>
    Platform.OS === "web" ? Promise.resolve(null) : SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    Platform.OS === "web" ? Promise.resolve() : SecureStore.setItemAsync(key, value),
  removeItem: (key: string) =>
    Platform.OS === "web" ? Promise.resolve() : SecureStore.deleteItemAsync(key),
};

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";

export const supabase = createClient(
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
