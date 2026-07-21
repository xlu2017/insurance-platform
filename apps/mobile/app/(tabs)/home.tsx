import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useActiveCase, useHistoricalCase, useHousehold } from "@/lib/household";
import { colors } from "@autopilot/design-tokens";
import { formatCad, formatEdmontonDate } from "@/lib/format";
import {
  Body,
  Caption,
  Card,
  Loading,
  PrimaryButton,
  Row,
  Screen,
  StatusPill,
  Subtitle,
  Title,
} from "@/components/ui";

export default function Home() {
  const { data: household, isLoading } = useHousehold();
  const { data: activeCase } = useActiveCase(household?.id);
  const { data: historicalCase } = useHistoricalCase(household?.id);

  const { data: policies } = useQuery({
    queryKey: ["current-policies", household?.id],
    enabled: !!household,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select(
          "insurer_name, product_line, annual_premium_cents, bundle_discount_cents, renewal_date",
        )
        .eq("household_id", household!.id)
        .eq("is_current", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: pendingQuestion } = useQuery({
    queryKey: ["pending-question", activeCase?.id],
    enabled: !!activeCase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_questions")
        .select("id, prompt")
        .eq("case_id", activeCase!.id)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: savings } = useQuery({
    queryKey: ["savings", household?.id],
    enabled: !!household,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recommendations")
        .select("net_savings_cents, optimization_cases!inner(household_id, state)")
        .eq("optimization_cases.household_id", household!.id)
        .eq("optimization_cases.state", "completed")
        .eq("status", "customer_approved");
      if (error) throw error;
      return (data ?? []).reduce((sum, r) => sum + r.net_savings_cents, 0);
    },
  });

  if (isLoading) return <Loading />;
  if (!household) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Title>Finish setting up</Title>
        <Body muted>Set up your account to start Autopilot.</Body>
        <View style={{ height: 16 }} />
        <PrimaryButton
          label="Continue setup"
          onPress={() => router.push("/onboarding/household")}
        />
      </Screen>
    );
  }

  const auto = (policies ?? []).find((p) => p.product_line === "auto");
  const property = (policies ?? []).find((p) => p.product_line === "property");
  const combined = (policies ?? []).reduce(
    (sum, p) => sum + p.annual_premium_cents - p.bundle_discount_cents,
    0,
  );
  const nextRenewal = (policies ?? [])
    .map((p) => p.renewal_date)
    .filter(Boolean)
    .sort()[0];

  const requiredAction = pendingQuestion
    ? {
        label: "Answer a question from your insurer",
        buttonLabel: "Answer question",
        action: () => router.push(`/question/${pendingQuestion.id}`),
      }
    : activeCase?.state === "customer_decision"
      ? {
          label: "Review your recommendation",
          buttonLabel: "Review recommendation",
          action: () => router.push("/recommendation"),
        }
      : activeCase?.state === "awaiting_customer_confirmation"
        ? {
            label: "Confirm your policy details",
            buttonLabel: "Confirm policy details",
            action: () => router.push("/confirm-details"),
          }
        : activeCase?.state === "extracting_information" ||
            activeCase?.state === "awaiting_documents"
          ? {
              label: "Review document details",
              buttonLabel: "Review document details",
              action: () => router.push("/onboarding/review-entities"),
            }
          : activeCase?.state === "comparing_quotes" || activeCase?.state === "licensed_review"
            ? {
                label: "Review coverage rules",
                buttonLabel: "Review coverage rules",
                action: () => router.push("/onboarding/reconcile-mandates"),
              }
            : null;

  const historicalOutcome = historicalCase
    ? historicalCase.state === "completed"
      ? "Last case completed with a switch."
      : historicalCase.state === "retained_incumbent"
        ? "Last case completed; you kept your current insurance."
        : "Last case was cancelled."
    : null;

  const isOnboardingComplete = household?.onboarding_step === "complete";
  const hasPolicies = (policies ?? []).length > 0;
  const showSetupAction = !requiredAction && (!isOnboardingComplete || !hasPolicies);
  const setupAction = isOnboardingComplete
    ? { label: "Upload documents", route: "/(tabs)/documents" }
    : { label: "Continue setup", route: "/onboarding/documents" };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>
            {requiredAction ? "One item needs your attention" : "Your insurance is covered"}
          </Title>
          <Body muted style={{ marginBottom: 16 }}>
            {requiredAction
              ? requiredAction.label
              : "Autopilot is monitoring your policies and will alert you before renewal."}
          </Body>

          <Card testID="autopilot-status-card">
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <StatusPill
                label={household.autopilot_active ? "Autopilot active" : "Autopilot paused"}
                tone={household.autopilot_active ? "accent" : "neutral"}
                tooltip={
                  household.autopilot_active
                    ? "Autopilot is monitoring your policies and renewals."
                    : "Autopilot is paused and will not monitor your policies."
                }
              />
              {historicalOutcome && !requiredAction ? <Caption>{historicalOutcome}</Caption> : null}
            </View>
            {requiredAction ? (
              <PrimaryButton
                label={requiredAction.buttonLabel}
                onPress={requiredAction.action}
                testID="required-action"
              />
            ) : null}
            {showSetupAction ? (
              <>
                <Body muted style={{ marginBottom: 12 }}>
                  {isOnboardingComplete
                    ? "Upload your current policies so we can monitor renewals and compare options."
                    : "Complete your setup so we can extract your coverage and start comparing."}
                </Body>
                <PrimaryButton
                  label={setupAction.label}
                  onPress={() => router.push(setupAction.route)}
                  testID="setup-action"
                />
              </>
            ) : null}
            {!requiredAction && !showSetupAction ? <Body muted>No action required</Body> : null}
          </Card>

          <Card>
            <Subtitle>Your insurance</Subtitle>
            <Row label="Auto insurer" value={auto?.insurer_name ?? "—"} />
            <Row label="Property insurer" value={property?.insurer_name ?? "—"} />
            <Row label="Combined annual premium" value={combined > 0 ? formatCad(combined) : "—"} />
            <Row label="Next renewal" value={formatEdmontonDate(nextRenewal)} />
          </Card>

          <Card>
            <Subtitle>Savings so far</Subtitle>
            <Title style={{ color: colors.accent, marginTop: 4 }}>{formatCad(savings ?? 0)}</Title>
            <Caption>Total annual savings from completed switches.</Caption>
          </Card>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
