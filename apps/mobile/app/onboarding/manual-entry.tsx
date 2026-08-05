import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHousehold } from "@/lib/household";
import { supabase } from "@/lib/supabase";
import { colors, spacing } from "@autopilot/design-tokens";
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

type AssetType = "property" | "vehicle";

interface BatchItem {
  id: string;
  policy_document_id: string;
  selected_file_name: string;
  category: string;
  review_status: string;
}

interface Candidate {
  id: string;
  asset_type: AssetType;
  display_label: string;
  source_document_ids: string[];
  selected_facts_json: Record<string, unknown>;
}

function generateRequestId(prefix: string, batchId: string): string {
  return `${prefix}:${batchId}:${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function isValidDate(value: string): boolean {
  if (!value) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isValidPostalCode(value: string): boolean {
  if (!value) return true;
  return /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(value.trim());
}

function parseMoney(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function formatMoneyError(label: string) {
  return `${label} must be a valid non-negative number`;
}

function formatCents(value: unknown): string {
  if (value == null) return "";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "";
  return String(n / 100);
}

export default function ManualEntry() {
  const { batchId, sessionId, caseId } = useLocalSearchParams<{
    batchId: string;
    sessionId: string;
    caseId: string;
  }>();
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();

  const [assetType, setAssetType] = useState<AssetType>("property");
  const [label, setLabel] = useState("");

  // Common policy fields
  const [insurerName, setInsurerName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [annualPremiumDollars, setAnnualPremiumDollars] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  // Property identity
  const [fullAddress, setFullAddress] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");

  // Property coverage
  const [dwellingLimit, setDwellingLimit] = useState("");
  const [contentsLimit, setContentsLimit] = useState("");
  const [propertyLiabilityLimit, setPropertyLiabilityLimit] = useState("");
  const [baseDeductible, setBaseDeductible] = useState("");

  // Vehicle identity
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vin, setVin] = useState("");

  // Vehicle coverage
  const [thirdPartyLiability, setThirdPartyLiability] = useState("");
  const [collisionDeductible, setCollisionDeductible] = useState("");
  const [comprehensiveDeductible, setComprehensiveDeductible] = useState("");

  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [editingCandidate, setEditingCandidate] = useState<Candidate | null>(null);

  const draftRequestIdRef = useRef<string | null>(null);
  const editRequestIdRef = useRef<string | null>(null);
  const completeRequestIdRef = useRef<string | null>(null);

  const missingRouteParam = !batchId || !sessionId || !caseId;

  const { data: items, isLoading: itemsLoading } = useQuery<BatchItem[]>({
    queryKey: ["document-processing-batch-items", household?.id, batchId],
    enabled: !!household && !!batchId,
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("document_processing_batch_items")
        .select("id, policy_document_id, selected_file_name, category, review_status")
        .eq("batch_id", batchId)
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;
      return (data as BatchItem[]) ?? [];
    },
  });

  const { data: candidates, isLoading: candidatesLoading } = useQuery<Candidate[]>({
    queryKey: ["manual-entry-candidates", household?.id, sessionId],
    enabled: !!household && !!sessionId,
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("asset_candidates")
        .select("id, asset_type, display_label, source_document_ids, selected_facts_json")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;
      return (data as Candidate[]) ?? [];
    },
  });

  const assignedDocIds = useMemo(
    () => new Set((candidates ?? []).flatMap((c) => c.source_document_ids)),
    [candidates],
  );

  const selectableItems = useMemo(
    () => (items ?? []).filter((item) => item.review_status !== "not_relevant"),
    [items],
  );

  const skippedItems = useMemo(
    () => (items ?? []).filter((item) => item.review_status === "not_relevant"),
    [items],
  );

  const incompleteDocuments = useMemo(
    () =>
      (items ?? []).filter(
        (item) => item.review_status !== "reviewed" && item.review_status !== "not_relevant",
      ),
    [items],
  );

  const currentSelectedFacts = useMemo(() => {
    const dwellingLimitCents = parseMoney(dwellingLimit);
    const personalLiabilityLimitCents = parseMoney(propertyLiabilityLimit);
    const contentsLimitCents = parseMoney(contentsLimit);
    const baseDeductibleCents = parseMoney(baseDeductible);
    const thirdPartyLiabilityCents = parseMoney(thirdPartyLiability);
    const collisionDeductibleCents = parseMoney(collisionDeductible);
    const comprehensiveDeductibleCents = parseMoney(comprehensiveDeductible);

    const propertyMandate: Record<string, unknown> = {};
    if (dwellingLimitCents != null) {
      propertyMandate.dwelling = { rule: "minimum", amountCents: dwellingLimitCents };
    }
    if (personalLiabilityLimitCents != null) {
      propertyMandate.liability = { rule: "minimum", amountCents: personalLiabilityLimitCents };
    }

    const vehicleMandate: Record<string, unknown> = {};
    if (thirdPartyLiabilityCents != null) {
      vehicleMandate.thirdPartyLiability = {
        rule: "minimum",
        amountCents: thirdPartyLiabilityCents,
      };
    }

    const common = {
      identity:
        assetType === "property"
          ? { fullAddress, city, province, postalCode, yearBuilt }
          : { year, make, model, vin },
      currentPolicy: {
        insurerName,
        policyNumber,
        annualPremiumCents: parseMoney(annualPremiumDollars),
        expiryDate,
      },
      currentCoverage:
        assetType === "property"
          ? {
              dwellingLimitCents,
              contentsLimitCents,
              personalLiabilityLimitCents,
              baseDeductibleCents,
            }
          : {
              thirdPartyLiabilityCents,
              collisionDeductibleCents,
              comprehensiveDeductibleCents,
            },
      mandateSuggestions: assetType === "property" ? propertyMandate : vehicleMandate,
    };
    return common;
  }, [
    assetType,
    fullAddress,
    city,
    province,
    postalCode,
    yearBuilt,
    year,
    make,
    model,
    vin,
    insurerName,
    policyNumber,
    annualPremiumDollars,
    expiryDate,
    dwellingLimit,
    contentsLimit,
    propertyLiabilityLimit,
    baseDeductible,
    thirdPartyLiability,
    collisionDeductible,
    comprehensiveDeductible,
  ]);

  const identityFingerprint = useMemo(() => {
    if (assetType === "property") {
      return `property|${fullAddress.trim()}|${yearBuilt.trim()}`.replace(/\|+/g, "|");
    }
    return `vehicle|${vin.trim()}|${year.trim()}|${make.trim()}|${model.trim()}`.replace(
      /\|+/g,
      "|",
    );
  }, [assetType, fullAddress, yearBuilt, vin, year, make, model]);

  useEffect(() => {
    if (missingRouteParam) {
      setError("Missing batch, session, or case identifier.");
    }
  }, [missingRouteParam]);

  if (isLoading || itemsLoading || candidatesLoading) return <Loading />;
  if (!household) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Title>Finish setting up</Title>
        <Body muted>Set up your account to continue.</Body>
      </Screen>
    );
  }

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!label.trim()) errors.label = "Display label is required";

    if (assetType === "property") {
      if (!fullAddress.trim()) errors.fullAddress = "Address is required";
      if (!city.trim()) errors.city = "City is required";
      if (!province.trim()) errors.province = "Province is required";
      if (!isValidPostalCode(postalCode)) errors.postalCode = "Enter a valid postal code";
      if (yearBuilt.trim() && !/^\d{4}$/.test(yearBuilt.trim())) {
        errors.yearBuilt = "Enter a valid 4-digit year";
      }
      if (parseMoney(dwellingLimit) === null && dwellingLimit.trim() !== "") {
        errors.dwellingLimit = formatMoneyError("Dwelling limit");
      }
      if (parseMoney(baseDeductible) === null && baseDeductible.trim() !== "") {
        errors.baseDeductible = formatMoneyError("Base deductible");
      }
    } else {
      if (!year.trim() || !/^\d{4}$/.test(year.trim())) {
        errors.year = "Enter a valid 4-digit year";
      }
      if (!make.trim()) errors.make = "Make is required";
      if (!model.trim()) errors.model = "Model is required";
      if (vin.trim() && vin.trim().length !== 17) errors.vin = "VIN must be 17 characters";
      if (parseMoney(thirdPartyLiability) === null && thirdPartyLiability.trim() !== "") {
        errors.thirdPartyLiability = formatMoneyError("Liability limit");
      }
      if (parseMoney(collisionDeductible) === null && collisionDeductible.trim() !== "") {
        errors.collisionDeductible = formatMoneyError("Collision deductible");
      }
    }

    const premiumCents = parseMoney(annualPremiumDollars);
    if (premiumCents === null || premiumCents <= 0) {
      errors.annualPremium = "Annual premium must be a positive amount";
    }
    if (!isValidDate(expiryDate)) errors.expiryDate = "Use YYYY-MM-DD";

    if (selectedDocIds.length === 0) errors.documents = "Select at least one source document";

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const resetForm = () => {
    setLabel("");
    setInsurerName("");
    setPolicyNumber("");
    setAnnualPremiumDollars("");
    setExpiryDate("");
    setFullAddress("");
    setCity("");
    setProvince("");
    setPostalCode("");
    setYearBuilt("");
    setDwellingLimit("");
    setContentsLimit("");
    setPropertyLiabilityLimit("");
    setBaseDeductible("");
    setYear("");
    setMake("");
    setModel("");
    setVin("");
    setThirdPartyLiability("");
    setCollisionDeductible("");
    setComprehensiveDeductible("");
    setSelectedDocIds([]);
    setValidationErrors({});
    setEditingCandidate(null);
    draftRequestIdRef.current = null;
    editRequestIdRef.current = null;
  };

  const toggleDocument = (docId: string) => {
    setSelectedDocIds((current) =>
      current.includes(docId) ? current.filter((id) => id !== docId) : [...current, docId],
    );
  };

  const markSkipped = async (doc: BatchItem) => {
    setSelectedDocIds((current) => current.filter((id) => id !== doc.policy_document_id));
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("set_manual_entry_document_status_v1", {
        p_batch_id: batchId,
        p_policy_document_id: doc.policy_document_id,
        p_household_id: household.id,
        p_status: "not_relevant",
      });
      if (rpcError) throw rpcError;
      if ((data as { success?: boolean } | null)?.success !== true) {
        throw new Error("Failed to mark document as not relevant");
      }
      await queryClient.invalidateQueries({
        queryKey: ["document-processing-batch-items", household.id, batchId],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update document status");
    } finally {
      setBusy(false);
    }
  };

  const unmarkSkipped = async (doc: BatchItem) => {
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc("set_manual_entry_document_status_v1", {
        p_batch_id: batchId,
        p_policy_document_id: doc.policy_document_id,
        p_household_id: household.id,
        p_status: "unreviewed",
      });
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["document-processing-batch-items", household.id, batchId],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update document status");
    } finally {
      setBusy(false);
    }
  };

  const loadCandidateIntoForm = (candidate: Candidate) => {
    const facts = (candidate.selected_facts_json ?? {}) as Record<string, unknown>;
    const identity = (facts.identity ?? {}) as Record<string, unknown>;
    const policy = (facts.currentPolicy ?? {}) as Record<string, unknown>;
    const coverage = (facts.currentCoverage ?? {}) as Record<string, unknown>;

    setAssetType(candidate.asset_type);
    setLabel(candidate.display_label);
    setInsurerName(String(policy.insurerName ?? ""));
    setPolicyNumber(String(policy.policyNumber ?? ""));
    setAnnualPremiumDollars(formatCents(policy.annualPremiumCents));
    setExpiryDate(String(policy.expiryDate ?? ""));
    setSelectedDocIds(candidate.source_document_ids ?? []);

    if (candidate.asset_type === "property") {
      setFullAddress(String(identity.fullAddress ?? ""));
      setCity(String(identity.city ?? ""));
      setProvince(String(identity.province ?? ""));
      setPostalCode(String(identity.postalCode ?? ""));
      setYearBuilt(String(identity.yearBuilt ?? ""));
      setDwellingLimit(formatCents(coverage.dwellingLimitCents));
      setContentsLimit(formatCents(coverage.contentsLimitCents));
      setPropertyLiabilityLimit(
        formatCents(coverage.personalLiabilityLimitCents ?? coverage.liabilityLimitCents),
      );
      setBaseDeductible(formatCents(coverage.baseDeductibleCents));
      setYear("");
      setMake("");
      setModel("");
      setVin("");
      setThirdPartyLiability("");
      setCollisionDeductible("");
      setComprehensiveDeductible("");
    } else {
      setYear(String(identity.year ?? ""));
      setMake(String(identity.make ?? ""));
      setModel(String(identity.model ?? ""));
      setVin(String(identity.vin ?? ""));
      setThirdPartyLiability(formatCents(coverage.thirdPartyLiabilityCents));
      setCollisionDeductible(formatCents(coverage.collisionDeductibleCents));
      setComprehensiveDeductible(formatCents(coverage.comprehensiveDeductibleCents));
      setFullAddress("");
      setCity("");
      setProvince("");
      setPostalCode("");
      setYearBuilt("");
      setDwellingLimit("");
      setContentsLimit("");
      setPropertyLiabilityLimit("");
      setBaseDeductible("");
    }
    setValidationErrors({});
  };

  const startEdit = (candidate: Candidate) => {
    loadCandidateIntoForm(candidate);
    setEditingCandidate(candidate);
    editRequestIdRef.current = generateRequestId("manual-entry-update", batchId);
  };

  const saveDraft = async () => {
    if (!validate()) return;

    setBusy(true);
    setError(null);
    try {
      const rpcName: "save_customer_manual_policy_review_v1" | "update_manual_entry_candidate_v1" =
        editingCandidate
          ? "update_manual_entry_candidate_v1"
          : "save_customer_manual_policy_review_v1";
      let clientRequestId = editingCandidate ? editRequestIdRef.current : draftRequestIdRef.current;
      const args: Record<string, unknown> = {
        p_batch_id: batchId,
        p_session_id: sessionId,
        p_case_id: caseId,
        p_household_id: household.id,
        p_asset_type: assetType,
        p_identity_fingerprint: identityFingerprint,
        p_display_label: label.trim(),
        p_source_document_ids: selectedDocIds,
        p_selected_facts_json: currentSelectedFacts,
        p_match_classification: "new",
      };

      if (editingCandidate && !editRequestIdRef.current) {
        editRequestIdRef.current = generateRequestId("manual-entry-update", batchId);
        clientRequestId = editRequestIdRef.current;
      }
      if (!editingCandidate && !draftRequestIdRef.current) {
        draftRequestIdRef.current = generateRequestId("manual-entry-save", batchId);
        clientRequestId = draftRequestIdRef.current;
      }
      if (editingCandidate) {
        args.p_candidate_id = editingCandidate.id;
      }

      args.p_client_request_id = clientRequestId;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error: rpcError } = await supabase.rpc(rpcName, args as any);
      if (rpcError) throw rpcError;
      const result = data as { success?: boolean; candidate_id?: string } | null;
      if (!result?.success || !result.candidate_id) throw new Error("Failed to save candidate");

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["manual-entry-candidates", household.id, sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["document-processing-batch-items", household.id, batchId],
        }),
      ]);
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save candidate");
    } finally {
      setBusy(false);
    }
  };

  const deleteCandidate = async (candidate: Candidate) => {
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("delete_manual_entry_candidate_v1", {
        p_candidate_id: candidate.id,
        p_batch_id: batchId,
        p_household_id: household.id,
      });
      if (rpcError) throw rpcError;
      if ((data as { success?: boolean } | null)?.success !== true) {
        throw new Error("Failed to delete candidate");
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["manual-entry-candidates", household.id, sessionId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["document-processing-batch-items", household.id, batchId],
        }),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete candidate");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!completeRequestIdRef.current) {
      completeRequestIdRef.current = generateRequestId("manual-entry-complete", batchId);
    }

    setBusy(true);
    setError(null);
    try {
      const skippedDocumentIds = (items ?? [])
        .filter((item) => item.review_status === "not_relevant")
        .map((item) => item.policy_document_id);

      const { data, error: rpcError } = await supabase.rpc("complete_customer_manual_entry_v1", {
        p_batch_id: batchId,
        p_session_id: sessionId,
        p_case_id: caseId,
        p_household_id: household.id,
        p_client_request_id: completeRequestIdRef.current,
        p_skipped_document_ids: skippedDocumentIds,
      });
      if (rpcError) throw rpcError;
      const result = data as { success?: boolean; batch_id?: string } | null;
      if (!result?.success) throw new Error("Failed to complete manual entry");

      await queryClient.invalidateQueries({
        queryKey: ["document-processing-batches", household.id],
      });
      router.push({
        pathname: "/onboarding/review-entities",
        params: { sessionId },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not complete manual entry");
      setBusy(false);
    }
  };

  const renderIdentityFields = () =>
    assetType === "property" ? (
      <View style={{ gap: spacing.md }}>
        <Field
          label="Full address"
          value={fullAddress}
          onChangeText={setFullAddress}
          error={validationErrors.fullAddress}
        />
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label="City" value={city} onChangeText={setCity} error={validationErrors.city} />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="Province"
              value={province}
              onChangeText={setProvince}
              error={validationErrors.province}
            />
          </View>
        </View>
        <Field
          label="Postal code"
          value={postalCode}
          onChangeText={setPostalCode}
          error={validationErrors.postalCode}
        />
        <Field
          label="Year built"
          value={yearBuilt}
          onChangeText={setYearBuilt}
          keyboardType="numeric"
          error={validationErrors.yearBuilt}
        />
      </View>
    ) : (
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Year"
              value={year}
              onChangeText={setYear}
              keyboardType="numeric"
              error={validationErrors.year}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Make" value={make} onChangeText={setMake} error={validationErrors.make} />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Model"
              value={model}
              onChangeText={setModel}
              error={validationErrors.model}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="VIN" value={vin} onChangeText={setVin} error={validationErrors.vin} />
          </View>
        </View>
      </View>
    );

  const renderCoverageFields = () =>
    assetType === "property" ? (
      <View style={{ gap: spacing.md }}>
        <Field
          label="Dwelling limit ($)"
          value={dwellingLimit}
          onChangeText={setDwellingLimit}
          keyboardType="numeric"
          error={validationErrors.dwellingLimit}
        />
        <Field
          label="Contents limit ($)"
          value={contentsLimit}
          onChangeText={setContentsLimit}
          keyboardType="numeric"
        />
        <Field
          label="Personal liability limit ($)"
          value={propertyLiabilityLimit}
          onChangeText={setPropertyLiabilityLimit}
          keyboardType="numeric"
        />
        <Field
          label="Base deductible ($)"
          value={baseDeductible}
          onChangeText={setBaseDeductible}
          keyboardType="numeric"
          error={validationErrors.baseDeductible}
        />
      </View>
    ) : (
      <View style={{ gap: spacing.md }}>
        <Field
          label="Third-party liability ($)"
          value={thirdPartyLiability}
          onChangeText={setThirdPartyLiability}
          keyboardType="numeric"
          error={validationErrors.thirdPartyLiability}
        />
        <Field
          label="Collision deductible ($)"
          value={collisionDeductible}
          onChangeText={setCollisionDeductible}
          keyboardType="numeric"
          error={validationErrors.collisionDeductible}
        />
        <Field
          label="Comprehensive deductible ($)"
          value={comprehensiveDeductible}
          onChangeText={setComprehensiveDeductible}
          keyboardType="numeric"
        />
      </View>
    );

  const categoryLabel = (value: string) =>
    (
      ({
        auto_detect: "Auto-detect",
        current_auto_policy: "Current auto policy",
        current_property_policy: "Current property policy",
        renewal_notice: "Renewal notice",
        competing_quote: "Competing quote",
        proof_of_insurance: "Proof of insurance",
        signed_authorization: "Signed authorization",
        cancellation_confirmation: "Cancellation confirmation",
        other: "Other",
      }) as Record<string, string>
    )[value] ?? value;

  const candidateList = candidates ?? [];
  const canFinish = candidateList.length > 0 && incompleteDocuments.length === 0;

  return (
    <Screen style={{ paddingVertical: spacing.md }}>
      <Stack.Screen options={{ headerShown: true, title: "Enter details manually" }} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Title>Enter policy details</Title>
        <Body muted>
          Your documents were stored without AI processing. Enter the policy details to continue.
        </Body>
        <View style={{ height: 16 }} />

        {error ? (
          <Body style={{ color: colors.danger, marginBottom: spacing.md }}>{error}</Body>
        ) : null}

        <Card>
          <Subtitle>Asset type</Subtitle>
          <Select
            label="Asset type"
            options={[
              { value: "property", label: "Property" },
              { value: "vehicle", label: "Vehicle" },
            ]}
            value={assetType}
            onValueChange={(value) => setAssetType(value as AssetType)}
          />
        </Card>

        <Card>
          <Subtitle>Identification</Subtitle>
          <Field
            label="Display label"
            value={label}
            onChangeText={setLabel}
            error={validationErrors.label}
          />
          {renderIdentityFields()}
        </Card>

        <Card>
          <Subtitle>Current policy</Subtitle>
          <View style={{ gap: spacing.md }}>
            <Field label="Insurer name" value={insurerName} onChangeText={setInsurerName} />
            <Field label="Policy number" value={policyNumber} onChangeText={setPolicyNumber} />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Annual premium ($)"
                  value={annualPremiumDollars}
                  onChangeText={setAnnualPremiumDollars}
                  keyboardType="numeric"
                  error={validationErrors.annualPremium}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="Expiry date"
                  value={expiryDate}
                  onChangeText={setExpiryDate}
                  placeholder="YYYY-MM-DD"
                  error={validationErrors.expiryDate}
                />
              </View>
            </View>
          </View>
        </Card>

        <Card>
          <Subtitle>Coverage</Subtitle>
          {renderCoverageFields()}
        </Card>

        <Card>
          <Subtitle>Source documents</Subtitle>
          {selectableItems.length === 0 && skippedItems.length === 0 ? (
            <Body muted>No documents available.</Body>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {selectableItems.map((item) => {
                const canSkip = !assignedDocIds.has(item.policy_document_id);
                return (
                  <View
                    key={item.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingVertical: spacing.sm,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <Pressable
                      onPress={() => toggleDocument(item.policy_document_id)}
                      style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                    >
                      <Body
                        style={{
                          color: selectedDocIds.includes(item.policy_document_id)
                            ? colors.accent
                            : colors.ink,
                        }}
                      >
                        {selectedDocIds.includes(item.policy_document_id) ? "[x] " : "[ ] "}
                      </Body>
                      <View style={{ marginLeft: spacing.sm }}>
                        <Body numberOfLines={1}>{item.selected_file_name}</Body>
                        <Caption>{categoryLabel(item.category)}</Caption>
                      </View>
                    </Pressable>
                    {canSkip ? (
                      <Pressable onPress={() => markSkipped(item)} disabled={busy} hitSlop={8}>
                        <Body style={{ color: colors.inkMuted }}>Not relevant</Body>
                      </Pressable>
                    ) : (
                      <Caption>In use</Caption>
                    )}
                  </View>
                );
              })}
              {skippedItems.map((item) => (
                <View
                  key={item.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: spacing.sm,
                    opacity: 0.6,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Body numberOfLines={1} style={{ textDecorationLine: "line-through" }}>
                    {item.selected_file_name}
                  </Body>
                  <Pressable onPress={() => unmarkSkipped(item)} disabled={busy} hitSlop={8}>
                    <Body style={{ color: colors.accent }}>Undo</Body>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {validationErrors.documents ? (
            <Body style={{ color: colors.danger, marginTop: spacing.sm }}>
              {validationErrors.documents}
            </Body>
          ) : null}
        </Card>

        {editingCandidate ? (
          <>
            <PrimaryButton
              label="Update this policy"
              onPress={saveDraft}
              loading={busy}
              disabled={busy || missingRouteParam}
            />
            <View style={{ height: 8 }} />
            <SecondaryButton label="Cancel edit" onPress={resetForm} disabled={busy} />
          </>
        ) : (
          <PrimaryButton
            label="Save this policy"
            onPress={saveDraft}
            loading={busy}
            disabled={busy || missingRouteParam}
          />
        )}
        <View style={{ height: 8 }} />

        {candidateList.length > 0 ? (
          <Card>
            <Subtitle>Saved policies</Subtitle>
            <View style={{ gap: spacing.sm }}>
              {candidateList.map((candidate) => (
                <View
                  key={candidate.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingVertical: spacing.sm,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Body>{candidate.display_label}</Body>
                    <Caption style={{ textTransform: "capitalize" }}>
                      {candidate.asset_type}
                    </Caption>
                  </View>
                  <View style={{ flexDirection: "row", gap: spacing.md }}>
                    <Pressable onPress={() => startEdit(candidate)} disabled={busy} hitSlop={8}>
                      <Body style={{ color: colors.accent }}>Edit</Body>
                    </Pressable>
                    <Pressable
                      onPress={() => deleteCandidate(candidate)}
                      disabled={busy}
                      hitSlop={8}
                    >
                      <Body style={{ color: colors.danger }}>Delete</Body>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <View style={{ height: 8 }} />
        <PrimaryButton
          label="Finish and review"
          onPress={finish}
          loading={busy}
          disabled={busy || !canFinish || missingRouteParam}
        />
        {incompleteDocuments.length > 0 ? (
          <Caption style={{ marginTop: spacing.sm, color: colors.danger }}>
            Assign or mark every uploaded document before finishing.
          </Caption>
        ) : null}
        {!editingCandidate ? (
          <>
            <View style={{ height: 8 }} />
            <SecondaryButton label="Cancel" onPress={() => router.back()} disabled={busy} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
