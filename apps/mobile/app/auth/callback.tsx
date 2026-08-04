import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Body, Loading, PrimaryButton, Screen } from "@/components/ui";
import { exchangeOAuthCode, parseOAuthReturnUrl, type OAuthPayload } from "@/lib/auth";
import { safeReplace } from "@/lib/auth-gate";
import { useAuth } from "@/lib/auth-context";

function dismissBrowserSafely() {
  if (typeof WebBrowser.dismissBrowser !== "function") return;
  try {
    Promise.resolve(WebBrowser.dismissBrowser()).catch(() => {});
  } catch {
    // Browser may already be closed or the API may be unavailable on this platform.
  }
}

function getPayload(
  params: Record<string, string | string[]>,
  url: string | null,
  initialUrl: string | null,
): OAuthPayload | null {
  for (const candidate of [url, initialUrl]) {
    if (!candidate) continue;
    try {
      const payload = parseOAuthReturnUrl(candidate);
      if (payload.code || payload.accessToken || payload.error) return payload;
    } catch {
      // malformed URL; try other sources
    }
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 0) {
      search.set(key, value);
    } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
      search.set(key, value[0]);
    }
  }
  const payload: OAuthPayload = {
    code: search.get("code") ?? undefined,
    accessToken: search.get("access_token") ?? undefined,
    refreshToken: search.get("refresh_token") ?? undefined,
    error: search.get("error") ?? undefined,
    errorDescription: search.get("error_description") ?? undefined,
  };
  if (payload.code || payload.accessToken || payload.error) return payload;
  return null;
}

export default function AuthCallback() {
  const { status, isAuthenticated } = useAuth();
  const params = useLocalSearchParams();
  const url = Linking.useURL();
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [initialUrl, setInitialUrl] = useState<string | null | undefined>(undefined);
  const handledRef = useRef(false);

  useEffect(() => {
    Linking.getInitialURL()
      .then((value) => setInitialUrl(value ?? null))
      .catch(() => setInitialUrl(null));
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      dismissBrowserSafely();
      safeReplace(router, "/home");
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (handledRef.current) return;
    if (initialUrl === undefined) return;
    if (status === "loading") return;

    const payload = getPayload(params, url, initialUrl);

    if (payload?.error) {
      handledRef.current = true;
      setErrorMessage(payload.errorDescription ?? payload.error);
      return;
    }

    if (!payload?.code && !payload?.accessToken) {
      handledRef.current = true;
      safeReplace(router, "/welcome");
      return;
    }

    handledRef.current = true;
    let cancelled = false;

    exchangeOAuthCode(payload.code, payload.accessToken, payload.refreshToken).then(
      ({ user, error }) => {
        if (cancelled) return;
        if (error) {
          setErrorMessage(error.message);
          return;
        }
        if (user) {
          dismissBrowserSafely();
          safeReplace(router, "/home");
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [status, params, url, initialUrl, router]);

  if (errorMessage) {
    return (
      <Screen style={{ justifyContent: "center", padding: 24 }}>
        <Body style={{ color: "#d00", textAlign: "center" }}>{errorMessage}</Body>
        <View style={{ height: 16 }} />
        <PrimaryButton label="Back to sign in" onPress={() => safeReplace(router, "/welcome")} />
      </Screen>
    );
  }

  return <Loading />;
}
