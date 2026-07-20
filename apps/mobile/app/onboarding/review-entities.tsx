import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { View, TextInput, ScrollView, StyleSheet } from "react-native";
import { colors, spacing } from "@autopilot/design-tokens";
import { useHousehold } from "@/lib/household";
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
  Select,
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
  { value: "confirm", label: "Confirm" },
  { value: "correct", label: "Edit" },
  { value: "unknown", label: "Unknown" },
];

const MANDATE_ACTIONS: { value: ReviewAction; label: string }[] = [
  { value: "reset_mandate_to_current", label: "Reset" },
  { value: "change_mandate", label: "Change" },
];

const MANDATE_RULES: { value: string; label: string }[] = [
  { value: "minimum", label: "Minimum" },
  { value: "maximum", label: "Maximum" },
  { value: "match_current_or_better", label: "Match current or better" },
  { value: "required", label: "Required" },
  { value: "any", label: "Any" },
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
  return `$${(num / 100).toFixed(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatFieldLabel(fieldPath: string): string {
  const raw = fieldPath.split(".").pop() ?? fieldPath;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reviewsByKey = useMemo(() => {
    const map = new Map<string, CandidateFieldReview>();
    for (const r of fieldReviews ?? []) {
      map.set(`${r.candidate_id}:${r.field_path}`, r);
    }
    return map;
  }, [fieldReviews]);

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
        <Stack.Screen options={{ title: "Review extracted details" }} />
        <Title style={styles.title}>Nothing to review</Title>
        <Body muted>Upload your policies first so we can extract your assets.</Body>
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

  const persistReview = async (
    candidate: ExtractionCandidate,
    fieldPath: string,
    draft: DraftReview,
  ): Promise<void> => {
    const value = getFieldValue(candidate, fieldPath);
    const correctedValue = draft.action === "correct" ? draft.correctedValue || value : undefined;

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
        setError("Please confirm or edit every field before approving an asset.");
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

  const FieldReview = ({
    candidate,
    fieldPath,
  }: {
    candidate: ExtractionCandidate;
    fieldPath: string;
  }) => {
    const key = `${candidate.id}:${fieldPath}`;
    const existing = reviewsByKey.get(key);
    const draft = drafts[key];
    const action = draft?.action ?? existing?.action ?? null;
    const value = getFieldValue(candidate, fieldPath);
    const mandate = getMandateSuggestion(candidate, fieldPath);
    const isCoverage = isCoverageField(fieldPath);
    const fieldLabel = formatFieldLabel(fieldPath);

    const setAction = (next: ReviewAction) => {
      setDrafts((prev) => ({
        ...prev,
        [key]: {
          action: next,
          correctedValue: prev[key]?.correctedValue ?? formatFieldValue(value),
          mandateRule: prev[key]?.mandateRule ?? (mandate?.rule as string) ?? "minimum",
          mandateAmount: prev[key]?.mandateAmount ?? "",
        },
      }));
    };

    const updateDraft = (patch: Partial<DraftReview>) => {
      setDrafts((prev) => {
        const base: DraftReview = prev[key] ?? {
          action: action ?? "confirm",
          correctedValue: formatFieldValue(value),
          mandateRule: (mandate?.rule as string) ?? "minimum",
          mandateAmount: "",
        };
        return { ...prev, [key]: { ...base, ...patch } };
      });
    };

    const displayValue =
      fieldPath.toLowerCase().includes("cents") || fieldPath.toLowerCase().includes("premium")
        ? renderCents(value)
        : formatFieldValue(value);

    return (
      <View style={{ marginBottom: 12 }}>
        <Caption style={styles.fieldLabel}>{fieldLabel}</Caption>
        <Body style={styles.fieldValue}>{displayValue}</Body>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {REVIEW_ACTIONS.map((a) => (
            <SecondaryButton
              key={a.value}
              label={a.label}
              disabled={saveReview.isPending}
              onPress={() => setAction(a.value)}
              style={styles.fieldAction}
            />
          ))}
        </View>
        {isCoverage && mandate && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
            {MANDATE_ACTIONS.map((a) => (
              <SecondaryButton
                key={a.value}
                label={a.label}
                disabled={saveReview.isPending}
                onPress={() => setAction(a.value)}
                style={styles.mandateAction}
              />
            ))}
          </View>
        )}
        {action === "correct" && (
          <View style={{ marginTop: 8 }}>
            <Field
              label="Edited value"
              value={draft?.correctedValue ?? formatFieldValue(value)}
              onChangeText={(text) => updateDraft({ correctedValue: text })}
              autoCorrect={false}
            />
          </View>
        )}
        {action === "change_mandate" && (
          <View style={{ marginTop: 8, gap: 8 }}>
            <Select
              label="Mandate rule"
              options={MANDATE_RULES}
              value={draft?.mandateRule ?? (mandate?.rule as string) ?? "minimum"}
              onValueChange={(v) => updateDraft({ mandateRule: v })}
            />
            <TextInput
              placeholder="Amount in dollars"
              keyboardType="numeric"
              value={draft?.mandateAmount ?? ""}
              onChangeText={(text) => updateDraft({ mandateAmount: text })}
              style={{
                borderWidth: 1,
                borderColor: "#E5E7EB",
                borderRadius: 8,
                padding: 12,
                fontSize: 16,
              }}
            />
          </View>
        )}
        {action ? (
          <Body style={{ color: "#16A34A", marginTop: 4 }}>
            {action === "reset_mandate_to_current"
              ? "Mandate reset to current"
              : `Marked: ${action}`}
          </Body>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surfaceSubtle }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl * 2 }}
    >
      <Stack.Screen options={{ title: "Review extracted assets" }} />
      <Title style={styles.title}>Review extracted assets</Title>
      <Body muted>
        Confirm or edit the asset identity and current-policy facts. Document-informed mandate
        specifications are reviewed one at a time next.
      </Body>
      <View style={{ height: 16 }} />

      {candidates.map((candidate) => {
        const decision = decisions[candidate.id];
        const conflicting = (candidate.conflicts_json?.length ?? 0) > 0;
        const fields = fieldPathsForCandidate(candidate);
        const ready = isCandidateReady(candidate);

        return (
          <Card key={candidate.id}>
            <Subtitle style={styles.subtitle}>
              {candidate.asset_type === "vehicle" ? "Vehicle" : "Property"}
            </Subtitle>
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

            <View style={{ marginTop: 12, gap: 8 }}>
              {fields.map((fieldPath) => (
                <FieldReview key={fieldPath} candidate={candidate} fieldPath={fieldPath} />
              ))}
            </View>

            {!ready && decision === "approve_new" ? (
              <Body style={{ color: "#B45309", marginTop: 8 }}>
                All fields must be reviewed before this asset can be approved.
              </Body>
            ) : null}
            {candidate.match_classification === "new_identity_confirmation_required" &&
            !identityConfirmations[candidate.id] ? (
              <Body style={{ color: "#B45309", marginTop: 8 }}>
                Confirm the identity below before approving.
              </Body>
            ) : null}

            <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
              {candidate.match_classification === "new_identity_confirmation_required" ? (
                <SecondaryButton
                  label={identityConfirmations[candidate.id] ? "Confirmed" : "Confirm"}
                  onPress={() =>
                    setIdentityConfirmations((prev) => ({
                      ...prev,
                      [candidate.id]: !prev[candidate.id],
                    }))
                  }
                  disabled={busy}
                  style={styles.identityButton}
                />
              ) : null}
              <SecondaryButton
                label="Skip"
                onPress={() => setDecision(candidate.id, "skip")}
                disabled={busy}
                style={styles.skipButton}
              />
              <PrimaryButton
                label="Approve"
                onPress={() => setDecision(candidate.id, "approve_new")}
                disabled={busy}
                style={styles.approveButton}
              />
            </View>
            {decision ? (
              <Body
                style={{ marginTop: 8, color: decision === "approve_new" ? "#16A34A" : "#6B7280" }}
              >
                {decision === "approve_new" ? "Approved (pending submit)" : "Skipped"}
              </Body>
            ) : null}
          </Card>
        );
      })}

      {error ? <Body muted>{error}</Body> : null}

      <PrimaryButton
        label="Submit"
        onPress={submit}
        loading={busy || saveReview.isPending}
        disabled={busy || saveReview.isPending || !allApprovedReady}
        style={styles.submitButton}
      />
    </ScrollView>
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
    fontSize: 16,
    fontWeight: "500",
    color: colors.ink,
    marginBottom: 6,
  },
  fieldAction: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minWidth: 72,
  },
  mandateAction: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  identityButton: {
    borderRadius: 999,
    paddingVertical: 12,
  },
  approveButton: {
    borderRadius: 999,
    paddingVertical: 14,
    flex: 1,
  },
  skipButton: {
    borderRadius: 999,
    paddingVertical: 14,
    minWidth: 80,
  },
  submitButton: {
    borderRadius: 999,
    paddingVertical: 16,
    width: "100%",
  },
});
