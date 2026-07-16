import { router, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { invokeEdgeFunction } from "@/lib/edge-functions";
import { useHousehold } from "@/lib/household";
import {
  Body,
  Card,
  Field,
  Loading,
  PrimaryButton,
  Row,
  Screen,
  Subtitle,
  Title,
} from "@/components/ui";
import {
  createDefaultHouseholdCoverageMandateV2,
  createDefaultSwitchingPreferencesV2,
} from "@autopilot/schemas";

export default function Mandate() {
  const { data: household, isLoading } = useHousehold();
  const [minLiability, setMinLiability] = useState("2000000");
  const [maxCollisionDeductible, setMaxCollisionDeductible] = useState("1000");
  const [maxComprehensiveDeductible, setMaxComprehensiveDeductible] = useState("1000");
  const [minDwelling, setMinDwelling] = useState("450000");
  const [maxBaseDeductible, setMaxBaseDeductible] = useState("2500");
  const [maxWaterDeductible, setMaxWaterDeductible] = useState("5000");
  const [collisionRequired, setCollisionRequired] = useState(true);
  const [comprehensiveRequired, setComprehensiveRequired] = useState(true);
  const [accidentForgiveness, setAccidentForgiveness] = useState(true);
  const [rentalCoverage, setRentalCoverage] = useState(true);
  const [telematicsAllowed, setTelematicsAllowed] = useState(false);
  const [sewerBackup, setSewerBackup] = useState(true);
  const [overlandWater, setOverlandWater] = useState(true);
  const [ale, setAle] = useState(true);
  const [equipmentBreakdown, setEquipmentBreakdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading || !household) return <Loading />;

  const save = async () => {
    if (!household) return;
    setBusy(true);
    setError(null);
    const dollars = (s: string) => Math.round(Number(s || "0") * 100);

    const baseMandate = createDefaultHouseholdCoverageMandateV2();
    const mandate = {
      ...baseMandate,
      householdAutoDefaults: {
        ...baseMandate.householdAutoDefaults,
        liability: { rule: "minimum", amountCents: dollars(minLiability) } as const,
        collisionDeductible: {
          rule: "maximum",
          amountCents: dollars(maxCollisionDeductible),
        } as const,
        comprehensiveDeductible: {
          rule: "maximum",
          amountCents: dollars(maxComprehensiveDeductible),
        } as const,
        coverageForm: {
          preference: collisionRequired && comprehensiveRequired ? "required" : "preferred",
          value: collisionRequired && comprehensiveRequired ? "comprehensive" : "liability_only",
        },
        endorsements: {
          ...baseMandate.householdAutoDefaults.endorsements,
          accident_forgiveness: accidentForgiveness ? "required" : "indifferent",
          rental_vehicle_coverage: rentalCoverage ? "required" : "indifferent",
          telematics: telematicsAllowed ? "indifferent" : "prohibited",
        },
      },
      householdPropertyDefaults: {
        ...baseMandate.householdPropertyDefaults,
        dwellingLimit: { rule: "minimum", amountCents: dollars(minDwelling) } as const,
        baseDeductible: { rule: "maximum", amountCents: dollars(maxBaseDeductible) } as const,
        waterDeductible: { rule: "maximum", amountCents: dollars(maxWaterDeductible) } as const,
        sewerBackup: {
          preference: sewerBackup ? "required" : "indifferent",
          limit: { rule: "any" },
          deductible: { rule: "any" },
        },
        overlandWater: {
          preference: overlandWater ? "required" : "indifferent",
          limit: { rule: "any" },
          deductible: { rule: "any" },
        },
        optionalCoverages: {
          ...baseMandate.householdPropertyDefaults.optionalCoverages,
          equipment_breakdown: equipmentBreakdown ? "required" : "indifferent",
          additional_living_expenses: ale ? "required" : "indifferent",
        },
      },
    };
    const switching = createDefaultSwitchingPreferencesV2();

    const { error } = await invokeEdgeFunction("save-household-mandate", {
      householdId: household.id,
      expectedMandateVersion: 0,
      expectedSwitchingVersion: 0,
      mandate,
      switching,
    });

    if (error) {
      setBusy(false);
      setError(error.message ?? "Save failed");
      return;
    }

    const { error: householdError } = await supabase
      .from("households")
      .update({ onboarding_step: "preferences" })
      .eq("id", household.id);
    if (householdError) {
      setBusy(false);
      setError(householdError.message);
      return;
    }
    setBusy(false);
    router.push("/onboarding/preferences");
  };

  const Toggle = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 6,
      }}
    >
      <Body>{label}</Body>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );

  return (
    <Screen>
      <Stack.Screen
        options={{ headerShown: true, headerBackTitle: "Back", title: "Coverage mandate" }}
      />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Title>Your coverage mandate</Title>
        <Body muted>These requirements are enforced on every future comparison.</Body>
        <View style={{ height: 16 }} />
        <Card>
          <Subtitle>Auto</Subtitle>
          <Field
            label="Minimum third-party liability (C$)"
            keyboardType="numeric"
            value={minLiability}
            onChangeText={setMinLiability}
          />
          <Field
            label="Maximum collision deductible (C$)"
            keyboardType="numeric"
            value={maxCollisionDeductible}
            onChangeText={setMaxCollisionDeductible}
          />
          <Field
            label="Maximum comprehensive deductible (C$)"
            keyboardType="numeric"
            value={maxComprehensiveDeductible}
            onChangeText={setMaxComprehensiveDeductible}
          />
          <Toggle
            label="Collision required"
            value={collisionRequired}
            onChange={setCollisionRequired}
          />
          <Toggle
            label="Comprehensive required"
            value={comprehensiveRequired}
            onChange={setComprehensiveRequired}
          />
          <Toggle
            label="Accident forgiveness required"
            value={accidentForgiveness}
            onChange={setAccidentForgiveness}
          />
          <Toggle
            label="Rental vehicle coverage required"
            value={rentalCoverage}
            onChange={setRentalCoverage}
          />
          <Toggle
            label="Telematics allowed"
            value={telematicsAllowed}
            onChange={setTelematicsAllowed}
          />
        </Card>
        <Card>
          <Subtitle>Property</Subtitle>
          <Field
            label="Minimum dwelling limit (C$)"
            keyboardType="numeric"
            value={minDwelling}
            onChangeText={setMinDwelling}
          />
          <Field
            label="Maximum base deductible (C$)"
            keyboardType="numeric"
            value={maxBaseDeductible}
            onChangeText={setMaxBaseDeductible}
          />
          <Field
            label="Maximum water deductible (C$)"
            keyboardType="numeric"
            value={maxWaterDeductible}
            onChangeText={setMaxWaterDeductible}
          />
          <Row label="Replacement cost" value="Required" />
          <Toggle label="Sewer backup required" value={sewerBackup} onChange={setSewerBackup} />
          <Toggle
            label="Overland water required"
            value={overlandWater}
            onChange={setOverlandWater}
          />
          <Toggle label="Additional living expenses required" value={ale} onChange={setAle} />
          <Toggle
            label="Equipment breakdown required"
            value={equipmentBreakdown}
            onChange={setEquipmentBreakdown}
          />
        </Card>
        {error ? <Body muted>{error}</Body> : null}
        <PrimaryButton label="Save and continue" onPress={save} loading={busy} />
        <View style={{ height: 24 }} />
      </ScrollView>
    </Screen>
  );
}
