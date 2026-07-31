import { Redirect, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Body, Field, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";
import {
  signInWithOAuthProvider,
  signInWithPassword,
  type AuthError,
  type SignInCredentials,
} from "@/lib/auth";
import { useAuth } from "@/lib/auth-context";
import { getDemoCredentials } from "@/lib/config";

const MAX_RETRIES = 3;
const SSO_TIMEOUT_MS = 30_000;

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
  const { status, isAuthenticated } = useAuth();
  const { email: demoEmail, password: demoPassword } = getDemoCredentials();

  const [email, setEmail] = useState(demoEmail ?? "");
  const [password, setPassword] = useState(demoPassword ?? "");
  const [error, setError] = useState<AuthError | null>(null);
  const [loading, setLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [lastAttempt, setLastAttempt] = useState<"password" | "google" | null>(null);
  const ssoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      isMounted.current = false;
      abortRef.current?.abort();
      if (ssoTimeoutRef.current) {
        clearTimeout(ssoTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      if (ssoTimeoutRef.current) {
        clearTimeout(ssoTimeoutRef.current);
        ssoTimeoutRef.current = null;
      }
      setLoading(false);
    }
  }, [isAuthenticated]);

  if (status === "loading") return null;
  if (isAuthenticated) return <Redirect href="/home" />;

  const resetForInput = () => {
    if (retryCount > 0) {
      setRetryCount(0);
    }
    if (error) {
      setError(null);
    }
  };

  const clearSsoTimeout = () => {
    if (ssoTimeoutRef.current) {
      clearTimeout(ssoTimeoutRef.current);
      ssoTimeoutRef.current = null;
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
    setLastAttempt("password");

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

  const performSSO = async ({ isRetry = false }: { isRetry?: boolean } = {}) => {
    if (loading) return;
    if (!isMounted.current) return;
    setLoading(true);
    setError(null);
    setRetryCount((count) => (isRetry ? count + 1 : 1));
    setLastAttempt("google");
    clearSsoTimeout();

    ssoTimeoutRef.current = setTimeout(() => {
      if (!isMounted.current) return;
      setLoading(false);
      setError({
        category: "timeout",
        message: "Sign-in took too long. Please try again.",
        retryable: true,
      });
    }, SSO_TIMEOUT_MS);

    try {
      const { user, error: ssoError } = await signInWithOAuthProvider("google");
      if (!isMounted.current) return;
      clearSsoTimeout();
      if (ssoError) {
        setError(ssoError);
        setLoading(false);
        return;
      }
      if (user) {
        setLoading(false);
        router.replace("/home");
        return;
      }
      // No immediate user and no error: the deep-link callback will complete
      // the exchange and the auth listener will redirect once the session is set.
    } catch (err) {
      if (!isMounted.current) return;
      clearSsoTimeout();
      setError({
        category: "unknown",
        message: err instanceof Error ? err.message : "Sign-in failed. Please try again.",
        retryable: false,
      });
      setLoading(false);
    }
  };

  const displayError = getDisplayError(error, retryCount);
  const canRetry = error?.retryable && retryCount < MAX_RETRIES && lastAttempt !== null;

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
        <View style={{ height: 12 }} />
        <SecondaryButton
          label="Continue with Google"
          onPress={performSSO}
          disabled={loading}
          loading={loading}
          testID="google-sign-in-button"
        />
        {canRetry ? (
          <>
            <View style={{ height: 12 }} />
            <SecondaryButton
              label="Retry"
              onPress={() => {
                if (lastAttempt === "google") {
                  performSSO({ isRetry: true });
                } else {
                  performSignIn({ email, password }, { isRetry: true });
                }
              }}
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
