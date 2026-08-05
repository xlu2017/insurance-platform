import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AssetEditModal } from "@/components/asset-edit-modal";
import { Body, Card, Loading, Row, Screen, Title } from "@/components/ui";
import { PropertyMandateRows } from "@/components/coverage-rules";
import { useHousehold } from "@/lib/household";
import { supabase } from "@/lib/supabase";
import { loadHouseholdMandateV2, resolveEffectivePropertyMandateV2 } from "@autopilot/database";
import { colors, spacing } from "@autopilot/design-tokens";

type PropertyCandidate = {
  id: string;
  display_label: string | null;
};

export default function PropertyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: household, isLoading: isLoadingHousehold } = useHousehold();
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["property", id, household?.id],
    enabled: !!household && !!id,
    queryFn: async () => {
      if (!household || !id) return null;
      const [{ data: row, error: propertyError }, { data: candidateRows }, mandateResult] =
        await Promise.all([
          supabase
            .from("properties")
            .select(
              "id, address_line1, city, province, postal_code, property_type, owner_occupied, year_built",
            )
            .eq("id", id)
            .eq("household_id", household.id)
            .single(),
          supabase
            .from("asset_candidates")
            .select("id, display_label")
            .eq("household_id", household.id)
            .eq("approved_asset_type", "property")
            .eq("approved_asset_id", id)
            .in("review_status", ["approved", "confirmed"])
            .limit(1),
          loadHouseholdMandateV2(supabase, household.id),
        ]);
      if (propertyError) throw new Error(propertyError.message);
      if (!row) throw new Error("Property not found");
      const effective = resolveEffectivePropertyMandateV2(mandateResult.mandate, row.id);
      return {
        property: row,
        candidate: (candidateRows ?? [])[0] as PropertyCandidate | undefined,
        effective,
      };
    },
  });

  if (isLoadingHousehold || isLoading) return <Loading />;

  if (error || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
        <Screen>
          <Title>Property not found</Title>
          <Body muted>{error ? String(error.message) : "This property does not exist."}</Body>
          <Pressable onPress={() => router.navigate("/properties")}>
            <Body style={{ color: colors.accent }}>Go back</Body>
          </Pressable>
        </Screen>
      </SafeAreaView>
    );
  }

  const { property, candidate, effective } = data;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
      <Screen style={{ flex: 1, padding: 0 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 0,
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.md,
            paddingBottom: spacing.md,
          }}
        >
          <Card
            title={property.address_line1}
            onEdit={() => setEditOpen(true)}
            style={{ marginBottom: spacing.md }}
          >
            <Body muted style={{ marginBottom: spacing.md }}>
              {[property.city, property.province, property.postal_code].filter(Boolean).join(", ")}
            </Body>
            <Row label="Type" value={property.property_type.replace("_", " ")} />
            <Row label="Occupancy" value={property.owner_occupied ? "Owner occupied" : "Rental"} />
            {property.year_built ? (
              <Row label="Year built" value={String(property.year_built)} />
            ) : null}
          </Card>

          <Card
            title="Coverage rules"
            onEdit={() => router.navigate("/edit-mandate")}
            style={{ marginBottom: spacing.md }}
          >
            <PropertyMandateRows property={effective} />
          </Card>
        </ScrollView>
      </Screen>

      <AssetEditModal
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        payload={{ type: "property", asset: property }}
        candidate={candidate ?? null}
        householdId={household!.id}
        onSaved={() => refetch()}
      />
    </SafeAreaView>
  );
}
