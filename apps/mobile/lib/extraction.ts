import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Json } from "@autopilot/database";

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}

export interface ExtractionCandidate {
  id: string;
  session_id: string;
  household_id: string;
  asset_type: "vehicle" | "property";
  identity_fingerprint: string;
  display_label: string;
  occupancy: string | null;
  match_classification: string;
  decision: string;
  review_status: string;
  selected_facts_json: Record<string, unknown>;
  conflicts_json: unknown[];
  extracted_fact_assertions?: { id: string; field_path: string; normalized_value: unknown }[];
}

export interface ExtractionSession {
  id: string;
  household_id: string;
  status: string;
}

export interface CandidateFieldReview {
  id: string;
  candidate_id: string;
  household_id: string;
  field_path: string;
  action: "confirm" | "correct" | "unknown" | "change_mandate" | "reset_mandate_to_current";
  corrected_value?: unknown;
  mandate_rule_json?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
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

export function useExtractionCandidates(householdId: string | undefined) {
  return useQuery({
    queryKey: ["extraction-candidates", householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<ExtractionCandidate[]> => {
      const { data, error } = await supabase
        .from("asset_candidates")
        .select("*, extracted_fact_assertions!candidate_id(id, field_path, normalized_value)")
        .eq("household_id", householdId!)
        .in("review_status", ["pending", "reviewing"])
        .in("decision", ["undecided", "not_sure"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ExtractionCandidate[];
    },
  });
}

export function useCandidateFieldReviews(candidateIds: string[] | undefined) {
  return useQuery({
    queryKey: ["candidate-field-reviews", candidateIds],
    enabled: !!candidateIds && candidateIds.length > 0,
    queryFn: async (): Promise<CandidateFieldReview[]> => {
      const { data, error } = await supabase
        .from("candidate_field_reviews")
        .select("*")
        .in("candidate_id", candidateIds!)
        .order("field_path", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CandidateFieldReview[];
    },
  });
}

export function useSaveCandidateFieldReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      review: Pick<
        CandidateFieldReview,
        | "candidate_id"
        | "household_id"
        | "field_path"
        | "action"
        | "corrected_value"
        | "mandate_rule_json"
      >,
    ): Promise<CandidateFieldReview> => {
      const { data, error } = await supabase
        .from("candidate_field_reviews")
        .upsert(
          {
            candidate_id: review.candidate_id,
            household_id: review.household_id,
            field_path: review.field_path,
            action: review.action,
            corrected_value: toJson(review.corrected_value),
            mandate_rule_json: toJson(review.mandate_rule_json),
          },
          { onConflict: "candidate_id,field_path" },
        )
        .select()
        .single();
      if (error) throw error;
      if (!data) throw new Error("Failed to save field review");
      return data as CandidateFieldReview;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["candidate-field-reviews", [variables.candidate_id]],
      });
    },
  });
}
