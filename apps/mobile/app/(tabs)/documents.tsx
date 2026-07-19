import { router } from "expo-router";
import { useState } from "react";
import { Alert, Linking, Platform, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { documentCategories, type DocumentCategory } from "@autopilot/schemas";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import {
  deletePolicyDocument,
  pickDocument,
  pickImage,
  uploadPolicyDocument,
  type PickedFile,
} from "@/lib/upload";
import { formatEdmontonDate } from "@/lib/format";
import {
  Body,
  Caption,
  Card,
  Loading,
  PrimaryButton,
  Screen,
  SecondaryButton,
  Select,
  StatusPill,
  Subtitle,
  Title,
} from "@/components/ui";

const categoryLabels: Record<DocumentCategory, string> = {
  current_auto_policy: "Current auto policy",
  current_property_policy: "Current property policy",
  renewal_notice: "Renewal notice",
  competing_quote: "Competing quote",
  proof_of_insurance: "Proof of insurance",
  signed_authorization: "Signed authorization",
  cancellation_confirmation: "Cancellation confirmation",
  other: "Other",
};

const categoryOptions = documentCategories.map((value) => ({
  value,
  label: categoryLabels[value],
}));

interface DocumentRow {
  id: string;
  category: string;
  status: string;
  storage_path: string;
  file_name: string;
  created_at: string;
}

export default function Documents() {
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<DocumentCategory>("current_auto_policy");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: documents } = useQuery({
    queryKey: ["documents", household?.id],
    enabled: !!household,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("policy_documents")
        .select("id, category, status, storage_path, file_name, created_at")
        .eq("household_id", household!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DocumentRow[];
    },
  });

  if (isLoading) return <Loading />;
  if (!household) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Title>Finish setting up</Title>
        <Body muted>Create your household to upload and view policy documents.</Body>
        <View style={{ height: 16 }} />
        <PrimaryButton
          label="Continue setup"
          onPress={() => router.push("/onboarding/household")}
        />
      </Screen>
    );
  }

  const upload = async (source: "document" | "camera" | "library") => {
    setBusy(true);
    setError(null);
    try {
      const file: PickedFile | null =
        source === "document" ? await pickDocument() : await pickImage(source === "camera");
      if (file) {
        await uploadPolicyDocument(household.id, category, file);
        queryClient.invalidateQueries({ queryKey: ["documents", household.id] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const download = async (doc: DocumentRow) => {
    const { data } = await supabase.storage
      .from("policy-documents")
      .createSignedUrl(doc.storage_path, 60);
    if (data?.signedUrl) await Linking.openURL(data.signedUrl);
  };

  const removeDocument = async (doc: DocumentRow) => {
    setBusy(true);
    setError(null);
    try {
      await deletePolicyDocument(doc.id);
      await queryClient.invalidateQueries({ queryKey: ["documents", household.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = (doc: DocumentRow) => {
    const message = `${doc.file_name} will be removed from your household documents.`;
    if (Platform.OS === "web") {
      if (window.confirm(`Remove document?\n\n${message}`)) void removeDocument(doc);
      return;
    }

    Alert.alert("Remove document?", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => void removeDocument(doc),
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Documents</Title>
          <Card>
            <Subtitle>Upload</Subtitle>
            <Select
              label="Category"
              options={categoryOptions}
              value={category}
              onValueChange={(value) => setCategory(value)}
            />
            <View style={{ gap: 8 }}>
              <SecondaryButton
                label="Upload a PDF"
                onPress={() => upload("document")}
                disabled={busy}
              />
              <SecondaryButton
                label="Take a photo"
                onPress={() => upload("camera")}
                disabled={busy}
              />
              <SecondaryButton
                label="Choose from library"
                onPress={() => upload("library")}
                disabled={busy}
              />
            </View>
            {error ? <Body muted>{error}</Body> : null}
          </Card>
          {(documents ?? []).map((doc) => (
            <Card key={doc.id}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Body>{doc.file_name}</Body>
                  <Caption>
                    {categoryLabels[doc.category as DocumentCategory] ?? doc.category} ·{" "}
                    {formatEdmontonDate(doc.created_at)}
                  </Caption>
                </View>
                <StatusPill
                  label={doc.status}
                  tone={doc.status === "extracted" ? "accent" : "neutral"}
                />
              </View>
              <View style={{ height: 8 }} />
              <SecondaryButton label="View (secure link)" onPress={() => download(doc)} />
              <View style={{ height: 8 }} />
              <SecondaryButton
                label="Remove document"
                onPress={() => remove(doc)}
                disabled={busy}
              />
            </Card>
          ))}
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
