import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Switch, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as LocalAuthentication from "expo-local-authentication";
import { SafeAreaView } from "react-native-safe-area-context";
import { MVP_DISCLAIMER } from "@autopilot/design-tokens";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { formatEdmontonDate } from "@/lib/format";
import {
  Body,
  Caption,
  Card,
  Loading,
  Row,
  Screen,
  SecondaryButton,
  Subtitle,
  Title,
} from "@/components/ui";

export default function Profile() {
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [biometrics, setBiometrics] = useState(false);
  const [autopilot, setAutopilot] = useState(household?.autopilot_active ?? false);

  useEffect(() => {
    if (household) setAutopilot(household.autopilot_active);
  }, [household?.autopilot_active]);

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", userData.user.id)
        .single();
      return { email: userData.user.email, ...data };
    },
  });

  const { data: subscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return null;
      const { data } = await supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("profile_id", userData.user.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: consents } = useQuery({
    queryKey: ["consents"],
    queryFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return [];
      const { data } = await supabase
        .from("consents")
        .select("consent_type, granted, disclosure_version, created_at")
        .eq("profile_id", userData.user.id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  if (isLoading) return <Loading />;

  const toggleBiometrics = async (value: boolean) => {
    if (value) {
      const available = await LocalAuthentication.hasHardwareAsync();
      if (!available) return;
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Enable biometric unlock",
      });
      if (!result.success) return;
    }
    setBiometrics(value);
  };

  const toggleAutopilot = async (value: boolean) => {
    if (!household) return;
    setAutopilot(value);
    const { error } = await supabase
      .from("households")
      .update({ autopilot_active: value })
      .eq("id", household.id);
    if (error) {
      setAutopilot(!value);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["household"] });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/welcome");
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Profile</Title>
          <Card>
            <Subtitle>Identity</Subtitle>
            <Row label="Name" value={profile?.full_name ?? "—"} />
            <Row label="Email" value={profile?.email ?? "—"} />
            <Row label="Household" value={household?.name ?? "—"} />
          </Card>
          <Card>
            <Subtitle>Autopilot</Subtitle>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Body>Monitor renewals and switch automatically</Body>
              <Switch value={autopilot} onValueChange={toggleAutopilot} />
            </View>
            <Caption>When paused, Autopilot will not open new renewal cases.</Caption>
          </Card>
          <Card>
            <Subtitle>Security</Subtitle>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Body>Biometric unlock</Body>
              <Switch value={biometrics} onValueChange={toggleBiometrics} />
            </View>
            <Caption>Approving a switch always requires reauthentication.</Caption>
          </Card>
          <Card>
            <Subtitle>Membership</Subtitle>
            <Row label="Status" value={subscription?.status ?? "—"} />
            <Row label="Renews" value={formatEdmontonDate(subscription?.current_period_end)} />
          </Card>
          <Card>
            <Subtitle>Consent history</Subtitle>
            {(consents ?? []).map((c, i) => (
              <Row
                key={i}
                label={`${c.consent_type} (${c.disclosure_version})`}
                value={`${c.granted ? "Granted" : "Withdrawn"} ${formatEdmontonDate(c.created_at)}`}
              />
            ))}
          </Card>
          <Card>
            <Caption>{MVP_DISCLAIMER}</Caption>
          </Card>
          <SecondaryButton label="Sign out" onPress={signOut} testID="sign-out" />
          <View style={{ height: 24 }} />
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
