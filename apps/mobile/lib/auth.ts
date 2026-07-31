import type { User } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { makeRedirectUri } from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { getBypassHeaders, getSupabaseAnonKey, getSupabaseUrl } from "./config";
import { getSupabaseClient } from "./supabase";

declare const __DEV__: boolean;

export type AuthErrorCategory =
  | "invalid_credentials"
  | "service_unavailable"
  | "timeout"
  | "offline"
  | "invalid_config"
  | "malformed_response"
  | "cancelled"
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
const DEEP_LINK_GRACE_MS = 1_500;
const PLACEHOLDER_PATTERNS = /YOUR_|INSERT_|REPLACE_/i;

function isLoopback(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function logDev(message: string) {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn(`[auth] ${message}`);
  }
}

export function getSupabaseConfigError(url?: string, anonKey?: string): AuthError | null {
  const resolvedUrl = url ?? getSupabaseUrl();
  const resolvedAnonKey = anonKey ?? getSupabaseAnonKey();
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

  if (Platform.OS !== "web" && isLoopback(parsed)) {
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
    return new URL(getSupabaseUrl()).hostname;
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

  const SUPABASE_URL = getSupabaseUrl();
  const SUPABASE_ANON_KEY = getSupabaseAnonKey();
  const BYPASS_TUNNEL_HEADERS = getBypassHeaders();

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

      const client = getSupabaseClient();
      const { error: sessionError } = await client.auth.setSession({
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

export type OAuthProvider = "google";

function ssoError(message: string, category: AuthErrorCategory = "unknown"): AuthError {
  return { category, message, retryable: false };
}

export interface OAuthPayload {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
  errorDescription?: string;
}

/**
 * Extracts the OAuth code (PKCE flow) or the access/refresh tokens (implicit
 * flow) from the deep link returned by the provider. The client sets
 * `detectSessionInUrl: false`, so the session must be established explicitly.
 */
export function parseOAuthReturnUrl(returnUrl: string): OAuthPayload {
  const parsed = new URL(returnUrl);
  const hashParams = new URLSearchParams(
    parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash,
  );
  return {
    code: parsed.searchParams.get("code") ?? undefined,
    accessToken:
      parsed.searchParams.get("access_token") ?? hashParams.get("access_token") ?? undefined,
    refreshToken:
      parsed.searchParams.get("refresh_token") ?? hashParams.get("refresh_token") ?? undefined,
    error: parsed.searchParams.get("error") ?? hashParams.get("error") ?? undefined,
    errorDescription:
      parsed.searchParams.get("error_description") ??
      hashParams.get("error_description") ??
      undefined,
  };
}

type ExchangeResult = { user: User; error?: undefined } | { user?: undefined; error: AuthError };
const exchangeLocks = new Map<string, Promise<ExchangeResult>>();

export async function exchangeOAuthCode(
  code?: string,
  accessToken?: string,
  refreshToken?: string,
): Promise<{ user?: User; error?: AuthError }> {
  const key = code ?? accessToken ?? "none";
  const existing = exchangeLocks.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<ExchangeResult> => {
    const client = getSupabaseClient();
    try {
      if (code) {
        const { data: exchanged, error: exchangeError } =
          await client.auth.exchangeCodeForSession(code);
        if (exchangeError || !exchanged.user) {
          logDev(`exchangeCodeForSession failed: ${exchangeError?.message ?? "no user"}`);
          return { error: ssoError("Could not complete SSO sign-in. Please try again.") };
        }
        return { user: exchanged.user };
      }

      if (accessToken && refreshToken) {
        const { data: session, error: sessionError } = await client.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError || !session.user) {
          logDev(`setSession failed: ${sessionError?.message ?? "no user"}`);
          return { error: ssoError("Could not complete SSO sign-in. Please try again.") };
        }
        return { user: session.user };
      }

      return { error: ssoError("SSO sign-in returned no session. Please try again.") };
    } catch (err) {
      logDev(`SSO exchange error: ${(err as Error).message}`);
      return {
        error: {
          category: "offline",
          message: "Your device appears to be offline. Check your connection and try again.",
          retryable: true,
        },
      };
    } finally {
      exchangeLocks.delete(key);
    }
  })();

  exchangeLocks.set(key, promise);
  return promise;
}

export async function signInWithOAuthProvider(
  provider: OAuthProvider = "google",
): Promise<{ user?: User; error?: AuthError }> {
  const configError = getSupabaseConfigError();
  if (configError) {
    return { error: configError };
  }

  const redirectTo = makeRedirectUri({ scheme: "insurance-autopilot", path: "auth/callback" });
  const client = getSupabaseClient();

  let capturedUrl: string | null = null;
  let linkSubscription: { remove: () => void } | null = null;
  const cleanupLinkListener = () => {
    if (linkSubscription) {
      linkSubscription.remove();
      linkSubscription = null;
    }
  };

  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (error || !data?.url) {
      logDev(`signInWithOAuth failed: ${error?.message ?? "no authorize url"}`);
      return { error: ssoError("Could not start SSO sign-in. Please try again.") };
    }

    // Capture any deep link that arrives while the browser session is open. On
    // Android the browser promise may resolve with 'dismiss' before the deep
    // link is delivered, so we keep a listener running through the whole flow.
    linkSubscription = Linking.addEventListener("url", ({ url }: { url: string }) => {
      if (url && url.startsWith(redirectTo)) {
        capturedUrl = url;
        cleanupLinkListener();
      }
    });

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type === "success") {
      cleanupLinkListener();
      const returnUrl = result.url ?? capturedUrl;
      if (!returnUrl) {
        return { error: ssoError("SSO sign-in returned no session. Please try again.") };
      }
      const { code, accessToken, refreshToken } = parseOAuthReturnUrl(returnUrl);
      return exchangeOAuthCode(code, accessToken, refreshToken);
    }

    if (result.type === "cancel") {
      cleanupLinkListener();
      return {
        error: {
          category: "cancelled",
          message: "Sign-in was cancelled.",
          retryable: false,
        },
      };
    }

    // Ambiguous dismissal (Android 'dismiss' or no explicit URL). If a deep
    // link was already captured, use it. Otherwise wait briefly for one to arrive.
    if (capturedUrl) {
      cleanupLinkListener();
      const { code, accessToken, refreshToken } = parseOAuthReturnUrl(capturedUrl);
      return exchangeOAuthCode(code, accessToken, refreshToken);
    }

    const deepLink = await new Promise<string | null>((resolve) => {
      const sub = Linking.addEventListener("url", ({ url }: { url: string }) => {
        if (url && url.startsWith(redirectTo)) {
          sub.remove();
          clearTimeout(timer);
          resolve(url);
        }
      });
      const timer = setTimeout(() => {
        sub.remove();
        resolve(null);
      }, DEEP_LINK_GRACE_MS);
    });
    cleanupLinkListener();

    if (deepLink) {
      const { code, accessToken, refreshToken } = parseOAuthReturnUrl(deepLink);
      return exchangeOAuthCode(code, accessToken, refreshToken);
    }

    return {
      error: {
        category: "cancelled",
        message: "Sign-in was cancelled.",
        retryable: false,
      },
    };
  } catch (err) {
    cleanupLinkListener();
    logDev(`SSO network error: ${(err as Error).message}`);
    return {
      error: {
        category: "offline",
        message: "Your device appears to be offline. Check your connection and try again.",
        retryable: true,
      },
    };
  }
}
