import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
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

interface RequirementsRow {
  id: string;
  version: number;
  auto_requirements: Record<string, number | boolean>;
  property_requirements: Record<string, number | boolean>;
}

interface PreferencesRow {
  id: string;
  version: number;
  min_net_annual_savings_cents: number;
  renewal_only_switching: boolean;
  household_optimization_enabled: boolean;
  split_insurers_allowed: boolean;
  excluded_insurer_ids: string[];
  deductible_increases_allowed: boolean;
}

const bool = (v: unknown) => Boolean(v ?? false);
const centsToDollars = (v: unknown) => String(Math.round(Number(v ?? 0) / 100));

export default function EditMandate() {
  const { data: household, isLoading: householdLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Auto requirements
  const [minLiability, setMinLiability] = useState("2000000");
  const [maxCollisionDeductible, setMaxCollisionDeductible] = useState("1000");
  const [maxComprehensiveDeductible, setMaxComprehensiveDeductible] = useState("1000");
  const [collisionRequired, setCollisionRequired] = useState(true);
  const [comprehensiveRequired, setComprehensiveRequired] = useState(true);
  const [accidentForgiveness, setAccidentForgiveness] = useState(true);
  const [rentalCoverage, setRentalCoverage] = useState(true);
  const [telematicsAllowed, setTelematicsAllowed] = useState(false);

  // Property requirements
  const [minDwelling, setMinDwelling] = useState("450000");
  const [maxBaseDeductible, setMaxBaseDeductible] = useState("2500");
  const [maxWaterDeductible, setMaxWaterDeductible] = useState("5000");
  const [sewerBackup, setSewerBackup] = useState(true);
  const [overlandWater, setOverlandWater] = useState(true);
  const [ale, setAle] = useState(true);
  const [equipmentBreakdown, setEquipmentBreakdown] = useState(false);

  // Switching preferences
  const [minSavings, setMinSavings] = useState("200");
  const [renewalOnly, setRenewalOnly] = useState(true);
  const [optimizeTogether, setOptimizeTogether] = useState(true);
  const [splitAllowed, setSplitAllowed] = useState(true);
  const [deductibleIncreases, setDeductibleIncreases] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["edit-mandate", household?.id],
    enabled: !!household,
    queryFn: async () => {
      const [req, prefs] = await Promise.all([
        supabase
          .from("coverage_requirements")
          .select("id, version, auto_requirements, property_requirements")
          .eq("household_id", household!.id)
          .eq("is_current", true)
          .maybeSingle(),
        supabase
          .from("switching_preferences")
          .select(
            "id, version, min_net_annual_savings_cents, renewal_only_switching, household_optimization_enabled, split_insurers_allowed, excluded_insurer_ids, deductible_increases_allowed",
          )
          .eq("household_id", household!.id)
          .eq("is_current", true)
          .maybeSingle(),
      ]);
      if (req.error) throw req.error;
      if (prefs.error) throw prefs.error;
      return {
        requirements: req.data as RequirementsRow | null,
        preferences: prefs.data as PreferencesRow | null,
      };
    },
  });

  useEffect(() => {
    if (!data) return;
    const auto = data.requirements?.auto_requirements ?? {};
    const property = data.requirements?.property_requirements ?? {};
    setMinLiability(centsToDollars(auto.minThirdPartyLiabilityCents));
    setMaxCollisionDeductible(centsToDollars(auto.maxCollisionDeductibleCents));
    setMaxComprehensiveDeductible(centsToDollars(auto.maxComprehensiveDeductibleCents));
    setCollisionRequired(bool(auto.collisionRequired));
    setComprehensiveRequired(bool(auto.comprehensiveRequired));
    setAccidentForgiveness(bool(auto.accidentForgivenessRequired));
    setRentalCoverage(bool(auto.rentalVehicleCoverageRequired));
    setTelematicsAllowed(bool(auto.telematicsAllowed));
    setMinDwelling(centsToDollars(property.minDwellingLimitCents));
    setMaxBaseDeductible(centsToDollars(property.maxBaseDeductibleCents));
    setMaxWaterDeductible(centsToDollars(property.maxWaterDeductibleCents));
    setSewerBackup(bool(property.sewerBackupRequired));
    setOverlandWater(bool(property.overlandWaterRequired));
    setAle(bool(property.additionalLivingExpensesRequired));
    setEquipmentBreakdown(bool(property.equipmentBreakdownRequired));

    const p = data.preferences;
    if (p) {
      setMinSavings(centsToDollars(p.min_net_annual_savings_cents));
      setRenewalOnly(bool(p.renewal_only_switching));
      setOptimizeTogether(bool(p.household_optimization_enabled));
      setSplitAllowed(bool(p.split_insurers_allowed));
      setDeductibleIncreases(bool(p.deductible_increases_allowed));
    }
  }, [data]);

  if (householdLoading || isLoading || !household) return <Loading />;

  const dollars = (s: string) => Math.round(Number(s || "0") * 100);

  const save = async () => {
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const autoRequirements = {
      minThirdPartyLiabilityCents: dollars(minLiability),
      collisionRequired,
      comprehensiveRequired,
      maxCollisionDeductibleCents: dollars(maxCollisionDeductible),
      maxComprehensiveDeductibleCents: dollars(maxComprehensiveDeductible),
      accidentForgivenessRequired: accidentForgiveness,
      rentalVehicleCoverageRequired: rentalCoverage,
      telematicsAllowed,
    };

    const propertyRequirements = {
      minDwellingLimitCents: dollars(minDwelling),
      replacementCostRequired: true,
      sewerBackupRequired: sewerBackup,
      overlandWaterRequired: overlandWater,
      maxBaseDeductibleCents: dollars(maxBaseDeductible),
      maxWaterDeductibleCents: dollars(maxWaterDeductible),
      additionalLivingExpensesRequired: ale,
      equipmentBreakdownRequired: equipmentBreakdown,
    };

    let coverageId = data?.requirements?.id;
    if (coverageId) {
      const { error: updateError } = await supabase
        .from("coverage_requirements")
        .update({
          auto_requirements: autoRequirements,
          property_requirements: propertyRequirements,
          version: (data?.requirements?.version ?? 1) + 1,
          updated_by: userId,
        })
        .eq("id", coverageId);
      if (updateError) {
        setBusy(false);
        setError(updateError.message);
        return;
      }
    } else {
      const { data: created, error: insertError } = await supabase
        .from("coverage_requirements")
        .insert({
          household_id: household.id,
          is_current: true,
          auto_requirements: autoRequirements,
          property_requirements: propertyRequirements,
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();
      if (insertError) {
        setBusy(false);
        setError(insertError.message);
        return;
      }
      coverageId = created.id;
    }

    if (data?.preferences?.id) {
      const { error: updateError } = await supabase
        .from("switching_preferences")
        .update({
          min_net_annual_savings_cents: dollars(minSavings),
          renewal_only_switching: renewalOnly,
          household_optimization_enabled: optimizeTogether,
          split_insurers_allowed: splitAllowed,
          deductible_increases_allowed: deductibleIncreases,
          version: (data?.preferences?.version ?? 1) + 1,
          updated_by: userId,
        })
        .eq("id", data.preferences.id);
      if (updateError) {
        setBusy(false);
        setError(updateError.message);
        return;
      }
    } else {
      const { error: insertError } = await supabase.from("switching_preferences").insert({
        household_id: household.id,
        is_current: true,
        min_net_annual_savings_cents: dollars(minSavings),
        renewal_only_switching: renewalOnly,
        household_optimization_enabled: optimizeTogether,
        split_insurers_allowed: splitAllowed,
        excluded_insurer_ids: data?.preferences?.excluded_insurer_ids ?? [],
        deductible_increases_allowed: deductibleIncreases,
        customer_approval_required: true,
        created_by: userId,
        updated_by: userId,
      });
      if (insertError) {
        setBusy(false);
        setError(insertError.message);
        return;
      }
    }

    await supabase.from("audit_events").insert({
      action: "coverage_mandate_updated",
      entity_type: "coverage_requirements",
      entity_id: coverageId,
      household_id: household.id,
      after_summary: {
        auto_requirements: autoRequirements,
        property_requirements: propertyRequirements,
      },
    });

    queryClient.invalidateQueries({ queryKey: ["coverage", household.id] });
    queryClient.invalidateQueries({ queryKey: ["edit-mandate", household.id] });
    setBusy(false);
    router.back();
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
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Stack.Screen
        options={{ headerShown: true, headerBackTitle: "Back", title: "Edit mandate" }}
      />
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Coverage mandate</Title>
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
          <Card>
            <Subtitle>Switching rules</Subtitle>
            <Field
              label="Minimum net annual savings before switching (C$)"
              keyboardType="numeric"
              value={minSavings}
              onChangeText={setMinSavings}
            />
            <Toggle label="Only switch at renewal" value={renewalOnly} onChange={setRenewalOnly} />
            <Toggle
              label="Optimize home and auto together"
              value={optimizeTogether}
              onChange={setOptimizeTogether}
            />
            <Toggle
              label="Allow different insurers per policy"
              value={splitAllowed}
              onChange={setSplitAllowed}
            />
            <Toggle
              label="Allow deductible increases"
              value={deductibleIncreases}
              onChange={setDeductibleIncreases}
            />
            <Row label="Material coverage reductions" value="Never allowed" />
            <Row label="Your approval before any switch" value="Always required" />
          </Card>
          {error ? <Body muted>{error}</Body> : null}
          <PrimaryButton label="Save changes" onPress={save} loading={busy} />
          <View style={{ height: 24 }} />
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
