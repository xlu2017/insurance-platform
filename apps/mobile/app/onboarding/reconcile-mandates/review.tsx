import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { loadHouseholdMandateV2, type MandateLoadResult } from "@autopilot/database";
import {
  Body,
  Card,
  Caption,
  Loading,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Subtitle,
  Title,
} from "@/components/ui";
import {
  approveCandidateAssetsV2,
  type ApproveCandidateDecision,
  useExtractionCandidates,
  useMandateReviewItems,
} from "@/lib/extraction";
import { useHousehold } from "@/lib/household";
import {
  buildCandidateMandateValues,
  formatMandateValue,
  mandateValuesEqual,
  visibleMandateItems,
} from "@/lib/mandate-reconciliation";
import { supabase } from "@/lib/supabase";

export default function MandateReconciliationReview() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const { data: household, isLoading: householdLoading } = useHousehold();
  const { data: allItems, isLoading: itemsLoading } = useMandateReviewItems(
    household?.id,
    sessionId,
  );
  const { data: candidates, isLoading: candidatesLoading } = useExtractionCandidates(
    household?.id,
    sessionId,
  );
  const [mandate, setMandate] = useState<MandateLoadResult | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = visibleMandateItems(allItems ?? []);

  useEffect(() => {
    if (!household) return;
    loadHouseholdMandateV2(supabase, household.id)
      .then(setMandate)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Could not load mandate"),
      );
  }, [household]);

  const changed = useMemo(
    () =>
      items.filter(
        (item) =>
          item.is_complete &&
          !mandateValuesEqual(item.prior_mandate_value, item.current_mandate_value),
      ),
    [items],
  );
  const unchanged = useMemo(
    () => items.filter((item) => !changed.some((candidate) => candidate.id === item.id)),
    [changed, items],
  );
  const corrections = items.filter(
    (item) => item.corrected_value !== undefined && item.corrected_value !== null,
  );
  const unresolved = items.filter(
    (item) => item.material_conflict && (!item.is_complete || item.action === "unresolved"),
  );
  const incomplete = items.filter((item) => !item.is_complete);
  const hasReviewItems = items.length > 0;

  if (householdLoading || itemsLoading || candidatesLoading || !mandate) return <Loading />;
  if (!household) {
    return (
      <Screen>
        <Title>No household</Title>
      </Screen>
    );
  }

  const save = async () => {
    if (!candidates || candidates.length === 0) {
      setError("No reviewed asset candidates are available for approval.");
      return;
    }
    if (incomplete.length > 0 || unresolved.length > 0) {
      setError("Complete every specification and resolve material conflicts before saving.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const candidateMandates = buildCandidateMandateValues(items);
      const decisions: ApproveCandidateDecision[] = candidates.map((candidate) => {
        const decision = candidate.draft_decision ?? "needs_correction";
        return {
          candidate_id: candidate.id,
          decision,
          existing_asset_id: candidate.draft_existing_asset_id ?? undefined,
          existing_asset_type: candidate.draft_existing_asset_type ?? undefined,
          identity_confirmed: candidate.draft_identity_confirmed ?? false,
          mandate_values: candidateMandates.get(candidate.id) ?? {},
        };
      });
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be signed in to save the mandate.");

      const firstCandidate = candidates[0];
      if (!firstCandidate) throw new Error("No reviewed asset candidates are available.");
      const batchId = items.find((item) => item.batch_id)?.batch_id ?? firstCandidate.session_id;
      await approveCandidateAssetsV2(
        household.id,
        user.id,
        `document-batch:${batchId}:candidate-approval-v2`,
        decisions,
        {
          jurisdiction: "AB",
          householdAutoDefaults: mandate.mandate.householdAutoDefaults as unknown as Record<
            string,
            unknown
          >,
          householdPropertyDefaults: mandate.mandate.householdPropertyDefaults as unknown as Record<
            string,
            unknown
          >,
          switchingPreferences: mandate.switching as unknown as Record<string, unknown>,
        },
      );
      await supabase
        .from("households")
        .update({ onboarding_step: "preferences" })
        .eq("id", household.id);
      router.replace("/onboarding/preferences");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save mandate and assets");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: "Final mandate review" }} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Title>Review mandate changes</Title>
        <Body muted>
          {hasReviewItems
            ? "Document values remain evidenced suggestions. Only the proposed current values below will be persisted."
            : "No mandate changes, corrections, or conflicts were found for the reviewed assets. Nothing needs to be persisted."}
        </Body>

        <Subtitle>Changed current mandates</Subtitle>
        {changed.length === 0 ? <Body muted>No current mandate values changed.</Body> : null}
        {changed.map((item) => (
          <Card key={item.id}>
            <Subtitle>{item.specification_title ?? item.field_path}</Subtitle>
            <Caption>{item.asset_candidate?.display_label ?? "Affected asset"}</Caption>
            <Body muted>Prior value</Body>
            <Body>{formatMandateValue(item.prior_mandate_value)}</Body>
            <Body muted>Proposed persisted value</Body>
            <Body>{formatMandateValue(item.current_mandate_value)}</Body>
          </Card>
        ))}

        <Subtitle>Corrected document assertions</Subtitle>
        {corrections.length === 0 ? (
          <Body muted>No document assertions were corrected.</Body>
        ) : null}
        {corrections.map((item) => (
          <Card key={item.id}>
            <Body>{item.specification_title ?? item.field_path}</Body>
            <Body muted>Original: {formatMandateValue(item.document_implied_mandate_value)}</Body>
            <Body>Corrected: {formatMandateValue(item.corrected_value)}</Body>
            <Caption>Reason: {(item.correction_reason ?? "other").replaceAll("_", " ")}</Caption>
          </Card>
        ))}

        <Subtitle>Unresolved conflicts</Subtitle>
        {unresolved.length === 0 ? (
          <Body muted>No material conflicts remain unresolved.</Body>
        ) : (
          unresolved.map((item) => (
            <Card key={item.id}>
              <Body>{item.specification_title ?? item.field_path}</Body>
              <Body style={{ color: "#B91C1C" }}>Resolve this conflict before final approval.</Body>
              <SecondaryButton
                label="Resolve conflict"
                onPress={() =>
                  router.push({
                    pathname: "/onboarding/reconcile-mandates/[reviewItemId]",
                    params: { reviewItemId: item.id, sessionId },
                  })
                }
              />
            </Card>
          ))
        )}

        {unchanged.length > 0 ? (
          <View style={{ marginTop: 12 }}>
            <SecondaryButton
              label={`${showUnchanged ? "Hide" : "Show"} unchanged reviewed specifications (${unchanged.length})`}
              onPress={() => setShowUnchanged((value) => !value)}
            />
            {showUnchanged
              ? unchanged.map((item) => (
                  <Card key={item.id}>
                    <Body>{item.specification_title ?? item.field_path}</Body>
                    <Body muted>{item.asset_candidate?.display_label ?? "Affected asset"}</Body>
                    <Body>{formatMandateValue(item.current_mandate_value)}</Body>
                  </Card>
                ))
              : null}
          </View>
        ) : null}

        {error ? <Body style={{ color: "#B91C1C" }}>{error}</Body> : null}
        <PrimaryButton
          label={hasReviewItems ? "Save mandate and continue" : "Continue to preferences"}
          onPress={save}
          loading={busy}
          disabled={busy || incomplete.length > 0 || unresolved.length > 0}
        />
      </ScrollView>
    </Screen>
  );
}
