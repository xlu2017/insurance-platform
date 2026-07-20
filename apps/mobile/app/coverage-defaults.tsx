import { router, Stack } from "expo-router";
import { ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Card, Loading, PageHeader, Screen } from "@/components/ui";
import { useHousehold } from "@/lib/household";
import { supabase } from "@/lib/supabase";
import { AutoMandateRows, PropertyMandateRows } from "@/components/coverage-rules";
import { loadHouseholdMandateV2 } from "@autopilot/database";
import { colors, spacing } from "@autopilot/design-tokens";

export default function CoverageDefaults() {
  const { data: household, isLoading: isLoadingHousehold } = useHousehold();
  const { data, isLoading } = useQuery({
    queryKey: ["coverage-defaults", household?.id],
    enabled: !!household,
    queryFn: async () => {
      if (!household) return null;
      return loadHouseholdMandateV2(supabase, household.id);
    },
  });

  if (isLoadingHousehold || isLoading) return <Loading />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen style={{ flex: 1, padding: 0 }}>
        <PageHeader title="Coverage defaults" backRoute="/coverage" />

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
            <Body muted>No coverage defaults set.</Body>
          ) : (
            <>
              <Card
                title="Auto defaults"
                onEdit={() => router.navigate("/edit-mandate")}
                style={{ marginBottom: spacing.md }}
              >
                <AutoMandateRows auto={data.mandate.householdAutoDefaults} />
              </Card>
              <Card
                title="Property defaults"
                onEdit={() => router.navigate("/edit-mandate")}
                style={{ marginBottom: spacing.md }}
              >
                <PropertyMandateRows property={data.mandate.householdPropertyDefaults} />
              </Card>
            </>
          )}
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
