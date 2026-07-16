"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";

export type UserRole = "customer" | "operations" | "reviewer" | "admin";

const baseNav = [{ href: "/", label: "Overview" }];

const roleNav: Record<UserRole, { href: string; label: string }[]> = {
  customer: [],
  operations: [
    { href: "/cases", label: "Cases" },
    { href: "/insurers", label: "Insurers" },
    { href: "/outbox", label: "Email outbox" },
  ],
  reviewer: [{ href: "/cases", label: "Cases" }],
  admin: [
    { href: "/cases", label: "Cases" },
    { href: "/insurers", label: "Insurers" },
    { href: "/outbox", label: "Email outbox" },
  ],
};

function isStaff(role: UserRole | null): role is "operations" | "reviewer" | "admin" {
  return role === "operations" || role === "reviewer" || role === "admin";
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        const user = data.session?.user;
        if (!user) {
          router.replace("/login");
          return;
        }
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        const userRole = (profile?.role as UserRole) ?? null;
        if (!isStaff(userRole)) {
          await supabase.auth.signOut();
          router.replace("/login");
          return;
        }
        setEmail(user.email ?? null);
        setRole(userRole);
        setChecked(true);
      })
      .catch(() => {
        setChecked(true);
        router.replace("/login");
      });
  }, [router]);

  if (!checked) {
    return <main className="p-8 text-sm text-ink-muted">Loading…</main>;
  }

  if (!role) return null;

  const nav = [...baseNav, ...roleNav[role]];

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-line bg-surface p-4">
        <p className="mb-6 text-sm font-semibold">Insurance Autopilot</p>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">{role}</p>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm hover:bg-surface-subtle",
                pathname === item.href && "bg-accent-soft font-medium text-accent",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 truncate text-xs text-ink-muted">{email}</p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={async () => {
              await supabaseBrowser().auth.signOut();
              router.replace("/login");
            }}
          >
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
