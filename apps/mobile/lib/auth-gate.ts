import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { loadRemoteConfig } from "./config";
import { getSupabaseClient, resetSupabaseClient } from "./supabase";
import type { AuthStatus } from "./auth-context";
import type { Session } from "@supabase/supabase-js";

export const PUBLIC_PATHS = new Set(["/", "/welcome", "/sign-in", "/register"]);

export interface AuthGateResult {
  session: Session | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  isUnauthenticated: boolean;
}

export function useAuthGate(): AuthGateResult {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const queryClient = useQueryClient();

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      await loadRemoteConfig({ timeoutMs: 10_000 });
      resetSupabaseClient();
      const { data } = await getSupabaseClient().auth.getSession();
      if (!mounted) return;
      setSession(data.session ?? null);
      setStatus(data.session ? "authenticated" : "unauthenticated");
    };

    void init();

    const { data: subscription } = getSupabaseClient().auth.onAuthStateChange(
      (event, nextSession) => {
        if (!mounted) return;

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

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient]);

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
