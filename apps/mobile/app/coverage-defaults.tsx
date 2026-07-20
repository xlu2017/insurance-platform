import { router, Stack } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Card, Loading, Screen, Subtitle, Title } from "@/components/ui";
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
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            minHeight: 56,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.push("/coverage")}
            style={{ position: "absolute", left: spacing.lg, padding: spacing.sm }}
          >
            <Body style={{ fontSize: 28, lineHeight: 28, color: colors.ink }}>{"<"}</Body>
          </Pressable>
          <Title style={{ marginBottom: 0 }}>Coverage defaults</Title>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 0,
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxl,
          }}
        >
          {!data ? (
            <Body muted>No coverage defaults set.</Body>
          ) : (
            <>
              <Card style={{ marginBottom: spacing.md }}>
                <Subtitle style={{ marginBottom: spacing.sm }}>Auto defaults</Subtitle>
                <AutoMandateRows auto={data.mandate.householdAutoDefaults} />
              </Card>
              <Card style={{ marginBottom: spacing.md }}>
                <Subtitle style={{ marginBottom: spacing.sm }}>Property defaults</Subtitle>
                <PropertyMandateRows property={data.mandate.householdPropertyDefaults} />
              </Card>
            </>
          )}
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
