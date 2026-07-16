import { router, Stack } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";
import { supabase, SUPABASE_URL } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { Body, Caption, Card, PrimaryButton, Screen, Title } from "@/components/ui";

export default function Membership() {
  const { data: household } = useHousehold();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const checkout = async () => {
    setLoading(true);
    setError(null);
    const { data: session } = await supabase.auth.getSession();
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session?.access_token ?? ""}`,
        },
      });
      if (!res.ok) throw new Error(`Checkout failed (${res.status})`);
      const payload = (await res.json()) as { url?: string; bypass?: boolean };
      if (payload.url) {
        await Linking.openURL(payload.url);
      }
      if (household) {
        await supabase
          .from("households")
          .update({ onboarding_step: "documents" })
          .eq("id", household.id);
      }
      router.push("/onboarding/documents");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen style={{ justifyContent: "center" }}>
      <Stack.Screen options={{ headerShown: true, headerBackTitle: "Back", title: "Membership" }} />
      <Title>Annual membership</Title>
      <Card>
        <Body>Insurance Autopilot Membership</Body>
        <Body muted>C$30 per year, billed through Stripe test mode.</Body>
        <View style={{ height: 8 }} />
        <Caption>
          In local development the payment step is bypassed automatically so no Stripe keys are
          required.
        </Caption>
      </Card>
      {error ? <Body muted>{error}</Body> : null}
      <PrimaryButton label="Start membership" onPress={checkout} loading={loading} />
    </Screen>
  );
}
