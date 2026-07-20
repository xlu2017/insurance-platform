import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { Body, Field, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";

const Registration = z.object({
  fullName: z.string().min(2, "Enter your name"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters"),
});

export default function Register() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const register = async () => {
    const parsed = Registration.safeParse({ fullName, email: email.trim(), password });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Check the form");
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { full_name: parsed.data.fullName, role: "customer" } },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/onboarding/household");
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen style={{ justifyContent: "center" }}>
        <Title>Create your account</Title>
        <Body muted>Start managing your insurance in one place.</Body>
        <View style={{ height: 16 }} />
        <Field label="Full name" value={fullName} onChangeText={setFullName} />
        <Field
          label="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Field label="Password" secureTextEntry value={password} onChangeText={setPassword} />
        {error ? <Body muted>{error}</Body> : null}
        <View style={{ height: 12 }} />
        <PrimaryButton label="Create account" onPress={register} loading={loading} />
        <View style={{ height: 12 }} />
        <SecondaryButton label="Back" onPress={() => router.back()} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
