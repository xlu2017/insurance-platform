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
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !household) return <Loading />;

  const isDevBypass = (message?: string) =>
    typeof __DEV__ !== "undefined" && __DEV__ && message?.includes("subscription is not active");

  const activate = async () => {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("activate_autopilot", {
      p_household_id: household.id,
    });
    if (rpcError && isDevBypass(rpcError.message)) {
      const { error: updateError } = await supabase
        .from("households")
        .update({ autopilot_active: true, onboarding_step: "complete" })
        .eq("id", household.id);
      setBusy(false);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["household"] });
      router.replace("/(tabs)/home");
      return;
    }
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (!data || (data as { success?: boolean }).success !== true) {
      setError("Activation failed");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["household"] });
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
      {error ? <Body muted>{error}</Body> : null}
      <PrimaryButton label="Activate Autopilot" onPress={activate} loading={busy} />
    </Screen>
  );
}
