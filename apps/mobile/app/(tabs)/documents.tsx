import { useState } from "react";
import { Linking, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { pickDocument, pickImage, uploadPolicyDocument } from "@/lib/upload";
import { formatEdmontonDate } from "@/lib/format";
import {
  Body,
  Caption,
  Card,
  Loading,
  Screen,
  SecondaryButton,
  StatusPill,
  Subtitle,
  Title,
} from "@/components/ui";

const categories = [
  { value: "current_policy", label: "Current policy" },
  { value: "renewal_notice", label: "Renewal notice" },
  { value: "competing_quote", label: "Competing quote" },
  { value: "proof_of_insurance", label: "Proof of insurance" },
  { value: "authorization", label: "Authorization" },
  { value: "cancellation_confirmation", label: "Cancellation confirmation" },
  { value: "other", label: "Other" },
];

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
  const [category, setCategory] = useState("current_policy");
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

  if (isLoading || !household) return <Loading />;

  const upload = async (source: "document" | "camera" | "library") => {
    setBusy(true);
    setError(null);
    try {
      const file =
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

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Documents</Title>
          <Card>
            <Subtitle>Upload</Subtitle>
            <Caption>Category</Caption>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 }}>
              {categories.map((c) => (
                <View key={c.value} style={{ opacity: category === c.value ? 1 : 0.55 }}>
                  <SecondaryButton label={c.label} onPress={() => setCategory(c.value)} />
                </View>
              ))}
            </View>
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
                    {categories.find((c) => c.value === doc.category)?.label ?? doc.category} ·{" "}
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
            </Card>
          ))}
        </ScrollView>
      </Screen>
    </SafeAreaView>
  );
}
