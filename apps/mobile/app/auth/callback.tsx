import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Body, Loading, Screen } from "@/components/ui";
import { exchangeOAuthCode } from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";

export default function AuthCallback() {
  const { status, isAuthenticated } = useAuth();
  const params = useLocalSearchParams<{
    code?: string;
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  }>();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/home");
      return;
    }
    if (status === "loading") return;

    if (params.error) {
      setErrorMessage(params.error_description ?? params.error);
      return;
    }

    if (!params.code && !params.access_token) {
      // No OAuth payload in the deep link. Return to welcome so the user can retry.
      router.replace("/welcome");
      return;
    }

    let cancelled = false;
    exchangeOAuthCode(params.code, params.access_token, params.refresh_token).then(({ error }) => {
      if (cancelled) return;
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      // The auth listener will pick up the new session and redirect to /home.
    });

    return () => {
      cancelled = true;
    };
  }, [status, isAuthenticated, params, router]);

  if (errorMessage) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Body style={{ color: "#d00", textAlign: "center" }}>{errorMessage}</Body>
      </Screen>
    );
  }

  return <Loading />;
}
