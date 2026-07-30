import { useLocalSearchParams, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { Body, Loading, Screen } from "@/components/ui";
import { exchangeOAuthCode } from "@/lib/auth";
import { safeReplace } from "@/lib/auth-gate";
import { useAuth } from "@/lib/auth-context";

function parseCallbackParams(
  local: ReturnType<typeof useLocalSearchParams>,
  url: string | null,
): {
  code?: string;
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
} {
  const out: ReturnType<typeof parseCallbackParams> = {};

  const read = (params: URLSearchParams | Record<string, unknown>) => {
    const get = (key: string) => {
      if (params instanceof URLSearchParams) {
        const value = params.get(key);
        if (typeof value === "string" && value.length > 0) return value;
        return undefined;
      }
      const value = params[key];
      if (typeof value === "string" && value.length > 0) return value;
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
        return value[0];
      }
      return undefined;
    };
    out.code = get("code") ?? out.code;
    out.access_token = get("access_token") ?? out.access_token;
    out.refresh_token = get("refresh_token") ?? out.refresh_token;
    out.error = get("error") ?? out.error;
    out.error_description = get("error_description") ?? out.error_description;
  };

  const stringParams: Record<string, unknown> = {};
  for (const key of Object.keys(local)) {
    const value = local[key];
    if (typeof value === "string" && value.length > 0) {
      stringParams[key] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      stringParams[key] = value;
    }
  }
  read(stringParams);

  if (url) {
    try {
      const parsed = new URL(url);
      read(parsed.searchParams);
    } catch {
      // Ignore malformed URL; local params may still be valid.
    }
  }

  return out;
}

function dismissBrowserSafely() {
  if (typeof WebBrowser.dismissBrowser === "function") {
    WebBrowser.dismissBrowser().catch(() => {});
  }
}

export default function AuthCallback() {
  const { status, isAuthenticated } = useAuth();
  const params = useLocalSearchParams();
  const url = Linking.useURL();
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    if (isAuthenticated) {
      // Close any Chrome Custom Tab / SFSafariViewController that is still open.
      dismissBrowserSafely();
      safeReplace(router, "/home");
      return;
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (status === "loading" || handledRef.current) return;

    const parsed = parseCallbackParams(params, url);

    if (parsed.error) {
      handledRef.current = true;
      setErrorMessage(parsed.error_description ?? parsed.error);
      return;
    }

    if (!parsed.code && !parsed.access_token) {
      // No OAuth payload in the deep link. Return to welcome so the user can retry.
      handledRef.current = true;
      safeReplace(router, "/welcome");
      return;
    }

    handledRef.current = true;
    let cancelled = false;

    exchangeOAuthCode(parsed.code, parsed.access_token, parsed.refresh_token).then(({ error }) => {
      if (cancelled) return;
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      dismissBrowserSafely();
      // The auth listener will redirect to /home once the session is set.
    });

    return () => {
      cancelled = true;
    };
  }, [status, params, url]);

  if (errorMessage) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Body style={{ color: "#d00", textAlign: "center" }}>{errorMessage}</Body>
      </Screen>
    );
  }

  return <Loading />;
}
