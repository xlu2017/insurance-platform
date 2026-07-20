import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Card, Loading, Row, Screen, Subtitle, Title } from "@/components/ui";
import { PropertyMandateRows } from "@/components/coverage-rules";
import { useHousehold } from "@/lib/household";
import { supabase } from "@/lib/supabase";
import { loadHouseholdMandateV2, resolveEffectivePropertyMandateV2 } from "@autopilot/database";
import { colors, spacing } from "@autopilot/design-tokens";

export default function PropertyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: household, isLoading: isLoadingHousehold } = useHousehold();

  const { data, isLoading, error } = useQuery({
    queryKey: ["property", id, household?.id],
    enabled: !!household && !!id,
    queryFn: async () => {
      if (!household || !id) return null;
      const [{ data: row, error: propertyError }, mandateResult] = await Promise.all([
        supabase
          .from("properties")
          .select(
            "id, address_line1, city, province, postal_code, property_type, owner_occupied, year_built",
          )
          .eq("id", id)
          .eq("household_id", household.id)
          .single(),
        loadHouseholdMandateV2(supabase, household.id),
      ]);
      if (propertyError) throw new Error(propertyError.message);
      if (!row) throw new Error("Property not found");
      const effective = resolveEffectivePropertyMandateV2(mandateResult.mandate, row.id);
      return { property: row, effective };
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

  const { property, effective } = data;

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
            onPress={() => router.navigate("/properties")}
            style={{ position: "absolute", left: spacing.lg, padding: spacing.sm }}
          >
            <Body style={{ fontSize: 28, lineHeight: 28, color: colors.ink }}>{"<"}</Body>
          </Pressable>
          <Title style={{ marginBottom: 0 }}>Property coverage</Title>
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
            <Subtitle style={{ marginBottom: spacing.sm }}>{property.address_line1}</Subtitle>
            <Body muted style={{ marginBottom: spacing.md }}>
              {[property.city, property.province, property.postal_code].filter(Boolean).join(", ")}
            </Body>
            <Row label="Type" value={property.property_type.replace("_", " ")} />
            <Row label="Occupancy" value={property.owner_occupied ? "Owner occupied" : "Rental"} />
            {property.year_built ? (
              <Row label="Year built" value={String(property.year_built)} />
            ) : null}
          </Card>

          <Card style={{ marginBottom: spacing.md }}>
            <Subtitle style={{ marginBottom: spacing.sm }}>Coverage rules</Subtitle>
            <PropertyMandateRows property={effective} />
          </Card>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
