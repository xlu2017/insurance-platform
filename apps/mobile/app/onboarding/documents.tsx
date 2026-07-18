import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { pickDocument, pickImage, uploadPolicyDocument, type PickedFile } from "@/lib/upload";
import { invokeEdgeFunction } from "@/lib/edge-functions";
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

interface UploadedFile {
  name: string;
  category: string;
  documentId: string;
}

export default function OnboardingDocuments() {
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading || !household) return <Loading />;

  const upload = async (
    category: "current_auto_policy" | "current_property_policy",
    source: "document" | "camera" | "library",
  ) => {
    setBusy(true);
    setError(null);
    try {
      const file: PickedFile | null =
        source === "document" ? await pickDocument() : await pickImage(source === "camera");
      if (file) {
        const result = await uploadPolicyDocument(household.id, category, file);
        setUploaded((u) => [...u, { name: file.name, category, documentId: result.id }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      const documentIds = uploaded.map((u) => u.documentId);
      if (documentIds.length > 0) {
        const { data } = await invokeEdgeFunction<{
          session_id: string;
          candidates: unknown[];
        }>("extract-policy-entities", {
          household_id: household.id,
          policy_document_ids: documentIds,
          session_id: sessionId ?? undefined,
        });
        if (data?.session_id) {
          setSessionId(data.session_id);
        }
      }

      const { data: existingCase } = await supabase
        .from("optimization_cases")
        .select("id")
        .eq("household_id", household.id)
        .not("state", "in", "(completed,retained_incumbent,cancelled)")
        .limit(1)
        .maybeSingle();
      if (!existingCase) {
        const { data: created } = await supabase
          .from("optimization_cases")
          .insert({ household_id: household.id, state: "extracting_information" })
          .select("id")
          .single();
        if (created) {
          await supabase
            .from("optimization_cases")
            .update({ state: "extracting_information" })
            .eq("id", created.id);
        }
      } else {
        await supabase
          .from("optimization_cases")
          .update({ state: "extracting_information" })
          .eq("id", existingCase.id);
      }
      await supabase
        .from("households")
        .update({ onboarding_step: "mandate" })
        .eq("id", household.id);
      queryClient.invalidateQueries({ queryKey: ["household"] });
      queryClient.invalidateQueries({ queryKey: ["extraction-session"] });
      router.push("/onboarding/review-entities");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen
        options={{ headerShown: true, headerBackTitle: "Back", title: "Upload policies" }}
      />
      <Title>Upload your current policies</Title>
      <Body muted>
        Add your auto and property policy documents. Our operations team extracts the details — no
        typing required.
      </Body>
      <View style={{ height: 16 }} />

      <Card>
        <Caption>Auto policy</Caption>
        <View style={{ gap: 8, marginTop: 8 }}>
          <SecondaryButton
            label="Upload a PDF"
            onPress={() => upload("current_auto_policy", "document")}
            disabled={busy}
          />
          <SecondaryButton
            label="Take a photo"
            onPress={() => upload("current_auto_policy", "camera")}
            disabled={busy}
          />
          <SecondaryButton
            label="Choose from library"
            onPress={() => upload("current_auto_policy", "library")}
            disabled={busy}
          />
        </View>
      </Card>

      <Card>
        <Caption>Property policy</Caption>
        <View style={{ gap: 8, marginTop: 8 }}>
          <SecondaryButton
            label="Upload a PDF"
            onPress={() => upload("current_property_policy", "document")}
            disabled={busy}
          />
          <SecondaryButton
            label="Take a photo"
            onPress={() => upload("current_property_policy", "camera")}
            disabled={busy}
          />
          <SecondaryButton
            label="Choose from library"
            onPress={() => upload("current_property_policy", "library")}
            disabled={busy}
          />
        </View>
      </Card>

      {uploaded.length > 0 ? (
        <Card>
          {uploaded.map((f, i) => (
            <Caption key={`${f.name}-${i}`}>
              {f.category === "current_auto_policy" ? "Auto" : "Property"}: {f.name}
            </Caption>
          ))}
        </Card>
      ) : null}
      {error ? <Body muted>{error}</Body> : null}
      <PrimaryButton
        label={uploaded.length > 0 ? "Continue" : "Skip for now"}
        onPress={finish}
        loading={busy}
      />
    </Screen>
  );
}
