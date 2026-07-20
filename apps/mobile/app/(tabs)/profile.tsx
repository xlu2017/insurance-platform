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
  Field,
  Loading,
  PrimaryButton,
  Row,
  Screen,
  SecondaryButton,
  Subtitle,
  Title,
} from "@/components/ui";
import { loadDangerousModeSetting, updateDangerousModeSetting } from "@/lib/document-processing";

const DANGEROUS_MODE_DISCLOSURE_VERSION = "dangerous-mode-v1";
const DANGEROUS_MODE_DISCLOSURE =
  "Immediately send uploaded policy documents to an external AI provider for extraction. Documents may contain sensitive personal, financial, property and vehicle information. AI output may be incomplete or incorrect and must be reviewed before use.";

export default function Profile() {
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [biometrics, setBiometrics] = useState(false);
  const [autopilot, setAutopilot] = useState(household?.autopilot_active ?? false);
  const [showDangerousConfirmation, setShowDangerousConfirmation] = useState(false);
  const [dangerousPassword, setDangerousPassword] = useState("");
  const [dangerousBusy, setDangerousBusy] = useState(false);
  const [dangerousError, setDangerousError] = useState<string | null>(null);
  const [dangerousAcknowledgements, setDangerousAcknowledgements] = useState({
    explicit: false,
    foreign: false,
    automated: false,
    raw: false,
  });

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

  const { data: dangerousMode, refetch: refetchDangerousMode } = useQuery({
    queryKey: ["dangerous-mode", household?.id],
    enabled: !!household,
    queryFn: () => loadDangerousModeSetting(household!.id),
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
    if (value) {
      const { data, error } = await supabase.rpc("activate_autopilot", {
        p_household_id: household.id,
      });
      if (error || !data || (data as { success?: boolean }).success !== true) {
        setAutopilot(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("households")
        .update({ autopilot_active: false })
        .eq("id", household.id);
      if (error) {
        setAutopilot(true);
        return;
      }
    }
    queryClient.invalidateQueries({ queryKey: ["household"] });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/welcome");
  };

  const disableDangerousMode = async () => {
    if (!household) return;
    setDangerousBusy(true);
    setDangerousError(null);
    try {
      await updateDangerousModeSetting({
        householdId: household.id,
        enabled: false,
        explicitConfirmation: false,
        foreignProcessingAcknowledged: false,
        automatedProcessingAcknowledged: false,
        rawProcessingApproved: false,
        disclosureVersion: DANGEROUS_MODE_DISCLOSURE_VERSION,
      });
      setShowDangerousConfirmation(false);
      await refetchDangerousMode();
    } catch (error) {
      setDangerousError(
        error instanceof Error ? error.message : "Failed to disable Dangerous mode",
      );
    } finally {
      setDangerousBusy(false);
    }
  };

  const enableDangerousMode = async () => {
    if (!household) return;
    setDangerousBusy(true);
    setDangerousError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const email = userData.user?.email;
      if (!email || !dangerousPassword) {
        throw new Error("Enter your password to reauthenticate");
      }
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: dangerousPassword,
      });
      if (reauthError) throw new Error("Reauthentication failed");

      await updateDangerousModeSetting({
        householdId: household.id,
        enabled: true,
        explicitConfirmation: dangerousAcknowledgements.explicit,
        foreignProcessingAcknowledged: dangerousAcknowledgements.foreign,
        automatedProcessingAcknowledged: dangerousAcknowledgements.automated,
        rawProcessingApproved: dangerousAcknowledgements.raw,
        disclosureVersion: DANGEROUS_MODE_DISCLOSURE_VERSION,
      });
      setDangerousPassword("");
      setShowDangerousConfirmation(false);
      setDangerousAcknowledgements({
        explicit: false,
        foreign: false,
        automated: false,
        raw: false,
      });
      await refetchDangerousMode();
    } catch (error) {
      setDangerousError(error instanceof Error ? error.message : "Failed to enable Dangerous mode");
    } finally {
      setDangerousBusy(false);
    }
  };

  const allDangerousAcknowledged = Object.values(dangerousAcknowledgements).every(Boolean);

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
            <Subtitle>Experimental</Subtitle>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <View style={{ flex: 1, marginRight: 12 }}>
                <Body>Dangerous mode</Body>
                <Caption>Safe mode is the default.</Caption>
              </View>
              <Switch
                accessibilityLabel="Dangerous mode"
                value={dangerousMode?.enabled ?? false}
                disabled={dangerousBusy}
                onValueChange={(enabled) => {
                  if (enabled) setShowDangerousConfirmation(true);
                  else void disableDangerousMode();
                }}
              />
            </View>
            <Caption>{DANGEROUS_MODE_DISCLOSURE}</Caption>
            {showDangerousConfirmation && !(dangerousMode?.enabled ?? false) ? (
              <View style={{ marginTop: 12, gap: 10 }}>
                {[
                  ["explicit", "I explicitly confirm that I want to enable Dangerous mode."],
                  ["foreign", "I acknowledge that processing may occur outside Canada."],
                  ["automated", "I acknowledge automated document processing."],
                  ["raw", "I approve processing the original policy documents."],
                ].map(([key, label]) => (
                  <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Body style={{ flex: 1 }}>{label}</Body>
                    <Switch
                      accessibilityLabel={label}
                      value={
                        dangerousAcknowledgements[key as keyof typeof dangerousAcknowledgements]
                      }
                      onValueChange={(value) =>
                        setDangerousAcknowledgements((current) => ({
                          ...current,
                          [key as keyof typeof current]: value,
                        }))
                      }
                    />
                  </View>
                ))}
                <Field
                  label="Password for reauthentication"
                  secureTextEntry
                  value={dangerousPassword}
                  onChangeText={setDangerousPassword}
                />
                <PrimaryButton
                  label="Enable Dangerous mode"
                  onPress={enableDangerousMode}
                  loading={dangerousBusy}
                  disabled={!allDangerousAcknowledged || !dangerousPassword}
                />
                <SecondaryButton
                  label="Cancel"
                  onPress={() => setShowDangerousConfirmation(false)}
                  disabled={dangerousBusy}
                />
              </View>
            ) : null}
            {dangerousError ? <Body muted>{dangerousError}</Body> : null}
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
