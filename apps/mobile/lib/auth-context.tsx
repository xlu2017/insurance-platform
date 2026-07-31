import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";
import type { AuthError } from "./auth";

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "configuration_error"
  | "session_error";

export interface AuthContextValue {
  session: Session | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  isUnauthenticated: boolean;
  error: AuthError | null;
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  session: null,
  status: "loading",
  isAuthenticated: false,
  isUnauthenticated: false,
  error: null,
  retry: () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
