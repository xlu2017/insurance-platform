import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Body, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export default function Welcome() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSignedIn(!!data.session);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setSignedIn(!!session);
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  if (signedIn) return <Redirect href="/home" />;
  return (
    <Screen style={{ justifyContent: "center" }}>
      <Title>Insurance handled for you</Title>
      <Body muted>
        Upload your current policies once. We monitor your renewals, look for eligible savings and
        show you one clear recommendation. You approve every change.
      </Body>
      <View style={{ height: 24 }} />
      <PrimaryButton
        label="Set up my insurance"
        onPress={() => router.push("/register")}
        testID="get-started"
      />
      <View style={{ height: 12 }} />
      <SecondaryButton
        label="Sign in"
        onPress={() => router.push("/sign-in")}
        testID="go-sign-in"
      />
    </Screen>
  );
}
