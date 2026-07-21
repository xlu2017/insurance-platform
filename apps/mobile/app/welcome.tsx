import { Redirect, router } from "expo-router";
import { useEffect, useState } from "react";
import { BackHandler, Platform, View } from "react-native";
import { Body, Loading, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";
import { signInWithOAuthProvider } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";

export default function Welcome() {
  const { status, isAuthenticated } = useAuth();
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // When the user is on the welcome screen there is no authenticated route
      // to go back to; exit the app instead of reopening any previous screen.
      BackHandler.exitApp();
      return true;
    });
    return () => subscription.remove();
  }, []);

  if (status === "loading") return <Loading />;
  if (isAuthenticated) return <Redirect href="/home" />;

  const continueWithSSO = async () => {
    setSsoLoading(true);
    setSsoError(null);
    try {
      const { error } = await signInWithOAuthProvider("google");
      if (error) {
        setSsoError(error.message);
      }
      // On success the global auth listener will pick up the session and redirect.
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
