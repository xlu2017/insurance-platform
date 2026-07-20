import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { colors, spacing } from "@autopilot/design-tokens";
import { useHousehold } from "@/lib/household";
import { formatEdmontonDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import {
  type CandidateFieldReview,
  type ExtractionCandidate,
  useCandidateFieldReviews,
  useExtractionCandidates,
  useOpenExtractionSession,
  useSaveCandidateFieldReview,
} from "@/lib/extraction";
import {
  Body,
  Caption,
  Card,
  Field,
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

type ReviewAction = CandidateFieldReview["action"];

interface DraftReview {
  action: ReviewAction;
  correctedValue: string;
  mandateRule: string;
  mandateAmount: string;
}

const REVIEW_ACTIONS: { value: ReviewAction; label: string }[] = [
  { value: "confirm", label: "Looks right" },
  { value: "correct", label: "Edit" },
  { value: "unknown", label: "Not sure" },
];

const MANDATE_ACTIONS: { value: ReviewAction; label: string }[] = [
  { value: "reset_mandate_to_current", label: "Reset" },
  { value: "change_mandate", label: "Change" },
];

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    if (Array.isArray(value)) return value.map((v) => formatFieldValue(v)).join(", ");
    if ("value" in value) return formatFieldValue((value as { value: unknown }).value);
    return JSON.stringify(value);
  }
  return String(value);
}

function renderCents(value: unknown): string {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return "—";
  return `C$${(num / 100).toFixed(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  fullAddress: "Address",
  postalCode: "Postal code",
  vehicleUse: "Vehicle use",
  vin: "VIN",
  insurerName: "Insurer",
  policyNumber: "Policy number",
  expiryDate: "Expiry date",
  annualPremiumCents: "Annual premium",
};

const VEHICLE_USE_LABELS: Record<string, string> = {
  commute: "Commute",
  pleasure: "Pleasure",
  business: "Business",
  farm: "Farm",
  unknown: "Unknown",
};

const OCCUPANCY_LABELS: Record<string, string> = {
  principal_residence: "Principal residence",
  rental: "Rental",
  unknown: "Unknown",
};

function formatFieldLabel(fieldPath: string): string {
  const raw = fieldPath.split(".").pop() ?? fieldPath;
  if (FIELD_LABEL_OVERRIDES[raw]) return FIELD_LABEL_OVERRIDES[raw];
  const spaced = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase();
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function displayValueForField(fieldPath: string, value: unknown): string {
  const key = fieldPath.split(".").pop();
  if (typeof value === "string") {
    if (key === "vehicleUse") return VEHICLE_USE_LABELS[value] ?? value;
    if (key === "occupancy") return OCCUPANCY_LABELS[value] ?? value;
    if (key === "expiryDate") return formatEdmontonDate(value);
  }
  return formatFieldValue(value);
}

function getFacts(candidate: ExtractionCandidate): Record<string, unknown> {
  return isRecord(candidate.selected_facts_json) ? candidate.selected_facts_json : {};
}

function getFieldValue(candidate: ExtractionCandidate, fieldPath: string): unknown {
  const parts = fieldPath.split(".");
  let current: unknown = getFacts(candidate);
  for (const part of parts) {
    if (isRecord(current) && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function getMandateSuggestion(
  candidate: ExtractionCandidate,
  fieldPath: string,
): Record<string, unknown> | undefined {
  const facts = getFacts(candidate);
  const suggestions = isRecord(facts.mandateSuggestions) ? facts.mandateSuggestions : undefined;
  const suggestion = suggestions?.[fieldPath];
  return isRecord(suggestion) ? suggestion : undefined;
}

const VEHICLE_IDENTITY_FIELDS = new Set(["vin", "year", "make", "model", "trim", "vehicleUse"]);

const PROPERTY_IDENTITY_FIELDS = new Set([
  "fullAddress",
  "city",
  "province",
  "postalCode",
  "occupancy",
]);

function identityFieldsFor(assetType: string | undefined, keys: string[]): Set<string> {
  if (assetType === "vehicle") return VEHICLE_IDENTITY_FIELDS;
  if (assetType === "property") return PROPERTY_IDENTITY_FIELDS;
  return new Set(keys);
}

function fieldPathsForCandidate(candidate: ExtractionCandidate): string[] {
  const paths: string[] = [];
  const facts = getFacts(candidate);
  const identity = isRecord(facts.identity) ? facts.identity : undefined;
  if (identity) {
    const allowed = identityFieldsFor(candidate.asset_type, Object.keys(identity));
    Object.keys(identity)
      .filter((k) => allowed.has(k))
      .forEach((k) => paths.push(`identity.${k}`));
  }
  const currentPolicy = isRecord(facts.currentPolicy) ? facts.currentPolicy : undefined;
  if (currentPolicy) {
    Object.keys(currentPolicy).forEach((k) => paths.push(`currentPolicy.${k}`));
  }
  return paths;
}

function isCoverageField(fieldPath: string): boolean {
  return fieldPath.startsWith("currentCoverage.");
}

function parseCorrectedValue(fieldPath: string, raw: string): unknown {
  if (fieldPath.toLowerCase().includes("cents") || fieldPath.toLowerCase().includes("premium")) {
    const dollars = Number(raw.replace(/[C$\s,]/g, ""));
    if (!Number.isNaN(dollars)) return Math.round(dollars * 100);
  }
  return raw;
}

function FieldReviewStep({
  candidate,
  fieldPath,
  existing,
  onComplete,
}: {
  candidate: ExtractionCandidate;
  fieldPath: string;
  existing?: CandidateFieldReview | null;
  onComplete: (action: ReviewAction, correctedValue?: string) => void;
}) {
  const value = getFieldValue(candidate, fieldPath);
  const mandate = getMandateSuggestion(candidate, fieldPath);
  const isCoverage = isCoverageField(fieldPath);
  const fieldLabel = formatFieldLabel(fieldPath);
  const isCents =
    fieldPath.toLowerCase().includes("cents") || fieldPath.toLowerCase().includes("premium");
  const [editing, setEditing] = useState(false);
  const [corrected, setCorrected] = useState(() => {
    if (existing?.corrected_value !== undefined && existing?.corrected_value !== null) {
      return formatFieldValue(existing.corrected_value);
    }
    return isCents ? renderCents(value) : formatFieldValue(value);
  });

  const displayValue = isCents ? renderCents(value) : displayValueForField(fieldPath, value);

  if (editing) {
    return (
      <View style={{ gap: 12 }}>
        <Caption style={styles.fieldLabel}>{fieldLabel}</Caption>
        <Field
          label="Edit value"
          value={corrected}
          onChangeText={setCorrected}
          autoCorrect={false}
          keyboardType={isCents ? "numeric" : "default"}
          prefix={isCents ? "C$" : undefined}
        />
        <View style={{ gap: 8 }}>
          <PrimaryButton label="Save" onPress={() => onComplete("correct", corrected)} />
          <SecondaryButton label="Cancel" onPress={() => setEditing(false)} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <View>
        <Caption style={styles.fieldLabel}>{fieldLabel}</Caption>
        <Body style={styles.fieldValue}>{displayValue}</Body>
      </View>
      <View style={{ gap: 10 }}>
        <Body muted>Is this {fieldLabel.toLowerCase()} correct?</Body>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {REVIEW_ACTIONS.map((a) => (
            <SecondaryButton
              key={a.value}
              label={a.label}
              onPress={() => onComplete(a.value)}
              style={styles.fieldAction}
            />
          ))}
        </View>
        {isCoverage && mandate && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {MANDATE_ACTIONS.map((a) => (
              <SecondaryButton
                key={a.value}
                label={a.label}
                onPress={() => onComplete(a.value)}
                style={styles.mandateAction}
              />
            ))}
          </View>
        )}
      </View>
      {actionLabel(existing?.action) ? (
        <Body style={{ color: "#16A34A" }}>{actionLabel(existing?.action)}</Body>
      ) : null}
    </View>
  );
}

function actionLabel(action: ReviewAction | null | undefined): string | null {
  if (!action) return null;
  if (action === "confirm") return "Looks right";
  if (action === "unknown") return "Not sure";
  if (action === "correct") return "Edited";
  if (action === "reset_mandate_to_current") return "Coverage rule reset to current";
  if (action === "change_mandate") return "Coverage rule changed";
  return null;
}

export default function ReviewEntities() {
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const { data: household, isLoading: householdLoading } = useHousehold();
  const { isLoading: sessionLoading } = useOpenExtractionSession(household?.id);
  const { data: candidates, isLoading: candidatesLoading } = useExtractionCandidates(
    household?.id,
    sessionId,
  );
  const candidateIds = useMemo(() => candidates?.map((c) => c.id) ?? [], [candidates]);
  const { data: fieldReviews, isLoading: reviewsLoading } = useCandidateFieldReviews(candidateIds);
  const saveReview = useSaveCandidateFieldReview();

  const [decisions, setDecisions] = useState<Record<string, CandidateDecision["decision"]>>({});
  const [identityConfirmations, setIdentityConfirmations] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, DraftReview>>({});
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [phase, setPhase] = useState<"decision" | "field" | "summary">("decision");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reviewsByKey = useMemo(() => {
    const map = new Map<string, CandidateFieldReview>();
    for (const r of fieldReviews ?? []) {
      map.set(`${r.candidate_id}:${r.field_path}`, r);
    }
    return map;
  }, [fieldReviews]);

  const currentCandidate = candidates?.[candidateIndex];
  const currentFields = useMemo(() => {
    if (!currentCandidate) return [];
    return fieldPathsForCandidate(currentCandidate).filter(
      (path) => !reviewsByKey.has(`${currentCandidate.id}:${path}`),
    );
  }, [currentCandidate, reviewsByKey]);

  const totalQuestions = useMemo(() => {
    if (!candidates) return 0;
    return candidates.reduce((sum, c) => sum + 1 + fieldPathsForCandidate(c).length, 0);
  }, [candidates]);

  const currentQuestion = useMemo(() => {
    if (!candidates) return 0;
    let count = 0;
    for (let i = 0; i < candidateIndex; i++) {
      const c = candidates[i];
      if (!c) continue;
      count += 1 + fieldPathsForCandidate(c).length;
    }
    if (phase === "field") {
      count += 2 + fieldIndex;
    } else if (phase === "decision") {
      count += 1;
    } else if (phase === "summary") {
      count = totalQuestions;
    }
    return count;
  }, [candidates, candidateIndex, fieldIndex, phase, totalQuestions]);

  if (householdLoading || sessionLoading || candidatesLoading || reviewsLoading) return <Loading />;
  if (!household) {
    return (
      <Screen>
        <Title style={styles.title}>No household</Title>
        <Body muted>Please sign in and create a household first.</Body>
      </Screen>
    );
  }
  if (!candidates || candidates.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: "Confirm what we found" }} />
        <Title style={styles.title}>Nothing to review</Title>
        <Body muted>Upload your policies first so we can show you what we found.</Body>
        <PrimaryButton
          label="Upload"
          onPress={() => router.push("/onboarding/documents")}
          style={styles.uploadButton}
        />
      </Screen>
    );
  }

  const setDecision = (candidateId: string, decision: CandidateDecision["decision"]) => {
    setDecisions((prev) => ({ ...prev, [candidateId]: decision }));
  };

  const isCandidateReady = (candidate: ExtractionCandidate): boolean => {
    const paths = fieldPathsForCandidate(candidate);
    return paths.every(
      (path) =>
        reviewsByKey.has(`${candidate.id}:${path}`) || drafts[`${candidate.id}:${path}`]?.action,
    );
  };

  const allApprovedReady = candidates.every((c) => {
    if (decisions[c.id] === "skip") return true;
    if (decisions[c.id] !== "approve_new") return false;
    if (
      c.match_classification === "new_identity_confirmation_required" &&
      !identityConfirmations[c.id]
    ) {
      return false;
    }
    return isCandidateReady(c);
  });

  const advanceCandidate = () => {
    const nextIndex = candidateIndex + 1;
    if (nextIndex >= candidates.length) {
      setPhase("summary");
    } else {
      setCandidateIndex(nextIndex);
      setFieldIndex(0);
      setPhase("decision");
    }
  };

  const handleDecision = (decision: "approve_new" | "skip") => {
    if (!currentCandidate) return;
    setDecision(currentCandidate.id, decision);
    if (decision === "approve_new") {
      if (currentCandidate.match_classification === "new_identity_confirmation_required") {
        setIdentityConfirmations((prev) => ({ ...prev, [currentCandidate.id]: true }));
      }
      if (currentFields.length === 0) {
        advanceCandidate();
      } else {
        setFieldIndex(0);
        setPhase("field");
      }
    } else {
      advanceCandidate();
    }
  };

  const handleFieldComplete = (action: ReviewAction, correctedValue?: string) => {
    if (!currentCandidate) return;
    const fieldPath = currentFields[fieldIndex];
    if (!fieldPath) return;
    const key = `${currentCandidate.id}:${fieldPath}`;
    const value = getFieldValue(currentCandidate, fieldPath);
    const mandate = getMandateSuggestion(currentCandidate, fieldPath);

    setDrafts((prev) => {
      const existing = prev[key];
      const isCents =
        fieldPath.toLowerCase().includes("cents") || fieldPath.toLowerCase().includes("premium");
      const corrected =
        action === "correct"
          ? String(parseCorrectedValue(fieldPath, correctedValue ?? formatFieldValue(value)))
          : isCents
            ? renderCents(value)
            : formatFieldValue(value);
      return {
        ...prev,
        [key]: {
          action,
          correctedValue: corrected,
          mandateRule: existing?.mandateRule ?? (mandate?.rule as string) ?? "minimum",
          mandateAmount: existing?.mandateAmount ?? "",
        },
      };
    });

    if (fieldIndex + 1 < currentFields.length) {
      setFieldIndex((i) => i + 1);
    } else {
      advanceCandidate();
    }
  };

  const persistReview = async (
    candidate: ExtractionCandidate,
    fieldPath: string,
    draft: DraftReview,
  ): Promise<void> => {
    const value = getFieldValue(candidate, fieldPath);
    let correctedValue: unknown =
      draft.action === "correct" ? draft.correctedValue || value : undefined;
    if (draft.action === "correct" && typeof correctedValue === "string") {
      correctedValue = parseCorrectedValue(fieldPath, correctedValue);
    }

    let mandateRuleJson: Record<string, unknown> | undefined;
    if (draft.action === "change_mandate") {
      const amount = Number(draft.mandateAmount);
      mandateRuleJson = {
        rule: draft.mandateRule,
        amountCents: Number.isNaN(amount) ? undefined : Math.round(amount * 100),
      };
    } else if (draft.action === "reset_mandate_to_current") {
      const suggestion = getMandateSuggestion(candidate, fieldPath);
      mandateRuleJson = suggestion ?? { rule: "any" };
    }

    await saveReview.mutateAsync({
      candidate_id: candidate.id,
      household_id: household.id,
      field_path: fieldPath,
      action: draft.action,
      corrected_value: correctedValue,
      mandate_rule_json: mandateRuleJson,
    });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const pendingDrafts = Object.entries(drafts);
      for (const [key, draft] of pendingDrafts) {
        const [candidateId, ...pathParts] = key.split(":");
        const fieldPath = pathParts.join(":");
        const candidate = candidates.find((c) => c.id === candidateId);
        if (candidate) {
          await persistReview(candidate, fieldPath, draft);
        }
      }

      if (!allApprovedReady) {
        setError("Please confirm or edit every field before adding it to your account.");
        setBusy(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("You must be signed in to approve candidates.");
        setBusy(false);
        return;
      }

      for (const candidate of candidates) {
        const { error: draftError } = await supabase.rpc("save_candidate_review_draft_v1", {
          p_household_id: household.id,
          p_candidate_id: candidate.id,
          p_decision: decisions[candidate.id] === "approve_new" ? "approve_new" : "skip",
          p_identity_confirmed:
            candidate.match_classification === "new_identity_confirmation_required"
              ? !!identityConfirmations[candidate.id]
              : false,
        });
        if (draftError) throw draftError;
      }

      router.push({ pathname: "/onboarding/reconcile-mandates", params: { sessionId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  };

  const renderDecisionStep = () => {
    if (!currentCandidate) return null;
    const typeLabel = currentCandidate.asset_type === "vehicle" ? "vehicle" : "property";
    return (
      <Card style={{ flex: 1, justifyContent: "center" }}>
        <Subtitle style={styles.subtitle}>
          {currentCandidate.asset_type === "vehicle" ? "Vehicle" : "Property"}
        </Subtitle>
        <Title style={styles.title}>{currentCandidate.display_label}</Title>
        {currentCandidate.occupancy ? (
          <Caption>
            {currentCandidate.occupancy === "rental" ? "Rental / tenant" : "Principal residence"}
          </Caption>
        ) : null}
        <View style={{ gap: 8, marginTop: 8 }}>
          {currentCandidate.match_classification === "new_identity_confirmation_required" ? (
            <Body style={{ color: "#B45309" }}>
              {`We could not confirm the full ${typeLabel} identity. Please verify this is the correct ${typeLabel} before adding it.`}
            </Body>
          ) : null}
          {(currentCandidate.conflicts_json?.length ?? 0) > 0 ? (
            <Body style={{ color: "#B45309" }}>
              Your documents contain different information about this {typeLabel}. You will review
              the details next.
            </Body>
          ) : null}
        </View>
        <View style={{ gap: 12, marginTop: 32 }}>
          <PrimaryButton
            label={`Add this ${typeLabel}`}
            onPress={() => handleDecision("approve_new")}
            disabled={busy}
          />
          <SecondaryButton
            label={`Skip this ${typeLabel}`}
            onPress={() => handleDecision("skip")}
            disabled={busy}
          />
        </View>
      </Card>
    );
  };

  const renderFieldStep = () => {
    if (!currentCandidate) return null;
    if (currentFields.length === 0) {
      advanceCandidate();
      return null;
    }
    const fieldPath = currentFields[fieldIndex];
    if (!fieldPath) return null;
    const existing = reviewsByKey.get(`${currentCandidate.id}:${fieldPath}`);
    const progressLabel = `Question ${currentQuestion} of ${totalQuestions}`;
    return (
      <Card style={{ flex: 1, justifyContent: "center" }}>
        <Caption>{progressLabel}</Caption>
        <View style={{ marginVertical: 8 }}>
          <Subtitle style={styles.subtitle}>
            {`${currentCandidate.asset_type === "vehicle" ? "Vehicle" : "Property"}: ${currentCandidate.display_label}`}
          </Subtitle>
        </View>
        <FieldReviewStep
          candidate={currentCandidate}
          fieldPath={fieldPath}
          existing={existing}
          onComplete={handleFieldComplete}
        />
      </Card>
    );
  };

  const renderSummary = () => (
    <Card style={{ flex: 1, justifyContent: "center" }}>
      <Title style={styles.title}>Ready to continue</Title>
      <Body muted>Review what we found before continuing to your coverage rules.</Body>
      <View style={{ gap: 12, marginVertical: 16 }}>
        {candidates?.map((candidate) => {
          const decision = decisions[candidate.id];
          return (
            <View key={candidate.id}>
              <Body>{candidate.display_label}</Body>
              <Caption>
                {decision === "approve_new" ? "Will be added to your account" : "Will not be added"}
              </Caption>
            </View>
          );
        })}
      </View>
      {error ? <Body muted>{error}</Body> : null}
      <PrimaryButton
        label="Continue to coverage"
        onPress={submit}
        loading={busy || saveReview.isPending}
        disabled={busy || saveReview.isPending || !allApprovedReady}
      />
    </Card>
  );

  const renderStep = () => {
    if (phase === "decision") return renderDecisionStep();
    if (phase === "field") return renderFieldStep();
    return renderSummary();
  };

  return (
    <Screen style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.surfaceSubtle }}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing.xl * 2,
          minHeight: "100%",
        }}
      >
        <Stack.Screen options={{ title: "Confirm what we found" }} />
        <Title style={styles.title}>Confirm what we found</Title>
        <Body muted>Review each vehicle and property before adding it to your account.</Body>
        <View style={{ height: 16 }} />
        {renderStep()}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.accent,
    marginBottom: 4,
  },
  uploadButton: {
    borderRadius: 999,
    paddingVertical: 16,
    minWidth: 160,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "capitalize",
    letterSpacing: 0.5,
    color: colors.ink,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 20,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: 6,
  },
  fieldAction: {
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
    minWidth: 80,
  },
  mandateAction: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
});
