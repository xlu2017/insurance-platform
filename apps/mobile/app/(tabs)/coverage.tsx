import { router, Stack } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Body, Screen, SettingsNavigationRow, Subtitle, Title } from "@/components/ui";
import { colors, spacing } from "@autopilot/design-tokens";

export default function Coverage() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen style={{ flex: 1, padding: 0 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            minHeight: 56,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.push("/home")}
            style={{ position: "absolute", left: spacing.lg, padding: spacing.sm }}
          >
            <Body style={{ fontSize: 28, lineHeight: 28, color: colors.ink }}>{"<"}</Body>
          </Pressable>
          <Title style={{ marginBottom: 0 }}>Coverage</Title>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 0,
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.xxl,
          }}
        >
          <View style={{ marginTop: spacing.xxl, marginBottom: spacing.xl }}>
            <Subtitle style={{ marginBottom: spacing.md }}>Assets</Subtitle>
            <View style={{ gap: 12 }}>
              <SettingsNavigationRow label="Vehicles" onPress={() => router.push("/vehicles")} />
              <SettingsNavigationRow
                label="Properties"
                onPress={() => router.push("/properties")}
              />
            </View>
          </View>

          <View style={{ marginBottom: spacing.xl }}>
            <Subtitle style={{ marginBottom: spacing.md }}>Rules</Subtitle>
            <View style={{ gap: 12 }}>
              <SettingsNavigationRow
                label="Coverage defaults"
                onPress={() => router.push("/coverage-defaults")}
              />
              <SettingsNavigationRow
                label="Switching conditions"
                onPress={() => router.push("/switching-conditions")}
              />
            </View>
          </View>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
