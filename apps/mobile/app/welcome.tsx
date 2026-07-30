import { Redirect, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Platform, View } from "react-native";
import { Body, Loading, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";
import { signInWithOAuthProvider } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";

const SSO_TIMEOUT_MS = 30_000;

export default function Welcome() {
  const { status, isAuthenticated } = useAuth();
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (isAuthenticated) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setSsoLoading(false);
    }
  }, [isAuthenticated]);

  if (status === "loading") return <Loading />;
  if (isAuthenticated) return <Redirect href="/home" />;

  const clearSsoTimeout = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const continueWithSSO = async () => {
    setSsoLoading(true);
    setSsoError(null);
    clearSsoTimeout();

    timeoutRef.current = setTimeout(() => {
      setSsoLoading(false);
      setSsoError("Sign-in took too long. Please try again.");
    }, SSO_TIMEOUT_MS);

    try {
      const { error } = await signInWithOAuthProvider("google");
      if (error) {
        clearSsoTimeout();
        setSsoError(error.message);
        setSsoLoading(false);
      }
      // If no error and no user, the browser was dismissed by the OS and the
      // deep-link callback will complete the sign-in. The auth listener above
      // will redirect once the session is set.
    } catch (err) {
      clearSsoTimeout();
      setSsoError(err instanceof Error ? err.message : "Sign-in failed. Please try again.");
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
        label="Continue with Google"
        onPress={continueWithSSO}
        disabled={ssoLoading}
        loading={ssoLoading}
        testID="welcome-google-button"
      />
      {ssoError ? (
        <Body style={{ color: "#d00", marginTop: 12, textAlign: "center" }}>{ssoError}</Body>
      ) : null}
    </Screen>
  );
}
