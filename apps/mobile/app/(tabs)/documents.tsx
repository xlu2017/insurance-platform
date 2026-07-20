import { router } from "expo-router";
import { useState } from "react";
import { Alert, Linking, Platform, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { documentCategories, type DocumentCategory } from "@autopilot/schemas";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import {
  createClientRequestId,
  createDocumentBatch,
  documentItemStatusLabel,
  documentBatchStatusLabels,
  loadDocumentBatch,
  loadLatestDocumentBatch,
  retryDocumentBatch,
  submitDocumentBatch,
  type DocumentBatchSummary,
} from "@/lib/document-processing";
import {
  createClientItemId,
  deletePolicyDocument,
  pickDocuments,
  pickImages,
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

interface PendingDocument {
  clientItemId: string;
  file: PickedFile;
  category: DocumentCategory;
  status: "pending" | "uploading" | "uploaded" | "deduplicated" | "failed";
  error?: string;
}

export default function Documents() {
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<DocumentCategory>("current_auto_policy");
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [batch, setBatch] = useState<DocumentBatchSummary | null>(null);
  const [batchSubmitted, setBatchSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: latestBatch } = useQuery({
    queryKey: ["latest-document-processing-batch", household?.id],
    enabled: !!household && !batch,
    queryFn: () => loadLatestDocumentBatch(household!.id),
  });
  const visibleBatch = batch ?? latestBatch ?? null;

  const { data: documents } = useQuery({
    queryKey: ["documents", household?.id],
    enabled: !!household,
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("policy_documents")
        .select("id, category, status, storage_path, file_name, created_at")
        .eq("household_id", household!.id)
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;
      return data as DocumentRow[];
    },
  });

  const { data: currentBatch } = useQuery({
    queryKey: ["document-processing-batch", household?.id, visibleBatch?.id],
    enabled: !!household && !!visibleBatch,
    queryFn: () => loadDocumentBatch(household!.id, visibleBatch!.id),
    initialData: visibleBatch ?? undefined,
    refetchInterval: (query) => {
      if (query.state.data?.is_terminal) return false;
      return 2_000;
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

  const appendFiles = (files: PickedFile[]) => {
    setPending((current) => [
      ...current,
      ...files.map((file) => ({
        clientItemId: createClientItemId(),
        file,
        category,
        status: "pending" as const,
      })),
    ]);
  };

  const choose = async (source: "document" | "camera" | "library") => {
    setError(null);
    try {
      appendFiles(
        source === "document" ? await pickDocuments() : await pickImages(source === "camera"),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not select files");
    }
  };

  const updatePending = (clientItemId: string, patch: Partial<PendingDocument>) => {
    setPending((current) =>
      current.map((item) => (item.clientItemId === clientItemId ? { ...item, ...patch } : item)),
    );
  };

  const uploadAndAnalyze = async () => {
    if (pending.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const created =
        batch ??
        (await createDocumentBatch(household.id, createClientRequestId("mobile-documents")));
      if (!batch) setBatch(created);
      for (const item of pending.filter(
        (candidate) => candidate.status === "pending" || candidate.status === "failed",
      )) {
        updatePending(item.clientItemId, { status: "uploading", error: undefined });
        try {
          const result = await uploadPolicyDocument(
            household.id,
            item.category,
            item.file,
            created.id,
            item.clientItemId,
          );
          updatePending(item.clientItemId, {
            status: result.deduplicated ? "deduplicated" : "uploaded",
          });
        } catch (caught) {
          updatePending(item.clientItemId, {
            status: "failed",
            error: caught instanceof Error ? caught.message : "Upload failed",
          });
          throw caught;
        }
      }
      setBatch(await submitDocumentBatch(household.id, created.id));
      setBatchSubmitted(true);
      await queryClient.invalidateQueries({ queryKey: ["documents", household.id] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed");
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Remove failed");
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
      { text: "Remove", style: "destructive", onPress: () => void removeDocument(doc) },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Title>Documents</Title>
          <Card>
            <Subtitle>Pending batch</Subtitle>
            <Select
              label="Category for files you add next"
              options={categoryOptions}
              value={category}
              onValueChange={setCategory}
            />
            <View style={{ gap: 8 }}>
              <SecondaryButton
                label="Add PDF or image files"
                onPress={() => choose("document")}
                disabled={busy || !!batch}
              />
              <SecondaryButton
                label="Take a photo"
                onPress={() => choose("camera")}
                disabled={busy || !!batch}
              />
              <SecondaryButton
                label="Add photos from library"
                onPress={() => choose("library")}
                disabled={busy || !!batch}
              />
            </View>
            {pending.map((item) => (
              <View key={item.clientItemId} style={{ marginTop: 12 }}>
                <Body>{item.file.name}</Body>
                <Caption>
                  {categoryLabels[item.category]} ·{" "}
                  {documentItemStatusLabel(item.status, currentBatch)}
                </Caption>
                {item.error ? <Caption>{item.error}</Caption> : null}
                {item.status === "pending" ? (
                  <SecondaryButton
                    label="Remove"
                    onPress={() =>
                      setPending((current) =>
                        current.filter((candidate) => candidate.clientItemId !== item.clientItemId),
                      )
                    }
                    disabled={busy}
                  />
                ) : null}
              </View>
            ))}
            {!batchSubmitted ? (
              <PrimaryButton
                label={batch ? "Retry upload and analyze" : "Upload and analyze"}
                onPress={uploadAndAnalyze}
                loading={busy}
                disabled={pending.length === 0}
              />
            ) : null}
            {error ? <Body muted>{error}</Body> : null}
          </Card>

          {currentBatch ? (
            <Card>
              <StatusPill
                label={documentBatchStatusLabels[currentBatch.status]}
                tone={currentBatch.status === "ready_for_review" ? "accent" : "neutral"}
              />
              <Caption>
                {currentBatch.document_count} selected · {currentBatch.unique_document_count} unique
                · {currentBatch.deduplicated_count} deduplicated
              </Caption>
              {!currentBatch.automatic_processing && currentBatch.is_terminal ? (
                <Body muted>Your documents are being reviewed.</Body>
              ) : null}
              {currentBatch.status === "ready_for_review" ? (
                <PrimaryButton
                  label="Review extracted details"
                  onPress={() =>
                    router.push({
                      pathname: "/onboarding/review-entities",
                      params: { sessionId: currentBatch.session_id },
                    })
                  }
                />
              ) : null}
              {currentBatch.status === "processing_unavailable" && currentBatch.retryable ? (
                <SecondaryButton
                  label="Retry processing"
                  onPress={async () =>
                    setBatch(await retryDocumentBatch(household.id, currentBatch.id))
                  }
                  disabled={busy}
                />
              ) : null}
            </Card>
          ) : null}

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
