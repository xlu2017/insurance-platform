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
import { colors, radii, spacing, typography } from "@autopilot/design-tokens";

export function Screen({ children, style, ...props }: ViewProps) {
  return (
    <View style={[styles.screen, style]} {...props}>
      {children}
    </View>
  );
}

export function Card({ children, style, ...props }: ViewProps) {
  return (
    <View style={[styles.card, style]} {...props}>
      {children}
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Body({
  children,
  muted,
  style,
}: {
  children: React.ReactNode;
  muted?: boolean;
  style?: React.ComponentProps<typeof Text>["style"];
}) {
  return <Text style={[styles.body, muted && styles.muted, style]}>{children}</Text>;
}

export function Caption({ children }: { children: React.ReactNode }) {
  return <Text style={styles.caption}>{children}</Text>;
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
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
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
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
  props: TextInputProps & { label: string; error?: string; helpText?: string },
) {
  const { label, error, helpText, ...inputProps } = props;
  return (
    <View style={{ marginBottom: spacing.md }}>
      <FormLabel label={label} helpText={helpText} />
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.inkMuted}
        style={styles.input}
        {...inputProps}
      />
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
        <Text style={{ color: colors.inkMuted, fontSize: typography.sizes.body }}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.selectOverlay} onPress={() => setOpen(false)}>
          <View style={styles.selectSheet}>
            <Text style={styles.subtitle}>{label}</Text>
            {options.map((option) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: option.value === value }}
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
  tone?: "accent" | "warning" | "neutral";
}) {
  const bg =
    tone === "accent" ? colors.accentSoft : tone === "warning" ? "#FBF3E0" : colors.surfaceSubtle;
  const fg =
    tone === "accent" ? colors.accent : tone === "warning" ? colors.warning : colors.inkMuted;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
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
    paddingVertical: 14,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: typography.sizes.body,
    fontWeight: "600",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: 14,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: "500",
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
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
