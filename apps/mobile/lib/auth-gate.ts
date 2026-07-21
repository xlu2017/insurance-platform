import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { loadRemoteConfig } from "./config";
import { getSupabaseClient, resetSupabaseClient } from "./supabase";
import type { AuthStatus } from "./auth-context";
import type { Session } from "@supabase/supabase-js";

export const PUBLIC_PATHS = new Set(["/", "/welcome", "/sign-in", "/register", "/auth/callback"]);

export interface AuthGateResult {
  session: Session | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  isUnauthenticated: boolean;
}

function safeReplaceToWelcome(router: ReturnType<typeof useRouter>, onDone?: () => void) {
  let attempts = 0;
  const maxAttempts = 10;
  const delay = 50;

  const tryReplace = () => {
    attempts++;
    try {
      // Reset the navigation stack so the Android back button cannot reopen an
      // authenticated screen after sign-out. dismissAll is best-effort on web.
      if (typeof router.dismissAll === "function") {
        try {
          router.dismissAll();
        } catch {
          // ignore
        }
      }
      router.replace("/welcome");
      onDone?.();
      return;
    } catch {
      if (attempts >= maxAttempts) {
        onDone?.();
        return;
      }
      setTimeout(tryReplace, delay * attempts);
    }
  };

  tryReplace();
}

export function useAuthGate(): AuthGateResult {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [redirected, setRedirected] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let subUnsubscribe = () => {};

    const init = async () => {
      await loadRemoteConfig({ timeoutMs: 10_000 });
      resetSupabaseClient();
      const { data } = await getSupabaseClient().auth.getSession();
      if (!mountedRef.current) return;
      setSession(data.session ?? null);
      setStatus(data.session ? "authenticated" : "unauthenticated");
    };

    void init();

    const { data: subscription } = getSupabaseClient().auth.onAuthStateChange(
      (event, nextSession) => {
        if (!mountedRef.current) return;

        if (event === "SIGNED_OUT" || nextSession === null) {
          setSession(null);
          setStatus("unauthenticated");
          queryClient.clear();
          // Ensure the Supabase client discards any cached session-dependent state.
          resetSupabaseClient();
          return;
        }

        if (nextSession) {
          setSession(nextSession);
          setStatus("authenticated");
        }
      },
    );
    subUnsubscribe = subscription.subscription.unsubscribe;

    return () => {
      mountedRef.current = false;
      subUnsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    if (status !== "unauthenticated" || !pathname || redirected) return;
    if (!PUBLIC_PATHS.has(pathname)) {
      setRedirected(true);
      safeReplaceToWelcome(router, () => {
        if (mountedRef.current) {
          // Allow future redirects if the pathname changes again.
          setRedirected(false);
        }
      });
    }
  }, [status, pathname, router, redirected]);

  return useMemo(
    () => ({
      session,
      status,
      isAuthenticated: status === "authenticated",
      isUnauthenticated: status === "unauthenticated",
    }),
    [session, status],
  );
}
