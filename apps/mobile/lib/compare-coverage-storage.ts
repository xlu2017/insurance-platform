import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "compare-coverage-state-v1";

export interface PersistedCompareState {
  selectedAssetIds: string[];
  colWidths: number[];
  hiddenSpecKeys: string[];
  showMode: "all" | "differences" | "identical";
}

function getWebStorage(): Storage | null {
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    return localStorage;
  }
  return null;
}

export const compareCoverageStorage = {
  load(): PersistedCompareState | null {
    try {
      const raw =
        Platform.OS === "web"
          ? (getWebStorage()?.getItem(STORAGE_KEY) ?? null)
          : SecureStore.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as PersistedCompareState;
    } catch {
      return null;
    }
  },
  save(state: PersistedCompareState): void {
    try {
      const raw = JSON.stringify(state);
      if (Platform.OS === "web") {
        getWebStorage()?.setItem(STORAGE_KEY, raw);
      } else {
        SecureStore.setItem(STORAGE_KEY, raw);
      }
    } catch {
      // ignore storage errors
    }
  },
  clear(): void {
    try {
      if (Platform.OS === "web") {
        getWebStorage()?.removeItem(STORAGE_KEY);
      } else {
        void SecureStore.deleteItemAsync(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  },
};
