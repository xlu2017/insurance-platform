import { render, fireEvent, screen } from "@testing-library/react-native";
import { UploadPlanModal } from "@/components/upload-plan-modal";
import type { UploadPlan } from "@/lib/document-processing";

function basePlan(overrides: Partial<UploadPlan> = {}): UploadPlan {
  return {
    activeBatchId: "batch-1",
    activeStatus: "comparing_policies",
    activeBatchGeneration: 1,
    newUploadCount: 1,
    reusableNormalizationCount: 0,
    newNormalizationCount: 1,
    unfinishedCurrentCount: 0,
    exactDuplicateDocuments: [],
    restartEstimate: { lowerSeconds: 240, upperSeconds: 420, reviewPasses: 1 },
    waitEstimate: {
      lowerSeconds: 0,
      upperSeconds: 0,
      currentLowerSeconds: 60,
      currentUpperSeconds: 180,
      queuedLowerSeconds: 120,
      queuedUpperSeconds: 300,
      reviewPasses: 2,
    },
    ...overrides,
  };
}

describe("UploadPlanModal", () => {
  it("renders restart and wait choices with time estimates", () => {
    const plan = basePlan();
    render(
      <UploadPlanModal
        visible
        plan={plan}
        loading={false}
        onRestart={jest.fn()}
        onWait={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    expect(screen.getByText("Another document is already being processed")).toBeTruthy();
    expect(screen.getByTestId("restart-button")).toBeTruthy();
    expect(screen.getByTestId("wait-button")).toBeTruthy();
    expect(screen.getByText(/Combined result/)).toBeTruthy();
    expect(screen.getByText(/Current result/)).toBeTruthy();
    expect(screen.getByText(/New document afterward/)).toBeTruthy();
    expect(screen.getByText("Cancel this upload")).toBeTruthy();
  });

  it("calls onRestart when restart is chosen", () => {
    const onRestart = jest.fn();
    render(
      <UploadPlanModal
        visible
        plan={basePlan()}
        loading={false}
        onRestart={onRestart}
        onWait={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId("restart-button"));
    expect(onRestart).toHaveBeenCalled();
  });

  it("calls onWait when wait is chosen", () => {
    const onWait = jest.fn();
    render(
      <UploadPlanModal
        visible
        plan={basePlan()}
        loading={false}
        onRestart={jest.fn()}
        onWait={onWait}
        onCancel={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId("wait-button"));
    expect(onWait).toHaveBeenCalled();
  });

  it("calls onCancel when cancel is chosen", () => {
    const onCancel = jest.fn();
    render(
      <UploadPlanModal
        visible
        plan={basePlan()}
        loading={false}
        onRestart={jest.fn()}
        onWait={jest.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.press(screen.getByTestId("cancel-upload-button"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows exact-duplicate warning and use-existing action", () => {
    const plan = basePlan({
      newUploadCount: 0,
      exactDuplicateDocuments: [
        {
          policyDocumentId: "doc-1",
          normalizationId: "norm-1",
          originalFilename: "policy.pdf",
          metadata: {
            insurer: "Bow River Assurance",
            policyNumber: "BR123456",
            effectiveDate: "2025-01-01",
            expiryDate: "2026-01-01",
            identifiedAssets: ["2023 Toyota Camry"],
          },
        },
      ],
    });
    const onCancel = jest.fn();
    render(
      <UploadPlanModal
        visible
        plan={plan}
        loading={false}
        onRestart={jest.fn()}
        onWait={jest.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("This document was already processed")).toBeTruthy();
    expect(screen.getByText("Use existing information")).toBeTruthy();
    expect(screen.getByText("policy.pdf")).toBeTruthy();
    expect(screen.getByText(/Bow River Assurance/)).toBeTruthy();
    expect(screen.getByText(/BR123456/)).toBeTruthy();
    expect(screen.getByText(/2023 Toyota Camry/)).toBeTruthy();

    fireEvent.press(screen.getByTestId("use-existing-button"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("disables action buttons while loading", () => {
    const plan = basePlan();
    render(
      <UploadPlanModal
        visible
        plan={plan}
        loading
        onRestart={jest.fn()}
        onWait={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    const restart = screen.getByTestId("restart-button");
    expect(restart.props.accessibilityState?.disabled).toBe(true);
  });
});
