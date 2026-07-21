import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { Body, Field, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";

export default function SignIn() {
  const demoEmail = process.env.EXPO_PUBLIC_DEMO_EMAIL;
  const demoPassword = process.env.EXPO_PUBLIC_DEMO_PASSWORD;

  const [email, setEmail] = useState(demoEmail ?? "");
  const [password, setPassword] = useState(demoPassword ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signIn = async (creds?: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: (creds?.email ?? email).trim(),
      password: creds?.password ?? password,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/home");
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen style={{ justifyContent: "center" }}>
        <Title>Welcome back</Title>
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
          autoComplete="current-password"
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          testID="password-input"
        />
        {error ? <Body error>{error}</Body> : null}
        <View style={{ height: 12 }} />
        <PrimaryButton
          label="Sign in"
          onPress={() => signIn()}
          loading={loading}
          testID="sign-in-button"
        />
        {demoEmail && demoPassword ? (
          <>
            <View style={{ height: 12 }} />
            <SecondaryButton
              label="Sign in with test account"
              onPress={() => signIn({ email: demoEmail, password: demoPassword })}
              disabled={loading}
              testID="demo-sign-in-button"
            />
          </>
        ) : null}
        <View style={{ height: 12 }} />
        <SecondaryButton label="Back" onPress={() => router.back()} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
