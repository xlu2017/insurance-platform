import {
  buildCaseTimeline,
  resolveCustomerCasePresentation,
  type SessionStep,
} from "@/lib/autopilot";
import { type OptimizationCase } from "@/lib/household";
import { type DocumentBatchSummary } from "@/lib/document-processing";

function caseStub(state: string, id = "case-1", closedFromState?: string): OptimizationCase {
  return {
    id,
    household_id: "h1",
    state,
    closed_from_state: closedFromState ?? null,
    renewal_date: null,
    notes: null,
    created_at: "2026-08-04T00:00:00Z",
    updated_at: "2026-08-04T00:00:00Z",
  };
}

function batchStub(
  status: DocumentBatchSummary["status"],
  extras?: Partial<DocumentBatchSummary>,
): DocumentBatchSummary {
  return {
    id: "batch-1",
    session_id: "session-1",
    case_id: "case-1",
    status,
    automatic_processing: false,
    document_count: 1,
    unique_document_count: 1,
    deduplicated_count: 0,
    retryable: false,
    is_terminal: false,
    created_at: "2026-08-04T00:00:00Z",
    processing_started_at: "2026-08-04T00:00:00Z",
    ...extras,
  };
}

function stepSummary(steps: SessionStep[]) {
  return steps.map((s) => ({ label: s.label, state: s.state, subtitle: s.subtitle }));
}

describe("resolveCustomerCasePresentation", () => {
  it("returns no action for draft", () => {
    const result = resolveCustomerCasePresentation({ c: caseStub("draft") });
    expect(result.action).toBeUndefined();
    expect(result.statusLabel).toBe("Review not started");
  });

  it("returns upload documents with exact caseId", () => {
    const c = caseStub("awaiting_documents", "case-upload-1");
    const result = resolveCustomerCasePresentation({ c });
    expect(result.action).toEqual({
      type: "route",
      label: "Upload documents",
      href: { pathname: "/(tabs)/documents", params: { caseId: "case-upload-1" } },
    });
  });

  it("shows no action during active extraction processing statuses", () => {
    const processingStatuses: DocumentBatchSummary["status"][] = [
      "checking_duplicates",
      "queued",
      "reading_policy_documents",
      "comparing_policies",
      "validating_extracted_details",
    ];
    for (const status of processingStatuses) {
      const result = resolveCustomerCasePresentation({
        c: caseStub("extracting_information"),
        batch: batchStub(status),
      });
      expect(result.isProcessing).toBe(true);
      expect(result.action).toBeUndefined();
    }
  });

  it("opens review-entities with exact sessionId when ready_for_review", () => {
    const result = resolveCustomerCasePresentation({
      c: caseStub("extracting_information"),
      batch: batchStub("ready_for_review", { session_id: "session-review-1" }),
    });
    expect(result.action).toEqual({
      type: "route",
      label: "Review extracted details",
      href: { pathname: "/onboarding/review-entities", params: { sessionId: "session-review-1" } },
    });
  });

  it("opens documents with caseId, batchId and sessionId when additional_information_required", () => {
    const result = resolveCustomerCasePresentation({
      c: caseStub("extracting_information", "case-ai-1"),
      batch: batchStub("additional_information_required", {
        id: "batch-ai-1",
        session_id: "session-ai-1",
      }),
    });
    expect(result.action).toEqual({
      type: "route",
      label: "Provide missing information",
      href: {
        pathname: "/(tabs)/documents",
        params: {
          caseId: "case-ai-1",
          batchId: "batch-ai-1",
          sessionId: "session-ai-1",
        },
      },
    });
  });

  it("returns retry action when processing_unavailable and retryable", () => {
    const result = resolveCustomerCasePresentation({
      c: caseStub("extracting_information"),
      batch: batchStub("processing_unavailable", { retryable: true, id: "batch-retry-1" }),
    });
    expect(result.action).toEqual({
      type: "retry",
      label: "Retry processing",
      batchId: "batch-retry-1",
      householdId: "h1",
    });
  });

  it("returns no action when processing_unavailable and not retryable", () => {
    const result = resolveCustomerCasePresentation({
      c: caseStub("extracting_information"),
      batch: batchStub("processing_unavailable", { retryable: false }),
    });
    expect(result.action).toBeUndefined();
  });

  it("returns no review action for manual_review", () => {
    const result = resolveCustomerCasePresentation({
      c: caseStub("extracting_information"),
      batch: batchStub("manual_review"),
    });
    expect(result.action).toBeUndefined();
    expect(result.statusLabel).toBe("Sent for review");
  });

  it("fails closed when extracting_information has no batch", () => {
    const result = resolveCustomerCasePresentation({ c: caseStub("extracting_information") });
    expect(result.action).toBeUndefined();
    expect(result.tooltip).toMatch(/missing/);
  });

  it("returns confirm details with exact caseId", () => {
    const c = caseStub("awaiting_customer_confirmation", "case-confirm-1");
    const result = resolveCustomerCasePresentation({ c });
    expect(result.action).toEqual({
      type: "route",
      label: "Confirm details",
      href: { pathname: "/confirm-details", params: { caseId: "case-confirm-1" } },
    });
  });

  it("returns no customer action for ready_for_market_search", () => {
    const result = resolveCustomerCasePresentation({ c: caseStub("ready_for_market_search") });
    expect(result.action).toBeUndefined();
  });

  it("returns no customer action for comparing_quotes", () => {
    const result = resolveCustomerCasePresentation({ c: caseStub("comparing_quotes") });
    expect(result.action).toBeUndefined();
  });

  it("returns no customer action for licensed_review", () => {
    const result = resolveCustomerCasePresentation({ c: caseStub("licensed_review") });
    expect(result.action).toBeUndefined();
  });

  it("returns no approval CTA for recommendation_ready and uses internal wording", () => {
    const result = resolveCustomerCasePresentation({ c: caseStub("recommendation_ready") });
    expect(result.action).toBeUndefined();
    expect(result.statusLabel).toBe("Preparing recommendation");
    expect(result.tooltip).toMatch(/finalized internally/);
  });

  it("returns review recommendation with exact caseId", () => {
    const c = caseStub("customer_decision", "case-rec-1");
    const result = resolveCustomerCasePresentation({ c });
    expect(result.action).toEqual({
      type: "route",
      label: "Review recommendation",
      href: { pathname: "/recommendation", params: { caseId: "case-rec-1" } },
    });
  });

  it("prioritizes a pending question with answer question action using typed route", () => {
    const result = resolveCustomerCasePresentation({
      c: caseStub("requesting_quotes"),
      pendingQuestion: { id: "q-1" },
    });
    expect(result.action).toEqual({
      type: "route",
      label: "Answer question",
      href: { pathname: "/question/[id]", params: { id: "q-1" } },
    });
  });
});

describe("buildCaseTimeline", () => {
  it("cancellation during document upload marks only prior phase failed", () => {
    const { steps, currentStepIndex } = buildCaseTimeline({
      state: "cancelled",
      closedFromState: "awaiting_documents",
    });
    expect(stepSummary(steps)).toEqual([
      { label: "Review your information", state: "failed" },
      { label: "Review cancelled", state: "failed" },
    ]);
    expect(currentStepIndex).toBe(1);
  });

  it("cancellation during extraction marks only review info failed", () => {
    const { steps, currentStepIndex } = buildCaseTimeline({
      state: "cancelled",
      closedFromState: "extracting_information",
    });
    expect(stepSummary(steps)).toEqual([
      { label: "Review your information", state: "failed" },
      { label: "Review cancelled", state: "failed" },
    ]);
    expect(currentStepIndex).toBe(1);
  });

  it("cancellation while awaiting quotes marks search market failed", () => {
    const { steps, currentStepIndex } = buildCaseTimeline({
      state: "cancelled",
      closedFromState: "awaiting_quotes",
    });
    expect(stepSummary(steps)).toEqual([
      { label: "Review your information", state: "completed" },
      { label: "Search the market", state: "failed" },
      { label: "Review cancelled", state: "failed" },
    ]);
    expect(currentStepIndex).toBe(2);
  });

  it("retention from quote comparison marks compare options incomplete", () => {
    const { steps, currentStepIndex } = buildCaseTimeline({
      state: "retained_incumbent",
      closedFromState: "comparing_quotes",
    });
    expect(stepSummary(steps)).toEqual([
      { label: "Review your information", state: "completed" },
      { label: "Search the market", state: "completed" },
      { label: "Compare options", state: "neutral" },
      { label: "Kept current insurance", state: "neutral" },
    ]);
    expect(currentStepIndex).toBe(3);
  });

  it("retention from customer decision marks review recommendation completed", () => {
    const { steps, currentStepIndex } = buildCaseTimeline({
      state: "retained_incumbent",
      closedFromState: "customer_decision",
    });
    expect(stepSummary(steps)).toEqual([
      { label: "Review your information", state: "completed" },
      { label: "Search the market", state: "completed" },
      { label: "Compare options", state: "completed" },
      { label: "Expert review", state: "completed" },
      { label: "Review recommendation", state: "completed" },
      { label: "Kept current insurance", state: "neutral" },
    ]);
    expect(currentStepIndex).toBe(5);
  });

  it("normal completion after switching produces a single Switch completed row", () => {
    const { steps, currentStepIndex } = buildCaseTimeline({
      state: "completed",
      closedFromState: "switching",
    });
    expect(stepSummary(steps)).toEqual([
      { label: "Review your information", state: "completed" },
      { label: "Search the market", state: "completed" },
      { label: "Compare options", state: "completed" },
      { label: "Expert review", state: "completed" },
      { label: "Review recommendation", state: "completed" },
      { label: "Switch completed", state: "completed" },
    ]);
    expect(currentStepIndex).toBe(5);
    expect(steps.filter((s) => s.label === "Switch completed")).toHaveLength(1);
  });

  it("legacy terminal case without closed_from_state reports incomplete history", () => {
    const { steps, currentStepIndex } = buildCaseTimeline({ state: "completed" });
    expect(stepSummary(steps)).toEqual([
      { label: "Switch completed", state: "completed", subtitle: "History incomplete" },
    ]);
    expect(currentStepIndex).toBe(0);
  });

  it("active awaiting_quotes shows search market current with precise status subtitle", () => {
    const { steps, currentStepIndex } = buildCaseTimeline({
      state: "awaiting_quotes",
      preciseStatus: "Waiting for insurer responses",
    });
    expect(steps.map((s) => s.label)).toEqual([
      "Review your information",
      "Search the market",
      "Compare options",
      "Expert review",
      "Review recommendation",
      "Complete your switch",
    ]);
    expect(steps[0]?.state).toBe("completed");
    expect(steps[1]?.state).toBe("current");
    expect(steps[1]?.subtitle).toBe("Waiting for insurer responses");
    expect(steps[2]?.state).toBe("upcoming");
    expect(currentStepIndex).toBe(1);
  });
});
