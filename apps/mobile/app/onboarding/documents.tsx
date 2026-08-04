import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHousehold } from "@/lib/household";
import { colors, spacing } from "@autopilot/design-tokens";
import {
  batchAllowsAdditionalUploads,
  createClientRequestId,
  createDocumentBatch,
  documentItemStatusLabel,
  documentBatchStatusLabels,
  documentBatchStatusTooltips,
  loadDangerousModeSetting,
  loadDocumentBatch,
  loadLatestDocumentBatch,
  submitDocumentBatch,
  type DocumentBatchSummary,
} from "@/lib/document-processing";
import {
  createClientItemId,
  pickDocuments,
  pickImages,
  uploadPolicyDocument,
  type PickedFile,
} from "@/lib/upload";
import {
  Body,
  Caption,
  Card,
  Loading,
  PrimaryButton,
  Screen,
  SecondaryButton,
  StatusPill,
  Title,
} from "@/components/ui";
import type { DocumentCategory } from "@autopilot/schemas";

type PendingStatus = "pending" | "uploading" | "uploaded" | "deduplicated" | "failed";

interface PendingPolicyFile {
  clientItemId: string;
  file: PickedFile;
  category: DocumentCategory;
  status: PendingStatus;
  error?: string;
}

const DEFAULT_CATEGORY: DocumentCategory = "auto_detect";

const categoryLabel: Record<DocumentCategory, string> = {
  auto_detect: "Auto-detect",
  current_auto_policy: "Auto",
  current_property_policy: "Property",
  renewal_notice: "Renewal notice",
  competing_quote: "Competing quote",
  proof_of_insurance: "Proof of insurance",
  signed_authorization: "Signed authorization",
  cancellation_confirmation: "Cancellation confirmation",
  other: "Other",
};

export default function OnboardingDocuments() {
  const { data: household, isLoading } = useHousehold();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingPolicyFile[]>([]);
  const [batch, setBatch] = useState<DocumentBatchSummary | null>(null);
  const [batchSubmitted, setBatchSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeChoice, setResumeChoice] = useState<"continue" | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: latestBatch, error: latestBatchError } = useQuery({
    queryKey: ["latest-document-processing-batch", household?.id],
    enabled: !!household && !batch,
    queryFn: () => loadLatestDocumentBatch(household!.id),
  });

  useEffect(() => {
    if (latestBatchError)
      setResumeError(
        latestBatchError instanceof Error ? latestBatchError.message : "Could not load batch",
      );
  }, [latestBatchError]);

  const resumableLatestBatch =
    latestBatch && batchAllowsAdditionalUploads(latestBatch) ? latestBatch : null;
  const awaitingResumeChoice = !!resumableLatestBatch && !resumeChoice && !batch;
  const visibleBatch = batch ?? (resumeChoice === "continue" ? resumableLatestBatch : null) ?? null;

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

  if (isLoading || !household) return <Loading />;

  const batchMode = dangerousMode?.enabled ? "dangerous" : "safe";
  const instantReview = batchMode === "dangerous";
  const fileCount = pending.length;
  const fileCountLabel = fileCount === 1 ? "1 file" : `${fileCount} files`;
  const hasFailed = pending.some((item) => item.status === "failed");

  const appendFiles = (files: PickedFile[], category: DocumentCategory) => {
    if (files.length === 0) return;
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

  const chooseDocuments = async () => {
    setError(null);
    try {
      appendFiles(await pickDocuments(), DEFAULT_CATEGORY);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not select files");
    }
  };

  const chooseImages = async (fromCamera: boolean) => {
    setError(null);
    try {
      appendFiles(await pickImages(fromCamera), DEFAULT_CATEGORY);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not select images");
    }
  };

  const updatePending = (clientItemId: string, patch: Partial<PendingPolicyFile>) => {
    setPending((current) =>
      current.map((item) => (item.clientItemId === clientItemId ? { ...item, ...patch } : item)),
    );
  };

  const uploadAndAnalyze = async () => {
    if (pending.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (awaitingResumeChoice) {
        throw new Error("Choose whether to continue the existing review or start a new one.");
      }
      const created =
        visibleBatch ??
        (await createDocumentBatch({
          householdId: household.id,
          clientRequestId: createClientRequestId("mobile-onboarding"),
        }));
      if (!visibleBatch) setBatch(created);

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

      const submitted = await submitDocumentBatch(household.id, created.id);
      setBatch(submitted);
      setBatchSubmitted(true);
      await queryClient.invalidateQueries({ queryKey: ["documents", household.id] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    await queryClient.invalidateQueries({ queryKey: ["household"] });
    router.push("/onboarding/mandate");
  };

  return (
    <Screen style={{ paddingVertical: spacing.md }}>
      <Stack.Screen
        options={{ headerShown: true, headerBackTitle: "Back", title: "Upload policies" }}
      />
      <Title>Add your current policies</Title>
      <Body muted>
        Select all policy PDFs or photos you have.
        {instantReview
          ? " AI review begins as soon as the upload finishes."
          : " We will organize them and prepare the details for your review."}
      </Body>
      <View style={{ height: 16 }} />

      <Card>
        <Caption>Policy documents</Caption>
        <View style={{ gap: 8, marginTop: 8 }}>
          <SecondaryButton
            label="Add PDF or image files"
            onPress={() => chooseDocuments()}
            disabled={busy || !!batch}
          />
          <SecondaryButton
            label="Take a photo"
            onPress={() => chooseImages(true)}
            disabled={busy || !!batch}
          />
          <SecondaryButton
            label="Add photos from library"
            onPress={() => chooseImages(false)}
            disabled={busy || !!batch}
          />
        </View>
      </Card>

      {pending.length > 0 ? (
        <Card>
          <Caption>{`${fileCountLabel} ready to upload`}</Caption>
          <View style={{ gap: 12, marginTop: 8 }}>
            {pending.map((item) => (
              <View key={item.clientItemId}>
                <Body>{item.file.name}</Body>
                <Caption>
                  {categoryLabel[item.category]} ·{" "}
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
          </View>
        </Card>
      ) : null}

      {currentBatch ? (
        <Card>
          <StatusPill
            label={documentBatchStatusLabels[currentBatch.status]}
            tone={currentBatch.status === "ready_for_review" ? "accent" : "neutral"}
            tooltip={documentBatchStatusTooltips[currentBatch.status]}
          />
          <Caption>{`${currentBatch.document_count} ${currentBatch.document_count === 1 ? "file" : "files"} added`}</Caption>
          {!currentBatch.automatic_processing && currentBatch.is_terminal ? (
            <Body muted>
              We are preparing the details for your review. You can safely leave and return later.
            </Body>
          ) : null}
          {currentBatch.status === "ready_for_review" ? (
            <PrimaryButton
              label="Review what we found"
              onPress={() =>
                router.push({
                  pathname: "/onboarding/review-entities",
                  params: { sessionId: currentBatch.session_id },
                })
              }
            />
          ) : null}
        </Card>
      ) : null}

      {awaitingResumeChoice ? (
        <View style={{ gap: 8 }}>
          <Body muted>An open review already exists. Continue it or start a new one?</Body>
          <PrimaryButton
            label="Continue existing review"
            onPress={() => setResumeChoice("continue")}
          />
          <SecondaryButton label="Start a new review" onPress={() => setResumeChoice("new")} />
        </View>
      ) : !batchSubmitted ? (
        <View style={{ gap: 8 }}>
          <PrimaryButton
            label={
              batch && hasFailed
                ? "Retry failed files"
                : instantReview
                  ? `Upload ${fileCountLabel} and start AI review`
                  : `Upload ${fileCountLabel}`
            }
            onPress={uploadAndAnalyze}
            loading={busy}
            disabled={pending.length === 0 || !!awaitingResumeChoice}
          />
          <SecondaryButton label="Do this later" onPress={skip} disabled={busy} />
        </View>
      ) : null}
      {resumeError ? (
        <Body style={{ color: colors.danger, marginTop: 8 }}>{resumeError}</Body>
      ) : null}
      {error ? <Body muted>{error}</Body> : null}
    </Screen>
  );
}
