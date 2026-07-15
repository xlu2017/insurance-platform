"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabaseBrowser } from "@/lib/supabase";
import { Button, Card, Input, Label } from "@/components/ui";

const LoginForm = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
type LoginForm = z.infer<typeof LoginForm>;

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(LoginForm) });

  const onSubmit = async (values: LoginForm) => {
    setError(null);
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      setError(error.message);
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
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
            {errors.email ? (
              <p className="mt-1 text-xs text-danger">{errors.email.message}</p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...register("password")}
            />
            {errors.password ? (
              <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
            ) : null}
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
