import { router, Stack } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import {
  Body,
  Caption,
  Card,
  Loading,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Title,
} from "@/components/ui";
import type { ConsentType } from "@autopilot/schemas";

const consentItems: { type: ConsentType; label: string; description: string }[] = [
  {
    type: "store_documents",
    label: "Store your policy documents",
    description: "Required to organize and review your insurance.",
  },
  {
    type: "share_for_quotation",
    label: "Use your information to request quotes",
    description:
      "We share only the information required by insurers when you ask us to shop your coverage.",
  },
  {
    type: "generate_recommendations",
    label: "Prepare insurance recommendations",
    description: "We compare eligible quotes against your saved coverage rules.",
  },
  {
    type: "electronic_communications",
    label: "Send account and renewal messages",
    description: "Required for policy questions, recommendations and switch updates.",
  },
];

export default function Consents() {
  const { data: household, isLoading } = useHousehold();
  const [granted, setGranted] = useState<Record<ConsentType, boolean>>({
    store_documents: false,
    share_for_quotation: false,
    generate_recommendations: false,
    electronic_communications: false,
  });
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!household) return;
    supabase.auth.getUser().then(({ data: userData }) => {
      const profileId = userData.user?.id;
      if (!profileId) return;
      supabase
        .from("consents")
        .select("consent_type, granted")
        .eq("profile_id", profileId)
        .eq("household_id", household.id)
        .then(({ data }) => {
          if (!data) return;
          const next: Record<ConsentType, boolean> = { ...granted };
          for (const row of data) {
            if (row.consent_type in next) {
              next[row.consent_type as ConsentType] = row.granted ?? false;
            }
          }
          setGranted(next);
        });
    });
  }, [household]);

  const current = consentItems[step];
  const isLast = step === consentItems.length - 1;

  const progressLabel = useMemo(() => `Permission ${step + 1} of ${consentItems.length}`, [step]);

  if (isLoading || !household) return <Loading />;
  if (!current) return <Loading />;

  const choose = (value: boolean) => {
    setGranted((g) => ({ ...g, [current.type]: value }));
    if (!value) {
      setError("This permission is required to continue.");
      return;
    }
    setError(null);
    if (isLast) {
      save();
    } else {
      setStep((s) => s + 1);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const profileId = userData.user?.id;
    if (!profileId) {
      setBusy(false);
      setError("Not signed in");
      return;
    }

    await supabase
      .from("consents")
      .delete()
      .eq("profile_id", profileId)
      .eq("household_id", household.id);

    const rows = consentItems.map((c) => ({
      profile_id: profileId,
      household_id: household.id,
      consent_type: c.type,
      granted: true,
      disclosure_version: "v1",
    }));
    const { error: consentError } = await supabase.from("consents").insert(rows);
    if (consentError) {
      setBusy(false);
      setError(consentError.message);
      return;
    }

    await supabase
      .from("households")
      .update({ onboarding_step: "activate" })
      .eq("id", household.id);
    setBusy(false);
    router.push("/onboarding/activate");
  };

  const goBack = () => {
    setStep((s) => Math.max(0, s - 1));
    setError(null);
  };

  return (
    <Screen>
      <Stack.Screen
        options={{ headerShown: true, headerBackTitle: "Back", title: "Permissions" }}
      />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Caption>{progressLabel}</Caption>
        <View style={{ height: 8 }} />
        <Title>{current.label}</Title>
        <View style={{ height: 8 }} />
        <Body muted>{current.description}</Body>
        <View style={{ height: 24 }} />
        <Card>
          <View style={{ flexDirection: "row", gap: 12 }}>
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
        {error ? <Body muted>{error}</Body> : null}
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
