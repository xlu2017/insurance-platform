import { router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { supabase, SUPABASE_URL } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { Body, Caption, Card, PrimaryButton, Screen, Title } from "@/components/ui";

export default function Membership() {
  const { data: household } = useHousehold();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const cleanup = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => cleanup, []);

  const advanceIfActive = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session.session?.user.id) return false;
    const { data } = await supabase
      .from("subscriptions")
      .select("status")
      .eq("profile_id", session.session.user.id)
      .maybeSingle();
    if (data?.status === "active") {
      if (household) {
        await supabase
          .from("households")
          .update({ onboarding_step: "documents" })
          .eq("id", household.id);
      }
      cleanup();
      router.push("/onboarding/documents");
      return true;
    }
    return false;
  };

  const startPolling = () => {
    setPolling(true);
    pollRef.current = setInterval(async () => {
      const active = await advanceIfActive();
      if (!active && pollRef.current) {
        // Keep polling
      }
    }, 1500);
  };

  const checkout = async () => {
    if (!household) return;
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
      const payload = (await res.json()) as {
        url?: string;
        bypass?: boolean;
        status?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error ?? `Checkout failed (${res.status})`);
      if (payload.url) {
        await Linking.openURL(payload.url);
      }
      // On local bypass the subscription is already active; otherwise wait for webhook.
      if (payload.bypass && payload.status === "active") {
        await advanceIfActive();
        return;
      }
      startPolling();
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
      {polling ? (
        <Body muted>Waiting for subscription to become active…</Body>
      ) : (
        <PrimaryButton label="Start membership" onPress={checkout} loading={loading} />
      )}
      {error ? <Body muted>{error}</Body> : null}
    </Screen>
  );
}
