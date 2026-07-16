import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function createSupabaseClient(config: SupabaseConfig): SupabaseClient<Database> {
  return createClient<Database>(config.url, config.anonKey);
}

/** Default local development endpoints (supabase start). */
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";
