import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { colors } from "@autopilot/design-tokens";
import { useActiveCase, useHistoricalCase, useHousehold } from "@/lib/household";
import {
  documentBatchStatusLabels,
  retryDocumentBatch,
  useReviewSessions,
  type DocumentBatchSummary,
} from "@/lib/document-processing";
import { formatEdmontonDateTime } from "@/lib/format";
import {
  Body,
  Caption,
  Card,
  Loading,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StatusPill,
  Subtitle,
} from "@/components/ui";

const customerStages: { states: string[]; label: string }[] = [
  {
    states: ["awaiting_documents", "extracting_information", "awaiting_customer_confirmation"],
    label: "Preparing your information",
  },
  {
    states: ["ready_for_market_search", "requesting_quotes", "awaiting_quotes"],
    label: "Requesting insurance options",
  },
  { states: ["comparing_quotes", "licensed_review"], label: "Comparing coverage and price" },
  { states: ["recommendation_ready", "customer_decision"], label: "Recommendation ready" },
  { states: ["switching", "completed"], label: "Completing your switch" },
];

const detailedStatus: Record<string, string> = {
  awaiting_documents: "Policies received",
  extracting_information: "Extracting your information",
  awaiting_customer_confirmation: "Waiting for your confirmation",
  ready_for_market_search: "Ready for market search",
  requesting_quotes: "Requesting quotes",
  awaiting_quotes: "Waiting for insurer responses",
  comparing_quotes: "Comparing coverage and price",
  licensed_review: "Expert review",
  recommendation_ready: "Recommendation ready",
  customer_decision: "Waiting for your decision",
  switching: "Switch in progress",
  completed: "Switch completed",
};

const outcomeText: Record<string, string> = {
  completed: "Your last case completed with a successful switch.",
  retained_incumbent: "Your last case completed; you kept your current insurance.",
  cancelled: "Your last case was cancelled.",
};

export default function Autopilot() {
  const { data: household, isLoading } = useHousehold();
  const { data: activeCase, isLoading: caseLoading } = useActiveCase(household?.id);
  const { data: historicalCase } = useHistoricalCase(household?.id);
  const queryClient = useQueryClient();
  const { data: sessions, isLoading: sessionsLoading } = useReviewSessions(household?.id);

  if (isLoading || caseLoading || sessionsLoading) return <Loading />;

  const currentStageIndex = activeCase
    ? customerStages.findIndex((s) => s.states.includes(activeCase.state))
    : -1;
  const subStatus = activeCase ? detailedStatus[activeCase.state] : undefined;

  const reviewableStatuses = new Set(["ready_for_review", "additional_information_required"]);
  const continueUploadStatuses = new Set(["uploading_files", "checking_duplicates"]);

  const handleRetry = async (session: DocumentBatchSummary) => {
    if (!household) return;
    await retryDocumentBatch(household.id, session.id);
    queryClient.invalidateQueries({ queryKey: ["review-sessions", household.id] });
  };

  function SessionAction({ session, index }: { session: DocumentBatchSummary; index: number }) {
    if (reviewableStatuses.has(session.status)) {
      return (
        <SecondaryButton
          label={index === 0 ? "Review" : "Continue review"}
          onPress={() =>
            router.push({
              pathname: "/onboarding/review-entities",
              params: { sessionId: session.session_id },
            })
          }
          style={{ paddingVertical: 10, paddingHorizontal: 14 }}
        />
      );
    }
    if (continueUploadStatuses.has(session.status)) {
      if (index === 0) {
        return (
          <SecondaryButton
            label="Continue upload"
            onPress={() => router.push("/(tabs)/documents")}
            style={{ paddingVertical: 10, paddingHorizontal: 14 }}
          />
        );
      }
      return <Caption>Incomplete upload</Caption>;
    }
    if (session.status === "processing_unavailable" && session.retryable) {
      return (
        <SecondaryButton
          label="Retry"
          onPress={() => handleRetry(session)}
          style={{ paddingVertical: 10, paddingHorizontal: 14 }}
        />
      );
    }
    if (session.status === "manual_review") {
      return <Caption>Sent for manual review</Caption>;
    }
    return <Caption>{index === 0 ? "Processing latest upload..." : "Processing..."}</Caption>;
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Body muted style={{ marginBottom: 16 }}>
            {activeCase
              ? "We are working through your current review. We will notify you when a recommendation is ready."
              : "Your insurance is being monitored. A new review starts automatically before your renewal."}
          </Body>

          {sessions && sessions.length > 0 ? (
            <Card testID="review-sessions">
              <Subtitle>Review sessions</Subtitle>
              <View style={{ height: 8 }} />
              {sessions.map((session, index) => (
                <View
                  key={session.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: index < sessions.length - 1 ? 12 : 0,
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Body>{documentBatchStatusLabels[session.status]}</Body>
                    <Caption>
                      {formatEdmontonDateTime(session.created_at)}
                      {session.unique_document_count > 0
                        ? ` · ${session.unique_document_count} document${session.unique_document_count === 1 ? "" : "s"}`
                        : ""}
                      {index === 0 ? " · latest" : ""}
                    </Caption>
                  </View>
                  <SessionAction session={session} index={index} />
                </View>
              ))}
            </Card>
          ) : null}

          {!activeCase && historicalCase ? (
            <Card>
              <StatusPill label="No review in progress" tone="neutral" />
              <View style={{ height: 12 }} />
              <Body muted>{outcomeText[historicalCase.state] ?? "Last case completed."}</Body>
              <View style={{ height: 8 }} />
              <Caption>
                A new renewal review will start when your policy renewal date approaches.
              </Caption>
            </Card>
          ) : null}
          {!activeCase && !historicalCase ? (
            <Card>
              <StatusPill label="Autopilot active" />
              <View style={{ height: 12 }} />
              <Body muted>
                Your insurance is being monitored. We will notify you before your next renewal.
              </Body>
            </Card>
          ) : null}
          {activeCase ? (
            <>
              <Card testID="case-timeline">
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                  }}
                >
                  <Subtitle style={{ marginBottom: 0 }}>Current review</Subtitle>
                  {subStatus ? <StatusPill label={subStatus} tone="accent" /> : null}
                </View>
                {customerStages.map((step, i) => {
                  const done = currentStageIndex > i;
                  const current = currentStageIndex === i;
                  return (
                    <View
                      key={step.label}
                      style={{ flexDirection: "row", alignItems: "flex-start", minHeight: 40 }}
                    >
                      <View style={{ alignItems: "center", width: 24 }}>
                        <View
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 6,
                            backgroundColor: current
                              ? colors.accent
                              : done
                                ? colors.success
                                : colors.border,
                            marginTop: 4,
                          }}
                        />
                        {i < customerStages.length - 1 ? (
                          <View
                            style={{
                              width: 2,
                              flex: 1,
                              backgroundColor: done ? colors.success : colors.border,
                            }}
                          />
                        ) : null}
                      </View>
                      <View style={{ flex: 1, paddingBottom: 12 }}>
                        <Body
                          muted={!done && !current}
                          style={
                            current
                              ? { color: colors.accent, fontWeight: "700" }
                              : done
                                ? { color: colors.success }
                                : undefined
                          }
                        >
                          {step.label}
                        </Body>
                      </View>
                    </View>
                  );
                })}
              </Card>
              {activeCase.state === "customer_decision" ? (
                <PrimaryButton
                  label="Review your recommendation"
                  onPress={() => router.push("/recommendation")}
                  testID="open-recommendation"
                />
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
