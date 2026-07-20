import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AssetEditModal } from "@/components/asset-edit-modal";
import { Body, Card, Loading, PageHeader, Row, Screen, Title } from "@/components/ui";
import { AutoMandateRows } from "@/components/coverage-rules";
import { useHousehold } from "@/lib/household";
import { supabase } from "@/lib/supabase";
import { loadHouseholdMandateV2, resolveEffectiveVehicleMandateV2 } from "@autopilot/database";
import { colors, spacing } from "@autopilot/design-tokens";

type VehicleCandidate = {
  id: string;
  display_label: string | null;
};

export default function VehicleDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: household, isLoading: isLoadingHousehold } = useHousehold();
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["vehicle", id, household?.id],
    enabled: !!household && !!id,
    queryFn: async () => {
      if (!household || !id) return null;
      const [{ data: row, error: vehicleError }, { data: candidateRows }, mandateResult] =
        await Promise.all([
          supabase
            .from("vehicles")
            .select(
              "id, year, make, model, vin, financing_status, vehicle_use_class, is_classic, is_modified",
            )
            .eq("id", id)
            .eq("household_id", household.id)
            .single(),
          supabase
            .from("asset_candidates")
            .select("id, display_label")
            .eq("household_id", household.id)
            .eq("approved_asset_type", "vehicle")
            .eq("approved_asset_id", id)
            .in("review_status", ["approved", "confirmed"])
            .limit(1),
          loadHouseholdMandateV2(supabase, household.id),
        ]);
      if (vehicleError) throw new Error(vehicleError.message);
      if (!row) throw new Error("Vehicle not found");
      const effective = resolveEffectiveVehicleMandateV2(mandateResult.mandate, row.id);
      return {
        vehicle: row,
        candidate: (candidateRows ?? [])[0] as VehicleCandidate | undefined,
        effective,
      };
    },
  });

  if (isLoadingHousehold || isLoading) return <Loading />;

  if (error || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
        <Screen>
          <Title>Vehicle not found</Title>
          <Body muted>{error ? String(error.message) : "This vehicle does not exist."}</Body>
          <Pressable onPress={() => router.navigate("/vehicles")}>
            <Body style={{ color: colors.accent }}>Go back</Body>
          </Pressable>
        </Screen>
      </SafeAreaView>
    );
  }

  const { vehicle, candidate, effective } = data;
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
        <PageHeader title="Vehicle coverage" backRoute="/vehicles" />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 0,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: spacing.xxl,
          }}
        >
          <Card
            title={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            onEdit={() => setEditOpen(true)}
            style={{ marginBottom: spacing.md }}
          >
            {tags ? (
              <Body muted style={{ marginBottom: spacing.md }}>
                {tags}
              </Body>
            ) : null}
            {vehicle.vin ? <Row label="VIN" value={vehicle.vin} /> : null}
          </Card>

          <Card
            title="Coverage rules"
            onEdit={() => router.navigate("/edit-mandate")}
            style={{ marginBottom: spacing.md }}
          >
            <AutoMandateRows auto={effective} />
          </Card>

          <Pressable onPress={() => refetch()}>
            <Body style={{ color: colors.accent }}>Refresh</Body>
          </Pressable>
        </ScrollView>
      </Screen>

      <AssetEditModal
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        payload={{ type: "vehicle", asset: vehicle }}
        candidate={candidate ?? null}
        onSaved={() => refetch()}
      />
    </SafeAreaView>
  );
}
