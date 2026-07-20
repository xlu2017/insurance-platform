import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
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
  Subtitle,
  Title,
} from "@/components/ui";
import {
  type DraftReview,
  OCCUPANCY_LABELS,
  PROPERTY_REVIEW_FIELDS,
  VEHICLE_REVIEW_FIELDS,
  displayValueForField,
  formatFieldLabel,
  formatFieldValue,
  getEffectiveDisplay,
  getFieldValue,
  isRecord,
  parseCorrectedValue,
  renderCents,
} from "@/lib/review-entities-helpers";

interface CandidateDecision {
  candidateId: string;
  decision: "approve_new" | "skip";
}

type ReviewAction = CandidateFieldReview["action"];

function fieldPathsForCandidate(candidate: ExtractionCandidate): string[] {
  const base = candidate.asset_type === "vehicle" ? VEHICLE_REVIEW_FIELDS : PROPERTY_REVIEW_FIELDS;
  return base.filter((path) => {
    const value = getFieldValue(candidate, path);
    return value !== null && value !== undefined && value !== "";
  });
}

export interface AddressSuggestion {
  displayName: string;
  latitude: number;
  longitude: number;
}

export function AddressVerification({
  candidate,
  draft,
  onVerified,
}: {
  candidate: ExtractionCandidate;
  draft?: DraftReview | null;
  onVerified: (displayName: string) => void;
}) {
  const identityValue = getFieldValue(candidate, "identity");
  const identity = isRecord(identityValue) ? identityValue : {};
  const original = String(identity.fullAddress ?? "");
  const [query, setQuery] = useState(draft?.correctedValue || original);
  const [status, setStatus] = useState<"idle" | "loading" | "found" | "not_found">(
    draft?.action === "correct" ? "found" : "idle",
  );
  const [result, setResult] = useState<string | null>(draft?.correctedValue ?? null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchSuggestions = async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      return;
    }
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("verify-address", {
        body: { q: trimmed, limit: 5 },
      });
      if (invokeError) throw new Error(invokeError.message);
      const response = data as { results?: AddressSuggestion[] };
      setSuggestions(response?.results?.slice(0, 5) ?? []);
    } catch {
      setSuggestions([]);
    }
  };

  useEffect(() => {
    if (status === "found" || !touched) return;
    const timeout = setTimeout(() => searchSuggestions(query), 400);
    return () => clearTimeout(timeout);
  }, [query, status, touched]);

  const selectSuggestion = (suggestion: AddressSuggestion) => {
    setQuery(suggestion.displayName);
    setResult(suggestion.displayName);
    setSuggestions([]);
    setStatus("found");
    onVerified(suggestion.displayName);
  };

  const verify = async () => {
    setStatus("loading");
    setError(null);
    setSuggestions([]);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("verify-address", {
        body: { q: query },
      });
      if (invokeError) throw new Error(invokeError.message);
      const response = data as { found?: boolean; result?: { displayName?: string } | null };
      if (response?.found && response.result?.displayName) {
        setResult(response.result.displayName);
        setStatus("found");
        onVerified(response.result.displayName);
        return;
      }
      setStatus("not_found");
      setResult(null);
    } catch (e) {
      setStatus("not_found");
      setError(e instanceof Error ? e.message : "Address lookup failed");
    }
  };

  const saveManual = () => {
    if (!query.trim()) return;
    setSuggestions([]);
    setResult(query.trim());
    setStatus("found");
    onVerified(query.trim());
  };

  return (
    <View style={{ gap: 8 }}>
      {status === "found" && result ? (
        <View style={{ gap: 8 }}>
          <Body>{result}</Body>
          <Caption style={{ color: "#16A34A" }}>Address verified</Caption>
          <SecondaryButton label="Re-verify" onPress={() => setStatus("idle")} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Field
            accessibilityLabel="Full address"
            value={query}
            onChangeText={(text: string) => {
              setTouched(true);
              setQuery(text);
            }}
            onFocus={() => {
              setTouched(true);
              searchSuggestions(query);
            }}
            multiline
            numberOfLines={2}
          />
          {suggestions.length > 0 ? (
            <View>
              <Caption style={{ marginBottom: 4, color: colors.inkMuted }}>Suggestions</Caption>
              <View style={styles.suggestions}>
                {suggestions.map((suggestion) => (
                  <Pressable
                    key={suggestion.displayName}
                    onPress={() => selectSuggestion(suggestion)}
                    style={styles.suggestionItem}
                  >
                    <Caption numberOfLines={2} ellipsizeMode="tail">
                      {suggestion.displayName}
                    </Caption>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <SecondaryButton
              label="Verify"
              onPress={verify}
              disabled={status === "loading"}
              style={{ flex: 1 }}
            />
            <SecondaryButton
              label="Save"
              onPress={saveManual}
              disabled={!query.trim()}
              style={{ flex: 1 }}
            />
          </View>
          {status === "not_found" ? (
            <Caption style={{ color: "#B45309" }}>
              We could not verify that address. Please enter the full street address and save.
            </Caption>
          ) : null}
          {error ? <Caption style={{ color: "#B45309" }}>{error}</Caption> : null}
        </View>
      )}
    </View>
  );
}

function FieldEditStep({
  candidate,
  fieldPath,
  draft,
  onComplete,
}: {
  candidate: ExtractionCandidate;
  fieldPath: string;
  draft?: DraftReview | null;
  onComplete: (action: ReviewAction, correctedValue?: string) => void;
}) {
  const value = getFieldValue(candidate, fieldPath);
  const isCents =
    fieldPath.toLowerCase().includes("cents") || fieldPath.toLowerCase().includes("premium");
  const label = formatFieldLabel(fieldPath);
  const [editing, setEditing] = useState(false);
  const [corrected, setCorrected] = useState(() => {
    if (draft?.action === "correct" && draft.correctedValue) return draft.correctedValue;
    return isCents ? renderCents(value) : displayValueForField(fieldPath, value);
  });

  const displayValue = isCents ? renderCents(value) : displayValueForField(fieldPath, value);

  if (editing) {
    return (
      <Card style={{ flex: 1, justifyContent: "center" }}>
        <Caption style={styles.fieldLabel}>{`Edit ${label}`}</Caption>
        <Field
          label={label}
          value={corrected}
          onChangeText={setCorrected}
          autoCorrect={false}
          keyboardType={isCents ? "numeric" : "default"}
          prefix={isCents ? "C$" : undefined}
          multiline={fieldPath.endsWith("fullAddress")}
          numberOfLines={fieldPath.endsWith("fullAddress") ? 2 : 1}
        />
        <View style={{ gap: 8 }}>
          <PrimaryButton label="Save" onPress={() => onComplete("correct", corrected)} />
          <SecondaryButton
            label="Cancel"
            onPress={() => {
              setEditing(false);
              setCorrected(isCents ? renderCents(value) : displayValueForField(fieldPath, value));
            }}
          />
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ flex: 1, justifyContent: "center" }}>
      <Caption style={styles.fieldLabel}>{label}</Caption>
      <Body style={styles.fieldValue}>{displayValue}</Body>
      <Body muted>{`Is the ${label} correct?`}</Body>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        <SecondaryButton label="Confirm" onPress={() => onComplete("confirm")} />
        <SecondaryButton label="Edit" onPress={() => setEditing(true)} />
        <SecondaryButton label="Unsure" onPress={() => onComplete("unknown")} />
      </View>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Caption style={styles.sectionTitle}>{title}</Caption>
      {children}
    </View>
  );
}

function FieldRow({
  candidate,
  fieldPath,
  draft,
  onPress,
}: {
  candidate: ExtractionCandidate;
  fieldPath: string;
  draft?: DraftReview | null;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.fieldRow}>
      <View style={{ flex: 1 }}>
        <Caption style={styles.fieldLabel}>{formatFieldLabel(fieldPath)}</Caption>
        <Body style={styles.fieldValue}>{getEffectiveDisplay(candidate, fieldPath, draft)}</Body>
      </View>
      <Caption style={styles.editLabel}>Edit</Caption>
    </Pressable>
  );
}

function CandidateSummary({
  candidate,
  drafts,
  addressVerified,
  onEdit,
  onAdd,
  onSkip,
  onAddressVerified,
  busy,
}: {
  candidate: ExtractionCandidate;
  drafts: Record<string, DraftReview>;
  addressVerified: Record<string, boolean>;
  onEdit: (fieldPath: string) => void;
  onAdd: () => void;
  onSkip: () => void;
  onAddressVerified: (displayName: string) => void;
  busy: boolean;
}) {
  const allPaths = fieldPathsForCandidate(candidate);
  const propertyAddressPath = `${candidate.id}:identity.fullAddress`;
  const addressDraft = drafts[propertyAddressPath];
  const identityPaths = allPaths
    .filter((p) => p.startsWith("identity."))
    .filter((p) => p !== "identity.fullAddress");
  const policyPaths = allPaths.filter((p) => p.startsWith("currentPolicy."));
  const typeLabel = candidate.asset_type === "vehicle" ? "Vehicle" : "Property";
  const isProperty = candidate.asset_type === "property";
  const canAdd = isProperty
    ? addressVerified[candidate.id] || addressDraft?.action === "correct"
    : true;

  return (
    <Card style={{ flex: 1, justifyContent: "center" }}>
      <Subtitle style={styles.subtitle}>{typeLabel}</Subtitle>
      <Title style={styles.title}>{candidate.display_label}</Title>
      {candidate.occupancy ? (
        <Caption>
          {OCCUPANCY_LABELS[candidate.occupancy.toLowerCase()] ?? candidate.occupancy}
        </Caption>
      ) : null}

      {isProperty ? (
        <Section title="Address">
          <AddressVerification
            candidate={candidate}
            draft={addressDraft}
            onVerified={onAddressVerified}
          />
        </Section>
      ) : null}

      {identityPaths.length > 0 ? (
        <Section title={typeLabel === "Vehicle" ? "Vehicle details" : "Property details"}>
          {identityPaths.map((path) => (
            <FieldRow
              key={path}
              candidate={candidate}
              fieldPath={path}
              draft={drafts[`${candidate.id}:${path}`]}
              onPress={() => onEdit(path)}
            />
          ))}
        </Section>
      ) : null}

      {policyPaths.length > 0 ? (
        <Section title="Policy details">
          {policyPaths.map((path) => (
            <FieldRow
              key={path}
              candidate={candidate}
              fieldPath={path}
              draft={drafts[`${candidate.id}:${path}`]}
              onPress={() => onEdit(path)}
            />
          ))}
        </Section>
      ) : null}

      {!canAdd ? (
        <Caption style={{ color: "#B45309", marginTop: 16 }}>
          Please verify or enter the full address before adding this property.
        </Caption>
      ) : null}

      <View style={{ gap: 12, marginTop: 24 }}>
        <PrimaryButton label="Add" onPress={onAdd} disabled={busy || !canAdd} />
        <SecondaryButton label="Skip" onPress={onSkip} disabled={busy} />
      </View>
    </Card>
  );
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
  const [drafts, setDrafts] = useState<Record<string, DraftReview>>({});
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [addressVerified, setAddressVerified] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fieldReviews) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const r of fieldReviews) {
        const key = `${r.candidate_id}:${r.field_path}`;
        if (!next[key]) {
          next[key] = {
            action: r.action,
            correctedValue:
              r.action === "correct" ? formatFieldValue(r.corrected_value) : undefined,
            mandateRule: "",
            mandateAmount: "",
          };
        }
      }
      return next;
    });
  }, [fieldReviews]);

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

    await saveReview.mutateAsync({
      candidate_id: candidate.id,
      household_id: household!.id,
      field_path: fieldPath,
      action: draft.action,
      corrected_value: correctedValue,
    });
  };

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
        <Stack.Screen options={{ title: "Review" }} />
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

  const currentCandidate = candidates[candidateIndex]!;

  const allCandidatesDecided = candidates.every(
    (c) => decisions[c.id] === "skip" || decisions[c.id] === "approve_new",
  );

  const advanceCandidate = () => {
    setCandidateIndex((i) => Math.min(i + 1, candidates.length));
    setEditingPath(null);
  };

  const handleFieldComplete = (action: ReviewAction, correctedValue?: string) => {
    if (!currentCandidate || !editingPath) return;
    const key = `${currentCandidate.id}:${editingPath}`;
    const value = getFieldValue(currentCandidate, editingPath);
    const corrected =
      action === "correct"
        ? String(
            parseCorrectedValue(
              editingPath,
              correctedValue ?? displayValueForField(editingPath, value),
            ),
          )
        : undefined;

    setDrafts((prev) => ({
      ...prev,
      [key]: {
        action,
        correctedValue: corrected,
        mandateRule: "",
        mandateAmount: "",
      },
    }));
    setEditingPath(null);
  };

  const handleAddressVerified = (displayName: string) => {
    if (!currentCandidate) return;
    const key = `${currentCandidate.id}:identity.fullAddress`;
    setDrafts((prev) => ({
      ...prev,
      [key]: { action: "correct", correctedValue: displayName, mandateRule: "", mandateAmount: "" },
    }));
    setAddressVerified((prev) => ({ ...prev, [currentCandidate.id]: true }));
  };

  const handleAdd = async () => {
    if (!currentCandidate || !household) return;
    setBusy(true);
    setError(null);
    try {
      const paths = fieldPathsForCandidate(currentCandidate);
      const nextDrafts = { ...drafts };
      for (const path of paths) {
        const key = `${currentCandidate.id}:${path}`;
        if (nextDrafts[key]) continue;
        nextDrafts[key] = {
          action: "confirm",
          correctedValue: undefined,
          mandateRule: "",
          mandateAmount: "",
        };
      }
      setDrafts(nextDrafts);
      setDecisions((prev) => ({ ...prev, [currentCandidate.id]: "approve_new" }));
      advanceCandidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add candidate");
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = () => {
    if (!currentCandidate) return;
    setDecisions((prev) => ({ ...prev, [currentCandidate.id]: "skip" }));
    advanceCandidate();
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const [key, draft] of Object.entries(drafts)) {
        const [candidateId, ...pathParts] = key.split(":");
        const fieldPath = pathParts.join(":");
        const candidate = candidates?.find((c) => c.id === candidateId);
        if (candidate) {
          await persistReview(candidate, fieldPath, draft);
        }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("You must be signed in to continue.");
        setBusy(false);
        return;
      }

      for (const candidate of candidates) {
        const { error: draftError } = await supabase.rpc("save_candidate_review_draft_v1", {
          p_household_id: household!.id,
          p_candidate_id: candidate.id,
          p_decision: decisions[candidate.id] === "approve_new" ? "approve_new" : "skip",
          p_identity_confirmed: decisions[candidate.id] === "approve_new",
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

  if (candidateIndex >= candidates.length) {
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
          <Stack.Screen options={{ title: "Review complete" }} />
          <Title style={styles.title}>Ready to continue</Title>
          <Body muted>Review what we found before continuing to your coverage rules.</Body>
          <View style={{ gap: 12, marginVertical: 16 }}>
            {candidates.map((candidate) => {
              const decision = decisions[candidate.id];
              return (
                <View key={candidate.id}>
                  <Body>{candidate.display_label}</Body>
                  <Caption>
                    {decision === "approve_new"
                      ? "Will be added to your account"
                      : "Will not be added"}
                  </Caption>
                </View>
              );
            })}
          </View>
          {error ? <Body muted>{error}</Body> : null}
          <PrimaryButton
            label="Continue"
            onPress={submit}
            loading={busy || saveReview.isPending}
            disabled={busy || saveReview.isPending || !allCandidatesDecided}
          />
        </ScrollView>
      </Screen>
    );
  }

  if (editingPath) {
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
          <Stack.Screen options={{ title: `Edit ${formatFieldLabel(editingPath)}` }} />
          <FieldEditStep
            candidate={currentCandidate}
            fieldPath={editingPath}
            draft={drafts[`${currentCandidate.id}:${editingPath}`]}
            onComplete={handleFieldComplete}
          />
        </ScrollView>
      </Screen>
    );
  }

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
        <Stack.Screen options={{ title: "Review" }} />
        <Caption>{`Asset ${candidateIndex + 1} of ${candidates.length}`}</Caption>
        <Title style={styles.title}>
          {currentCandidate.asset_type === "vehicle"
            ? "Is this your vehicle?"
            : "Is this your property?"}
        </Title>
        {error ? <Body muted>{error}</Body> : null}
        <CandidateSummary
          candidate={currentCandidate}
          drafts={drafts}
          addressVerified={addressVerified}
          onEdit={setEditingPath}
          onAdd={handleAdd}
          onSkip={handleSkip}
          onAddressVerified={handleAddressVerified}
          busy={busy}
        />
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
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.ink,
    marginBottom: 6,
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
    fontWeight: "600",
    color: colors.ink,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSubtle,
  },
  editLabel: {
    color: colors.accent,
    fontWeight: "700",
  },
  uploadButton: {
    borderRadius: 999,
    paddingVertical: 16,
    minWidth: 160,
  },
  suggestions: {
    borderWidth: 1,
    borderColor: colors.surfaceSubtle,
    borderRadius: 8,
    backgroundColor: colors.surface,
    maxHeight: 200,
  },
  suggestionItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSubtle,
  },
});
