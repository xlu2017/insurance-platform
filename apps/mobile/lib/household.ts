import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { invokeEdgeFunction } from "./edge-functions";

export interface HouseholdSummary {
  id: string;
  name: string;
  province: string;
  autopilot_active: boolean;
  onboarding_step: string;
}

export function useHousehold() {
  return useQuery({
    queryKey: ["household"],
    queryFn: async (): Promise<HouseholdSummary | null> => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return null;
      const { data, error } = await supabase
        .from("households")
        .select("id, name, province, autopilot_active, onboarding_step")
        .eq("owner_profile_id", userData.user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export interface OptimizationCase {
  id: string;
  household_id: string;
  state: string;
  renewal_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  session_id?: string | null;
  closed_from_state?: string | null;
}

export function useOptimizationCases(householdId: string | undefined) {
  return useQuery({
    queryKey: ["optimization-cases", householdId],
    enabled: !!householdId,
    queryFn: async (): Promise<OptimizationCase[]> => {
      const { data, error } = await invokeEdgeFunction<OptimizationCase[]>(
        "document-processing-batch",
        { action: "list-cases", household_id: householdId },
      );
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

export function useActiveCase(householdId: string | undefined, caseId?: string) {
  return useQuery({
    queryKey: ["active-case", householdId, caseId],
    enabled: !!householdId,
    queryFn: async () => {
      if (caseId) {
        const { data, error } = await supabase
          .from("optimization_cases")
          .select("id, household_id, state, renewal_date, closed_from_state")
          .eq("id", caseId)
          .eq("household_id", householdId!)
          .maybeSingle();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from("optimization_cases")
        .select("id, household_id, state, renewal_date, closed_from_state")
        .eq("household_id", householdId!)
        .not("state", "in", "(completed,retained_incumbent,cancelled)")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useHistoricalCase(householdId: string | undefined) {
  return useQuery({
    queryKey: ["historical-case", householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("optimization_cases")
        .select("id, state, renewal_date")
        .eq("household_id", householdId!)
        .in("state", ["completed", "retained_incumbent", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
