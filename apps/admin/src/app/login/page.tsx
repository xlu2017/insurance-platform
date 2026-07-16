"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { supabaseBrowser } from "@/lib/supabase";
import { Button, Card, Input, Label } from "@/components/ui";

const LoginForm = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setError(null);
    setErrors({});

    const parsed = LoginForm.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const formatted = parsed.error.format();
      setErrors({
        email: formatted.email?._errors[0],
        password: formatted.password?._errors[0],
      });
      return;
    }

    setLoading(true);
    const supabase = supabaseBrowser();
    const { data, error: signInError } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    if (!profile || profile.role === "customer") {
      await supabase.auth.signOut();
      setError("This console is for operations, reviewer and administrator accounts.");
      return;
    }

    router.push("/");
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold">Insurance Autopilot</h1>
        <p className="mb-5 text-sm text-ink-muted">Operations console sign in</p>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            signIn();
          }}
          noValidate
        >
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
            {errors.email ? <p className="mt-1 text-xs text-danger">{errors.email}</p> : null}
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            {errors.password ? <p className="mt-1 text-xs text-danger">{errors.password}</p> : null}
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
