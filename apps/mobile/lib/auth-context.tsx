import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  session: Session | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  isUnauthenticated: boolean;
}

export const AuthContext = createContext<AuthContextValue>({
  session: null,
  status: "loading",
  isAuthenticated: false,
  isUnauthenticated: false,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
