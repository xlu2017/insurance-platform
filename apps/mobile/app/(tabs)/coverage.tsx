import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { formatCad } from "@/lib/format";
import { Body, Card, Loading, PrimaryButton, Row, Screen, Subtitle, Title } from "@/components/ui";

export default function Coverage() {
  const { data: household, isLoading } = useHousehold();

  const { data } = useQuery({
    queryKey: ["coverage", household?.id],
    enabled: !!household,
    queryFn: async () => {
      const [drivers, vehicles, properties, requirements, preferences] = await Promise.all([
        supabase.from("drivers").select("id, full_name").eq("household_id", household!.id),
        supabase.from("vehicles").select("id, year, make, model").eq("household_id", household!.id),
        supabase
          .from("properties")
          .select("id, address_line1, city")
          .eq("household_id", household!.id),
        supabase
          .from("coverage_requirements")
          .select("auto_requirements, property_requirements")
          .eq("household_id", household!.id)
          .eq("is_current", true)
          .maybeSingle(),
        supabase
          .from("switching_preferences")
          .select("*")
          .eq("household_id", household!.id)
          .eq("is_current", true)
          .maybeSingle(),
      ]);
      return {
        drivers: drivers.data ?? [],
        vehicles: vehicles.data ?? [],
        properties: properties.data ?? [],
        requirements: requirements.data,
        preferences: preferences.data,
      };
    },
  });

  if (isLoading || !household) return <Loading />;

  const auto = data?.requirements?.auto_requirements as
    | Record<string, number | boolean>
    | undefined;
  const property = data?.requirements?.property_requirements as
    | Record<string, number | boolean>
    | undefined;
  const prefs = data?.preferences;

  const yesNo = (v: unknown) => (v ? "Yes" : "No");

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Coverage mandate</Title>
          <Body muted>Your standing instructions. Every comparison is bound by these rules.</Body>
          <PrimaryButton
            label="Edit mandate"
            onPress={() => router.push("/edit-mandate")}
            testID="edit-mandate"
          />
          <View style={{ height: 12 }} />
          <Card>
            <Subtitle>Household</Subtitle>
            <Row
              label="Drivers"
              value={(data?.drivers ?? []).map((d) => d.full_name).join(", ") || "—"}
            />
            <Row
              label="Vehicles"
              value={
                (data?.vehicles ?? []).map((v) => `${v.year} ${v.make} ${v.model}`).join(", ") ||
                "—"
              }
            />
            <Row
              label="Properties"
              value={
                (data?.properties ?? []).map((p) => `${p.address_line1}, ${p.city}`).join("; ") ||
                "—"
              }
            />
          </Card>
          <Card>
            <Subtitle>Auto requirements</Subtitle>
            <Row
              label="Minimum liability"
              value={auto ? formatCad(Number(auto.minThirdPartyLiabilityCents ?? 0)) : "—"}
            />
            <Row
              label="Max collision deductible"
              value={auto ? formatCad(Number(auto.maxCollisionDeductibleCents ?? 0)) : "—"}
            />
            <Row
              label="Max comprehensive deductible"
              value={auto ? formatCad(Number(auto.maxComprehensiveDeductibleCents ?? 0)) : "—"}
            />
            <Row
              label="Accident forgiveness"
              value={auto ? yesNo(auto.accidentForgivenessRequired) : "—"}
            />
            <Row
              label="Rental coverage"
              value={auto ? yesNo(auto.rentalVehicleCoverageRequired) : "—"}
            />
            <Row label="Telematics allowed" value={auto ? yesNo(auto.telematicsAllowed) : "—"} />
          </Card>
          <Card>
            <Subtitle>Property requirements</Subtitle>
            <Row
              label="Minimum dwelling limit"
              value={property ? formatCad(Number(property.minDwellingLimitCents ?? 0)) : "—"}
            />
            <Row
              label="Replacement cost"
              value={property ? yesNo(property.replacementCostRequired) : "—"}
            />
            <Row
              label="Sewer backup"
              value={property ? yesNo(property.sewerBackupRequired) : "—"}
            />
            <Row
              label="Overland water"
              value={property ? yesNo(property.overlandWaterRequired) : "—"}
            />
            <Row
              label="Max base deductible"
              value={property ? formatCad(Number(property.maxBaseDeductibleCents ?? 0)) : "—"}
            />
          </Card>
          <Card>
            <Subtitle>Switching rules</Subtitle>
            <Row
              label="Minimum net annual savings"
              value={prefs ? formatCad(prefs.min_net_annual_savings_cents) : "—"}
            />
            <Row
              label="Only switch at renewal"
              value={prefs ? yesNo(prefs.renewal_only_switching) : "—"}
            />
            <Row
              label="Optimize home and auto together"
              value={prefs ? yesNo(prefs.household_optimization_enabled) : "—"}
            />
            <Row
              label="Split insurers allowed"
              value={prefs ? yesNo(prefs.split_insurers_allowed) : "—"}
            />
            <Row
              label="Excluded insurers"
              value={String(prefs?.excluded_insurer_ids?.length ?? 0)}
            />
            <Row label="Your approval before any switch" value="Always required" />
          </Card>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
