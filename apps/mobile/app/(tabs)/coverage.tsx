import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Screen, SettingsNavigationRow, Subtitle } from "@/components/ui";
import { colors, spacing } from "@autopilot/design-tokens";

export default function Coverage() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSubtle }} edges={["top"]}>
      <Screen style={{ flex: 1, padding: 0 }}>
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
              <SettingsNavigationRow
                label="Compare coverage"
                onPress={() => router.push("/compare-coverage")}
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
