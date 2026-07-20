import { router, Stack } from "expo-router";
import { ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Card, Loading, PageHeader, Screen } from "@/components/ui";
import { useHousehold } from "@/lib/household";
import { supabase } from "@/lib/supabase";
import { SwitchingRows } from "@/components/coverage-rules";
import { loadHouseholdMandateV2 } from "@autopilot/database";
import { colors, spacing } from "@autopilot/design-tokens";

export default function SwitchingConditions() {
  const { data: household, isLoading: isLoadingHousehold } = useHousehold();
  const { data, isLoading } = useQuery({
    queryKey: ["switching-conditions", household?.id],
    enabled: !!household,
    queryFn: async () => {
      if (!household) return null;
      const [mandateResult, insurers] = await Promise.all([
        loadHouseholdMandateV2(supabase, household.id),
        supabase.from("insurers").select("id, name").eq("active", true),
      ]);
      const insurerMap = new Map((insurers.data ?? []).map((i) => [i.id, i.name]));
      const excludedNames = mandateResult.switching.excludedInsurerIds
        .map((id) => insurerMap.get(id))
        .filter((name): name is string => Boolean(name));
      return { switching: mandateResult.switching, excludedNames };
    },
  });

  if (isLoadingHousehold || isLoading) return <Loading />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen style={{ flex: 1, padding: 0 }}>
        <PageHeader title="Switching conditions" backRoute="/coverage" />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 0,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: spacing.xxl,
          }}
        >
          {!data ? (
            <Body muted>No switching conditions set.</Body>
          ) : (
            <Card title="Switching conditions" onEdit={() => router.navigate("/edit-mandate")}>
              <SwitchingRows prefs={data.switching} excludedNames={data.excludedNames} />
            </Card>
          )}
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
