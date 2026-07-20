import { router, Stack } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { CaretLeftIcon } from "phosphor-react-native";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Card, Loading, Screen, Title } from "@/components/ui";
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
            onPress={() => router.navigate("/coverage")}
            style={{ position: "absolute", left: spacing.lg, padding: spacing.sm }}
          >
            <CaretLeftIcon color={colors.ink} size={28} />
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
