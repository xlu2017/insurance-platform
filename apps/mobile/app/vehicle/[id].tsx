import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Card, Loading, Row, Screen, Subtitle, Title } from "@/components/ui";
import { AutoMandateRows } from "@/components/coverage-rules";
import { useHousehold } from "@/lib/household";
import { supabase } from "@/lib/supabase";
import { loadHouseholdMandateV2, resolveEffectiveVehicleMandateV2 } from "@autopilot/database";
import { colors, spacing } from "@autopilot/design-tokens";

export default function VehicleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: household, isLoading: isLoadingHousehold } = useHousehold();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["vehicle", id, household?.id],
    enabled: !!household && !!id,
    queryFn: async () => {
      if (!household || !id) return null;
      const [{ data: row, error: vehicleError }, mandateResult] = await Promise.all([
        supabase
          .from("vehicles")
          .select(
            "id, year, make, model, vin, financing_status, vehicle_use_class, is_classic, is_modified",
          )
          .eq("id", id)
          .eq("household_id", household.id)
          .single(),
        loadHouseholdMandateV2(supabase, household.id),
      ]);
      if (vehicleError) throw new Error(vehicleError.message);
      if (!row) throw new Error("Vehicle not found");
      const effective = resolveEffectiveVehicleMandateV2(mandateResult.mandate, row.id);
      return { vehicle: row, effective };
    },
  });

  if (isLoadingHousehold || isLoading) return <Loading />;

  if (error || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
        <Screen>
          <Title>Vehicle not found</Title>
          <Body muted>{error ? String(error.message) : "This vehicle does not exist."}</Body>
          <Pressable onPress={() => router.back()}>
            <Body style={{ color: colors.accent }}>Go back</Body>
          </Pressable>
        </Screen>
      </SafeAreaView>
    );
  }

  const { vehicle, effective } = data;
  const tags = [
    vehicle.financing_status ? vehicle.financing_status.replace("_", " ") : null,
    vehicle.vehicle_use_class ? vehicle.vehicle_use_class.replace("_", " ") : null,
    vehicle.is_classic ? "Classic" : null,
    vehicle.is_modified ? "Modified" : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
            onPress={() => router.back()}
            style={{ position: "absolute", left: spacing.lg, padding: spacing.sm }}
          >
            <Body style={{ fontSize: 28, lineHeight: 28, color: colors.ink }}>{"<"}</Body>
          </Pressable>
          <Title style={{ marginBottom: 0 }}>Vehicle coverage</Title>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 0,
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxl,
          }}
        >
          <Card style={{ marginBottom: spacing.md }}>
            <Subtitle style={{ marginBottom: spacing.sm }}>
              {`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            </Subtitle>
            {tags ? (
              <Body muted style={{ marginBottom: spacing.md }}>
                {tags}
              </Body>
            ) : null}
            {vehicle.vin ? <Row label="VIN" value={vehicle.vin} /> : null}
          </Card>

          <Card style={{ marginBottom: spacing.md }}>
            <Subtitle style={{ marginBottom: spacing.sm }}>Coverage rules</Subtitle>
            <AutoMandateRows auto={effective} />
          </Card>

          <Pressable onPress={() => refetch()}>
            <Body style={{ color: colors.accent }}>Refresh</Body>
          </Pressable>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
