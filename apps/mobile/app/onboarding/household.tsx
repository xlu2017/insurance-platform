import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { supabase } from "@/lib/supabase";
import { Body, Field, PrimaryButton, Screen, Title } from "@/components/ui";

export default function CreateHousehold() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (name.trim().length < 2) {
      setError("Enter an account name");
      return;
    }
    setLoading(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { data: household, error } = await supabase
      .from("households")
      .insert({
        owner_profile_id: userData.user.id,
        name: name.trim(),
        province: "AB",
        onboarding_step: "membership",
      })
      .select("id")
      .single();
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }
    await supabase.from("household_members").insert({
      household_id: household.id,
      profile_id: userData.user.id,
      member_role: "owner",
    });
    await supabase.from("audit_events").insert({
      action: "household_created",
      entity_type: "household",
      entity_id: household.id,
      household_id: household.id,
      after_summary: { province: "AB" },
    });
    setLoading(false);
    router.push("/onboarding/membership");
  };

  return (
    <Screen style={{ justifyContent: "center" }}>
      <Stack.Screen options={{ headerShown: true, headerBackTitle: "Back", title: "Account" }} />
      <Title>Set up your insurance account</Title>
      <Body muted>We currently serve Alberta households.</Body>
      <Body muted style={{ marginTop: 8 }}>
        This groups the people, vehicles and properties you insure together.
      </Body>
      <View style={{ height: 16 }} />
      <Field label="Account name" placeholder="My household" value={name} onChangeText={setName} />
      <Field label="Province" value="Alberta" editable={false} />
      {error ? <Body muted>{error}</Body> : null}
      <View style={{ height: 12 }} />
      <PrimaryButton label="Continue" onPress={save} loading={loading} />
    </Screen>
  );
}
