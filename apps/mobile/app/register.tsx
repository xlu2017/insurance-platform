import { Redirect, router, Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { signInWithOAuthProvider } from "@/lib/auth";
import {
  Body,
  Field,
  Loading,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Title,
} from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

const Registration = z.object({
  fullName: z.string().min(2, "Enter your name"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters"),
});

const SSO_TIMEOUT_MS = 30_000;

export default function Register() {
  const { status, isAuthenticated } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const ssoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (ssoTimeoutRef.current) {
        clearTimeout(ssoTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated && ssoTimeoutRef.current) {
      clearTimeout(ssoTimeoutRef.current);
      ssoTimeoutRef.current = null;
      setSsoLoading(false);
    }
  }, [isAuthenticated]);

  if (status === "loading") return <Loading />;
  if (isAuthenticated) return <Redirect href="/home" />;

  const register = async () => {
    const parsed = Registration.safeParse({ fullName, email: email.trim(), password });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Check the form");
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { full_name: parsed.data.fullName, role: "customer" } },
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    // Supabase may require email confirmation in hosted environments.
    if (data.session) {
      router.replace("/onboarding/household");
    } else {
      router.replace({ pathname: "/verify-email", params: { email: parsed.data.email } });
    }
  };

  const clearSsoTimeout = () => {
    if (ssoTimeoutRef.current) {
      clearTimeout(ssoTimeoutRef.current);
      ssoTimeoutRef.current = null;
    }
  };

  const continueWithGoogle = async () => {
    setSsoLoading(true);
    setError(null);
    clearSsoTimeout();

    ssoTimeoutRef.current = setTimeout(() => {
      setSsoLoading(false);
      setError("Sign-up took too long. Please try again.");
    }, SSO_TIMEOUT_MS);

    try {
      const { user, error: ssoError } = await signInWithOAuthProvider("google");
      clearSsoTimeout();
      if (ssoError) {
        setError(ssoError.message);
        setSsoLoading(false);
        return;
      }
      if (user) {
        setSsoLoading(false);
        router.replace("/home");
        return;
      }
      // The deep-link callback will complete sign-in; the auth listener will route
      // the authenticated user away from this screen.
    } catch (err) {
      clearSsoTimeout();
      setError(err instanceof Error ? err.message : "Sign-up failed. Please try again.");
      setSsoLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen style={{ justifyContent: "center" }}>
        <Stack.Screen options={{ headerShown: true, headerBackTitle: "Back", title: "Register" }} />
        <Title>Create your account</Title>
        <Body muted>Start managing your insurance in one place.</Body>
        <View style={{ height: 16 }} />
        <Field
          label="Full name"
          autoComplete="name"
          textContentType="name"
          value={fullName}
          onChangeText={setFullName}
          testID="full-name-input"
        />
        <Field
          label="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          testID="email-input"
        />
        <Field
          label="Password"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          value={password}
          onChangeText={setPassword}
          testID="password-input"
        />
        {error ? <Body error>{error}</Body> : null}
        <View style={{ height: 12 }} />
        <PrimaryButton
          label="Create account"
          onPress={register}
          loading={loading}
          testID="register-button"
        />
        <View style={{ height: 12 }} />
        <SecondaryButton
          label="Continue with Google"
          onPress={continueWithGoogle}
          disabled={ssoLoading}
          loading={ssoLoading}
          testID="google-register-button"
        />
        <View style={{ height: 12 }} />
        <SecondaryButton label="Back" onPress={() => router.back()} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
