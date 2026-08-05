"use client";

import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "@autopilot/database";

function cookieValue(name: string): string | undefined {
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + "=([^;]*)"),
  );
  if (!match) return undefined;
  const value = match[1];
  if (!value) return undefined;
  return decodeURIComponent(value);
}

function setCookie(name: string, value: string, options?: CookieOptions) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  if (options?.path) parts.push(`path=${options.path}`);
  if (options?.maxAge) parts.push(`max-age=${options.maxAge}`);
  if (options?.domain) parts.push(`domain=${options.domain}`);
  if (options?.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options?.secure) parts.push("Secure");
  document.cookie = parts.join("; ");
}

export function supabaseBrowser() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        get: cookieValue,
        set: setCookie,
        remove: (name, options) => setCookie(name, "", { ...options, maxAge: -1 }),
      },
    },
  );
}
