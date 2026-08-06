import type { ExactDuplicateDocument, UploadPlan } from "./document-processing";

export interface UploadPlanControllerDependencies {
  planDocumentUpload: (input: {
    householdId: string;
    caseId?: string;
    newPolicyDocumentIds?: string[];
  }) => Promise<UploadPlan>;
  supersedeDocumentBatch: (input: {
    householdId: string;
    activeBatchId: string;
    continuationRequestId: string;
    newPolicyDocumentIds?: string[];
    activeBatchGeneration?: number | null;
  }) => Promise<{ new_batch_id: string; new_session_id: string; superseded_batch_id: string }>;
  queueSuccessorDocumentBatch: (input: {
    householdId: string;
    predecessorBatchId: string;
    continuationRequestId: string;
    newPolicyDocumentIds?: string[];
    activeBatchGeneration?: number | null;
  }) => Promise<{ new_batch_id: string; new_session_id: string; predecessor_batch_id: string }>;
}

export interface UploadPlanControllerInput {
  householdId: string;
  caseId?: string;
  stagedDocumentIds: string[];
  continuationRequestId: string;
  dependencies: UploadPlanControllerDependencies;
}

export type UploadPlanOutcome =
  | { outcome: "proceed_without_active_batch"; plan: UploadPlan; stagedDocumentIds: string[] }
  | { outcome: "exact_duplicate_only"; plan: UploadPlan; documents: ExactDuplicateDocument[] }
  | {
      outcome: "choice_required";
      plan: UploadPlan;
      stagedDocumentIds: string[];
      continuationRequestId: string;
    }
  | {
      outcome: "restart_completed";
      plan: UploadPlan;
      newBatchId: string;
      newSessionId: string;
      supersededBatchId: string;
    }
  | {
      outcome: "wait_queued";
      plan: UploadPlan;
      newBatchId: string;
      newSessionId: string;
      predecessorBatchId: string;
    }
  | { outcome: "cancelled" }
  | { outcome: "stale_plan" }
  | { outcome: "use_existing"; documents: ExactDuplicateDocument[] };

function isExactDuplicateOnly(plan: UploadPlan): boolean {
  return (
    plan.newUploadCount > 0 &&
    plan.newNormalizationCount === 0 &&
    plan.exactDuplicateDocuments.length === plan.newUploadCount
  );
}

function isStaleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("BATCH_GENERATION_MISMATCH") ||
    message.includes("DOCUMENT_BATCH_GENERATION_MISMATCH") ||
    message.includes("CONTINUATION_CONFLICT") ||
    message.includes("CONTINUATION_TYPE_CONFLICT") ||
    message.includes("already chosen") ||
    message.includes("already superseded or cancelled")
  );
}

export class UploadPlanController {
  private plan: UploadPlan | null = null;
  private submitting = false;

  constructor(private readonly input: UploadPlanControllerInput) {}

  get currentPlan(): UploadPlan | null {
    return this.plan;
  }

  get isSubmitting(): boolean {
    return this.submitting;
  }

  private guard(): boolean {
    if (this.submitting) return false;
    this.submitting = true;
    return true;
  }

  private finish(): void {
    this.submitting = false;
  }

  async start(): Promise<UploadPlanOutcome> {
    if (!this.guard()) {
      throw new Error("Upload plan request already in progress");
    }
    try {
      const plan = await this.input.dependencies.planDocumentUpload({
        householdId: this.input.householdId,
        caseId: this.input.caseId,
        newPolicyDocumentIds: this.input.stagedDocumentIds,
      });
      this.plan = plan;

      if (isExactDuplicateOnly(plan)) {
        return { outcome: "exact_duplicate_only", plan, documents: plan.exactDuplicateDocuments };
      }

      if (!plan.activeBatchId) {
        return {
          outcome: "proceed_without_active_batch",
          plan,
          stagedDocumentIds: this.input.stagedDocumentIds,
        };
      }

      return {
        outcome: "choice_required",
        plan,
        stagedDocumentIds: this.input.stagedDocumentIds,
        continuationRequestId: this.input.continuationRequestId,
      };
    } finally {
      this.finish();
    }
  }

  async restart(): Promise<UploadPlanOutcome> {
    if (!this.guard()) {
      throw new Error("Restart already in progress");
    }
    try {
      const plan = this.plan;
      if (!plan || !plan.activeBatchId) {
        throw new Error("No active batch to restart");
      }

      const result = await this.input.dependencies.supersedeDocumentBatch({
        householdId: this.input.householdId,
        activeBatchId: plan.activeBatchId,
        continuationRequestId: this.input.continuationRequestId,
        newPolicyDocumentIds: this.input.stagedDocumentIds,
        activeBatchGeneration: plan.activeBatchGeneration,
      });

      return {
        outcome: "restart_completed",
        plan,
        newBatchId: result.new_batch_id,
        newSessionId: result.new_session_id,
        supersededBatchId: result.superseded_batch_id,
      };
    } catch (error) {
      if (isStaleError(error)) {
        return { outcome: "stale_plan" };
      }
      throw error;
    } finally {
      this.finish();
    }
  }

  async wait(): Promise<UploadPlanOutcome> {
    if (!this.guard()) {
      throw new Error("Wait already in progress");
    }
    try {
      const plan = this.plan;
      if (!plan || !plan.activeBatchId) {
        throw new Error("No active batch to queue after");
      }

      const result = await this.input.dependencies.queueSuccessorDocumentBatch({
        householdId: this.input.householdId,
        predecessorBatchId: plan.activeBatchId,
        continuationRequestId: this.input.continuationRequestId,
        newPolicyDocumentIds: this.input.stagedDocumentIds,
        activeBatchGeneration: plan.activeBatchGeneration,
      });

      return {
        outcome: "wait_queued",
        plan,
        newBatchId: result.new_batch_id,
        newSessionId: result.new_session_id,
        predecessorBatchId: result.predecessor_batch_id,
      };
    } catch (error) {
      if (isStaleError(error)) {
        return { outcome: "stale_plan" };
      }
      throw error;
    } finally {
      this.finish();
    }
  }

  useExisting(): UploadPlanOutcome {
    const plan = this.plan;
    if (!plan) {
      throw new Error("Upload plan has not been loaded");
    }
    if (!isExactDuplicateOnly(plan)) {
      throw new Error("No reusable documents to select");
    }
    return { outcome: "use_existing", documents: plan.exactDuplicateDocuments };
  }

  cancel(): UploadPlanOutcome {
    return { outcome: "cancelled" };
  }
}

export function createUploadPlanController(
  input: Omit<UploadPlanControllerInput, "dependencies"> & {
    dependencies?: Partial<UploadPlanControllerDependencies>;
  },
): UploadPlanController {
  return new UploadPlanController(input as UploadPlanControllerInput);
}
