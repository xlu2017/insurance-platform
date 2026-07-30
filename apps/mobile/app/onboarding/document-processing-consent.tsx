import { router, Stack } from "expo-router";
import { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { recordDocumentProcessingConsent } from "@/lib/document-processing";
import { spacing } from "@autopilot/design-tokens";
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

const PRIVACY_URL = "https://example.com/privacy"; // Replace with real privacy notice URL.

export default function DocumentProcessingConsent() {
  const { data: household, isLoading } = useHousehold();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || !household) return <Loading />;

  const advance = async (mode: "safe" | "dangerous") => {
    setError(null);
    await supabase.from("households").update({ onboarding_step: "documents" }).eq("id", household.id);
    router.push({ pathname: "/onboarding/documents", params: { mode } });
  };

  const allowProcessing = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const profileId = userData.user?.id;
      if (!profileId) {
        setError("Not signed in");
        return;
      }
      await recordDocumentProcessingConsent({
        householdId: household.id,
        profileId,
        purpose: "insurance_policy_extraction",
        privacyNoticeVersion: "1.0.0",
        processorContractVersion: "1.0.0",
        foreignProcessingAcknowledged: true,
        automatedProcessingAcknowledged: true,
        rawProcessingApproved: true,
      });
      await advance("dangerous");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not record consent");
    } finally {
      setBusy(false);
    }
  };

  const uploadWithoutAi = async () => {
    setBusy(true);
    setError(null);
    try {
      await advance("safe");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen
        options={{ headerShown: true, headerBackTitle: "Back", title: "Document processing" }}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.md }}
      >
        <Title>Process your documents</Title>
        <View style={{ height: 8 }} />
        <Body muted>
          Before we analyze your policy documents, confirm how you want us to handle them.
        </Body>

        <View style={{ height: 24 }} />
        <Card>
          <Caption>What happens next</Caption>
          <View style={{ height: 12 }} />
          {[
            "The policy documents you upload will be analyzed to extract coverage details, assets, and insurers.",
            "An external AI provider may receive and process your documents.",
            "Processing may occur outside Canada.",
            "Documents are sent in a privacy-prepared form where possible; the provider may receive the original file when required.",
            "The purpose of processing is to extract policy information so we can compare coverage and prepare recommendations.",
          ].map((point) => (
            <View key={point} style={{ flexDirection: "row", paddingVertical: spacing.xs }}>
              <Body style={{ marginRight: spacing.sm }}>•</Body>
              <Body style={{ flex: 1 }}>{point}</Body>
            </View>
          ))}
          <View style={{ height: 12 }} />
          <SecondaryButton
            label="Read privacy notice"
            onPress={() => Linking.openURL(PRIVACY_URL)}
          />
        </Card>

        {error ? (
          <Body style={{ color: "#d00", marginTop: spacing.sm }}>{error}</Body>
        ) : null}

        <View style={{ height: 24 }} />
        <PrimaryButton
          label="Allow processing"
          onPress={allowProcessing}
          loading={busy}
          disabled={busy}
        />
        <View style={{ height: 12 }} />
        <SecondaryButton
          label="Upload without AI processing"
          onPress={uploadWithoutAi}
          disabled={busy}
        />
        <View style={{ height: 12 }} />
        <SecondaryButton
          label="Cancel"
          onPress={() => router.back()}
          disabled={busy}
        />
      </ScrollView>
    </Screen>
  );
}
