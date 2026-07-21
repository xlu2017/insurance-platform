import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { loadHouseholdMandateV2 } from "@autopilot/database";
import {
  Body,
  Card,
  Caption,
  Field,
  Loading,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Select,
  Subtitle,
  Title,
} from "@/components/ui";
import {
  type CandidateFieldReview,
  type CorrectionReason,
  saveMandateReviewItem,
  useMandateReviewItems,
} from "@/lib/extraction";
import { useHousehold } from "@/lib/household";
import { spacing } from "@autopilot/design-tokens";
import {
  editableMandateValue,
  formatMandateValue,
  initialCurrentMandateValue,
  parseEditableMandateValue,
  visibleMandateItems,
} from "@/lib/mandate-reconciliation";
import { supabase } from "@/lib/supabase";

type CorrectionReasonChoice = CorrectionReason | "unselected";

const CORRECTION_REASONS: { value: CorrectionReasonChoice; label: string }[] = [
  { value: "unselected", label: "Choose a reason" },
  { value: "document_was_read_incorrectly", label: "Document was read incorrectly" },
  { value: "policy_wording_is_unclear", label: "Policy wording is unclear" },
  { value: "value_changed_after_document_issue", label: "Value changed after document issue" },
  { value: "wrong_source_document", label: "Wrong source document" },
  { value: "other", label: "Other" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function ReconcileMandateItem() {
  const { reviewItemId, sessionId } = useLocalSearchParams<{
    reviewItemId: string;
    sessionId?: string;
  }>();
  const { data: household, isLoading: householdLoading } = useHousehold();
  const {
    data: allItems,
    isLoading: itemsLoading,
    refetch,
  } = useMandateReviewItems(household?.id, sessionId);
  const items = visibleMandateItems(allItems ?? []);
  const index = items.findIndex((candidate) => candidate.id === reviewItemId);
  const item = index >= 0 ? items[index] : undefined;
  const [currentValue, setCurrentValue] = useState<unknown>();
  const [currentText, setCurrentText] = useState("");
  const [correctedValue, setCorrectedValue] = useState<unknown>();
  const [correctedText, setCorrectedText] = useState("");
  const [correctionReason, setCorrectionReason] = useState<CorrectionReason | undefined>();
  const [action, setAction] = useState<CandidateFieldReview["action"]>("pending");
  const [revising, setRevising] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveQueue = useRef(Promise.resolve());

  const enqueueSave = useCallback(
    (next: {
      action: CandidateFieldReview["action"];
      current: unknown;
      corrected?: unknown;
      reason?: CorrectionReason;
      complete?: boolean;
    }) => {
      if (!household || !item) return Promise.resolve();
      const write = async () => {
        await saveMandateReviewItem(household.id, item.id, {
          action: next.action,
          currentMandateValue: next.current,
          correctedValue: next.corrected,
          correctionReason: next.reason,
          isComplete: next.complete ?? false,
        });
      };
      const result = saveQueue.current.then(write, write);
      saveQueue.current = result.catch(() => undefined);
      result.catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Draft save failed"),
      );
      return result;
    },
    [household, item],
  );

  useEffect(() => {
    let active = true;
    if (!household || !item) {
      setInitializing(false);
      return;
    }
    setInitializing(true);
    loadHouseholdMandateV2(supabase, household.id)
      .then(async (loaded) => {
        if (!active) return;
        const initial = initialCurrentMandateValue(
          item,
          loaded.mandate,
          loaded.versions.mandateVersion,
        );
        const nextAction = item.action ?? "pending";
        setCurrentValue(initial);
        setCurrentText(editableMandateValue(initial));
        setCorrectedValue(item.corrected_value);
        setCorrectedText(
          item.corrected_value === undefined || item.corrected_value === null
            ? ""
            : editableMandateValue(item.corrected_value),
        );
        setCorrectionReason(item.correction_reason ?? undefined);
        setAction(nextAction);
        setRevising(item.corrected_value !== undefined && item.corrected_value !== null);
        if (item.current_mandate_value === undefined || item.current_mandate_value === null) {
          await enqueueSave({ action: nextAction, current: initial });
        }
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Could not load coverage rules");
      })
      .finally(() => {
        if (active) setInitializing(false);
      });
    return () => {
      active = false;
    };
  }, [enqueueSave, household, item]);

  const documentValue = item?.document_implied_mandate_value;
  const conflictValues = useMemo(
    () => (Array.isArray(item?.conflict_values_json) ? item.conflict_values_json : []),
    [item?.conflict_values_json],
  );

  if (householdLoading || itemsLoading || initializing) return <Loading />;
  if (!household || !item || index < 0) {
    return (
      <Screen>
        <Title>Coverage detail unavailable</Title>
        <Body muted>This coverage detail is no longer available.</Body>
        <PrimaryButton
          label="Return to review"
          onPress={() =>
            router.replace({ pathname: "/onboarding/reconcile-mandates", params: { sessionId } })
          }
        />
      </Screen>
    );
  }

  const saveCurrentEdit = (text: string) => {
    const parsed = parseEditableMandateValue(text, currentValue ?? documentValue);
    setCurrentText(text);
    setCurrentValue(parsed);
    setAction("keep_current");
    void enqueueSave({
      action: "keep_current",
      current: parsed,
      corrected: correctedValue,
      reason: correctionReason,
    });
  };

  const chooseKeep = () => {
    setAction("keep_current");
    void enqueueSave({
      action: "keep_current",
      current: currentValue,
      corrected: correctedValue,
      reason: correctionReason,
    });
  };

  const chooseDocumentValue = (value: unknown = correctedValue ?? documentValue) => {
    const nextAction =
      correctedValue !== undefined && correctedValue !== null
        ? "use_corrected_document_value"
        : "use_document_value";
    setCurrentValue(value);
    setCurrentText(editableMandateValue(value));
    setAction(nextAction);
    void enqueueSave({
      action: nextAction,
      current: value,
      corrected: correctedValue,
      reason: correctionReason,
    });
  };

  const saveCorrectedEdit = (text: string) => {
    const parsed = parseEditableMandateValue(text, documentValue);
    setCorrectedText(text);
    setCorrectedValue(parsed);
    void enqueueSave({
      action,
      current: currentValue,
      corrected: parsed,
      reason: correctionReason,
    });
  };

  const markUnresolved = () => {
    setAction("unresolved");
    void enqueueSave({
      action: "unresolved",
      current: currentValue,
      corrected: correctedValue,
      reason: correctionReason,
    });
  };

  const continueReview = async () => {
    if (action === "pending") {
      setError("Choose how to handle this coverage detail before continuing.");
      return;
    }
    if (correctedValue !== undefined && correctedValue !== null && !correctionReason) {
      setError("Choose a reason for the corrected policy value.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const complete = !(item.material_conflict && action === "unresolved");
      await enqueueSave({
        action,
        current: currentValue,
        corrected: correctedValue,
        reason: correctionReason,
        complete,
      });
      await refetch();
      const nextItem = items[index + 1];
      if (nextItem) {
        router.push({
          pathname: "/onboarding/reconcile-mandates/[reviewItemId]",
          params: { reviewItemId: nextItem.id, sessionId },
        });
      } else {
        router.push({ pathname: "/onboarding/reconcile-mandates/review", params: { sessionId } });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this coverage detail");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: `${index + 1} of ${items.length}` }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.md }}
      >
        <Caption>{`${index + 1} of ${items.length}`}</Caption>
        <Title>{item.specification_title ?? item.field_path}</Title>
        <Body muted>{item.asset_candidate?.display_label ?? "Affected asset"}</Body>
        <View style={{ height: 16 }} />

        <Card>
          <Subtitle>Your current rule</Subtitle>
          <Field
            label={`${item.specification_title ?? "Coverage detail"} (current)`}
            value={currentText}
            onChangeText={saveCurrentEdit}
            editable
            autoCorrect={false}
            keyboardType={
              typeof currentValue === "object" &&
              currentValue !== null &&
              "amountCents" in currentValue
                ? "numeric"
                : "default"
            }
          />
          <SecondaryButton
            label={`Keep ${formatMandateValue(currentValue ?? item.prior_mandate_value)}`}
            onPress={chooseKeep}
            disabled={busy}
          />
        </Card>

        <Card>
          <Subtitle>
            {item.value_state === "conflicting"
              ? "Conflicting policy information"
              : "Shown in your policy"}
          </Subtitle>
          {item.value_state === "conflicting" ? (
            conflictValues.length > 0 ? (
              conflictValues.map((value, conflictIndex) => {
                const conflict = isRecord(value) ? value : {};
                const conflictMandateValue = conflict.mandateValue ?? value;
                return (
                  <View key={conflictIndex} style={{ marginTop: 8 }}>
                    <Field
                      label={`Policy value ${conflictIndex + 1}`}
                      value={formatMandateValue(conflictMandateValue)}
                      editable={false}
                      style={{
                        backgroundColor: "#E5E7EB",
                        color: "#6B7280",
                        padding: 12,
                        borderRadius: 8,
                      }}
                    />
                    {typeof conflict.sourcePageNumber === "number" ? (
                      <Body muted>Page {conflict.sourcePageNumber}</Body>
                    ) : null}
                    {typeof conflict.sourceFileName === "string" ? (
                      <Body muted>Source: {conflict.sourceFileName}</Body>
                    ) : null}
                    {typeof conflict.sourceSection === "string" ? (
                      <Body muted>Section: {conflict.sourceSection}</Body>
                    ) : null}
                    {typeof conflict.explanation === "string" ? (
                      <Body style={{ color: "#B45309" }}>{conflict.explanation}</Body>
                    ) : null}
                    <SecondaryButton
                      label={`Use ${formatMandateValue(conflictMandateValue)}`}
                      onPress={() => chooseDocumentValue(conflictMandateValue)}
                      disabled={busy}
                    />
                  </View>
                );
              })
            ) : (
              <Body style={{ color: "#B45309" }}>The documents disagree and require a choice.</Body>
            )
          ) : (
            <Field
              label="Shown in your policy"
              value={formatMandateValue(documentValue)}
              editable={false}
              style={{ backgroundColor: "#E5E7EB", color: "#6B7280", padding: 12, borderRadius: 8 }}
            />
          )}
          <Caption>Source document</Caption>
          <Body>{item.source_document?.file_name ?? "Uploaded policy document"}</Body>
          {item.source_page_number ? <Body muted>Page {item.source_page_number}</Body> : null}
          {item.source_section ? <Body muted>Section: {item.source_section}</Body> : null}
          {typeof item.confidence === "number" ? (
            <Body muted>Confidence: {Math.round(item.confidence * 100)}%</Body>
          ) : null}
          {item.value_state === "conflicting" ? (
            <Body style={{ color: "#B45309" }}>
              Your documents show different values. Choose the one that matches your policy.
            </Body>
          ) : null}

          {item.value_state !== "conflicting" ? (
            <SecondaryButton
              label={
                item.value_state === "absent"
                  ? 'Use "Not covered"'
                  : `Use ${formatMandateValue(documentValue)}`
              }
              onPress={() => chooseDocumentValue()}
              disabled={busy || documentValue === null || documentValue === undefined}
            />
          ) : null}
          <SecondaryButton
            label="The policy value is wrong"
            onPress={() => setRevising(true)}
            disabled={busy}
          />
          {item.value_state === "conflicting" ? (
            <SecondaryButton label="Decide later" onPress={markUnresolved} disabled={busy} />
          ) : null}

          {revising ? (
            <View style={{ marginTop: 12 }}>
              <Field
                label="Corrected policy value"
                value={correctedText}
                onChangeText={saveCorrectedEdit}
                autoCorrect={false}
              />
              <Select
                label="Correction reason"
                options={CORRECTION_REASONS}
                value={correctionReason ?? "unselected"}
                onValueChange={(reason) => {
                  if (reason === "unselected") {
                    setCorrectionReason(undefined);
                    return;
                  }
                  setCorrectionReason(reason);
                  void enqueueSave({
                    action,
                    current: currentValue,
                    corrected: correctedValue,
                    reason,
                  });
                }}
              />
              <Body muted>
                Correcting this value does not change your current rule. Choose “Use [policy value]”
                separately to apply it.
              </Body>
            </View>
          ) : null}
        </Card>

        {action !== "pending" ? <Body muted>Saved</Body> : null}
        {error ? <Body style={{ color: "#B91C1C" }}>{error}</Body> : null}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <SecondaryButton label="Back" onPress={() => router.back()} disabled={busy} />
          <PrimaryButton label="Continue" onPress={continueReview} loading={busy} />
        </View>
      </ScrollView>
    </Screen>
  );
}
