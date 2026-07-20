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
  approved_asset_id?: string | null;
  approved_asset_type?: "vehicle" | "property" | null;
  draft_decision?: "approve_new" | "link_existing" | "skip" | "needs_correction" | null;
  draft_identity_confirmed?: boolean;
  draft_existing_asset_id?: string | null;
  draft_existing_asset_type?: "vehicle" | "property" | null;
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
  action:
    | "confirm"
    | "correct"
    | "unknown"
    | "change_mandate"
    | "reset_mandate_to_current"
    | "not_applicable"
    | "pending"
    | "keep_current"
    | "use_document_value"
    | "use_corrected_document_value"
    | "unresolved";
  batch_id?: string | null;
  value_state?: "known" | "absent" | "unknown" | "not_applicable" | "conflicting" | null;
  specification_title?: string | null;
  mandate_path?: string | null;
  original_extracted_value?: unknown;
  document_implied_value?: unknown;
  document_implied_mandate_value?: unknown;
  current_mandate_value?: unknown;
  prior_mandate_value?: unknown;
  corrected_value?: unknown;
  correction_reason?: CorrectionReason | null;
  mandate_rule_json?: Record<string, unknown>;
  source_document_id?: string | null;
  source_page_number?: number | null;
  source_section?: string | null;
  confidence?: number | null;
  conflict_values_json?: unknown[];
  material_conflict?: boolean;
  is_complete?: boolean;
  completed_at?: string | null;
  asset_candidate?: Pick<
    ExtractionCandidate,
    | "id"
    | "display_label"
    | "asset_type"
    | "draft_decision"
    | "draft_existing_asset_id"
    | "draft_existing_asset_type"
  > & { session_id?: string };
  source_document?: { file_name: string } | null;
  created_at: string;
  updated_at: string;
}

export type CorrectionReason =
  | "document_was_read_incorrectly"
  | "policy_wording_is_unclear"
  | "value_changed_after_document_issue"
  | "wrong_source_document"
  | "other";

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

export function useExtractionCandidates(householdId: string | undefined, sessionId?: string) {
  return useQuery({
    queryKey: ["extraction-candidates", householdId, sessionId],
    enabled: !!householdId,
    queryFn: async (): Promise<ExtractionCandidate[]> => {
      let query = supabase
        .from("asset_candidates")
        .select("*, extracted_fact_assertions!candidate_id(id, field_path, normalized_value)")
        .eq("household_id", householdId!)
        .in("review_status", ["pending", "reviewing"])
        .in("decision", ["undecided", "not_sure"])
        .order("created_at", { ascending: true });
      if (sessionId) query = query.eq("session_id", sessionId);
      const { data, error } = await query;
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

export interface ApproveCandidateDecision {
  candidate_id: string;
  decision: "approve_new" | "link_existing" | "skip" | "needs_correction";
  existing_asset_id?: string;
  existing_asset_type?: "vehicle" | "property";
  identity_confirmed?: boolean;
  mandate_values?: Record<string, unknown>;
}

export interface ApprovalMandateContext {
  jurisdiction: "AB";
  householdAutoDefaults: Record<string, unknown>;
  householdPropertyDefaults: Record<string, unknown>;
  switchingPreferences: Record<string, unknown>;
}

export async function approveCandidateAssetsV2(
  householdId: string,
  actorProfileId: string,
  clientRequestId: string,
  decisions: ApproveCandidateDecision[],
  mandateContext?: ApprovalMandateContext,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("approve_candidate_assets_v2", {
    p_household_id: householdId,
    p_actor_profile_id: actorProfileId,
    p_client_request_id: clientRequestId,
    p_decisions: toJson(decisions),
    p_jurisdiction: mandateContext?.jurisdiction,
    p_household_auto_defaults: mandateContext
      ? toJson(mandateContext.householdAutoDefaults)
      : undefined,
    p_household_property_defaults: mandateContext
      ? toJson(mandateContext.householdPropertyDefaults)
      : undefined,
    p_switching_preferences: mandateContext
      ? toJson(mandateContext.switchingPreferences)
      : undefined,
  });
  if (error) throw error;
  if (!data) throw new Error("approve_candidate_assets_v2 returned no data");
  return data as Record<string, unknown>;
}

export function useMandateReviewItems(householdId: string | undefined, sessionId?: string) {
  return useQuery({
    queryKey: ["mandate-review-items", householdId, sessionId],
    enabled: !!householdId,
    queryFn: async (): Promise<CandidateFieldReview[]> => {
      const { data, error } = await supabase
        .from("candidate_field_reviews")
        .select(
          "*, asset_candidate:asset_candidates!candidate_id(id, display_label, asset_type, draft_decision, draft_existing_asset_id, draft_existing_asset_type, session_id), source_document:policy_documents!source_document_id(file_name)",
        )
        .eq("household_id", householdId!)
        .not("batch_id", "is", null)
        .in("asset_candidate.draft_decision", ["approve_new", "link_existing"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as CandidateFieldReview[]).filter(
        (item) =>
          (item.asset_candidate?.draft_decision === "approve_new" ||
            item.asset_candidate?.draft_decision === "link_existing") &&
          (!sessionId || item.asset_candidate.session_id === sessionId),
      );
    },
  });
}

export async function saveMandateReviewItem(
  householdId: string,
  reviewId: string,
  input: {
    action: CandidateFieldReview["action"];
    currentMandateValue: unknown;
    correctedValue?: unknown;
    correctionReason?: CorrectionReason;
    isComplete: boolean;
  },
): Promise<void> {
  const { error } = await supabase.rpc("save_mandate_review_item_v1", {
    p_household_id: householdId,
    p_review_id: reviewId,
    p_action: input.action,
    p_current_mandate_value: toJson(input.currentMandateValue),
    p_corrected_value: input.correctedValue === undefined ? null : toJson(input.correctedValue),
    p_correction_reason: input.correctionReason ?? undefined,
    p_is_complete: input.isComplete,
  });
  if (error) throw error;
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
