import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { Body, Loading, PrimaryButton, Screen, Title } from "@/components/ui";

export default function Activate() {
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  if (isLoading || !household) return <Loading />;

  const activate = async () => {
    setBusy(true);
    await supabase
      .from("households")
      .update({ autopilot_active: true, onboarding_step: "complete" })
      .eq("id", household.id);
    queryClient.invalidateQueries({ queryKey: ["household"] });
    setBusy(false);
    router.replace("/(tabs)/home");
  };

  return (
    <Screen style={{ justifyContent: "center" }}>
      <Stack.Screen options={{ headerShown: true, headerBackTitle: "Back", title: "Activate" }} />
      <Title>Ready to activate</Title>
      <Body muted>
        Autopilot will monitor your renewals, gather quotes and only ever propose a switch that
        meets your rules. You approve every change.
      </Body>
      <View style={{ height: 24 }} />
      <PrimaryButton label="Activate Autopilot" onPress={activate} loading={busy} />
    </Screen>
  );
}
