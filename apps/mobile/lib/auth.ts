import type { User } from "@supabase/supabase-js";
import { BYPASS_TUNNEL_HEADERS, supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase";

declare const __DEV__: boolean;

export type AuthErrorCategory =
  | "invalid_credentials"
  | "service_unavailable"
  | "timeout"
  | "offline"
  | "invalid_config"
  | "malformed_response"
  | "unknown";

export interface AuthError {
  category: AuthErrorCategory;
  message: string;
  retryable: boolean;
}

export interface SignInCredentials {
  email: string;
  password: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const PLACEHOLDER_PATTERNS = /YOUR_|INSERT_|REPLACE_/i;

function isLoopback(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function logDev(message: string) {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(`[auth] ${message}`);
  }
}

export function getSupabaseConfigError(url?: string, anonKey?: string): AuthError | null {
  const resolvedUrl = url ?? SUPABASE_URL;
  const resolvedAnonKey = anonKey ?? SUPABASE_ANON_KEY;
  if (!resolvedUrl || !resolvedAnonKey) {
    return {
      category: "invalid_config",
      message: "Sign-in is not configured. The backend URL or API key is missing.",
      retryable: false,
    };
  }

  if (PLACEHOLDER_PATTERNS.test(resolvedUrl) || PLACEHOLDER_PATTERNS.test(resolvedAnonKey)) {
    return {
      category: "invalid_config",
      message:
        "The backend configuration contains a placeholder. Check your environment variables.",
      retryable: false,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(resolvedUrl);
  } catch {
    return {
      category: "invalid_config",
      message: "The backend URL is not valid. Check your environment configuration.",
      retryable: false,
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      category: "invalid_config",
      message: "The backend URL must use http or https.",
      retryable: false,
    };
  }

  if (isLoopback(parsed)) {
    return {
      category: "invalid_config",
      message:
        "localhost/127.0.0.1 cannot be used from a phone. Use a hosted backend or a stable tunnel.",
      retryable: false,
    };
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return {
      category: "invalid_config",
      message: "The backend URL should be the project root, not a path like /auth/v1.",
      retryable: false,
    };
  }

  if (resolvedAnonKey.trim().length < 20) {
    return {
      category: "invalid_config",
      message: "The API key appears to be incomplete. Check your environment configuration.",
      retryable: false,
    };
  }

  return null;
}

function getSanitizedHostname(): string | null {
  try {
    return new URL(SUPABASE_URL).hostname;
  } catch {
    return null;
  }
}

function isServiceUnavailableStatus(status: number, headers: Headers): boolean {
  const localtunnelStatus = headers.get("x-localtunnel-status") ?? "";
  return (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    localtunnelStatus.toLowerCase().includes("unavailable") ||
    localtunnelStatus.toLowerCase().includes("offline")
  );
}

function categorizeHttpError(status: number, body: unknown, headers: Headers): AuthError {
  if (isServiceUnavailableStatus(status, headers)) {
    return {
      category: "service_unavailable",
      message:
        "The sign-in service is temporarily unavailable. Check your connection and try again.",
      retryable: true,
    };
  }

  if (status === 400) {
    const message =
      typeof body === "object" && body !== null ? ((body as { msg?: string }).msg ?? "") : "";
    if (message.toLowerCase().includes("invalid login credentials")) {
      return {
        category: "invalid_credentials",
        message: "Invalid email or password.",
        retryable: false,
      };
    }
  }

  if (status === 401 || status === 403) {
    return {
      category: "invalid_credentials",
      message: "Invalid email or password.",
      retryable: false,
    };
  }

  if (status >= 500) {
    return {
      category: "service_unavailable",
      message:
        "The sign-in service is temporarily unavailable. Check your connection and try again.",
      retryable: true,
    };
  }

  if (status === 422) {
    return {
      category: "unknown",
      message: "We couldn't process your request. Please try again.",
      retryable: false,
    };
  }

  return {
    category: "unknown",
    message: "Something went wrong. Please try again.",
    retryable: false,
  };
}

export async function signInWithPassword(
  credentials: SignInCredentials,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<{ user?: User; error?: AuthError }> {
  const configError = getSupabaseConfigError();
  if (configError) {
    logDev(`invalid config: ${configError.category}`);
    return { error: configError };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort);

  const cleanup = () => {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", onAbort);
  };

  const hostname = getSanitizedHostname();
  logDev(`sign-in request: hostname=${hostname ?? "unknown"}`);

  try {
    const url = new URL(`${SUPABASE_URL}/auth/v1/token`);
    url.searchParams.set("grant_type", "password");

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        ...(BYPASS_TUNNEL_HEADERS ?? {}),
      },
      body: JSON.stringify({
        email: credentials.email.trim(),
        password: credentials.password,
      }),
      signal: controller.signal,
    });

    if (response.ok) {
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        return {
          error: {
            category: "malformed_response",
            message: "Unexpected response from sign-in service. Please try again.",
            retryable: true,
          },
        };
      }

      const token = data as {
        access_token?: string;
        refresh_token?: string;
        user?: User;
      };
      if (!token.access_token || !token.refresh_token || !token.user) {
        return {
          error: {
            category: "malformed_response",
            message: "Unexpected response from sign-in service. Please try again.",
            retryable: true,
          },
        };
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: token.access_token,
        refresh_token: token.refresh_token,
      });

      if (sessionError) {
        logDev(`setSession failed: ${sessionError.message}`);
        return {
          error: {
            category: "unknown",
            message: "We couldn't save your sign-in session. Please try again.",
            retryable: false,
          },
        };
      }

      return { user: token.user };
    }

    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    const error = categorizeHttpError(response.status, parsed, response.headers);
    logDev(`sign-in failed: status=${response.status}, category=${error.category}`);
    return { error };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      logDev("sign-in timed out");
      return {
        error: {
          category: "timeout",
          message: "Sign-in timed out. Check your connection and try again.",
          retryable: true,
        },
      };
    }

    logDev(`sign-in network error: ${(err as Error).message}`);
    return {
      error: {
        category: "offline",
        message: "Your device appears to be offline. Check your connection and try again.",
        retryable: true,
      },
    };
  } finally {
    cleanup();
  }
}
