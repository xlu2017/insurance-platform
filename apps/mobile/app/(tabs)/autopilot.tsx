import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@autopilot/design-tokens";
import { useActiveCase, useHistoricalCase, useHousehold } from "@/lib/household";
import { Body, Card, Loading, PrimaryButton, Screen, StatusPill, Title } from "@/components/ui";

const timeline: { state: string; label: string }[] = [
  { state: "awaiting_documents", label: "Policies received" },
  { state: "extracting_information", label: "Extracting your information" },
  { state: "awaiting_customer_confirmation", label: "Waiting for your confirmation" },
  { state: "ready_for_market_search", label: "Ready for market search" },
  { state: "requesting_quotes", label: "Requesting quotes" },
  { state: "awaiting_quotes", label: "Waiting for insurer responses" },
  { state: "comparing_quotes", label: "Comparing household configurations" },
  { state: "licensed_review", label: "Licensed review" },
  { state: "recommendation_ready", label: "Recommendation ready" },
  { state: "customer_decision", label: "Waiting for your decision" },
  { state: "switching", label: "Switch in progress" },
  { state: "completed", label: "Switch completed" },
];

const outcomeText: Record<string, string> = {
  completed: "Your last case completed with a successful switch.",
  retained_incumbent: "Your last case completed; you kept your current insurance.",
  cancelled: "Your last case was cancelled.",
};

export default function Autopilot() {
  const { data: household, isLoading } = useHousehold();
  const { data: activeCase, isLoading: caseLoading } = useActiveCase(household?.id);
  const { data: historicalCase } = useHistoricalCase(household?.id);

  if (isLoading || caseLoading) return <Loading />;

  const currentIndex = activeCase ? timeline.findIndex((t) => t.state === activeCase.state) : -1;

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Autopilot</Title>
          {!activeCase && historicalCase ? (
            <Card>
              <StatusPill label="No active case" tone="neutral" />
              <View style={{ height: 8 }} />
              <Body muted>{outcomeText[historicalCase.state] ?? "Last case completed."}</Body>
              <View style={{ height: 8 }} />
              <Body muted>
                A new renewal case will be created when your policy renewal date approaches.
              </Body>
            </Card>
          ) : null}
          {!activeCase && !historicalCase ? (
            <Card>
              <StatusPill label="Autopilot active" />
              <View style={{ height: 8 }} />
              <Body muted>No optimization in progress. We are monitoring your renewals.</Body>
            </Card>
          ) : null}
          {activeCase ? (
            <>
              <Card testID="case-timeline">
                {timeline.map((step, i) => {
                  const done = currentIndex > i;
                  const current = currentIndex === i;
                  return (
                    <View
                      key={step.state}
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
                        {i < timeline.length - 1 ? (
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
