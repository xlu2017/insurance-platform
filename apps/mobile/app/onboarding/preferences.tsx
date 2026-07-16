import { router, Stack } from "expo-router";
import { useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { Body, Card, Field, Loading, PrimaryButton, Row, Screen, Title } from "@/components/ui";

export default function Preferences() {
  const { data: household, isLoading } = useHousehold();
  const [minSavings, setMinSavings] = useState("200");
  const [renewalOnly, setRenewalOnly] = useState(true);
  const [optimizeTogether, setOptimizeTogether] = useState(true);
  const [splitAllowed, setSplitAllowed] = useState(true);
  const [deductibleIncreases, setDeductibleIncreases] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading || !household) return <Loading />;

  const save = async () => {
    setBusy(true);
    setError(null);
    const { error: prefError } = await supabase.from("switching_preferences").insert({
      household_id: household.id,
      is_current: true,
      min_net_annual_savings_cents: Math.round(Number(minSavings || "0") * 100),
      renewal_only_switching: renewalOnly,
      household_optimization_enabled: optimizeTogether,
      split_insurers_allowed: splitAllowed,
      excluded_insurer_ids: [],
      deductible_increases_allowed: deductibleIncreases,
      customer_approval_required: true,
    });
    if (prefError) {
      setBusy(false);
      setError(prefError.message);
      return;
    }
    await supabase
      .from("households")
      .update({ onboarding_step: "consents" })
      .eq("id", household.id);
    setBusy(false);
    router.push("/onboarding/consents");
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
        options={{ headerShown: true, headerBackTitle: "Back", title: "Switching preferences" }}
      />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Title>Switching preferences</Title>
        <Body muted>We only ever propose a switch that satisfies these rules.</Body>
        <View style={{ height: 16 }} />
        <Card>
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
        <PrimaryButton label="Save and continue" onPress={save} loading={busy} />
      </ScrollView>
    </Screen>
  );
}
