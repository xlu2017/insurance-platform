import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseAnonKey, getSupabaseUrl, loadRemoteConfig } from "./config";
import { getSupabaseClient, resetSupabaseClient } from "./supabase";
import type { AuthContextValue, AuthStatus } from "./auth-context";
import type { AuthError } from "./auth";

export const PUBLIC_PATHS = new Set(["/", "/welcome", "/sign-in", "/register", "/verify-email", "/auth/callback"]);
export const AUTHENTICATION_PATHS = new Set(["/sign-in", "/register"]);

export function safeReplace(router: ReturnType<typeof useRouter>, href: string, onDone?: () => void) {
  let attempts = 0;
  const maxAttempts = 10;
  const delay = 50;

  const tryReplace = () => {
    attempts++;
    try {
      if (typeof router.dismissAll === "function") {
        try {
          router.dismissAll();
        } catch {
          // ignore
        }
      }
      router.replace(href as never);
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

function buildError(category: "invalid_config" | "service_unavailable", message: string): AuthError {
  return { category, message, retryable: true };
}

export function useAuthGate(): AuthContextValue {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<AuthError | null>(null);
  const [redirectedForAuth, setRedirectedForAuth] = useState(false);
  const [redirectedForPublic, setRedirectedForPublic] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const mountedRef = useRef(true);

  const retry = useCallback(() => {
    setError(null);
    setStatus("loading");
    setAttempt((count) => count + 1);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let subUnsubscribe = () => {};

    const init = async () => {
      await loadRemoteConfig({ timeoutMs: 10_000, force: attempt > 0 });

      const url = getSupabaseUrl();
      const key = getSupabaseAnonKey();
      if (!url || !key) {
        // Remote configuration is the only path that should be able to override a missing
        // local environment. If neither is available, the app cannot initialize auth.
        if (!mountedRef.current) return;
        setStatus("configuration_error");
        setError(
          buildError(
            "invalid_config",
            "Sign-in is not configured. Check your environment or remote config endpoint.",
          ),
        );
        return;
      }

      // Create exactly one client from the loaded configuration and use it for both
      // the initial session read and the auth-state listener. Do not reset it again.
      resetSupabaseClient();
      let client;
      try {
        client = getSupabaseClient();
      } catch (configError) {
        if (!mountedRef.current) return;
        setStatus("configuration_error");
        setError(
          buildError(
            "invalid_config",
            configError instanceof Error ? configError.message : "Sign-in is not configured.",
          ),
        );
        return;
      }

      let data;
      try {
        ({ data } = await client.auth.getSession());
      } catch (sessionError) {
        if (!mountedRef.current) return;
        setStatus("session_error");
        setError(
          buildError(
            "service_unavailable",
            sessionError instanceof Error
              ? sessionError.message
              : "Could not reach the sign-in service. Please try again.",
          ),
        );
        return;
      }

      if (!mountedRef.current) return;
      setSession(data.session ?? null);
      setStatus(data.session ? "authenticated" : "unauthenticated");
      setError(null);

      const { data: subscription } = client.auth.onAuthStateChange((event, nextSession) => {
        if (!mountedRef.current) return;

        if (event === "SIGNED_OUT" || nextSession === null) {
          setSession(null);
          setStatus("unauthenticated");
          queryClient.clear();
          return;
        }

        if (nextSession) {
          setSession(nextSession);
          setStatus("authenticated");
        }
      });
      subUnsubscribe = subscription.subscription.unsubscribe;
    };

    void init();

    return () => {
      mountedRef.current = false;
      subUnsubscribe();
    };
  }, [attempt, queryClient]);

  useEffect(() => {
    if (status !== "unauthenticated" || !pathname || redirectedForPublic) return;
    if (!PUBLIC_PATHS.has(pathname)) {
      setRedirectedForPublic(true);
      safeReplace(router, "/welcome", () => {
        if (mountedRef.current) {
          setRedirectedForPublic(false);
        }
      });
    }
  }, [status, pathname, router, redirectedForPublic]);

  useEffect(() => {
    if (status !== "authenticated" || !pathname || redirectedForAuth) return;
    if (AUTHENTICATION_PATHS.has(pathname)) {
      setRedirectedForAuth(true);
      safeReplace(router, "/home", () => {
        if (mountedRef.current) {
          setRedirectedForAuth(false);
        }
      });
    }
  }, [status, pathname, router, redirectedForAuth]);

  return useMemo(
    () => ({
      session,
      status,
      isAuthenticated: status === "authenticated",
      isUnauthenticated: status === "unauthenticated",
      error,
      retry,
    }),
    [session, status, error, retry],
  );
}
