import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { Body, Card, Loading, PrimaryButton, Screen, Title } from "@/components/ui";

const consentItems = [
  { type: "document_storage", label: "Store my insurance documents securely" },
  { type: "quotation_sharing", label: "Share my information with insurers for quotations" },
  { type: "recommendations", label: "Receive optimization recommendations" },
  { type: "electronic_communications", label: "Receive electronic communications" },
] as const;

export default function Consents() {
  const { data: household, isLoading } = useHousehold();
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading || !household) return <Loading />;

  const allGranted = consentItems.every((c) => granted[c.type]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const rows = consentItems.map((c) => ({
      profile_id: userData.user?.id,
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

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Title>Your consent</Title>
        <Body muted>Each consent is recorded separately with a timestamp and disclosure version.</Body>
        <View style={{ height: 16 }} />
        <Card>
          {consentItems.map((c) => (
            <View
              key={c.type}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingVertical: 8,
              }}
            >
              <View style={{ flex: 1, marginRight: 12 }}>
                <Body>{c.label}</Body>
              </View>
              <Switch
                value={granted[c.type] ?? false}
                onValueChange={(v) => setGranted((g) => ({ ...g, [c.type]: v }))}
              />
            </View>
          ))}
        </Card>
        {error ? <Body muted>{error}</Body> : null}
        <PrimaryButton label="Agree and continue" onPress={save} loading={busy} disabled={!allGranted} />
      </ScrollView>
    </Screen>
  );
}
