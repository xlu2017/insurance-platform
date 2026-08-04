import { resolveCustomerCasePresentation, type AutopilotSession } from "@/lib/autopilot";
import { type OptimizationCase } from "@/lib/household";
import { type DocumentBatchSummary } from "@/lib/document-processing";

function caseStub(state: string, id = "case-1"): OptimizationCase {
  return {
    id,
    household_id: "h1",
    state,
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

  it("returns no approval CTA for recommendation_ready", () => {
    const result = resolveCustomerCasePresentation({ c: caseStub("recommendation_ready") });
    expect(result.action).toBeUndefined();
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

  it("prioritizes a pending question with answer question action", () => {
    const result = resolveCustomerCasePresentation({
      c: caseStub("requesting_quotes"),
      pendingQuestion: { id: "q-1" },
    });
    expect(result.action).toEqual({
      type: "route",
      label: "Answer question",
      href: { pathname: "/question/q-1" },
    });
  });
});

describe("AutopilotSession timeline", () => {
  it("builds terminal cancelled timeline from the closed_from_state", () => {
    const session: AutopilotSession = {
      id: "c1",
      state: "cancelled",
      name: "Review",
      startedAt: "now",
      status: "Cancelled",
      statusTone: "error",
      tooltip: "",
      isCurrent: false,
      steps: [
        { key: "awaiting_documents", label: "Upload your documents", state: "completed" },
        { key: "extracting_information", label: "Extract policy information", state: "completed" },
        { key: "awaiting_customer_confirmation", label: "Confirm your details", state: "upcoming" },
        { key: "ready_for_market_search", label: "Ready for market search", state: "upcoming" },
        { key: "requesting_quotes", label: "Request insurer quotes", state: "upcoming" },
        { key: "awaiting_quotes", label: "Wait for insurer responses", state: "upcoming" },
        { key: "comparing_quotes", label: "Compare eligible options", state: "upcoming" },
        { key: "licensed_review", label: "Licensed review", state: "upcoming" },
        { key: "recommendation_ready", label: "Recommendation ready", state: "upcoming" },
        { key: "customer_decision", label: "Choose to switch", state: "upcoming" },
        { key: "switching", label: "Complete policy change", state: "upcoming" },
        { key: "completed", label: "Switch completed", state: "upcoming" },
        { key: "terminal", label: "Review cancelled", state: "failed" },
      ],
      currentStepIndex: 1,
    };
    expect(session.steps[session.currentStepIndex]?.key).toBe("extracting_information");
    expect(session.steps.find((s) => s.key === "licensed_review")?.state).toBe("upcoming");
    expect(session.steps.find((s) => s.key === "terminal")?.state).toBe("failed");
  });
});
