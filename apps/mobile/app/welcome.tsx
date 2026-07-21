import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Body, Loading, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";
import { signInWithOAuthProvider } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export default function Welcome() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);

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

  useEffect(() => {
    if (signedIn) {
      router.replace("/home");
    }
  }, [signedIn]);

  if (signedIn === null) return <Loading />;

  const continueWithSSO = async () => {
    setSsoLoading(true);
    setSsoError(null);
    try {
      const { error } = await signInWithOAuthProvider("google");
      if (error) {
        setSsoError(error.message);
      }
    } finally {
      setSsoLoading(false);
    }
  };

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
      <View style={{ height: 12 }} />
      <SecondaryButton
        label="Continue with SSO"
        onPress={continueWithSSO}
        disabled={ssoLoading}
        loading={ssoLoading}
        testID="welcome-sso-button"
      />
      {ssoError ? (
        <Body style={{ color: "#d00", marginTop: 12, textAlign: "center" }}>{ssoError}</Body>
      ) : null}
    </Screen>
  );
}
