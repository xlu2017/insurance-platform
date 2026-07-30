import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "@/lib/supabase";
import { Body, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";

export default function VerifyEmail() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const resend = async () => {
    if (!email) {
      setStatus("No email address to resend to.");
      return;
    }
    setLoading(true);
    setStatus(null);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setLoading(false);
    setStatus(error ? error.message : "Verification email resent.");
  };

  return (
    <Screen style={{ justifyContent: "center" }}>
      <Stack.Screen options={{ headerShown: false }} />
      <Title>Verify your email</Title>
      <Body muted>
        We sent a confirmation link to {email ?? "your email address"}. Please open it to continue.
      </Body>
      <View style={{ height: 24 }} />
      <PrimaryButton
        label="I confirmed my email"
        onPress={() => router.replace("/sign-in")}
      />
      <View style={{ height: 12 }} />
      <SecondaryButton label="Resend verification email" onPress={resend} loading={loading} />
      {status ? (
        <Body style={{ color: "#d00", marginTop: 12, textAlign: "center" }}>{status}</Body>
      ) : null}
      <View style={{ height: 12 }} />
      <SecondaryButton label="Back to sign in" onPress={() => router.replace("/sign-in")} />
    </Screen>
  );
}
