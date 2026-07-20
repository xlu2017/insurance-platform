import { router, Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import {
  Body,
  Caption,
  Card,
  Field,
  Loading,
  PrimaryButton,
  Row,
  Screen,
  SecondaryButton,
  Title,
} from "@/components/ui";

interface PreferenceStep {
  key: string;
  question: string;
  description?: string;
  type: "number" | "toggle" | "info";
}

const STEPS: PreferenceStep[] = [
  {
    key: "minSavings",
    question: "Recommend a switch only if I save at least (C$ per year)",
    type: "number",
  },
  {
    key: "renewalOnly",
    question: "Only recommend changes at renewal",
    type: "toggle",
  },
  {
    key: "optimizeTogether",
    question: "Compare home and auto together",
    type: "toggle",
  },
  {
    key: "splitAllowed",
    question: "Allow home and auto with different insurers",
    type: "toggle",
  },
  {
    key: "deductibleIncreases",
    question: "Allow higher deductibles",
    description:
      "A higher deductible can lower the premium but increases what you pay after a claim.",
    type: "toggle",
  },
  {
    key: "coverage",
    question: "Never reduce important coverage",
    description: "We will not recommend coverage reductions as a way to save money.",
    type: "toggle",
  },
  {
    key: "approval",
    question: "Always ask me before starting a switch",
    description: "We never start a switch without your approval.",
    type: "toggle",
  },
];

export default function Preferences() {
  const { data: household, isLoading } = useHousehold();
  const [minSavings, setMinSavings] = useState("200");
  const [renewalOnly, setRenewalOnly] = useState(true);
  const [optimizeTogether, setOptimizeTogether] = useState(true);
  const [splitAllowed, setSplitAllowed] = useState(true);
  const [deductibleIncreases, setDeductibleIncreases] = useState(false);
  const [coverage, setCoverage] = useState(true);
  const [approval, setApproval] = useState(true);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!household) return;
    supabase
      .from("switching_preferences")
      .select("*")
      .eq("household_id", household.id)
      .eq("is_current", true)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setMinSavings(String(data.min_net_annual_savings_cents / 100));
        setRenewalOnly(data.renewal_only_switching ?? true);
        setOptimizeTogether(data.household_optimization_enabled ?? true);
        setSplitAllowed(data.split_insurers_allowed ?? true);
        setDeductibleIncreases(data.deductible_increases_allowed ?? false);
        setCoverage(!(data.material_coverage_reductions_allowed ?? false));
        setApproval(data.customer_approval_required ?? true);
      });
  }, [household]);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const progressLabel = useMemo(() => `Question ${step + 1} of ${STEPS.length}`, [step]);

  if (isLoading || !household || !current) return <Loading />;

  const save = async () => {
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const profileId = userData.user?.id;

    const { data: existing } = await supabase
      .from("switching_preferences")
      .select("id")
      .eq("household_id", household.id)
      .eq("is_current", true)
      .maybeSingle();

    const payload = {
      household_id: household.id,
      is_current: true,
      min_net_annual_savings_cents: Math.round(Number(minSavings || "0") * 100),
      renewal_only_switching: renewalOnly,
      household_optimization_enabled: optimizeTogether,
      split_insurers_allowed: splitAllowed,
      excluded_insurer_ids: [] as string[],
      deductible_increases_allowed: deductibleIncreases,
      customer_approval_required: approval,
      material_coverage_reductions_allowed: !coverage,
      switch_only_after_customer_approval: approval,
      updated_by: profileId,
    };

    let prefError;
    if (existing) {
      ({ error: prefError } = await supabase
        .from("switching_preferences")
        .update(payload)
        .eq("id", existing.id));
    } else {
      ({ error: prefError } = await supabase
        .from("switching_preferences")
        .insert({ ...payload, created_by: profileId }));
    }

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

  const goNext = () => {
    if (isLast) {
      save();
    } else {
      setStep((s) => s + 1);
    }
  };

  const goBack = () => {
    setStep((s) => Math.max(0, s - 1));
  };

  const setValueForStep = (key: string, value: string | boolean) => {
    switch (key) {
      case "minSavings":
        setMinSavings(value as string);
        break;
      case "renewalOnly":
        setRenewalOnly(value as boolean);
        break;
      case "optimizeTogether":
        setOptimizeTogether(value as boolean);
        break;
      case "splitAllowed":
        setSplitAllowed(value as boolean);
        break;
      case "deductibleIncreases":
        setDeductibleIncreases(value as boolean);
        break;
      case "coverage":
        setCoverage(value as boolean);
        break;
      case "approval":
        setApproval(value as boolean);
        break;
    }
  };

  const renderStep = () => {
    if (current.type === "number") {
      return (
        <Card>
          <Field
            label="Minimum savings per year"
            keyboardType="numeric"
            value={minSavings}
            onChangeText={setMinSavings}
            prefix="C$"
            autoFocus
          />
        </Card>
      );
    }

    if (current.type === "toggle") {
      const choose = (v: boolean) => {
        setValueForStep(current.key, v);
        goNext();
      };
      return (
        <Card>
          {current.description ? <Body muted>{current.description}</Body> : null}
          <View style={{ flexDirection: "row", gap: 12, marginTop: 24 }}>
            <PrimaryButton
              label="Yes"
              onPress={() => choose(true)}
              style={{ flex: 1 }}
              disabled={busy}
            />
            <SecondaryButton
              label="No"
              onPress={() => choose(false)}
              style={{ flex: 1 }}
              disabled={busy}
            />
          </View>
        </Card>
      );
    }

    return (
      <Card>
        {current.description ? <Body muted>{current.description}</Body> : null}
        <Row label="Answer" value={current.key === "coverage" ? "Always" : "Yes"} />
      </Card>
    );
  };

  return (
    <Screen>
      <Stack.Screen
        options={{ headerShown: true, headerBackTitle: "Back", title: "When to switch" }}
      />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Caption>{progressLabel}</Caption>
        <View style={{ height: 8 }} />
        <Title>{current.question}</Title>
        <View style={{ height: 16 }} />
        {renderStep()}
        {error ? <Body muted>{error}</Body> : null}
        {current.type !== "toggle" ? (
          <>
            <View style={{ height: 16 }} />
            <PrimaryButton label={isLast ? "Continue" : "Next"} onPress={goNext} loading={busy} />
          </>
        ) : null}
        {step > 0 ? (
          <>
            <View style={{ height: 12 }} />
            <SecondaryButton label="Back" onPress={goBack} disabled={busy} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
