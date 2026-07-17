import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export interface ExtractionCandidate {
  id: string;
  session_id: string;
  asset_type: "vehicle" | "property";
  identity_fingerprint: string;
  display_label: string;
  occupancy: string | null;
  match_classification: string;
  decision: string;
  review_status: string;
  selected_facts_json: Record<string, string>;
  conflicts_json: unknown[];
  extracted_fact_assertions?: { id: string; field_path: string; normalized_value: unknown }[];
}

export interface ExtractionSession {
  id: string;
  household_id: string;
  status: string;
}

export function useOpenExtractionSession(householdId: string | undefined) {
  return useQuery({
    queryKey: ["extraction-session", householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<ExtractionSession | null> => {
      const { data, error } = await supabase
        .from("document_extraction_sessions")
        .select("id, household_id, status")
        .eq("household_id", householdId!)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useExtractionCandidates(sessionId: string | undefined) {
  return useQuery({
    queryKey: ["extraction-candidates", sessionId],
    enabled: !!sessionId,
    queryFn: async (): Promise<ExtractionCandidate[]> => {
      const { data, error } = await supabase
        .from("asset_candidates")
        .select("*, extracted_fact_assertions!candidate_id(id, field_path, normalized_value)")
        .eq("session_id", sessionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ExtractionCandidate[];
    },
  });
}
