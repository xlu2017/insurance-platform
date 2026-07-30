import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// OAuth/OIDC callback for the admin console. Exchanges the provider code for a
// session, then applies the SAME staff-only role gate as the password flow
// (apps/admin/src/app/login/page.tsx): customers or profiles without a staff
// role are signed out and bounced back to /login with the staff-only error.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");

  // Carrier response for Supabase cookie mutations; its cookies are copied onto
  // whichever redirect we ultimately return so sessions are set or cleared.
  const carrier = NextResponse.next();

  const redirectWithCookies = (path: string) => {
    const res = NextResponse.redirect(new URL(path, origin));
    for (const cookie of carrier.cookies.getAll()) {
      res.cookies.set(cookie);
    }
    return res;
  };

  if (providerError || !code) {
    return redirectWithCookies("/login?error=sso");
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          carrier.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          carrier.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return redirectWithCookies("/login?error=sso");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile || profile.role === "customer") {
    await supabase.auth.signOut();
    return redirectWithCookies("/login?error=staff_only");
  }

  return redirectWithCookies("/");
}
