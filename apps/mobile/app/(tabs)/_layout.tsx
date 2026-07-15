import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors } from "@autopilot/design-tokens";

function TabIcon({ symbol, color }: { symbol: string; color: string }) {
  return <Text style={{ fontSize: 18, color }}>{symbol}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Home", tabBarIcon: ({ color }) => <TabIcon symbol="⌂" color={color} /> }}
      />
      <Tabs.Screen
        name="coverage"
        options={{
          title: "Coverage",
          tabBarIcon: ({ color }) => <TabIcon symbol="✓" color={color} />,
        }}
      />
      <Tabs.Screen
        name="autopilot"
        options={{
          title: "Autopilot",
          tabBarIcon: ({ color }) => <TabIcon symbol="➤" color={color} />,
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: "Documents",
          tabBarIcon: ({ color }) => <TabIcon symbol="▤" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <TabIcon symbol="◉" color={color} />,
        }}
      />
    </Tabs>
  );
}
