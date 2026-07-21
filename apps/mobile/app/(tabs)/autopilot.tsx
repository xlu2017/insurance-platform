import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@autopilot/design-tokens";
import { useHousehold } from "@/lib/household";
import { useAutopilotSessions, type AutopilotSession, type SessionStep } from "@/lib/autopilot";
import {
  Body,
  Caption,
  Card,
  CollapsibleSection,
  Loading,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StatusPill,
  Subtitle,
} from "@/components/ui";

function StepMarker({ state }: { state: SessionStep["state"] }) {
  const color =
    state === "completed"
      ? colors.success
      : state === "current"
        ? "#F59E0B"
        : state === "failed"
          ? "#B91C1C"
          : colors.border;
  const backgroundColor =
    state === "upcoming" ? colors.surface : state === "current" ? "#FEF3C7" : color;
  const borderWidth = state === "upcoming" || state === "current" ? 1 : 0;
  return (
    <View
      style={{
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor,
        borderWidth,
        borderColor: color,
        marginTop: 4,
      }}
    />
  );
}

function SessionStepList({
  steps,
  action,
  processing,
}: {
  steps: SessionStep[];
  action?: AutopilotSession["action"];
  processing?: boolean;
}) {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    if (!processing) return;
    const interval = setInterval(() => setDots((d) => (d % 3) + 1), 500);
    return () => clearInterval(interval);
  }, [processing]);
  return (
    <View>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const isCurrent = step.state === "current";
        const color =
          step.state === "completed"
            ? colors.success
            : step.state === "current"
              ? "#F59E0B"
              : step.state === "failed"
                ? "#B91C1C"
                : colors.inkMuted;
        const lineColor =
          index < steps.findIndex((s) => s.state === "current" || s.state === "failed")
            ? colors.success
            : colors.border;
        return (
          <View
            key={step.key}
            style={{ flexDirection: "row", alignItems: "flex-start", minHeight: 40 }}
          >
            <View style={{ alignItems: "center", width: 24 }}>
              <StepMarker state={step.state} />
              {!isLast ? (
                <View
                  style={{
                    width: 2,
                    flex: 1,
                    backgroundColor: lineColor,
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: 12 }}>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Body
                  style={{
                    color,
                    fontWeight: isCurrent ? "700" : step.state === "completed" ? "600" : "400",
                  }}
                >
                  {step.label}
                </Body>
                {isCurrent && processing ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator color={color} size="small" />
                    <Body
                      style={{ color, fontWeight: "700" }}
                    >{`Processing${".".repeat(dots)}`}</Body>
                  </View>
                ) : isCurrent && action ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    onPress={() =>
                      router.push({
                        pathname: action.route,
                        params: action.params,
                      })
                    }
                    style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Body style={{ color: "#F59E0B", fontWeight: "600" }}>{action.label}</Body>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SessionCard({ session, testID }: { session: AutopilotSession; testID?: string }) {
  return (
    <Card testID={testID} style={{ marginBottom: 0 }}>
      <View style={{ marginBottom: 12, gap: 4 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <Subtitle style={{ flex: 1, marginBottom: 0 }}>{session.name}</Subtitle>
          <StatusPill
            label={session.status}
            tone={session.statusTone}
            tooltip={session.tooltip}
            variant="text"
          />
        </View>
        <Caption>Started {session.startedAt}</Caption>
      </View>
      <SessionStepList
        steps={session.steps}
        action={session.action}
        processing={session.isProcessing}
      />
      {session.action && !session.isProcessing ? (
        <PrimaryButton
          label={session.action.label}
          onPress={() =>
            router.push({
              pathname: session.action!.route,
              params: session.action!.params,
            })
          }
        />
      ) : null}
    </Card>
  );
}

export default function Autopilot() {
  const { data: household, isLoading: householdLoading } = useHousehold();
  const { current, past, isLoading, error, refetch } = useAutopilotSessions(household?.id);

  if (householdLoading || isLoading) return <Loading />;

  if (error) {
    return (
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <Screen>
          <Subtitle>We couldn’t load Autopilot</Subtitle>
          <Body muted>Check your connection and try again.</Body>
          <View style={{ height: 16 }} />
          <SecondaryButton label="Try again" onPress={() => refetch()} />
        </Screen>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.md }}
        >
          <Subtitle style={{ marginBottom: spacing.md }}>Current Session</Subtitle>
          {current ? (
            <SessionCard session={current} testID="current-session" />
          ) : (
            <Card>
              <Subtitle style={{ marginBottom: 4 }}>No active Autopilot session</Subtitle>
              <Body muted>
                Your next insurance review will appear here when Autopilot begins checking your
                coverage.
              </Body>
            </Card>
          )}

          <View style={{ height: 24 }} />

          <CollapsibleSection title="Other sessions" testID="past-sessions-section">
            {past.length === 0 ? (
              <Card>
                <Body muted>No other sessions yet</Body>
                <Caption>Other active or completed Autopilot sessions will appear here.</Caption>
              </Card>
            ) : (
              past.map((session, index) => (
                <View key={session.id} style={{ marginBottom: index < past.length - 1 ? 16 : 0 }}>
                  <SessionCard session={session} />
                </View>
              ))
            )}
          </CollapsibleSection>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
