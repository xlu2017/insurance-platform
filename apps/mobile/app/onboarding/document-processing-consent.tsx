import { router, Stack } from "expo-router";
import * as Linking from "expo-linking";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  DANGEROUS_MODE_DISCLOSURE_VERSION,
  getPrivacyNoticeUrl,
  getProcessorContractVersion,
} from "@/lib/document-processing-config";
import { useHousehold } from "@/lib/household";
import { updateDangerousModeSetting } from "@/lib/document-processing";
import { supabase } from "@/lib/supabase";
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

export default function DocumentProcessingConsent() {
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = useMemo(() => {
    const privacyNoticeUrl = getPrivacyNoticeUrl();
    const processorContractVersion = getProcessorContractVersion();
    return { privacyNoticeUrl, processorContractVersion };
  }, []);

  const isConfigured = Boolean(config.privacyNoticeUrl && config.processorContractVersion);

  if (isLoading || !household) return <Loading />;

  useEffect(() => {
    if (household.onboarding_step === "documents") {
      router.replace("/onboarding/documents");
    }
  }, [household.onboarding_step]);

  const advance = () => {
    router.push("/onboarding/documents");
  };

  const persistOnboardingStep = async (step: string) => {
    const { error: updateError } = await supabase
      .from("households")
      .update({ onboarding_step: step })
      .eq("id", household.id);
    if (updateError) {
      throw new Error("Could not save onboarding progress");
    }
    await queryClient.invalidateQueries({ queryKey: ["household"] });
  };

  const openPrivacyNotice = () => {
    if (config.privacyNoticeUrl) {
      Linking.openURL(config.privacyNoticeUrl);
    }
  };

  const setMode = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await updateDangerousModeSetting({
        householdId: household.id,
        enabled,
        explicitConfirmation: enabled,
        foreignProcessingAcknowledged: enabled,
        automatedProcessingAcknowledged: enabled,
        rawProcessingApproved: enabled,
        disclosureVersion: DANGEROUS_MODE_DISCLOSURE_VERSION,
      });
      await persistOnboardingStep("documents");
      advance();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update processing preference");
    } finally {
      setBusy(false);
    }
  };

  const allowProcessing = () => {
    if (!isConfigured) return;
    setMode(true);
  };
  const uploadWithoutAi = () => setMode(false);

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
            onPress={openPrivacyNotice}
            disabled={!config.privacyNoticeUrl}
          />
        </Card>

        {!isConfigured ? (
          <Body style={{ color: "#d00", marginTop: spacing.sm }}>
            Automatic document processing is not configured. You can still upload documents for manual review.
          </Body>
        ) : null}

        {error ? (
          <Body style={{ color: "#d00", marginTop: spacing.sm }}>{error}</Body>
        ) : null}

        <View style={{ height: 24 }} />
        <PrimaryButton
          label="Allow processing"
          onPress={allowProcessing}
          loading={busy}
          disabled={busy || !isConfigured}
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
