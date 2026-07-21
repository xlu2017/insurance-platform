import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewProps,
} from "react-native";
import { router } from "expo-router";
import type { NativeStackHeaderProps } from "@react-navigation/native-stack";
import { CaretDownIcon, CaretLeftIcon, CaretRightIcon } from "phosphor-react-native";
import { colors, radii, spacing, typography } from "@autopilot/design-tokens";

export function Screen({ children, style, ...props }: ViewProps) {
  return (
    <View style={[styles.screen, style]} {...props}>
      {children}
    </View>
  );
}

export function Card({
  children,
  style,
  onEdit,
  editLabel = "Edit",
  title,
  ...props
}: ViewProps & { onEdit?: () => void; editLabel?: string; title?: string }) {
  return (
    <View style={[styles.card, style]} {...props}>
      {title || onEdit ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: spacing.sm,
          }}
        >
          {title ? <Subtitle>{title}</Subtitle> : <View />}
          {onEdit ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editLabel}
              onPress={onEdit}
              style={({ pressed }) => [styles.editButton, pressed && styles.editButtonPressed]}
            >
              <Body style={{ color: colors.accent }}>{editLabel}</Body>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Title({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.ComponentProps<typeof Text>["style"];
}) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function PageHeader({
  title,
  backRoute,
  onBack,
  right,
}: {
  title: string;
  backRoute?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const showBack = Boolean(onBack ?? backRoute);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        minHeight: 56,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      {showBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => {
            if (onBack) {
              onBack();
            } else if (backRoute) {
              router.navigate(backRoute);
            } else {
              router.back();
            }
          }}
          style={{
            position: "absolute",
            left: spacing.lg,
            padding: spacing.sm,
            minWidth: 44,
            minHeight: 44,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <CaretLeftIcon color={colors.ink} size={28} />
        </Pressable>
      ) : null}
      <Title style={{ marginBottom: 0 }}>{title}</Title>
      {right ? <View style={{ position: "absolute", right: spacing.lg }}>{right}</View> : null}
    </View>
  );
}

function titleForRoute(routeName: string): string {
  const titles: Record<string, string> = {
    home: "Home",
    coverage: "Coverage",
    autopilot: "Autopilot",
    documents: "Documents",
    profile: "Profile",
    vehicles: "Vehicles",
    properties: "Properties",
    "vehicle/[id]": "Vehicle coverage",
    "property/[id]": "Property coverage",
    "compare-coverage": "Compare coverage",
    "coverage-defaults": "Coverage defaults",
    "switching-conditions": "Switching conditions",
    "edit-mandate": "Edit mandate",
    recommendation: "Recommendation",
    "confirm-details": "Confirm details",
    welcome: "Welcome",
    register: "Register",
    "sign-in": "Sign in",
    "(tabs)": "Insurance Autopilot",
  };
  if (titles[routeName]) {
    return titles[routeName];
  }
  return (
    routeName
      .split("/")
      .pop()
      ?.replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) ?? ""
  );
}

const PRIMARY_TAB_ROUTES = new Set([
  "home",
  "(tabs)/home",
  "coverage",
  "(tabs)/coverage",
  "autopilot",
  "(tabs)/autopilot",
  "documents",
  "(tabs)/documents",
  "profile",
  "(tabs)/profile",
]);

export function StackHeader({ options, navigation, route }: NativeStackHeaderProps) {
  const canGoBack = Boolean(navigation.canGoBack?.());
  const isPrimaryTab = PRIMARY_TAB_ROUTES.has(route.name);
  return (
    <PageHeader
      title={options.title ?? titleForRoute(route.name)}
      onBack={!isPrimaryTab && canGoBack ? () => navigation.goBack() : undefined}
    />
  );
}

export function Subtitle({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.ComponentProps<typeof Text>["style"];
}) {
  return <Text style={[styles.subtitle, style]}>{children}</Text>;
}

export function Body({
  children,
  muted,
  error,
  style,
  ...rest
}: {
  children: React.ReactNode;
  muted?: boolean;
  error?: boolean;
  style?: React.ComponentProps<typeof Text>["style"];
} & Omit<React.ComponentProps<typeof Text>, "style" | "children">) {
  return (
    <Text
      style={[styles.body, muted && styles.muted, error && { color: colors.danger }, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}

export function Caption({
  children,
  style,
  ...rest
}: {
  children: React.ReactNode;
  style?: React.ComponentProps<typeof Text>["style"];
} & Omit<React.ComponentProps<typeof Text>, "style" | "children">) {
  return (
    <Text style={[styles.caption, style]} {...rest}>
      {children}
    </Text>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: React.ComponentProps<typeof Pressable>["style"];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primaryButton,
        typeof style === "function" ? style({ pressed }) : style,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.primaryButtonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  style?: React.ComponentProps<typeof Pressable>["style"];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.secondaryButton,
        typeof style === "function" ? style({ pressed }) : style,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

export function InfoTooltip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`About ${label}`}
        accessibilityHint="Shows an explanation of this setting"
        hitSlop={8}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.helpButton, pressed && styles.buttonPressed]}
      >
        <Text style={styles.helpButtonText}>?</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.selectOverlay} onPress={() => setOpen(false)}>
          <Pressable
            accessibilityViewIsModal
            style={styles.tooltipSheet}
            onPress={(event) => event.stopPropagation()}
          >
            <Text style={styles.subtitle}>{label}</Text>
            <Text style={styles.tooltipBody}>{text}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Close ${label} explanation`}
              onPress={() => setOpen(false)}
              style={({ pressed }) => [styles.tooltipClose, pressed && styles.buttonPressed]}
            >
              <Text style={styles.tooltipCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export function FormLabel({ label, helpText }: { label: string; helpText?: string }) {
  return (
    <View style={styles.fieldLabelRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {helpText ? <InfoTooltip label={label} text={helpText} /> : null}
    </View>
  );
}

export function Field(
  props: TextInputProps & { label?: string; error?: string; helpText?: string; prefix?: string },
) {
  const { label, error, helpText, prefix, ...inputProps } = props;
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <FormLabel label={label} helpText={helpText} /> : null}
      {prefix ? (
        <View style={styles.inputWithPrefix}>
          <Text style={styles.inputPrefix}>{prefix}</Text>
          <TextInput
            accessibilityLabel={label}
            placeholderTextColor={colors.inkMuted}
            style={[styles.input, { flex: 1, borderWidth: 0, backgroundColor: "transparent" }]}
            {...inputProps}
          />
        </View>
      ) : (
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.inkMuted}
          style={styles.input}
          {...inputProps}
        />
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function Select<T extends string>({
  label,
  helpText,
  options,
  value,
  onValueChange,
}: {
  label: string;
  helpText?: string;
  options: { value: T; label: string }[];
  value: T;
  onValueChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value)?.label ?? value;
  return (
    <View style={{ marginBottom: spacing.md }}>
      <FormLabel label={label} helpText={helpText} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: selected }}
        accessibilityHint="Opens the available choices"
        onPress={() => setOpen(true)}
        style={styles.selectTrigger}
      >
        <Text style={styles.selectTriggerText}>{selected}</Text>
        <CaretDownIcon color={colors.inkMuted} size={16} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.selectOverlay} onPress={() => setOpen(false)}>
          <View style={styles.selectSheet}>
            <Text style={styles.subtitle}>{label}</Text>
            {options.map((option) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: option.value === value }}
                testID={`select-option-${option.label}`}
                key={option.value}
                onPress={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [
                  styles.selectOption,
                  option.value === value && styles.selectOptionSelected,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text
                  style={[
                    styles.body,
                    option.value === value && { color: colors.accent, fontWeight: "600" },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

export function StatusPill({
  label,
  tone = "accent",
}: {
  label: string;
  tone?: "accent" | "warning" | "neutral" | "error" | "success";
}) {
  const bg =
    tone === "accent"
      ? colors.accentSoft
      : tone === "warning"
        ? "#FBF3E0"
        : tone === "error"
          ? "#FDECEC"
          : tone === "success"
            ? "#E6F6F2"
            : colors.surfaceSubtle;
  const fg =
    tone === "accent"
      ? colors.accent
      : tone === "warning"
        ? colors.warning
        : tone === "error"
          ? "#B91C1C"
          : tone === "success"
            ? colors.success
            : colors.inkMuted;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function CollapsibleSection({
  title,
  children,
  defaultExpanded = true,
  testID,
}: {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  testID?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <View testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${expanded ? "expanded" : "collapsed"}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => [styles.collapsibleHeader, pressed && styles.buttonPressed]}
      >
        <Text style={styles.collapsibleTitle}>{title}</Text>
        {expanded ? (
          <CaretDownIcon color={colors.inkMuted} size={16} />
        ) : (
          <CaretRightIcon color={colors.inkMuted} size={16} />
        )}
      </Pressable>
      {expanded ? children : null}
    </View>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function SettingsNavigationRow({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsRow,
        pressed && !disabled ? styles.settingsRowPressed : null,
        disabled ? styles.settingsRowDisabled : null,
      ]}
    >
      <Text style={styles.settingsRowLabel}>{label}</Text>
      <CaretRightIcon color={colors.inkMuted} size={16} />
    </Pressable>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.sizes.title,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: typography.sizes.subtitle,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  body: {
    fontSize: typography.sizes.body,
    color: colors.ink,
    lineHeight: 22,
  },
  muted: {
    color: colors.inkMuted,
  },
  caption: {
    fontSize: typography.sizes.caption,
    color: colors.inkMuted,
    lineHeight: 18,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    minHeight: 56,
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: typography.sizes.body,
    fontWeight: "600",
    textAlign: "center",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    minHeight: 56,
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "500",
    textAlign: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  fieldLabel: {
    flexShrink: 1,
    fontSize: typography.sizes.caption,
    fontWeight: "500",
    color: colors.inkMuted,
  },
  helpButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
    backgroundColor: colors.surface,
  },
  helpButtonText: {
    color: colors.accent,
    fontSize: typography.sizes.caption,
    fontWeight: "700",
    lineHeight: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: typography.sizes.body,
    color: colors.ink,
    minHeight: 48,
  },
  inputWithPrefix: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    minHeight: 48,
  },
  inputPrefix: {
    paddingLeft: 12,
    paddingRight: 6,
    fontSize: typography.sizes.body,
    color: colors.inkMuted,
  },
  error: {
    color: colors.danger,
    fontSize: typography.sizes.caption,
    marginTop: 4,
  },
  pill: {
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: {
    fontSize: typography.sizes.caption,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  rowLabel: {
    color: colors.inkMuted,
    fontSize: typography.sizes.caption,
    flexShrink: 1,
    marginRight: spacing.md,
  },
  rowValue: {
    color: colors.ink,
    fontSize: typography.sizes.caption,
    fontWeight: "600",
    textAlign: "right",
    flexShrink: 1,
  },
  selectTrigger: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 48,
  },
  selectTriggerText: {
    fontSize: typography.sizes.body,
    color: colors.ink,
  },
  selectOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  selectSheet: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  selectOption: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  selectOptionSelected: {
    backgroundColor: colors.accentSoft,
  },
  tooltipSheet: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    maxWidth: 520,
    alignSelf: "center",
    width: "100%",
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: 16,
    minHeight: 56,
  },
  settingsRowPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  settingsRowDisabled: {
    opacity: 0.5,
  },
  settingsRowLabel: {
    fontSize: typography.sizes.body,
    fontWeight: "500",
    color: colors.ink,
  },
  settingsRowChevron: {
    fontSize: typography.sizes.body,
    fontWeight: "600",
    color: colors.inkMuted,
  },
  tooltipBody: {
    fontSize: typography.sizes.body,
    color: colors.ink,
    lineHeight: 22,
  },
  tooltipClose: {
    alignSelf: "flex-end",
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tooltipCloseText: {
    color: colors.accent,
    fontSize: typography.sizes.body,
    fontWeight: "600",
  },
  editButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
  },
  editButtonPressed: {
    opacity: 0.7,
  },
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
  },
  collapsibleTitle: {
    fontSize: typography.sizes.subtitle,
    fontWeight: "600",
    color: colors.ink,
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
