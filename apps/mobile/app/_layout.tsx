import { enableScreens } from "react-native-screens";

// Disable react-native-screens native optimization while running in Expo Go so the
// root render tree does not get stuck in a blank loading state on the Android emulator.
enableScreens(false);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PrimaryButton, StackHeader } from "@/components/ui";
import { BottomTabBar } from "@/components/bottom-tab-bar";
import { AuthContext } from "@/lib/auth-context";
import { useAuthGate } from "@/lib/auth-gate";
import { colors } from "@autopilot/design-tokens";

function AuthGate() {
  const auth = useAuthGate();
  const pathname = usePathname();

  useEffect(() => {
    // Let expo-web-browser clean up any pending auth session that may have
    // survived a cold start or process switch.
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const style = document.createElement("style");
    style.id = "hide-web-textarea-scrollbars";
    style.textContent = `
      textarea::-webkit-scrollbar { display: none; }
      textarea { scrollbar-width: none; }
    `;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  if (auth.status === "configuration_error" || auth.status === "network_error") {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={[styles.viewport, styles.loading]}>
          <Text style={{ color: "#d00", textAlign: "center" }}>
            {auth.error?.message ?? "Sign-in is unavailable."}
          </Text>
          <View style={{ height: 16 }} />
          <PrimaryButton label="Retry" onPress={auth.retry} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (auth.status === "loading") {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={[styles.viewport, styles.loading]}>
          <ActivityIndicator />
        </View>
      </SafeAreaProvider>
    );
  }

  const showTabBar =
    auth.isAuthenticated &&
    pathname !== "/welcome" &&
    pathname !== "/sign-in" &&
    pathname !== "/register" &&
    pathname !== "/auth/callback";

  return (
    <AuthContext.Provider value={auth}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={styles.viewport}>
          <View style={Platform.OS === "web" ? styles.webPhoneFrame : styles.nativeFrame}>
            <Stack
              screenOptions={{
                header: StackHeader,
                headerStyle: { backgroundColor: colors.surface },
                headerTintColor: colors.ink,
                headerShadowVisible: true,
                contentStyle: { flex: 1, backgroundColor: colors.surfaceSubtle },
              }}
            />
            {showTabBar && <BottomTabBar />}
          </View>
        </View>
      </SafeAreaProvider>
    </AuthContext.Provider>
  );
}

export default function RootLayout() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 10_000 } } }),
  );

  return (
    <QueryClientProvider client={client}>
      <AuthGate />
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  viewport: {
    flex: 1,
    backgroundColor: colors.surfaceSubtle,
  },
  nativeFrame: {
    flex: 1,
  },
  webPhoneFrame: {
    width: "100%",
    maxWidth: 430,
    height: "100%",
    maxHeight: 932,
    alignSelf: "center",
    flex: 1,
    backgroundColor: colors.surfaceSubtle,
  },
});
