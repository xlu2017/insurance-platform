import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { pickDocument, pickImage, uploadPolicyDocument } from "@/lib/upload";
import { Body, Caption, Card, Loading, PrimaryButton, Screen, SecondaryButton, Title } from "@/components/ui";

export default function OnboardingDocuments() {
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading || !household) return <Loading />;

  const upload = async (source: "document" | "camera" | "library") => {
    setBusy(true);
    setError(null);
    try {
      const file =
        source === "document" ? await pickDocument() : await pickImage(source === "camera");
      if (file) {
        await uploadPolicyDocument(household.id, "current_policy", file);
        setUploaded((u) => [...u, file.name]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    const { data: existingCase } = await supabase
      .from("optimization_cases")
      .select("id")
      .eq("household_id", household.id)
      .limit(1)
      .maybeSingle();
    if (!existingCase) {
      const { data: created } = await supabase
        .from("optimization_cases")
        .insert({ household_id: household.id, state: "awaiting_documents" })
        .select("id")
        .single();
      if (created) {
        await supabase
          .from("optimization_cases")
          .update({ state: "extracting_information" })
          .eq("id", created.id);
      }
    }
    await supabase
      .from("households")
      .update({ onboarding_step: "mandate" })
      .eq("id", household.id);
    queryClient.invalidateQueries({ queryKey: ["household"] });
    setBusy(false);
    router.push("/onboarding/mandate");
  };

  return (
    <Screen>
      <Title>Upload your current policies</Title>
      <Body muted>
        Add your auto and property policy documents. Our operations team extracts the details — no
        typing required.
      </Body>
      <View style={{ height: 16 }} />
      <SecondaryButton label="Upload a PDF" onPress={() => upload("document")} disabled={busy} />
      <View style={{ height: 8 }} />
      <SecondaryButton label="Take a photo" onPress={() => upload("camera")} disabled={busy} />
      <View style={{ height: 8 }} />
      <SecondaryButton label="Choose from library" onPress={() => upload("library")} disabled={busy} />
      <View style={{ height: 16 }} />
      {uploaded.length > 0 ? (
        <Card>
          {uploaded.map((name) => (
            <Caption key={name}>Uploaded: {name}</Caption>
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
