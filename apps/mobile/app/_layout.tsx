import { enableScreens } from "react-native-screens";

// Disable react-native-screens native optimization while running in Expo Go so the
// root render tree does not get stuck in a blank loading state on the Android emulator.
enableScreens(false);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StackHeader } from "@/components/ui";
import { BottomTabBar } from "@/components/bottom-tab-bar";
import { supabase } from "@/lib/supabase";
import { colors } from "@autopilot/design-tokens";
import type { Session } from "@supabase/supabase-js";

const PUBLIC_PATHS = new Set(["/", "/welcome", "/sign-in", "/register"]);

function useAuthGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setReady(true);
      }
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (mounted) setSession(next);
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!ready || !pathname) return;
    if (!session && !PUBLIC_PATHS.has(pathname)) {
      router.replace("/welcome");
    }
  }, [ready, session, pathname, router]);

  return { session, ready };
}

export default function RootLayout() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 10_000 } } }),
  );
  const { session, ready } = useAuthGate();
  return (
    <QueryClientProvider client={client}>
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
            {ready && session && <BottomTabBar />}
          </View>
        </View>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
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
