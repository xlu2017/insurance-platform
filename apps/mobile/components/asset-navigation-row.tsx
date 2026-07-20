import { Pressable, View } from "react-native";
import { CaretRightIcon } from "phosphor-react-native";
import { Body, Caption } from "@/components/ui";
import { colors, radii, spacing } from "@autopilot/design-tokens";

export function AssetNavigationRow({
  title,
  subtitle,
  editMode,
  onPress,
  onRename,
  onEditDetails,
  onRemove,
}: {
  title: string;
  subtitle?: string;
  editMode: boolean;
  onPress: () => void;
  onRename?: () => void;
  onEditDetails?: () => void;
  onRemove?: () => void;
}) {
  if (editMode) {
    return (
      <View style={rowStyles}>
        <View style={{ flex: 1, marginRight: spacing.md }}>
          <Body style={{ fontWeight: "600" }}>{title}</Body>
          {subtitle ? <Caption>{subtitle}</Caption> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          {onRename ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Rename ${title}`}
              onPress={onRename}
            >
              <Body>Rename</Body>
            </Pressable>
          ) : null}
          {onEditDetails ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${title}`}
              onPress={onEditDetails}
            >
              <Body>Edit</Body>
            </Pressable>
          ) : null}
          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${title}`}
              onPress={onRemove}
            >
              <Body style={{ color: colors.danger }}>Remove</Body>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open coverage settings for ${title}`}
      onPress={onPress}
      style={({ pressed }) => [rowStyles, pressed && { backgroundColor: colors.surfaceSubtle }]}
    >
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Body style={{ fontWeight: "600" }}>{title}</Body>
        {subtitle ? <Caption numberOfLines={1}>{subtitle}</Caption> : null}
      </View>
      <CaretRightIcon color={colors.inkMuted} size={16} />
    </Pressable>
  );
}

const rowStyles = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radii.md,
  paddingHorizontal: 16,
  minHeight: 56,
};
