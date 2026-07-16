import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

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
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useActiveCase(householdId: string | undefined) {
  return useQuery({
    queryKey: ["active-case", householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("optimization_cases")
        .select("id, state, renewal_date")
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
