import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { Body, Field, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
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
        <PrimaryButton label="Sign in" onPress={signIn} loading={loading} testID="sign-in-button" />
        <View style={{ height: 12 }} />
        <SecondaryButton label="Back" onPress={() => router.back()} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
