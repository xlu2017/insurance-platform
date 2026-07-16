import { router, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useActiveCase, useHousehold } from "@/lib/household";
import { formatCad, formatEdmontonDate } from "@/lib/format";
import { Body, Card, Loading, PrimaryButton, Row, Screen, Subtitle, Title } from "@/components/ui";

export default function ConfirmDetails() {
  const { data: household } = useHousehold();
  const { data: activeCase } = useActiveCase(household?.id);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["confirm-details", household?.id],
    enabled: !!household,
    queryFn: async () => {
      const [drivers, vehicles, properties, policies] = await Promise.all([
        supabase.from("drivers").select("full_name").eq("household_id", household!.id),
        supabase.from("vehicles").select("year, make, model").eq("household_id", household!.id),
        supabase
          .from("properties")
          .select("address_line1, city, province")
          .eq("household_id", household!.id),
        supabase
          .from("policies")
          .select("insurer_name, product_line, annual_premium_cents, renewal_date")
          .eq("household_id", household!.id)
          .eq("is_current", true),
      ]);
      return {
        drivers: drivers.data ?? [],
        vehicles: vehicles.data ?? [],
        properties: properties.data ?? [],
        policies: policies.data ?? [],
      };
    },
  });

  if (isLoading || !data || !activeCase) return <Loading />;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const { error: caseError } = await supabase
      .from("optimization_cases")
      .update({ state: "ready_for_market_search" })
      .eq("id", activeCase.id);
    if (caseError) {
      setBusy(false);
      setError(caseError.message);
      return;
    }
    await supabase.from("audit_events").insert({
      action: "customer_confirmed_extracted_information",
      entity_type: "optimization_case",
      entity_id: activeCase.id,
      household_id: household?.id,
      case_id: activeCase.id,
    });
    queryClient.invalidateQueries();
    setBusy(false);
    router.replace("/(tabs)/autopilot");
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Stack.Screen
        options={{ headerShown: true, headerBackTitle: "Back", title: "Confirm details" }}
      />
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Confirm your details</Title>
          <Body muted>
            Check what we extracted from your documents before we search the market.
          </Body>
          <Card>
            <Subtitle>Drivers</Subtitle>
            {data.drivers.map((d) => (
              <Body key={d.full_name}>{d.full_name}</Body>
            ))}
          </Card>
          <Card>
            <Subtitle>Vehicles</Subtitle>
            {data.vehicles.map((v, i) => (
              <Body key={i}>
                {v.year} {v.make} {v.model}
              </Body>
            ))}
          </Card>
          <Card>
            <Subtitle>Property</Subtitle>
            {data.properties.map((p, i) => (
              <Body key={i}>
                {p.address_line1}, {p.city}, {p.province}
              </Body>
            ))}
          </Card>
          <Card>
            <Subtitle>Current policies</Subtitle>
            {data.policies.map((p, i) => (
              <Row
                key={i}
                label={`${p.insurer_name} (${p.product_line})`}
                value={`${formatCad(p.annual_premium_cents)} · renews ${formatEdmontonDate(p.renewal_date)}`}
              />
            ))}
          </Card>
          {error ? <Body muted>{error}</Body> : null}
          <PrimaryButton label="Everything is correct" onPress={confirm} loading={busy} />
          <View style={{ height: 24 }} />
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
