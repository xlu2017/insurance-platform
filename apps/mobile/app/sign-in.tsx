import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Body, Field, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";
import { signInWithPassword, type AuthError, type SignInCredentials } from "@/lib/auth";

const MAX_RETRIES = 3;

function getDisplayError(error: AuthError | null, retryCount: number): AuthError | null {
  if (!error) return null;
  if (error.retryable && retryCount >= MAX_RETRIES) {
    return {
      category: "service_unavailable",
      message: "The sign-in service is still unavailable. Please try again later.",
      retryable: false,
    };
  }
  return error;
}

export default function SignIn() {
  const demoEmail = process.env.EXPO_PUBLIC_DEMO_EMAIL;
  const demoPassword = process.env.EXPO_PUBLIC_DEMO_PASSWORD;

  const [email, setEmail] = useState(demoEmail ?? "");
  const [password, setPassword] = useState(demoPassword ?? "");
  const [error, setError] = useState<AuthError | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const isMounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const resetForInput = () => {
    if (retryCount > 0) {
      setRetryCount(0);
    }
    if (error) {
      setError(null);
    }
  };

  const performSignIn = async (
    credentials: SignInCredentials,
    { isRetry = false }: { isRetry?: boolean } = {},
  ) => {
    if (loading) return;

    const trimmedEmail = credentials.email.trim();
    if (!trimmedEmail || !credentials.password) {
      setError({
        category: "invalid_credentials",
        message: "Enter your email and password.",
        retryable: false,
      });
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    if (!isMounted.current) return;
    setLoading(true);
    setError(null);

    try {
      const { user, error: authError } = await signInWithPassword(credentials, {
        signal: abortRef.current.signal,
      });

      if (!isMounted.current) return;

      if (user) {
        router.replace("/home");
        return;
      }

      if (authError) {
        setError(authError);
        if (authError.retryable) {
          setRetryCount((count) => (isRetry ? count + 1 : 1));
        } else {
          setRetryCount(0);
        }
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  };

  const displayError = getDisplayError(error, retryCount);
  const canRetry = error?.retryable && retryCount < MAX_RETRIES;

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
          onChangeText={(value) => {
            setEmail(value);
            resetForInput();
          }}
          testID="email-input"
        />
        <Field
          label="Password"
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            resetForInput();
          }}
          testID="password-input"
        />
        <View style={{ minHeight: 40, justifyContent: "center" }}>
          {displayError ? (
            <Body error numberOfLines={2} testID="sign-in-error">
              {displayError.message}
            </Body>
          ) : null}
        </View>
        <PrimaryButton
          label="Sign in"
          onPress={() => performSignIn({ email, password })}
          loading={loading}
          testID="sign-in-button"
        />
        {canRetry ? (
          <>
            <View style={{ height: 12 }} />
            <SecondaryButton
              label="Retry"
              onPress={() => performSignIn({ email, password }, { isRetry: true })}
              disabled={loading}
              testID="retry-button"
            />
          </>
        ) : null}
        {demoEmail && demoPassword ? (
          <>
            <View style={{ height: 12 }} />
            <SecondaryButton
              label="Sign in with test account"
              onPress={() => performSignIn({ email: demoEmail, password: demoPassword })}
              disabled={loading}
              testID="demo-sign-in-button"
            />
          </>
        ) : null}
        <View style={{ height: 12 }} />
        <SecondaryButton
          label="Back"
          onPress={() => router.back()}
          disabled={loading}
          testID="back-button"
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}
