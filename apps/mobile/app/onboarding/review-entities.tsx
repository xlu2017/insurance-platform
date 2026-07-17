import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useHousehold } from "@/lib/household";
import { invokeEdgeFunction } from "@/lib/edge-functions";
import { useExtractionCandidates, useOpenExtractionSession } from "@/lib/extraction";
import {
  Body,
  Caption,
  Card,
  Loading,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Subtitle,
  Title,
} from "@/components/ui";

interface CandidateDecision {
  candidateId: string;
  decision: "approve_new" | "skip";
}

export default function ReviewEntities() {
  const { data: household, isLoading: householdLoading } = useHousehold();
  const { data: session, isLoading: sessionLoading } = useOpenExtractionSession(household?.id);
  const { data: candidates, isLoading: candidatesLoading } = useExtractionCandidates(session?.id);
  const queryClient = useQueryClient();
  const [decisions, setDecisions] = useState<Record<string, CandidateDecision["decision"]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (householdLoading || sessionLoading || candidatesLoading) return <Loading />;
  if (!household) {
    return (
      <Screen>
        <Title>No household</Title>
        <Body muted>Please sign in and create a household first.</Body>
      </Screen>
    );
  }
  if (!session || !candidates || candidates.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Review extracted details" }} />
        <Title>Nothing to review</Title>
        <Body muted>Upload your policies first so we can extract your assets.</Body>
        <PrimaryButton
          label="Upload documents"
          onPress={() => router.push("/onboarding/documents")}
        />
      </Screen>
    );
  }

  const setDecision = (candidateId: string, decision: CandidateDecision["decision"]) => {
    setDecisions((prev) => ({ ...prev, [candidateId]: decision }));
  };

  const finished = candidates.every((c) => decisions[c.id]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const payload = candidates.map((c) => ({
      candidateId: c.id,
      decision: decisions[c.id]!,
    }));
    const { data, error: fnErr } = await invokeEdgeFunction<{ session_id: string; status: string }>(
      "approve-policy-candidates",
      {
        session_id: session.id,
        decisions: payload,
      },
    );
    setBusy(false);
    if (fnErr) {
      setError(fnErr.message ?? "Approval failed");
      return;
    }
    if (!data || typeof data.status !== "string") {
      setError("Unexpected response from approval");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["household"] });
    queryClient.invalidateQueries({ queryKey: ["extraction-session"] });
    router.push("/edit-mandate");
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: "Review extracted assets" }} />
      <Title>Review extracted assets</Title>
      <Body muted>
        We found the following assets in your uploaded documents. Approve the ones that are correct,
        or skip them if you want to add them manually.
      </Body>
      <View style={{ height: 16 }} />

      {candidates.map((candidate) => {
        const decision = decisions[candidate.id];
        const conflicting = (candidate.conflicts_json?.length ?? 0) > 0;
        return (
          <Card key={candidate.id}>
            <Subtitle>{candidate.asset_type === "vehicle" ? "Vehicle" : "Property"}</Subtitle>
            <Body>{candidate.display_label}</Body>
            {candidate.occupancy ? (
              <Caption>
                {candidate.occupancy === "rental" ? "Rental / tenant" : "Principal residence"}
              </Caption>
            ) : null}
            {candidate.match_classification === "new_identity_confirmation_required" ? (
              <Body style={{ color: "#B45309" }}>Address identity needs confirmation</Body>
            ) : null}
            {conflicting ? (
              <Body style={{ color: "#B45309" }}>Conflicting facts need review</Body>
            ) : null}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
              <SecondaryButton
                label="Skip"
                onPress={() => setDecision(candidate.id, "skip")}
                disabled={busy}
              />
              <PrimaryButton
                label="Approve"
                onPress={() => setDecision(candidate.id, "approve_new")}
                disabled={busy}
              />
            </View>
            {decision ? (
              <Body
                style={{ marginTop: 8, color: decision === "approve_new" ? "#16A34A" : "#6B7280" }}
              >
                {decision === "approve_new" ? "Approved" : "Skipped"}
              </Body>
            ) : null}
          </Card>
        );
      })}

      {error ? <Body muted>{error}</Body> : null}

      <PrimaryButton
        label="Continue to mandate"
        onPress={submit}
        loading={busy}
        disabled={!finished || busy}
      />
    </Screen>
  );
}
