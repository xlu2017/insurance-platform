import { enableScreens } from "react-native-screens";

// Disable react-native-screens native optimization while running in Expo Go so the
// root render tree does not get stuck in a blank loading state on the Android emulator.
enableScreens(false);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Redirect, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StackHeader } from "@/components/ui";
import { BottomTabBar } from "@/components/bottom-tab-bar";
import { AuthContext } from "@/lib/auth-context";
import { PUBLIC_PATHS, useAuthGate } from "@/lib/auth-gate";
import { colors } from "@autopilot/design-tokens";

function AuthGate() {
  const auth = useAuthGate();
  const pathname = usePathname();

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

  if (auth.isUnauthenticated && pathname && !PUBLIC_PATHS.has(pathname)) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <Redirect href="/welcome" />
      </SafeAreaProvider>
    );
  }

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
            {auth.isAuthenticated && <BottomTabBar />}
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
