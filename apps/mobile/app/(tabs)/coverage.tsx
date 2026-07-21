import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Screen, SettingsNavigationRow, Subtitle } from "@/components/ui";
import { spacing } from "@autopilot/design-tokens";

export default function Coverage() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.md }}
        >
          <View style={{ gap: spacing.lg }}>
            <View>
              <Subtitle style={{ marginBottom: spacing.md }}>Assets</Subtitle>
              <View style={{ gap: spacing.md }}>
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

            <View>
              <Subtitle style={{ marginBottom: spacing.md }}>Rules</Subtitle>
              <View style={{ gap: spacing.md }}>
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
          </View>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
