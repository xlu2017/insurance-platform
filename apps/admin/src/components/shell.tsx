"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";

const nav = [
  { href: "/", label: "Overview" },
  { href: "/cases", label: "Cases" },
  { href: "/insurers", label: "Insurers" },
  { href: "/outbox", label: "Email outbox" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setEmail(data.user.email ?? null);
      setChecked(true);
    });
  }, [router]);

  if (!checked) {
    return <main className="p-8 text-sm text-ink-muted">Loading…</main>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-line bg-surface p-4">
        <p className="mb-6 text-sm font-semibold">Insurance Autopilot</p>
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
