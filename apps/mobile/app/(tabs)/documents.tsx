import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radii, spacing, typography } from "@autopilot/design-tokens";
import { documentCategories, type DocumentCategory } from "@autopilot/schemas";
import { supabase } from "@/lib/supabase";
import { useHousehold } from "@/lib/household";
import { openDocumentUrl } from "@/lib/open-url";
import {
  additionalUploadAllowedStatuses,
  batchAllowsAdditionalUploads,
  createClientRequestId,
  createDocumentBatch,
  documentItemStatusLabel,
  documentBatchStatusLabels,
  documentBatchStatusTooltips,
  loadDangerousModeSetting,
  loadDocumentBatch,
  loadDocumentBatchForCase,
  loadLatestDocumentBatch,
  retryDocumentBatch,
  submitDocumentBatch,
  type DocumentBatchSummary,
} from "@/lib/document-processing";
import { useExtractionCandidates } from "@/lib/extraction";
import {
  createClientItemId,
  deletePolicyDocument,
  pickDocuments,
  pickImages,
  uploadPolicyDocument,
  type PickedFile,
} from "@/lib/upload";
import { formatEdmontonDateTime } from "@/lib/format";
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
  auto_detect: "Auto-detect",
  current_auto_policy: "Current auto policy",
  current_property_policy: "Current property policy",
  renewal_notice: "Renewal notice",
  competing_quote: "Competing quote",
  proof_of_insurance: "Proof of insurance",
  signed_authorization: "Signed authorization",
  cancellation_confirmation: "Cancellation confirmation",
  other: "Other",
};

const documentStatusLabels: Record<string, string> = {
  uploaded: "Uploaded",
  in_review: "In review",
  extracted: "Processed",
  rejected: "Rejected",
};

const documentStatusTooltips: Record<string, string> = {
  uploaded: "Document uploaded, waiting to be processed.",
  in_review: "Document is being reviewed.",
  extracted: "Document processed and data extracted.",
  rejected: "Document could not be processed.",
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
  mime_type: string;
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
  const { caseId, batchId, sessionId } = useLocalSearchParams<{
    caseId?: string;
    batchId?: string;
    sessionId?: string;
  }>();
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<DocumentCategory>("auto_detect");
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [batch, setBatch] = useState<DocumentBatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeChoice, setResumeChoice] = useState<"continue" | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeConfirmDoc, setRemoveConfirmDoc] = useState<DocumentRow | null>(null);

  const hasIdentifiers = !!caseId || !!batchId;

  // Load a batch specified by route parameters and verify identity.
  const { data: paramBatch, error: paramBatchError } = useQuery({
    queryKey: ["document-processing-param-batch", household?.id, caseId, batchId, sessionId],
    enabled: !!household && hasIdentifiers && !batch,
    queryFn: async () => {
      if (batchId) {
        const b = await loadDocumentBatch(household!.id, batchId);
        if (!additionalUploadAllowedStatuses.has(b.status)) {
          throw new Error("This batch is not available for additional uploads.");
        }
        if (caseId && b.case_id !== caseId) {
          throw new Error("Batch does not belong to the selected case.");
        }
        if (sessionId && b.session_id !== sessionId) {
          throw new Error("Batch does not match the selected session.");
        }
        return b;
      }
      if (caseId) {
        const b = await loadDocumentBatchForCase(household!.id, caseId);
        if (!b) return null;
        if (!additionalUploadAllowedStatuses.has(b.status)) {
          throw new Error("This case does not have an open upload.");
        }
        if (sessionId && b.session_id !== sessionId) {
          throw new Error("Session mismatch.");
        }
        return b;
      }
      return null;
    },
  });

  // Load the most recent batch only when no route identifiers are supplied.
  const { data: latestBatch, error: latestBatchError } = useQuery({
    queryKey: ["document-processing-latest-batch", household?.id],
    enabled: !!household && !hasIdentifiers && !batch,
    queryFn: () => loadLatestDocumentBatch(household!.id),
  });

  useEffect(() => {
    const e = paramBatchError ?? latestBatchError;
    if (e) setResumeError(e instanceof Error ? e.message : "Could not load batch");
  }, [paramBatchError, latestBatchError]);

  const resumableLatestBatch =
    !hasIdentifiers && latestBatch && batchAllowsAdditionalUploads(latestBatch)
      ? latestBatch
      : null;
  const visibleBatch =
    batch ?? paramBatch ?? (resumeChoice === "continue" ? resumableLatestBatch : null) ?? null;
  const awaitingResumeChoice = !hasIdentifiers && !!resumableLatestBatch && !resumeChoice && !batch;

  const { data: documents } = useQuery({
    queryKey: ["documents", household?.id],
    enabled: !!household,
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("policy_documents")
        .select("id, category, status, storage_path, file_name, mime_type, created_at")
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

  const { data: dangerousMode } = useQuery({
    queryKey: ["dangerous-mode", household?.id],
    enabled: !!household,
    queryFn: () => loadDangerousModeSetting(household!.id),
  });

  const { data: pendingCandidates } = useExtractionCandidates(
    household?.id,
    currentBatch?.session_id,
  );

  const instantReview = dangerousMode?.enabled ?? false;
  const fileCount = pending.length;
  const fileCountLabel = fileCount === 1 ? "1 file" : `${fileCount} files`;
  const hasFailed = pending.some((item) => item.status === "failed");

  if (isLoading) return <Loading />;
  if (!household) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Title>Finish setting up</Title>
        <Body muted>Set up your account to upload and view policy documents.</Body>
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

  const batchIsOpen = batchAllowsAdditionalUploads(currentBatch);

  const uploadAndAnalyze = async () => {
    if (pending.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (awaitingResumeChoice) {
        throw new Error("Choose whether to continue the existing review or start a new one.");
      }
      if (hasIdentifiers && !visibleBatch) {
        throw new Error("No open batch was found for the selected case or session.");
      }
      const targetBatch =
        visibleBatch ??
        (await createDocumentBatch({
          householdId: household.id,
          caseId: caseId,
          clientRequestId: caseId
            ? `case-upload:${caseId}`
            : createClientRequestId("mobile-documents"),
        }));
      if (!visibleBatch) setBatch(targetBatch);
      for (const item of pending.filter(
        (candidate) => candidate.status === "pending" || candidate.status === "failed",
      )) {
        updatePending(item.clientItemId, { status: "uploading", error: undefined });
        try {
          const result = await uploadPolicyDocument(
            household.id,
            item.category,
            item.file,
            targetBatch.id,
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
      setBatch(await submitDocumentBatch(household.id, targetBatch.id));
      await queryClient.invalidateQueries({ queryKey: ["documents", household.id] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const viewDocument = async (doc: DocumentRow) => {
    try {
      const { data, error: signedError } = await supabase.storage
        .from("policy-documents")
        .createSignedUrl(doc.storage_path, 60);
      if (signedError || !data?.signedUrl) throw new Error("Could not generate document preview.");
      if (Platform.OS === "web") {
        setPreviewDoc(doc);
        setPreviewUrl(data.signedUrl);
      } else {
        await openDocumentUrl(data.signedUrl);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not open document";
      if (Platform.OS === "web") {
        window.alert(message);
      } else {
        Alert.alert("View document", message);
      }
    }
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

  const remove = (doc: DocumentRow) => setRemoveConfirmDoc(doc);

  const confirmRemove = async () => {
    if (!removeConfirmDoc) return;
    await removeDocument(removeConfirmDoc);
    setRemoveConfirmDoc(null);
  };

  const cancelRemove = () => setRemoveConfirmDoc(null);

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <Screen>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.md }}
        >
          <Body muted style={{ marginBottom: spacing.md }}>
            Upload or photograph your current insurance documents so we can review your coverage.
          </Body>

          <Card>
            <Select
              label="Document type"
              helpText="Leave Auto-detect if you are unsure."
              options={categoryOptions}
              value={category}
              onValueChange={setCategory}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <SecondaryButton
                label="Files"
                onPress={() => choose("document")}
                disabled={busy || !batchIsOpen}
                style={{ flex: 1, paddingVertical: 10 }}
              />
              <SecondaryButton
                label="Camera"
                onPress={() => choose("camera")}
                disabled={busy || !batchIsOpen}
                style={{ flex: 1, paddingVertical: 10 }}
              />
              <SecondaryButton
                label="Photos"
                onPress={() => choose("library")}
                disabled={busy || !batchIsOpen}
                style={{ flex: 1, paddingVertical: 10 }}
              />
            </View>

            {pending.length > 0 ? (
              <View style={{ marginTop: spacing.md }}>
                <Subtitle style={{ fontSize: typography.sizes.body, marginBottom: spacing.sm }}>
                  Ready to upload
                </Subtitle>
                {pending.map((item) => (
                  <View
                    key={item.clientItemId}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingVertical: spacing.sm,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <View style={{ flex: 1, marginRight: spacing.sm }}>
                      <Body numberOfLines={1}>{item.file.name}</Body>
                      <Caption>
                        {categoryLabels[item.category]} ·{" "}
                        {documentItemStatusLabel(item.status, currentBatch)}
                      </Caption>
                      {item.error ? (
                        <Caption style={{ color: colors.danger }}>{item.error}</Caption>
                      ) : null}
                    </View>
                    {item.status === "pending" ? (
                      <Pressable
                        onPress={() =>
                          setPending((current) =>
                            current.filter(
                              (candidate) => candidate.clientItemId !== item.clientItemId,
                            ),
                          )
                        }
                        disabled={busy}
                        hitSlop={8}
                      >
                        <Body style={{ color: colors.danger }}>Remove</Body>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {awaitingResumeChoice ? (
              <View style={{ marginTop: spacing.md, gap: 8 }}>
                <Body muted>An open review already exists. Continue it or start a new one?</Body>
                <PrimaryButton
                  label="Continue existing review"
                  onPress={() => setResumeChoice("continue")}
                />
                <SecondaryButton
                  label="Start a new review"
                  onPress={() => setResumeChoice("new")}
                />
              </View>
            ) : batchIsOpen ? (
              <PrimaryButton
                label={
                  pending.length === 0
                    ? "Upload files to start review"
                    : batch && hasFailed
                      ? "Retry failed files"
                      : instantReview
                        ? `Upload ${fileCountLabel} and start AI review`
                        : `Upload ${fileCountLabel}`
                }
                onPress={uploadAndAnalyze}
                loading={busy}
                disabled={pending.length === 0 || !!awaitingResumeChoice}
                style={{ marginTop: spacing.md }}
              />
            ) : null}
            {resumeError ? (
              <Body style={{ color: colors.danger, marginTop: spacing.sm }}>{resumeError}</Body>
            ) : null}
            {error ? (
              <Body muted style={{ marginTop: spacing.sm }}>
                {error}
              </Body>
            ) : null}
          </Card>

          {currentBatch && currentBatch.document_count > 0 ? (
            <Card>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: spacing.sm,
                }}
              >
                <StatusPill
                  label={documentBatchStatusLabels[currentBatch.status]}
                  tone={currentBatch.status === "ready_for_review" ? "accent" : "neutral"}
                  tooltip={documentBatchStatusTooltips[currentBatch.status]}
                />
                <Caption>
                  {currentBatch.document_count}{" "}
                  {currentBatch.document_count === 1 ? "file" : "files"} added
                </Caption>
              </View>
              {!currentBatch.automatic_processing && currentBatch.is_terminal ? (
                <Body muted>We are preparing the details for your review.</Body>
              ) : null}
              {currentBatch.status === "ready_for_review" &&
              (pendingCandidates ?? []).length > 0 ? (
                <PrimaryButton
                  label="Review what we found"
                  onPress={() =>
                    router.push({
                      pathname: "/onboarding/review-entities",
                      params: { sessionId: currentBatch.session_id },
                    })
                  }
                />
              ) : currentBatch.status === "ready_for_review" ? (
                <Body muted>All extracted items have been reviewed.</Body>
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

          {(documents ?? []).length > 0 ? (
            <Subtitle style={{ marginTop: spacing.md, marginBottom: spacing.sm }}>
              Uploaded documents
            </Subtitle>
          ) : null}
          {(documents ?? []).map((doc) => (
            <Card key={doc.id}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: radii.md,
                    backgroundColor: colors.accentSoft,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: spacing.md,
                  }}
                >
                  <Body style={{ color: colors.accent, fontWeight: "700" }}>
                    {doc.mime_type?.startsWith("image/") ? "IMG" : "PDF"}
                  </Body>
                </View>
                <View style={{ flex: 1, marginRight: spacing.sm }}>
                  <Body numberOfLines={1}>{doc.file_name}</Body>
                  <Caption>
                    {categoryLabels[doc.category as DocumentCategory] ?? doc.category} ·{" "}
                    {formatEdmontonDateTime(doc.created_at)}
                  </Caption>
                </View>
                <StatusPill
                  label={documentStatusLabels[doc.status] ?? doc.status}
                  tone={doc.status === "extracted" ? "accent" : "neutral"}
                  tooltip={documentStatusTooltips[doc.status]}
                />
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.md }}>
                <SecondaryButton
                  label="View"
                  onPress={() => viewDocument(doc)}
                  style={{ flex: 1, paddingVertical: 10 }}
                />
                <SecondaryButton
                  label="Remove"
                  onPress={() => remove(doc)}
                  disabled={busy}
                  style={{ flex: 1, paddingVertical: 10 }}
                />
              </View>
            </Card>
          ))}
        </ScrollView>

        <Modal
          visible={!!removeConfirmDoc}
          transparent
          animationType="fade"
          onRequestClose={cancelRemove}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              justifyContent: "center",
              padding: spacing.lg,
            }}
          >
            <Card>
              <Subtitle>Remove document?</Subtitle>
              <Body muted style={{ marginBottom: spacing.md }}>
                {removeConfirmDoc
                  ? `${removeConfirmDoc.file_name} will be removed from your household documents.`
                  : ""}
              </Body>
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <SecondaryButton
                  label="Cancel"
                  onPress={cancelRemove}
                  style={{ flex: 1 }}
                  disabled={busy}
                />
                <PrimaryButton
                  label="Remove"
                  onPress={confirmRemove}
                  loading={busy}
                  disabled={busy}
                  style={{ flex: 1, backgroundColor: colors.danger }}
                />
              </View>
            </Card>
          </View>
        </Modal>

        {previewDoc && previewUrl ? (
          <DocumentPreview doc={previewDoc} url={previewUrl} onClose={() => setPreviewUrl(null)} />
        ) : null}
      </Screen>
    </SafeAreaView>
  );
}

function DocumentPreview({
  doc,
  url,
  onClose,
}: {
  doc: DocumentRow;
  url: string;
  onClose: () => void;
}) {
  const content = (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          padding: 16,
          borderBottomWidth: 1,
          borderBottomColor: "#E5E7EB",
        }}
      >
        <Body style={{ flex: 1, marginRight: 12 }}>{doc.file_name}</Body>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <SecondaryButton label="Open" onPress={() => openDocumentUrl(url)} />
          <SecondaryButton label="Close" onPress={onClose} />
        </View>
      </View>
      {Platform.OS === "web" ? (
        <View style={{ flex: 1 }}>
          {doc.mime_type.startsWith("image/")
            ? React.createElement("img", {
                src: url,
                alt: doc.file_name,
                style: { width: "100%", height: "100%", objectFit: "contain" },
              })
            : React.createElement("iframe", {
                src: url,
                title: doc.file_name,
                style: { width: "100%", height: "100%", border: "none" },
              })}
        </View>
      ) : (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 16 }}>
          <Body muted style={{ textAlign: "center" }}>
            Preview is available in your device browser.
          </Body>
          <View style={{ height: 16 }} />
          <PrimaryButton label="Open in browser" onPress={() => openDocumentUrl(url)} />
        </View>
      )}
    </SafeAreaView>
  );

  if (Platform.OS === "web") {
    return React.createElement("div", {
      style: {
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 9999,
      },
      children: content,
    });
  }

  return (
    <Modal
      visible
      animationType="fade"
      transparent={false}
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      {content}
    </Modal>
  );
}
