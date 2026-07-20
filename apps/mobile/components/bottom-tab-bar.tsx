import { Pressable, Text, View } from "react-native";
import { usePathname, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  FileTextIcon,
  HouseIcon,
  RobotIcon,
  ShieldCheckIcon,
  UserIcon,
} from "phosphor-react-native";
import { colors, typography } from "@autopilot/design-tokens";

const TABS = [
  { name: "Home", path: "/(tabs)/home", icon: HouseIcon },
  { name: "Coverage", path: "/(tabs)/coverage", icon: ShieldCheckIcon },
  { name: "Autopilot", path: "/(tabs)/autopilot", icon: RobotIcon },
  { name: "Documents", path: "/(tabs)/documents", icon: FileTextIcon },
  { name: "Profile", path: "/(tabs)/profile", icon: UserIcon },
];

function activeTabFromPathname(pathname: string): string | null {
  if (pathname === "/" || pathname === "/home" || pathname.startsWith("/(tabs)/home")) {
    return "Home";
  }
  if (
    pathname.startsWith("/coverage") ||
    pathname.startsWith("/(tabs)/coverage") ||
    pathname.startsWith("/vehicles") ||
    pathname.startsWith("/properties") ||
    pathname.startsWith("/vehicle") ||
    pathname.startsWith("/property") ||
    pathname.startsWith("/compare-coverage") ||
    pathname.startsWith("/coverage-defaults") ||
    pathname.startsWith("/switching-conditions") ||
    pathname.startsWith("/edit-mandate")
  ) {
    return "Coverage";
  }
  if (
    pathname.startsWith("/autopilot") ||
    pathname.startsWith("/(tabs)/autopilot") ||
    pathname.startsWith("/recommendation") ||
    pathname.startsWith("/confirm-details")
  ) {
    return "Autopilot";
  }
  if (pathname.startsWith("/documents") || pathname.startsWith("/(tabs)/documents")) {
    return "Documents";
  }
  if (pathname.startsWith("/profile") || pathname.startsWith("/(tabs)/profile")) {
    return "Profile";
  }
  return null;
}

export function BottomTabBar() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const active = activeTabFromPathname(pathname);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingBottom: insets.bottom,
        minHeight: 64 + insets.bottom,
      }}
    >
      {TABS.map((tab) => {
        const focused = tab.name === active;
        const Icon = tab.icon;
        return (
          <Pressable
            key={tab.name}
            accessibilityRole="button"
            accessibilityLabel={tab.name}
            accessibilityState={{ selected: focused }}
            onPress={() => router.replace(tab.path)}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              paddingTop: 6,
              paddingBottom: 4,
            }}
          >
            <View style={{ marginBottom: 4 }}>
              <Icon
                color={focused ? colors.accent : colors.inkMuted}
                size={28}
                weight={focused ? "fill" : "regular"}
              />
            </View>
            <Text
              style={{
                fontSize: typography.sizes.caption,
                fontWeight: "500",
                color: focused ? colors.accent : colors.inkMuted,
              }}
            >
              {tab.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
