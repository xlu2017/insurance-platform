import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useHousehold } from "@/lib/household";
import { supabase } from "@/lib/supabase";
import { colors, spacing } from "@autopilot/design-tokens";
import {
  Body,
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

export default function ManualEntry() {
  const { batchId, sessionId, caseId } = useLocalSearchParams<{
    batchId: string;
    sessionId: string;
    caseId: string;
  }>();
  const { data: household, isLoading } = useHousehold();
  const [assetType, setAssetType] = useState<AssetType>("property");
  const [label, setLabel] = useState("");
  const [insurerName, setInsurerName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [annualPremiumDollars, setAnnualPremiumDollars] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [coverageA, setCoverageA] = useState("");
  const [coverageB, setCoverageB] = useState("");

  // Identity fields
  const [fullAddress, setFullAddress] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");

  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vin, setVin] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !household) return <Loading />;

  const identity =
    assetType === "property"
      ? { fullAddress, city, province, postalCode, yearBuilt }
      : { year, make, model, vin };

  const identityFingerprint = Object.entries(identity)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join("|");

  const currentCoverage =
    assetType === "property"
      ? {
          dwellingLimitCents: Math.round(Number(coverageA) * 100) || 0,
          baseDeductibleCents: Math.round(Number(coverageB) * 100) || 0,
        }
      : {
          thirdPartyLiabilityCents: Math.round(Number(coverageA) * 100) || 0,
          collisionDeductibleCents: Math.round(Number(coverageB) * 100) || 0,
        };

  const mandateSuggestions =
    assetType === "property"
      ? { dwelling: { rule: "minimum", amountCents: currentCoverage.dwellingLimitCents || 0 } }
      : {
          thirdPartyLiability: {
            rule: "minimum",
            amountCents: currentCoverage.thirdPartyLiabilityCents || 0,
          },
        };

  const save = async () => {
    if (!label.trim()) {
      setError("Display label is required");
      return;
    }
    if (!identityFingerprint) {
      setError("Please enter at least one identity field");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const profileId = user?.id;
      if (!profileId) {
        throw new Error("You must be signed in to save manual entry.");
      }
      const annualPremiumCents = Math.round(Number(annualPremiumDollars) * 100) || 0;
      const selectedFacts = {
        identity,
        currentPolicy: {
          insurerName,
          policyNumber,
          annualPremiumCents,
          expiryDate,
        },
        currentCoverage,
        mandateSuggestions,
      };

      const { data, error: rpcError } = await supabase.rpc(
        "save_customer_manual_policy_review_v1",
        {
          p_batch_id: batchId,
          p_session_id: sessionId,
          p_case_id: caseId,
          p_household_id: household.id,
          p_actor_profile_id: profileId,
          p_client_request_id: `manual-entry:${batchId}:${Date.now()}`,
          p_asset_type: assetType,
          p_identity_fingerprint: identityFingerprint,
          p_display_label: label,
          p_match_classification: "new",
          p_selected_facts_json: selectedFacts,
        },
      );
      if (rpcError) throw rpcError;
      const result = data as { success?: boolean; candidate?: { id: string } } | null;
      if (!result?.success) throw new Error("Failed to save manual entry");

      router.push({
        pathname: "/onboarding/review-entities",
        params: { sessionId },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save manual entry");
    } finally {
      setBusy(false);
    }
  };

  const identityFields =
    assetType === "property" ? (
      <View style={{ gap: spacing.md }}>
        <Field label="Full address" value={fullAddress} onChangeText={setFullAddress} />
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label="City" value={city} onChangeText={setCity} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Province" value={province} onChangeText={setProvince} />
          </View>
        </View>
        <Field label="Postal code" value={postalCode} onChangeText={setPostalCode} />
        <Field
          label="Year built"
          value={yearBuilt}
          onChangeText={setYearBuilt}
          keyboardType="numeric"
        />
      </View>
    ) : (
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label="Year" value={year} onChangeText={setYear} keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Make" value={make} onChangeText={setMake} />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label="Model" value={model} onChangeText={setModel} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="VIN" value={vin} onChangeText={setVin} />
          </View>
        </View>
      </View>
    );

  const coverageLabels =
    assetType === "property"
      ? { a: "Dwelling limit ($)", b: "Base deductible ($)" }
      : { a: "Third-party liability ($)", b: "Collision deductible ($)" };

  return (
    <Screen style={{ paddingVertical: spacing.md }}>
      <Stack.Screen options={{ headerShown: true, title: "Enter details manually" }} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Title>Enter policy details</Title>
        <Body muted>
          We could not read your documents automatically. Enter the details here so we can review
          your coverage.
        </Body>
        <View style={{ height: 16 }} />

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
          <Field label="Display label" value={label} onChangeText={setLabel} />
          {identityFields}
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
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Expiry date" value={expiryDate} onChangeText={setExpiryDate} />
              </View>
            </View>
          </View>
        </Card>

        <Card>
          <Subtitle>Coverage</Subtitle>
          <View style={{ gap: spacing.md }}>
            <Field
              label={coverageLabels.a}
              value={coverageA}
              onChangeText={setCoverageA}
              keyboardType="numeric"
            />
            <Field
              label={coverageLabels.b}
              value={coverageB}
              onChangeText={setCoverageB}
              keyboardType="numeric"
            />
          </View>
        </Card>

        {error ? (
          <Body style={{ color: colors.danger, marginTop: spacing.sm }}>{error}</Body>
        ) : null}

        <PrimaryButton label="Save and review" onPress={save} loading={busy} />
        <View style={{ height: 8 }} />
        <SecondaryButton label="Cancel" onPress={() => router.back()} disabled={busy} />
      </ScrollView>
    </Screen>
  );
}
