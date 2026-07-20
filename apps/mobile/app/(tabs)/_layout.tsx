import { Tabs } from "expo-router";
import { View } from "react-native";
import {
  FileTextIcon,
  HouseIcon,
  RobotIcon,
  ShieldCheckIcon,
  UserIcon,
} from "phosphor-react-native";
import { colors, typography } from "@autopilot/design-tokens";

function TabIcon({
  icon: Icon,
  focused,
  color,
  size = 28,
}: {
  icon: typeof HouseIcon;
  focused: boolean;
  color: string;
  size?: number;
}) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 4 }}>
      <Icon color={color} size={size} weight={focused ? "fill" : "regular"} />
      {focused ? (
        <View
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: color,
            marginTop: 3,
          }}
        />
      ) : null}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontSize: typography.sizes.caption, fontWeight: "500" },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          height: 64,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon={HouseIcon} focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="coverage"
        options={{
          title: "Coverage",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon={ShieldCheckIcon} focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="autopilot"
        options={{
          title: "Autopilot",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon={RobotIcon} focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: "Documents",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon={FileTextIcon} focused={focused} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ focused, color }) => (
            <TabIcon icon={UserIcon} focused={focused} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
