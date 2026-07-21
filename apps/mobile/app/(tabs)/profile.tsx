import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as LocalAuthentication from "expo-local-authentication";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radii, spacing } from "@autopilot/design-tokens";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { formatEdmontonDate } from "@/lib/format";
import {
  Body,
  Caption,
  Card,
  Loading,
  PrimaryButton,
  Row,
  Screen,
  SecondaryButton,
  StatusPill,
  Subtitle,
} from "@/components/ui";
import { loadDangerousModeSetting, updateDangerousModeSetting } from "@/lib/document-processing";

const DANGEROUS_MODE_DISCLOSURE_VERSION = "dangerous-mode-v1";
const DANGEROUS_MODE_DISCLOSURE =
  "Your uploaded policies will be sent to an external AI service immediately. This may speed up setup, but the AI can make mistakes. You will review all information before anything is saved.";

export default function Profile() {
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [biometrics, setBiometrics] = useState(false);
  const [autopilot, setAutopilot] = useState(household?.autopilot_active ?? false);
  const [showDangerousConfirmation, setShowDangerousConfirmation] = useState(false);
  const [dangerousBusy, setDangerousBusy] = useState(false);
  const [dangerousError, setDangerousError] = useState<string | null>(null);

  const membershipStatusLabel: Record<string, string> = {
    active: "Active",
    past_due: "Payment required",
    cancelled: "Cancelled",
    trialing: "Trial",
    unpaid: "Unpaid",
  };

  const consentTypeLabel: Record<string, string> = {
    store_documents: "Policy document storage",
    share_for_quotation: "Sharing information for quotes",
    generate_recommendations: "Insurance recommendations",
    electronic_communications: "Account communications",
  };

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

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const signOut = async () => {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setSignOutError(error.message || "Sign out failed. Please try again.");
        return;
      }
      // The root auth gate listens for SIGNED_OUT and redirects to /welcome.
      // Clearing the local query cache here guarantees no stale data persists
      // across the transition.
      queryClient.clear();
    } finally {
      setSigningOut(false);
    }
  };

  const latestConsents = (consents ?? []).reduce(
    (acc, consent) => {
      const current = acc[consent.consent_type];
      if (!current || current.created_at < consent.created_at) {
        acc[consent.consent_type] = consent;
      }
      return acc;
    },
    {} as Record<string, NonNullable<typeof consents>[number]>,
  );

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
        error instanceof Error ? error.message : "Failed to turn off instant AI review",
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
      await updateDangerousModeSetting({
        householdId: household.id,
        enabled: true,
        explicitConfirmation: true,
        foreignProcessingAcknowledged: true,
        automatedProcessingAcknowledged: true,
        rawProcessingApproved: true,
        disclosureVersion: DANGEROUS_MODE_DISCLOSURE_VERSION,
      });
      setShowDangerousConfirmation(false);
      await refetchDangerousMode();
    } catch (error) {
      setDangerousError(
        error instanceof Error ? error.message : "Failed to turn on instant AI review",
      );
    } finally {
      setDangerousBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.md }}
        >
          <Body muted style={{ marginBottom: spacing.md }}>
            Manage your account, preferences, and permissions.
          </Body>

          <Card>
            <Subtitle>Identity</Subtitle>
            <Row label="Name" value={profile?.full_name ?? "—"} />
            <Row label="Email" value={profile?.email ?? "—"} />
            <Row label="Household" value={household?.name ?? "—"} />
          </Card>

          <Card>
            <Subtitle>Settings</Subtitle>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingVertical: spacing.sm,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <View style={{ flex: 1, marginRight: spacing.md }}>
                <Body>Monitor renewals</Body>
                <Caption>Find better options before renewal. You approve every switch.</Caption>
              </View>
              <Switch value={autopilot} onValueChange={toggleAutopilot} />
            </View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingVertical: spacing.sm,
              }}
            >
              <View style={{ flex: 1, marginRight: spacing.md }}>
                <Body>Biometric unlock</Body>
                <Caption>Approving a switch always requires reauthentication.</Caption>
              </View>
              <Switch value={biometrics} onValueChange={toggleBiometrics} />
            </View>
          </Card>

          <Card>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: spacing.sm,
              }}
            >
              <View style={{ flex: 1, marginRight: spacing.md }}>
                <Subtitle style={{ marginBottom: 0 }}>Document review</Subtitle>
                <Caption>
                  {dangerousMode?.enabled
                    ? "Instant AI review is on"
                    : "Standard review is recommended"}
                </Caption>
              </View>
              <Switch
                accessibilityLabel="Instant AI review"
                value={dangerousMode?.enabled ?? false}
                disabled={dangerousBusy}
                onValueChange={(enabled) => {
                  if (enabled) setShowDangerousConfirmation(true);
                  else void disableDangerousMode();
                }}
              />
            </View>
            <Caption>{DANGEROUS_MODE_DISCLOSURE}</Caption>
            <Modal
              animationType="fade"
              transparent
              visible={showDangerousConfirmation && !(dangerousMode?.enabled ?? false)}
              onRequestClose={() => {
                setShowDangerousConfirmation(false);
                setDangerousError(null);
              }}
            >
              <Pressable
                style={{
                  flex: 1,
                  backgroundColor: "rgba(0,0,0,0.4)",
                  justifyContent: "center",
                  padding: spacing.lg,
                }}
                onPress={() => {
                  setShowDangerousConfirmation(false);
                  setDangerousError(null);
                }}
              >
                <View
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: radii.lg,
                    padding: spacing.lg,
                    gap: spacing.sm,
                  }}
                >
                  <Subtitle style={{ marginBottom: spacing.xs }}>
                    Turn on instant AI review?
                  </Subtitle>
                  <Body muted style={{ marginBottom: spacing.sm }}>
                    {DANGEROUS_MODE_DISCLOSURE}
                  </Body>
                  {[
                    "I understand my policy documents will be processed by an external AI service.",
                    "I understand processing may occur outside Canada.",
                    "I understand AI-generated information may be incorrect.",
                    "I agree to review the results before they are saved.",
                  ].map((point) => (
                    <View key={point} style={{ flexDirection: "row", paddingVertical: spacing.xs }}>
                      <Body style={{ marginRight: spacing.sm }}>•</Body>
                      <Body style={{ flex: 1 }}>{point}</Body>
                    </View>
                  ))}
                  {dangerousError ? (
                    <Body style={{ color: colors.danger, marginTop: spacing.sm }}>
                      {dangerousError}
                    </Body>
                  ) : null}
                  <View
                    style={{
                      flexDirection: "column",
                      gap: spacing.sm,
                      marginTop: spacing.md,
                      width: "100%",
                    }}
                  >
                    <PrimaryButton
                      label="Turn on instant AI review"
                      onPress={enableDangerousMode}
                      loading={dangerousBusy}
                      style={{ width: "100%" }}
                    />
                    <SecondaryButton
                      label="Cancel"
                      onPress={() => {
                        setShowDangerousConfirmation(false);
                        setDangerousError(null);
                      }}
                      disabled={dangerousBusy}
                      style={{ width: "100%" }}
                    />
                  </View>
                </View>
              </Pressable>
            </Modal>
            {dangerousError && !showDangerousConfirmation ? (
              <Body muted style={{ marginTop: spacing.sm }}>
                {dangerousError}
              </Body>
            ) : null}
          </Card>

          <Card>
            <Subtitle>Membership</Subtitle>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: spacing.sm,
              }}
            >
              <Body>Status</Body>
              <StatusPill
                label={
                  membershipStatusLabel[subscription?.status ?? ""] ?? subscription?.status ?? "—"
                }
                tooltip="Your current subscription status."
              />
            </View>
            <Row label="Renews" value={formatEdmontonDate(subscription?.current_period_end)} />
          </Card>

          <Card>
            <Subtitle>Privacy and permissions</Subtitle>
            {Object.values(latestConsents).map((c) => (
              <View
                key={c.consent_type}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingVertical: spacing.sm,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Body style={{ flex: 1, marginRight: spacing.sm }}>
                  {consentTypeLabel[c.consent_type] ?? c.consent_type}
                </Body>
                <View style={{ alignItems: "flex-end" }}>
                  <StatusPill
                    label={c.granted ? "Granted" : "Withdrawn"}
                    tone={c.granted ? "accent" : "neutral"}
                    tooltip={
                      c.granted
                        ? `You have granted permission for ${consentTypeLabel[c.consent_type] ?? c.consent_type}.`
                        : `Permission for ${consentTypeLabel[c.consent_type] ?? c.consent_type} is withdrawn.`
                    }
                  />
                  <Caption>{formatEdmontonDate(c.created_at)}</Caption>
                </View>
              </View>
            ))}
          </Card>

          <SecondaryButton
            label="Sign out"
            onPress={signOut}
            loading={signingOut}
            testID="sign-out"
          />
          {signOutError ? (
            <Body style={{ color: colors.danger, marginTop: spacing.sm }}>{signOutError}</Body>
          ) : null}
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
