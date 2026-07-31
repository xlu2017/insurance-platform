import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const publicRoutes = new Set(["/login", "/auth/callback", "/_next", "/favicon.ico"]);

function redirectWithCookies(path: string, req: NextRequest, res: NextResponse) {
  const redirect = NextResponse.redirect(new URL(path, req.url));
  for (const cookie of res.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  if (publicRoutes.has(req.nextUrl.pathname)) {
    return res;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          res.cookies.set({ name, value: "", ...options });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectWithCookies("/login", req, res);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = profile?.role;

  if (!role || role === "customer") {
    await supabase.auth.signOut();
    return redirectWithCookies("/login", req, res);
  }

  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login|auth/callback).*)"],
};
