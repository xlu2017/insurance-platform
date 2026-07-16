import { router, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as LocalAuthentication from "expo-local-authentication";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useActiveCase, useHousehold } from "@/lib/household";
import { formatCad } from "@/lib/format";
import {
  Body,
  Caption,
  Card,
  Field,
  Loading,
  PrimaryButton,
  Row,
  Screen,
  SecondaryButton,
  Subtitle,
  Title,
} from "@/components/ui";

interface RecommendationRow {
  id: string;
  status: string;
  version: number;
  mandate_version: number;
  quote_ids: string[];
  current_total_cents: number;
  proposed_total_cents: number;
  net_savings_cents: number;
  reason_codes: string[];
  comparison: {
    proposedInsurer?: string;
    bundled?: boolean;
    materialDifferences?: string[];
    deductibleDifferences?: string[];
  };
  recommendation_options: {
    rank: number;
    bundled: boolean;
    total_cents: number;
    net_savings_cents: number;
    eligible: boolean;
    reason_codes: string[];
  }[];
}

export default function Recommendation() {
  const { data: household } = useHousehold();
  const { data: activeCase } = useActiveCase(household?.id);
  const queryClient = useQueryClient();
  const [showComparison, setShowComparison] = useState(false);
  const [asking, setAsking] = useState(false);
  const [questionText, setQuestionText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");

  const { data: recommendation, isLoading } = useQuery({
    queryKey: ["published-recommendation", activeCase?.id],
    enabled: !!activeCase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recommendations")
        .select(
          "*, recommendation_options(rank, bundled, total_cents, net_savings_cents, eligible, reason_codes)",
        )
        .eq("case_id", activeCase!.id)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as RecommendationRow | null;
    },
  });

  if (isLoading || !activeCase) return <Loading />;
  if (!recommendation) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Title>No recommendation yet</Title>
        <Body muted>Your recommendation appears here after licensed review.</Body>
        <View style={{ height: 16 }} />
        <SecondaryButton label="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const reauthenticate = async (): Promise<"ok" | "needs-password" | "failed"> => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = hasHardware && (await LocalAuthentication.isEnrolledAsync());
    if (enrolled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Confirm it's you before approving the switch",
      });
      return result.success ? "ok" : "failed";
    }
    // Devices without biometrics require the account password before approval.
    return "needs-password";
  };

  const approve = async () => {
    setError(null);
    if (!needsPassword) {
      const result = await reauthenticate();
      if (result === "failed") {
        setError("Reauthentication failed");
        return;
      }
      if (result === "needs-password") {
        setNeedsPassword(true);
        return;
      }
    } else {
      const { data: userData } = await supabase.auth.getUser();
      const { error: pwError } = await supabase.auth.signInWithPassword({
        email: userData.user?.email ?? "",
        password,
      });
      if (pwError) {
        setError("Password is incorrect");
        return;
      }
    }
    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error: approvalError } = await supabase.from("recommendation_approvals").insert({
      recommendation_id: recommendation.id,
      approver_profile_id: userData.user?.id,
      approver_role: "customer",
      approved: true,
      notes: "Customer approved switch",
      metadata: {
        recommendation_version: recommendation.version,
        quote_ids: recommendation.quote_ids,
        mandate_version: recommendation.mandate_version,
        disclosure_version: "v1",
        approved_at: new Date().toISOString(),
      },
    });
    if (approvalError) {
      setBusy(false);
      setError(approvalError.message);
      return;
    }
    const { error: recError } = await supabase
      .from("recommendations")
      .update({ status: "accepted" })
      .eq("id", recommendation.id);
    if (recError) {
      setBusy(false);
      setError(recError.message);
      return;
    }
    const { error: switchError } = await supabase.from("switch_events").insert({
      case_id: activeCase.id,
      recommendation_id: recommendation.id,
      state: "customer_approved",
    });
    if (switchError) {
      setBusy(false);
      setError(switchError.message);
      return;
    }
    const { error: caseError } = await supabase
      .from("optimization_cases")
      .update({ state: "switching" })
      .eq("id", activeCase.id);
    if (caseError) {
      setBusy(false);
      setError(caseError.message);
      return;
    }
    await supabase.from("audit_events").insert({
      action: "switch_approved_by_customer",
      entity_type: "recommendation",
      entity_id: recommendation.id,
      household_id: household?.id,
      case_id: activeCase.id,
      after_summary: { net_savings_cents: recommendation.net_savings_cents },
    });
    queryClient.invalidateQueries();
    setBusy(false);
    router.replace("/(tabs)/autopilot");
  };

  const keepCurrent = async () => {
    setBusy(true);
    await supabase
      .from("recommendations")
      .update({ status: "declined" })
      .eq("id", recommendation.id);
    await supabase
      .from("optimization_cases")
      .update({ state: "retained_incumbent" })
      .eq("id", activeCase.id);
    queryClient.invalidateQueries();
    setBusy(false);
    router.replace("/(tabs)/home");
  };

  const askQuestion = async () => {
    if (questionText.trim().length < 5) return;
    setBusy(true);
    await supabase.from("customer_questions").insert({
      case_id: activeCase.id,
      question_type: "short_text",
      prompt: `Customer question: ${questionText.trim()}`,
      status: "pending",
    });
    setBusy(false);
    setAsking(false);
    setQuestionText("");
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Stack.Screen
        options={{ headerShown: true, headerBackTitle: "Back", title: "Recommendation" }}
      />
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Your recommendation</Title>
          <Card testID="recommendation-summary">
            <Subtitle>
              {recommendation.comparison.proposedInsurer ?? "Proposed configuration"}
            </Subtitle>
            <Row
              label="Current annual cost"
              value={formatCad(recommendation.current_total_cents)}
            />
            <Row
              label="Proposed annual cost"
              value={formatCad(recommendation.proposed_total_cents)}
            />
            <Row label="Net annual savings" value={formatCad(recommendation.net_savings_cents)} />
            <Row
              label="Bundle"
              value={
                recommendation.comparison.bundled ? "Home + auto bundled" : "Separate insurers"
              }
            />
            <Row label="Meets all your requirements" value="Yes" />
          </Card>
          <Card>
            <Subtitle>Material differences</Subtitle>
            {(recommendation.comparison.materialDifferences ?? []).length === 0 ? (
              <Body muted>No material coverage reductions.</Body>
            ) : (
              (recommendation.comparison.materialDifferences ?? []).map((d) => (
                <Body key={d} muted>
                  {d}
                </Body>
              ))
            )}
            {(recommendation.comparison.deductibleDifferences ?? []).map((d) => (
              <Body key={d} muted>
                {d}
              </Body>
            ))}
          </Card>
          {showComparison ? (
            <Card>
              <Subtitle>Full comparison</Subtitle>
              {recommendation.recommendation_options
                .slice()
                .sort((a, b) => a.rank - b.rank)
                .map((o) => (
                  <Row
                    key={o.rank}
                    label={`#${o.rank} ${o.bundled ? "Bundled" : "Split"} ${o.eligible ? "" : "(rejected)"}`}
                    value={`${formatCad(o.total_cents)} / saves ${formatCad(o.net_savings_cents)}`}
                  />
                ))}
            </Card>
          ) : null}
          {needsPassword ? (
            <Card>
              <Field
                label="Confirm your password"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                testID="approve-password"
              />
            </Card>
          ) : null}
          {asking ? (
            <Card>
              <Field label="Your question" value={questionText} onChangeText={setQuestionText} />
              <PrimaryButton label="Send question" onPress={askQuestion} loading={busy} />
            </Card>
          ) : null}
          {error ? <Body muted>{error}</Body> : null}
          <View style={{ gap: 8 }}>
            <PrimaryButton
              label={needsPassword ? "Confirm and approve" : "Approve switch"}
              onPress={approve}
              loading={busy}
              testID="approve-switch"
            />
            <SecondaryButton label="Keep current insurance" onPress={keepCurrent} disabled={busy} />
            <SecondaryButton
              label="Ask a question"
              onPress={() => setAsking((v) => !v)}
              disabled={busy}
            />
            <SecondaryButton
              label={showComparison ? "Hide full comparison" : "Review full comparison"}
              onPress={() => setShowComparison((v) => !v)}
            />
          </View>
          <View style={{ height: 12 }} />
          <Caption>
            Approving requires reauthentication. Your current policy is never cancelled before
            replacement coverage is confirmed.
          </Caption>
          <View style={{ height: 24 }} />
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
