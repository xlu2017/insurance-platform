import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useHistoricalCase, useHousehold } from "@/lib/household";
import { useAutopilotSessions } from "@/lib/autopilot";
import { retryDocumentBatch } from "@/lib/document-processing";
import { colors, spacing } from "@autopilot/design-tokens";
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
  const queryClient = useQueryClient();
  const { data: household, isLoading } = useHousehold();
  const { data: historicalCase } = useHistoricalCase(household?.id);
  const {
    current,
    isLoading: sessionsLoading,
    error: sessionsError,
  } = useAutopilotSessions(household?.id);

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

  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  if (isLoading || sessionsLoading) return <Loading />;
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

  const isOnboardingComplete = household?.onboarding_step === "complete";
  const hasPolicies = (policies ?? []).length > 0;

  const historicalOutcome = historicalCase
    ? historicalCase.state === "completed"
      ? "Last case completed with a switch."
      : historicalCase.state === "retained_incumbent"
        ? "Last case completed; you kept your current insurance."
        : "Last case was cancelled."
    : null;

  const action = current?.action;
  const statusLabel = current?.status ?? "No active review";

  const handleAction = async () => {
    setRetryError(null);
    if (!action) return;
    if (action.type === "route") {
      router.push(action.href);
      return;
    }
    if (action.type === "retry") {
      setRetrying(true);
      try {
        await retryDocumentBatch(action.householdId, action.batchId);
        await queryClient.invalidateQueries({ queryKey: ["document-processing-batches"] });
      } catch (caught) {
        setRetryError(caught instanceof Error ? caught.message : "Retry failed");
      } finally {
        setRetrying(false);
      }
    }
  };

  const autopilotReady = isOnboardingComplete && hasPolicies && household.autopilot_active;
  const showSetupAction =
    !action && (!isOnboardingComplete || !hasPolicies || !household.autopilot_active);

  function onboardingRouteFor(step: string | null | undefined): string {
    switch (step) {
      case "complete":
        return "/(tabs)/documents";
      case "documents":
        return "/onboarding/documents";
      case "document_processing_consent":
        return "/onboarding/document-processing-consent";
      case "membership":
        return "/onboarding/membership";
      case "preferences":
        return "/onboarding/preferences";
      case "consents":
        return "/onboarding/consents";
      case "activate":
        return "/onboarding/activate";
      case "household":
      default:
        return "/onboarding/household";
    }
  }

  const setupAction = !isOnboardingComplete
    ? { label: "Continue setup", route: onboardingRouteFor(household?.onboarding_step) }
    : !hasPolicies
      ? { label: "Upload documents", route: "/(tabs)/documents" }
      : !household.autopilot_active
        ? { label: "Activate Autopilot", route: "/onboarding/activate" }
        : { label: "Upload documents", route: "/(tabs)/documents" };

  const title = action
    ? "One item needs your attention"
    : !isOnboardingComplete
      ? "Finish setting up"
      : !hasPolicies
        ? "Upload your policies"
        : !household.autopilot_active
          ? "Autopilot paused"
          : "Your insurance is covered";

  const subtitle = action
    ? statusLabel
    : sessionsError
      ? "Could not load your Autopilot session."
      : !isOnboardingComplete
        ? "Complete your setup so we can extract your coverage and start comparing."
        : !hasPolicies
          ? "Upload your current policies so we can monitor renewals and compare options."
          : !household.autopilot_active
            ? "Autopilot is paused and will not monitor your policies."
            : "Autopilot is monitoring your policies and will alert you before renewal.";

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.md }}
        >
          <Title>{title}</Title>
          <Body muted style={{ marginBottom: 16 }}>
            {subtitle}
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
                label={
                  !isOnboardingComplete || !hasPolicies
                    ? "Setup incomplete"
                    : household.autopilot_active
                      ? "Autopilot active"
                      : "Autopilot paused"
                }
                tone={autopilotReady ? "accent" : "neutral"}
                tooltip={
                  !isOnboardingComplete || !hasPolicies
                    ? "Autopilot cannot monitor policies until setup is complete and current policies are uploaded."
                    : household.autopilot_active
                      ? "Autopilot is monitoring your policies and renewals."
                      : "Autopilot is paused and will not monitor your policies."
                }
              />
              {historicalOutcome && !action ? <Caption>{historicalOutcome}</Caption> : null}
            </View>
            {action ? (
              <PrimaryButton
                label={action.label}
                onPress={handleAction}
                loading={retrying}
                testID="required-action"
              />
            ) : null}
            {retryError ? (
              <Body style={{ color: colors.danger, marginTop: 8 }}>{retryError}</Body>
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
            {!action && !showSetupAction ? <Body muted>No action required</Body> : null}
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
