import { Modal, ScrollView, View } from "react-native";
import { colors, radii, spacing } from "@autopilot/design-tokens";
import {
  documentBatchStatusLabels,
  type ExactDuplicateDocument,
  type UploadPlan,
  type UploadPlanEstimate,
  type UploadPlanWaitEstimate,
} from "@/lib/document-processing";
import { Body, Caption, Card, PrimaryButton, SecondaryButton, Title } from "./ui";

interface UploadPlanModalProps {
  visible: boolean;
  plan: UploadPlan | null;
  loading: boolean;
  onRestart: () => void;
  onWait: () => void;
  onUseExisting: () => void;
  onCancel: () => void;
}

function formatSecondsRange(lowerSeconds: number | undefined, upperSeconds: number | undefined) {
  if (lowerSeconds === undefined || upperSeconds === undefined) return "about a few minutes";
  const lowerMin = Math.ceil(lowerSeconds / 60);
  const upperMin = Math.ceil(upperSeconds / 60);
  if (lowerMin === upperMin) return `about ${lowerMin} minute${lowerMin === 1 ? "" : "s"}`;
  return `${lowerMin}–${upperMin} minutes`;
}

function reviewLabel(passes: number | undefined) {
  if (passes === undefined) return "One review";
  if (passes <= 1) return "One review";
  return `Up to ${passes} reviews`;
}

function EstimateRow({
  title,
  estimate,
}: {
  title: string;
  estimate: UploadPlanEstimate | null | undefined;
}) {
  if (!estimate) return null;
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Body style={{ fontWeight: "600" }}>{title}</Body>
      <Caption>{`Approximately ${formatSecondsRange(estimate.lowerSeconds, estimate.upperSeconds)} · ${reviewLabel(estimate.reviewPasses)}`}</Caption>
    </View>
  );
}

function WaitEstimateRows({ estimate }: { estimate: UploadPlanWaitEstimate | null | undefined }) {
  if (!estimate) return null;
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <EstimateRow
        title="Current result"
        estimate={{
          lowerSeconds: estimate.currentLowerSeconds,
          upperSeconds: estimate.currentUpperSeconds,
          reviewPasses: 1,
        }}
      />
      <EstimateRow
        title="New document afterward"
        estimate={{
          lowerSeconds: estimate.queuedLowerSeconds,
          upperSeconds: estimate.queuedUpperSeconds,
          reviewPasses: 1,
        }}
      />
      {estimate.reviewPasses !== undefined && estimate.reviewPasses > 1 ? (
        <Caption>{`You may receive up to ${estimate.reviewPasses} reviews in total.`}</Caption>
      ) : null}
    </View>
  );
}

export function UploadPlanModal({
  visible,
  plan,
  loading,
  onRestart,
  onWait,
  onUseExisting,
  onCancel,
}: UploadPlanModalProps) {
  if (!plan) return null;

  const allDuplicates =
    plan.newUploadCount > 0 &&
    plan.newNormalizationCount === 0 &&
    plan.exactDuplicateDocuments.length === plan.newUploadCount;
  const activeStatusLabel = plan.activeStatus
    ? documentBatchStatusLabels[plan.activeStatus]
    : "being processed";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "rgba(0,0,0,0.5)",
          padding: spacing.md,
        }}
      >
        <Card
          style={{
            width: "100%",
            maxWidth: 480,
            maxHeight: "80%",
            backgroundColor: colors.surface,
            borderRadius: radii.md,
          }}
        >
          <ScrollView showsVerticalScrollIndicator={false}>
            <Title style={{ marginBottom: spacing.sm }}>
              {allDuplicates
                ? "This document was already processed"
                : "Another document is already being processed"}
            </Title>

            {allDuplicates ? (
              <>
                <Body muted style={{ marginBottom: spacing.md }}>
                  This exact document was already processed. You can use the existing information.
                </Body>
                {plan.exactDuplicateDocuments.map((doc) => (
                  <DuplicateDocumentRow key={doc.policyDocumentId} doc={doc} />
                ))}
              </>
            ) : (
              <>
                <Body muted style={{ marginBottom: spacing.md }}>
                  {`A document is currently ${activeStatusLabel.toLowerCase()}. Completed work will be reused in either choice.`}
                </Body>

                <View style={{ marginBottom: spacing.md }}>
                  <Body style={{ fontWeight: "600" }}>Restart with all documents</Body>
                  <Body muted>
                    We will combine the current and new documents. Only unfinished documents will
                    continue processing.
                  </Body>
                  <EstimateRow title="Combined result" estimate={plan.restartEstimate} />
                </View>

                <View style={{ marginBottom: spacing.md }}>
                  <Body style={{ fontWeight: "600" }}>Finish current processing first</Body>
                  <Body muted>
                    You will receive the current result sooner. The new document will be processed
                    afterward and may require a second short review.
                  </Body>
                  <WaitEstimateRows estimate={plan.waitEstimate} />
                </View>
              </>
            )}

            <View style={{ gap: spacing.sm }}>
              {allDuplicates ? (
                <PrimaryButton
                  label="Use existing information"
                  onPress={onUseExisting}
                  loading={loading}
                  disabled={loading}
                  testID="use-existing-button"
                />
              ) : (
                <>
                  <PrimaryButton
                    label="Restart with all documents"
                    onPress={onRestart}
                    loading={loading}
                    disabled={loading}
                    testID="restart-button"
                  />
                  <SecondaryButton
                    label="Finish current processing first"
                    onPress={onWait}
                    loading={loading}
                    disabled={loading}
                    testID="wait-button"
                  />
                </>
              )}
              <SecondaryButton
                label="Cancel this upload"
                onPress={onCancel}
                disabled={loading}
                testID="cancel-upload-button"
              />
            </View>
          </ScrollView>
        </Card>
      </View>
    </Modal>
  );
}

function DuplicateDocumentRow({ doc }: { doc: ExactDuplicateDocument }) {
  const metadata = doc.metadata;
  const assetLabel = metadata?.identifiedAssets?.join(", ") ?? "";
  const termLabel = [metadata?.effectiveDate, metadata?.expiryDate].filter(Boolean).join(" – ");
  return (
    <View
      style={{
        marginBottom: spacing.sm,
        padding: spacing.sm,
        backgroundColor: colors.surfaceSubtle,
        borderRadius: radii.sm,
      }}
    >
      <Body numberOfLines={1}>{doc.originalFilename ?? "Document"}</Body>
      {metadata?.insurer ? <Caption>{`Insurer: ${metadata.insurer}`}</Caption> : null}
      {metadata?.policyNumber ? <Caption>{`Policy: ${metadata.policyNumber}`}</Caption> : null}
      {assetLabel ? <Caption>{`Assets: ${assetLabel}`}</Caption> : null}
      {termLabel ? <Caption>{`Term: ${termLabel}`}</Caption> : null}
    </View>
  );
}
