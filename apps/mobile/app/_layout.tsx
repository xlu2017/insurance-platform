import { enableScreens } from "react-native-screens";

// Disable react-native-screens native optimization while running in Expo Go so the
// root render tree does not get stuck in a blank loading state on the Android emulator.
enableScreens(false);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { colors } from "@autopilot/design-tokens";

export default function RootLayout() {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 2, staleTime: 10_000 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <StatusBar style="dark" />
      <View style={styles.viewport}>
        <View style={Platform.OS === "web" ? styles.webPhoneFrame : styles.nativeFrame}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </View>
      </View>
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
