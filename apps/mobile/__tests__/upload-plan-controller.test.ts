import {
  UploadPlanController,
  type UploadPlanControllerDependencies,
} from "@/lib/upload-plan-controller";
import type { UploadPlan } from "@/lib/document-processing";

function basePlan(overrides: Partial<UploadPlan> = {}): UploadPlan {
  return {
    activeBatchId: null,
    activeStatus: null,
    activeBatchGeneration: null,
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

const duplicateDoc = {
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
};

describe("UploadPlanController", () => {
  function makeDeps(
    overrides: Partial<UploadPlanControllerDependencies> = {},
  ): UploadPlanControllerDependencies {
    return {
      planDocumentUpload: jest.fn().mockResolvedValue(basePlan()),
      supersedeDocumentBatch: jest.fn().mockResolvedValue({
        new_batch_id: "batch-2",
        new_session_id: "session-2",
        superseded_batch_id: "batch-1",
      }),
      queueSuccessorDocumentBatch: jest.fn().mockResolvedValue({
        new_batch_id: "batch-3",
        new_session_id: "session-3",
        predecessor_batch_id: "batch-1",
      }),
      ...overrides,
    };
  }

  it("returns proceed_without_active_batch when no active batch exists", async () => {
    const deps = makeDeps();
    const controller = new UploadPlanController({
      householdId: "household-1",
      stagedDocumentIds: ["doc-1"],
      continuationRequestId: "req-1",
      dependencies: deps,
    });

    const result = await controller.start();

    expect(result.outcome).toBe("proceed_without_active_batch");
    expect(deps.planDocumentUpload).toHaveBeenCalledWith({
      householdId: "household-1",
      newPolicyDocumentIds: ["doc-1"],
    });
  });

  it("returns exact_duplicate_only when all uploads are exact duplicates", async () => {
    const deps = makeDeps({
      planDocumentUpload: jest.fn().mockResolvedValue(
        basePlan({
          activeBatchId: null,
          newUploadCount: 1,
          reusableNormalizationCount: 1,
          newNormalizationCount: 0,
          exactDuplicateDocuments: [duplicateDoc],
        }),
      ),
    });
    const controller = new UploadPlanController({
      householdId: "household-1",
      stagedDocumentIds: ["doc-1"],
      continuationRequestId: "req-1",
      dependencies: deps,
    });

    const result = await controller.start();

    expect(result.outcome).toBe("exact_duplicate_only");
    if (result.outcome === "exact_duplicate_only") {
      expect(result.documents).toEqual([duplicateDoc]);
    }
  });

  it("returns choice_required when there is an active batch and mixed documents", async () => {
    const deps = makeDeps({
      planDocumentUpload: jest.fn().mockResolvedValue(
        basePlan({
          activeBatchId: "batch-1",
          activeStatus: "comparing_policies",
          activeBatchGeneration: 5,
          newUploadCount: 2,
          reusableNormalizationCount: 1,
          newNormalizationCount: 1,
          unfinishedCurrentCount: 1,
          exactDuplicateDocuments: [duplicateDoc],
        }),
      ),
    });
    const controller = new UploadPlanController({
      householdId: "household-1",
      caseId: "case-1",
      stagedDocumentIds: ["doc-2", "doc-3"],
      continuationRequestId: "req-2",
      dependencies: deps,
    });

    const result = await controller.start();

    expect(result.outcome).toBe("choice_required");
    if (result.outcome === "choice_required") {
      expect(result.plan.activeBatchId).toBe("batch-1");
      expect(result.plan.activeBatchGeneration).toBe(5);
      expect(result.stagedDocumentIds).toEqual(["doc-2", "doc-3"]);
      expect(result.continuationRequestId).toBe("req-2");
    }
    expect(deps.planDocumentUpload).toHaveBeenCalledWith({
      householdId: "household-1",
      caseId: "case-1",
      newPolicyDocumentIds: ["doc-2", "doc-3"],
    });
  });

  it("restarts with active batch generation and continuation request id", async () => {
    const deps = makeDeps({
      planDocumentUpload: jest.fn().mockResolvedValue(
        basePlan({
          activeBatchId: "batch-1",
          activeBatchGeneration: 7,
          newUploadCount: 1,
          newNormalizationCount: 1,
        }),
      ),
    });
    const controller = new UploadPlanController({
      householdId: "household-1",
      stagedDocumentIds: ["doc-4"],
      continuationRequestId: "req-3",
      dependencies: deps,
    });
    await controller.start();

    const result = await controller.restart();

    expect(result.outcome).toBe("restart_completed");
    expect(deps.supersedeDocumentBatch).toHaveBeenCalledWith({
      householdId: "household-1",
      activeBatchId: "batch-1",
      continuationRequestId: "req-3",
      newPolicyDocumentIds: ["doc-4"],
      activeBatchGeneration: 7,
    });
  });

  it("queues a successor with active batch generation and continuation request id", async () => {
    const deps = makeDeps({
      planDocumentUpload: jest.fn().mockResolvedValue(
        basePlan({
          activeBatchId: "batch-1",
          activeBatchGeneration: 3,
          newUploadCount: 1,
          newNormalizationCount: 1,
        }),
      ),
    });
    const controller = new UploadPlanController({
      householdId: "household-1",
      stagedDocumentIds: ["doc-5"],
      continuationRequestId: "req-4",
      dependencies: deps,
    });
    await controller.start();

    const result = await controller.wait();

    expect(result.outcome).toBe("wait_queued");
    expect(deps.queueSuccessorDocumentBatch).toHaveBeenCalledWith({
      householdId: "household-1",
      predecessorBatchId: "batch-1",
      continuationRequestId: "req-4",
      newPolicyDocumentIds: ["doc-5"],
      activeBatchGeneration: 3,
    });
  });

  it("returns cancelled on cancel", async () => {
    const controller = new UploadPlanController({
      householdId: "household-1",
      stagedDocumentIds: ["doc-1"],
      continuationRequestId: "req-1",
      dependencies: makeDeps(),
    });

    const result = await controller.cancel();

    expect(result.outcome).toBe("cancelled");
  });

  it("returns use_existing with reusable metadata", async () => {
    const deps = makeDeps({
      planDocumentUpload: jest.fn().mockResolvedValue(
        basePlan({
          newUploadCount: 1,
          reusableNormalizationCount: 1,
          newNormalizationCount: 0,
          exactDuplicateDocuments: [duplicateDoc],
        }),
      ),
    });
    const controller = new UploadPlanController({
      householdId: "household-1",
      stagedDocumentIds: ["doc-1"],
      continuationRequestId: "req-1",
      dependencies: deps,
    });
    await controller.start();

    const result = controller.useExisting();

    expect(result.outcome).toBe("use_existing");
    if (result.outcome === "use_existing") {
      expect(result.documents).toEqual([duplicateDoc]);
    }
  });

  it("returns stale_plan when a restart hits a generation mismatch", async () => {
    const deps = makeDeps({
      planDocumentUpload: jest.fn().mockResolvedValue(
        basePlan({
          activeBatchId: "batch-1",
          activeBatchGeneration: 2,
          newUploadCount: 1,
          newNormalizationCount: 1,
        }),
      ),
      supersedeDocumentBatch: jest
        .fn()
        .mockRejectedValue(new Error("BATCH_GENERATION_MISMATCH: batch generation changed")),
    });
    const controller = new UploadPlanController({
      householdId: "household-1",
      stagedDocumentIds: ["doc-1"],
      continuationRequestId: "req-1",
      dependencies: deps,
    });
    await controller.start();

    const result = await controller.restart();

    expect(result.outcome).toBe("stale_plan");
  });

  it("returns stale_plan when a wait request conflicts", async () => {
    const deps = makeDeps({
      planDocumentUpload: jest.fn().mockResolvedValue(
        basePlan({
          activeBatchId: "batch-1",
          activeBatchGeneration: 4,
          newUploadCount: 1,
          newNormalizationCount: 1,
        }),
      ),
      queueSuccessorDocumentBatch: jest
        .fn()
        .mockRejectedValue(
          new Error("CONTINUATION_CONFLICT: a different continuation was already chosen"),
        ),
    });
    const controller = new UploadPlanController({
      householdId: "household-1",
      stagedDocumentIds: ["doc-1"],
      continuationRequestId: "req-1",
      dependencies: deps,
    });
    await controller.start();

    const result = await controller.wait();

    expect(result.outcome).toBe("stale_plan");
  });

  it("rejects concurrent restart attempts (double-tap guard)", async () => {
    const deps = makeDeps({
      planDocumentUpload: jest.fn().mockResolvedValue(
        basePlan({
          activeBatchId: "batch-1",
          activeBatchGeneration: 1,
          newUploadCount: 1,
          newNormalizationCount: 1,
        }),
      ),
      supersedeDocumentBatch: jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () => resolve({ new_batch_id: "b", new_session_id: "s", superseded_batch_id: "a" }),
                50,
              ),
            ),
        ),
    });
    const controller = new UploadPlanController({
      householdId: "household-1",
      stagedDocumentIds: ["doc-1"],
      continuationRequestId: "req-1",
      dependencies: deps,
    });
    await controller.start();

    const first = controller.restart();
    await expect(controller.restart()).rejects.toThrow("Restart already in progress");
    await first;
  });

  it("retry uses the same continuation request id", async () => {
    const planUpload = jest.fn().mockResolvedValue(
      basePlan({
        activeBatchId: "batch-1",
        activeBatchGeneration: 6,
        newUploadCount: 1,
        newNormalizationCount: 1,
      }),
    );
    const deps = makeDeps({
      planDocumentUpload: planUpload,
    });
    const controller = new UploadPlanController({
      householdId: "household-1",
      stagedDocumentIds: ["doc-1"],
      continuationRequestId: "stable-req-id",
      dependencies: deps,
    });
    await controller.start();
    await controller.restart();
    await controller.start();
    await controller.restart();

    const calls = (deps.supersedeDocumentBatch as jest.Mock).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][0].continuationRequestId).toBe("stable-req-id");
    expect(calls[1][0].continuationRequestId).toBe("stable-req-id");
  });
});
