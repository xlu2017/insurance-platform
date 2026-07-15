import { router } from "expo-router";
import { ScrollView, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useActiveCase, useHousehold } from "@/lib/household";
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

  const { data: policies } = useQuery({
    queryKey: ["current-policies", household?.id],
    enabled: !!household,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policies")
        .select("insurer_name, product_line, annual_premium_cents, bundle_discount_cents, renewal_date")
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
        .eq("status", "accepted");
      if (error) throw error;
      return (data ?? []).reduce((sum, r) => sum + r.net_savings_cents, 0);
    },
  });

  if (isLoading) return <Loading />;
  if (!household) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Title>Finish setting up</Title>
        <Body muted>Create your household to start Autopilot.</Body>
        <View style={{ height: 16 }} />
        <PrimaryButton label="Continue setup" onPress={() => router.push("/onboarding/household")} />
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
    ? { label: "Answer a question from your insurer", action: () => router.push(`/question/${pendingQuestion.id}`) }
    : activeCase?.state === "customer_decision"
      ? { label: "Review your recommendation", action: () => router.push("/recommendation") }
      : activeCase?.state === "awaiting_customer_confirmation"
        ? { label: "Confirm your policy details", action: () => router.push("/confirm-details") }
        : null;

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Home</Title>
          <Card testID="autopilot-status-card">
            <StatusPill
              label={household.autopilot_active ? "Autopilot active" : "Autopilot paused"}
              tone={household.autopilot_active ? "accent" : "neutral"}
            />
            <View style={{ height: 8 }} />
            <Body muted>{requiredAction ? "Action required" : "No action required"}</Body>
          </Card>
          {requiredAction ? (
            <Card>
              <Subtitle>Required action</Subtitle>
              <Body muted>{requiredAction.label}</Body>
              <View style={{ height: 12 }} />
              <PrimaryButton label="Open" onPress={requiredAction.action} testID="required-action" />
            </Card>
          ) : null}
          <Card>
            <Subtitle>Your insurance</Subtitle>
            <Row label="Auto insurer" value={auto?.insurer_name ?? "—"} />
            <Row label="Property insurer" value={property?.insurer_name ?? "—"} />
            <Row label="Combined annual premium" value={combined > 0 ? formatCad(combined) : "—"} />
            <Row label="Next renewal" value={formatEdmontonDate(nextRenewal)} />
          </Card>
          <Card>
            <Subtitle>Savings so far</Subtitle>
            <Title>{formatCad(savings ?? 0)}</Title>
            <Caption>Cumulative demonstrated savings from completed switches.</Caption>
          </Card>
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
