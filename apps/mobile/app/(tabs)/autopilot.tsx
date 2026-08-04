import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "@autopilot/design-tokens";
import { useHousehold } from "@/lib/household";
import { retryDocumentBatch } from "@/lib/document-processing";
import {
  type AutopilotSession,
  type CustomerCaseAction,
  type SessionStep,
  useAutopilotSessions,
} from "@/lib/autopilot";
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

function formatElapsed(since: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime() + 334) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function SessionStepList({
  steps,
  processing,
  processingSince,
}: {
  steps: SessionStep[];
  processing?: boolean;
  processingSince?: string;
}) {
  const [tick, setTick] = useState(0);
  const [elapsed, setElapsed] = useState(processingSince ? formatElapsed(processingSince) : "");
  const dots = processing ? (tick % 3) + 1 : 1;
  useEffect(() => {
    if (!processing || !processingSince) return;
    setElapsed(formatElapsed(processingSince));
    const interval = setInterval(() => {
      setTick((t) => (t + 1) % 3);
      setElapsed(formatElapsed(processingSince));
    }, 1000 / 3);
    return () => clearInterval(interval);
  }, [processing, processingSince]);

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
        // The connector below a completed marker is completed; otherwise it
        // keeps the neutral border color. This also fixes fully-completed
        // timelines, which previously had no current/failed marker to key off.
        const lineColor = step.state === "completed" ? colors.success : colors.border;
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
              <Body
                style={{
                  color,
                  fontWeight: isCurrent ? "700" : step.state === "completed" ? "600" : "400",
                }}
              >
                {step.label}
              </Body>
              {isCurrent && processing ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <ActivityIndicator color={color} size="small" />
                  <Body
                    style={{ color, fontWeight: "700" }}
                  >{`Processing${".".repeat(dots)} ${elapsed}`}</Body>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function SessionCard({
  session,
  testID,
  onRetryComplete,
}: {
  session: AutopilotSession;
  testID?: string;
  onRetryComplete?: () => void;
}) {
  const [retrying, setRetrying] = useState(false);

  const handleAction = async (action: CustomerCaseAction) => {
    if (action.type === "route") {
      router.push(action.href);
      return;
    }
    if (action.type === "retry") {
      setRetrying(true);
      try {
        await retryDocumentBatch(action.householdId, action.batchId);
        onRetryComplete?.();
      } catch {
        // Retry failures surface on the next batch poll; no extra UI here.
      } finally {
        setRetrying(false);
      }
    }
  };

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
        processing={session.isProcessing}
        processingSince={session.processingSince}
      />
      {session.action && !session.isProcessing ? (
        <PrimaryButton
          label={session.action.label}
          onPress={() => handleAction(session.action!)}
          loading={retrying}
          testID="session-action"
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
            <SessionCard
              session={current}
              testID="current-session"
              onRetryComplete={() => refetch()}
            />
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
                  <SessionCard session={session} onRetryComplete={() => refetch()} />
                </View>
              ))
            )}
          </CollapsibleSection>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
