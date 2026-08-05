import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Href } from "expo-router";
import type { CaseState } from "@autopilot/schemas";
import { invokeEdgeFunction } from "./edge-functions";
import { supabase } from "./supabase";
import { useOptimizationCases, type OptimizationCase } from "./household";
import { formatEdmontonDate, formatEdmontonDateTimeLong } from "./format";
import {
  documentBatchStatusLabels,
  documentBatchStatusTooltips,
  type DocumentBatchSummary,
} from "./document-processing";

export type SessionStepState = "completed" | "current" | "upcoming" | "failed" | "neutral";

export interface SessionStep {
  key: string;
  label: string;
  state: SessionStepState;
  subtitle?: string;
}

export type Actor = "you" | "our team" | "insurer" | "broker" | "operations";

export interface RouteAction {
  type: "route";
  label: string;
  href: Href;
}

export interface RetryAction {
  type: "retry";
  label: string;
  batchId: string;
  householdId: string;
}

export type CustomerCaseAction = RouteAction | RetryAction;

export interface CustomerCasePresentation {
  statusLabel: string;
  statusTone: "accent" | "warning" | "error" | "success" | "neutral";
  tooltip: string;
  actor: Actor;
  action?: CustomerCaseAction;
  isProcessing?: boolean;
  processingSince?: string;
}

export interface AutopilotSession {
  id: string;
  state: CaseState;
  name: string;
  startedAt: string;
  status: string;
  statusTone: CustomerCasePresentation["statusTone"];
  tooltip: string;
  isCurrent: boolean;
  steps: SessionStep[];
  currentStepIndex: number;
  action?: CustomerCaseAction;
  isProcessing?: boolean;
  processingSince?: string;
  closedFromState?: CaseState | null;
}

interface WorkflowStepDef {
  state: CaseState;
  label: string;
  actor: Actor;
  waiting: string;
}

const caseWorkflow: WorkflowStepDef[] = [
  { state: "draft", label: "Start review", actor: "operations", waiting: "Review not started" },
  {
    state: "awaiting_documents",
    label: "Upload your documents",
    actor: "you",
    waiting: "Waiting for you to upload documents",
  },
  {
    state: "extracting_information",
    label: "Extract policy information",
    actor: "our team",
    waiting: "Extracting your information",
  },
  {
    state: "awaiting_customer_confirmation",
    label: "Confirm your details",
    actor: "you",
    waiting: "Waiting for you to confirm information",
  },
  {
    state: "ready_for_market_search",
    label: "Ready for market search",
    actor: "our team",
    waiting: "Ready for market search",
  },
  {
    state: "requesting_quotes",
    label: "Request insurer quotes",
    actor: "our team",
    waiting: "Requesting insurer quotes",
  },
  {
    state: "awaiting_quotes",
    label: "Wait for insurer responses",
    actor: "insurer",
    waiting: "Waiting for insurer responses",
  },
  {
    state: "comparing_quotes",
    label: "Compare eligible options",
    actor: "our team",
    waiting: "Comparing eligible options",
  },
  {
    state: "licensed_review",
    label: "Licensed review",
    actor: "broker",
    waiting: "Waiting for licensed review",
  },
  {
    state: "recommendation_ready",
    label: "Recommendation ready",
    actor: "our team",
    waiting: "Recommendation ready",
  },
  {
    state: "customer_decision",
    label: "Choose to switch",
    actor: "you",
    waiting: "Waiting for your decision",
  },
  {
    state: "switching",
    label: "Complete policy change",
    actor: "our team",
    waiting: "Completing your switch",
  },
  { state: "completed", label: "Switch completed", actor: "our team", waiting: "Completed" },
];

const workflowByState = new Map<CaseState, WorkflowStepDef>(caseWorkflow.map((s) => [s.state, s]));

const terminalStates = new Set<CaseState>(["completed", "retained_incumbent", "cancelled"]);

const activeProcessingStatuses = new Set<DocumentBatchSummary["status"]>([
  "checking_duplicates",
  "queued",
  "reading_policy_documents",
  "comparing_policies",
  "validating_extracted_details",
]);

const questionOverrideStates = new Set<CaseState>([
  "ready_for_market_search",
  "requesting_quotes",
  "awaiting_quotes",
  "comparing_quotes",
  "licensed_review",
  "recommendation_ready",
]);

function sessionName(c: OptimizationCase): string {
  if (c.renewal_date) {
    const year = new Date(c.renewal_date).getFullYear();
    return `${year} Renewal Review`;
  }
  if (c.created_at) {
    return `${formatEdmontonDate(c.created_at)} Review`;
  }
  return "Autopilot session";
}

function statusForState(state: CaseState): {
  label: string;
  tone: CustomerCasePresentation["statusTone"];
  tooltip: string;
} {
  const step = workflowByState.get(state);
  const tooltipByState: Record<CaseState, string> = {
    draft: "The review has not started yet.",
    awaiting_documents: "Upload your policy documents so we can start the review.",
    extracting_information: "We are reading your documents and extracting policy details.",
    awaiting_customer_confirmation: "Please confirm the extracted details before we continue.",
    ready_for_market_search: "We have your details and are preparing to search the market.",
    requesting_quotes: "We are requesting quotes from insurance providers.",
    awaiting_quotes: "Waiting for insurers to respond with quotes.",
    comparing_quotes: "We are comparing the quotes and coverage options.",
    licensed_review: "A licensed advisor is reviewing your case.",
    recommendation_ready:
      "The recommendation is being finalized internally before it is ready for you.",
    customer_decision: "Please choose whether to switch or keep your current policy.",
    switching: "We are completing the policy switch with your chosen insurer.",
    completed: "This review is complete. Your new policy is in place.",
    retained_incumbent: "You decided to keep your current insurance.",
    cancelled: "This review was cancelled.",
  };
  const tooltip = tooltipByState[state] ?? step?.waiting ?? "In progress";
  if (state === "completed")
    return { label: step?.waiting ?? "Completed", tone: "success", tooltip };
  if (state === "retained_incumbent")
    return { label: step?.waiting ?? "Kept current insurance", tone: "neutral", tooltip };
  if (state === "cancelled") return { label: step?.waiting ?? "Cancelled", tone: "error", tooltip };
  if (state === "recommendation_ready")
    return { label: "Preparing recommendation", tone: "warning", tooltip };
  if (state === "awaiting_quotes")
    return { label: step?.waiting ?? "Waiting for insurer responses", tone: "warning", tooltip };
  return { label: step?.waiting ?? "In progress", tone: "accent", tooltip };
}

export interface ResolveCustomerCasePresentationErrors {
  cases?: Error | null;
  batch?: Error | null;
  pendingQuestion?: Error | null;
}

export interface ResolveCustomerCasePresentationInput {
  c: OptimizationCase;
  batch?: DocumentBatchSummary | null;
  pendingQuestion?: { id: string; prompt?: string } | null;
  errors?: ResolveCustomerCasePresentationErrors;
}

export function resolveCustomerCasePresentation({
  c,
  batch,
  pendingQuestion,
  errors,
}: ResolveCustomerCasePresentationInput): CustomerCasePresentation {
  const state = c.state as CaseState;
  const step = workflowByState.get(state);
  const base = statusForState(state);

  if (pendingQuestion && questionOverrideStates.has(state) && !errors?.pendingQuestion) {
    return {
      statusLabel: base.label,
      statusTone: base.tone,
      tooltip: "Your insurer needs an answer before we can continue.",
      actor: "you",
      action: {
        type: "route",
        label: "Answer question",
        href: { pathname: "/question/[id]", params: { id: pendingQuestion.id } },
      },
    };
  }

  if (state === "awaiting_documents") {
    return {
      statusLabel: base.label,
      statusTone: base.tone,
      tooltip: base.tooltip,
      actor: step?.actor ?? "you",
      action: {
        type: "route",
        label: "Upload documents",
        href: { pathname: "/(tabs)/documents", params: { caseId: c.id } },
      },
    };
  }

  if (state === "extracting_information") {
    if (!batch) {
      if (errors?.batch) {
        return {
          statusLabel: "Document batch unavailable",
          statusTone: "error",
          tooltip: "Could not load the document batch. Please try again.",
          actor: step?.actor ?? "our team",
        };
      }
      return {
        statusLabel: base.label,
        statusTone: base.tone,
        tooltip: "Document batch information is missing. Please contact support.",
        actor: step?.actor ?? "our team",
      };
    }

    if (activeProcessingStatuses.has(batch.status)) {
      return {
        statusLabel: documentBatchStatusLabels[batch.status],
        statusTone: base.tone,
        tooltip: documentBatchStatusTooltips[batch.status],
        actor: step?.actor ?? "our team",
        isProcessing: true,
        processingSince: batch.processing_started_at ?? batch.created_at,
      };
    }

    if (batch.status === "ready_for_review") {
      return {
        statusLabel: documentBatchStatusLabels[batch.status],
        statusTone: "accent",
        tooltip: documentBatchStatusTooltips[batch.status],
        actor: "you",
        action: {
          type: "route",
          label: "Review extracted details",
          href: {
            pathname: "/onboarding/review-entities",
            params: { sessionId: batch.session_id },
          },
        },
      };
    }

    if (batch.status === "additional_information_required") {
      return {
        statusLabel: documentBatchStatusLabels[batch.status],
        statusTone: "warning",
        tooltip: documentBatchStatusTooltips[batch.status],
        actor: "you",
        action: {
          type: "route",
          label: "Provide missing information",
          href: {
            pathname: "/(tabs)/documents",
            params: { caseId: c.id, batchId: batch.id, sessionId: batch.session_id },
          },
        },
      };
    }

    if (batch.status === "processing_unavailable") {
      if (batch.retryable) {
        return {
          statusLabel: documentBatchStatusLabels[batch.status],
          statusTone: "error",
          tooltip: documentBatchStatusTooltips[batch.status],
          actor: step?.actor ?? "our team",
          action: {
            type: "retry",
            label: "Retry processing",
            batchId: batch.id,
            householdId: c.household_id,
          },
        };
      }
      return {
        statusLabel: documentBatchStatusLabels[batch.status],
        statusTone: "error",
        tooltip:
          "Processing could not be completed. Enter the policy details manually or contact support.",
        actor: step?.actor ?? "our team",
        action: {
          type: "route",
          label: "Enter details manually",
          href: {
            pathname: "/onboarding/manual-entry",
            params: {
              batchId: batch.id,
              sessionId: batch.session_id,
              caseId: batch.case_id ?? c.id,
            },
          },
        },
      };
    }

    if (batch.status === "manual_review") {
      return {
        statusLabel: documentBatchStatusLabels[batch.status],
        statusTone: "warning",
        tooltip: "We need you to enter the policy details manually.",
        actor: "you",
        action: {
          type: "route",
          label: "Enter details manually",
          href: {
            pathname: "/onboarding/manual-entry",
            params: {
              batchId: batch.id,
              sessionId: batch.session_id,
              caseId: batch.case_id ?? c.id,
            },
          },
        },
      };
    }

    // Any other batch status is not a customer action state.
    return {
      statusLabel: documentBatchStatusLabels[batch.status] ?? base.label,
      statusTone: base.tone,
      tooltip: documentBatchStatusTooltips[batch.status] ?? base.tooltip,
      actor: step?.actor ?? "our team",
    };
  }

  if (state === "awaiting_customer_confirmation") {
    return {
      statusLabel: base.label,
      statusTone: base.tone,
      tooltip: base.tooltip,
      actor: step?.actor ?? "you",
      action: {
        type: "route",
        label: "Confirm details",
        href: { pathname: "/confirm-details", params: { caseId: c.id } },
      },
    };
  }

  if (state === "customer_decision") {
    return {
      statusLabel: base.label,
      statusTone: base.tone,
      tooltip: base.tooltip,
      actor: step?.actor ?? "you",
      action: {
        type: "route",
        label: "Review recommendation",
        href: { pathname: "/recommendation", params: { caseId: c.id } },
      },
    };
  }

  // ready_for_market_search, requesting_quotes, awaiting_quotes, comparing_quotes,
  // licensed_review, switching, and terminal states have no customer action.
  return {
    statusLabel: base.label,
    statusTone: base.tone,
    tooltip: base.tooltip,
    actor: step?.actor ?? "our team",
  };
}

interface DisplayPhase {
  key: string;
  label: string;
  states: CaseState[];
}

const displayPhases: DisplayPhase[] = [
  {
    key: "review_information",
    label: "Review your information",
    states: [
      "draft",
      "awaiting_documents",
      "extracting_information",
      "awaiting_customer_confirmation",
    ],
  },
  {
    key: "search_market",
    label: "Search the market",
    states: ["ready_for_market_search", "requesting_quotes", "awaiting_quotes"],
  },
  { key: "compare_options", label: "Compare options", states: ["comparing_quotes"] },
  { key: "expert_review", label: "Expert review", states: ["licensed_review"] },
  {
    key: "review_recommendation",
    label: "Review recommendation",
    states: ["recommendation_ready", "customer_decision"],
  },
  { key: "complete_switch", label: "Complete your switch", states: ["switching", "completed"] },
];

function phaseForState(state: CaseState): DisplayPhase | undefined {
  return displayPhases.find((p) => p.states.includes(state));
}

function terminalOutcome(state: CaseState): { label: string; state: SessionStepState } {
  switch (state) {
    case "completed":
      return { label: "Switch completed", state: "completed" };
    case "retained_incumbent":
      return { label: "Kept current insurance", state: "neutral" };
    case "cancelled":
      return { label: "Review cancelled", state: "failed" };
    default:
      return { label: "Closed", state: "neutral" };
  }
}

export interface BuildCaseTimelineInput {
  state: string;
  closedFromState?: string | null;
  preciseStatus?: string;
}

export function buildCaseTimeline(input: BuildCaseTimelineInput): {
  steps: SessionStep[];
  currentStepIndex: number;
} {
  const state = input.state as CaseState;
  const closedFrom = (input.closedFromState ?? null) as CaseState | null;
  const preciseStatus = input.preciseStatus;

  if (terminalStates.has(state)) {
    if (!closedFrom) {
      const outcome = terminalOutcome(state);
      return {
        steps: [
          {
            key: "terminal",
            label: outcome.label,
            state: outcome.state,
            subtitle: "History incomplete",
          },
        ],
        currentStepIndex: 0,
      };
    }

    const sourcePhase = phaseForState(closedFrom);
    if (!sourcePhase) {
      const outcome = terminalOutcome(state);
      return {
        steps: [
          {
            key: "terminal",
            label: outcome.label,
            state: outcome.state,
            subtitle: "History incomplete",
          },
        ],
        currentStepIndex: 0,
      };
    }

    const sourceIndex = displayPhases.indexOf(sourcePhase);
    const steps: SessionStep[] = [];

    for (let i = 0; i < sourceIndex; i++) {
      const phase = displayPhases[i];
      if (!phase) continue;
      steps.push({ key: phase.key, label: phase.label, state: "completed" });
    }

    if (state === "completed" && sourcePhase.key === "complete_switch") {
      steps.push({ key: "terminal", label: "Switch completed", state: "completed" });
      return { steps, currentStepIndex: steps.length - 1 };
    }

    const sourceCompleted =
      state === "completed" ||
      (state === "retained_incumbent" && sourcePhase.key === "review_recommendation");
    steps.push({
      key: sourcePhase.key,
      label: sourcePhase.label,
      state: sourceCompleted ? "completed" : state === "cancelled" ? "failed" : "neutral",
    });

    const outcome = terminalOutcome(state);
    steps.push({ key: "terminal", label: outcome.label, state: outcome.state });
    return { steps, currentStepIndex: steps.length - 1 };
  }

  const currentPhase = phaseForState(state);
  const currentIndex = currentPhase ? displayPhases.indexOf(currentPhase) : 0;
  const steps: SessionStep[] = displayPhases.map((phase, i) => {
    if (i < currentIndex) return { key: phase.key, label: phase.label, state: "completed" };
    if (i === currentIndex)
      return { key: phase.key, label: phase.label, state: "current", subtitle: preciseStatus };
    return { key: phase.key, label: phase.label, state: "upcoming" };
  });
  return { steps, currentStepIndex: currentIndex };
}

function buildSession(
  c: OptimizationCase,
  isCurrent: boolean,
  batches: DocumentBatchSummary[],
  pendingQuestion?: { id: string; prompt?: string } | null,
  errors?: ResolveCustomerCasePresentationErrors,
): AutopilotSession {
  const isTerminal = terminalStates.has(c.state as CaseState);
  const batch = batches.find((b) => b.case_id === c.id);
  const presentation = resolveCustomerCasePresentation({ c, batch, pendingQuestion, errors });
  const { steps, currentStepIndex } = buildCaseTimeline({
    state: c.state,
    closedFromState: c.closed_from_state,
    preciseStatus: presentation.statusLabel,
  });

  return {
    id: c.id,
    state: c.state as CaseState,
    name: sessionName(c),
    startedAt: formatEdmontonDateTimeLong(c.created_at),
    status: presentation.statusLabel,
    statusTone: presentation.statusTone,
    tooltip: presentation.tooltip,
    isCurrent: isCurrent && !isTerminal,
    steps,
    currentStepIndex,
    action: isTerminal ? undefined : presentation.action,
    isProcessing: presentation.isProcessing,
    processingSince: presentation.processingSince,
    closedFromState: c.closed_from_state as CaseState | undefined,
  };
}

export function useAutopilotSessions(householdId: string | undefined) {
  const {
    data: cases,
    isLoading,
    error: casesError,
    refetch: refetchCases,
  } = useOptimizationCases(householdId);
  const {
    data: batches,
    isLoading: batchesLoading,
    error: batchesError,
    refetch: refetchBatches,
  } = useQuery<DocumentBatchSummary[]>({
    queryKey: ["document-processing-batches", householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data, error: queryError } = await invokeEdgeFunction<DocumentBatchSummary[]>(
        "document-processing-batch",
        { action: "list", household_id: householdId },
      );
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      const activeStatuses = new Set<DocumentBatchSummary["status"]>([
        "checking_duplicates",
        "queued",
        "reading_policy_documents",
        "comparing_policies",
        "validating_extracted_details",
      ]);
      return rows.some((b) => activeStatuses.has(b.status)) ? 5_000 : false;
    },
  });

  const currentCase = useMemo(
    () => cases?.find((c) => !terminalStates.has(c.state as CaseState)) ?? null,
    [cases],
  );
  const currentCaseId = currentCase?.id;

  const {
    data: pendingQuestion,
    isLoading: pendingQuestionLoading,
    error: pendingQuestionError,
    refetch: refetchPendingQuestion,
  } = useQuery<{
    id: string;
    prompt?: string;
  } | null>({
    queryKey: ["pending-question", currentCaseId],
    enabled: !!currentCaseId,
    queryFn: async () => {
      const { data, error: queryError } = await supabase
        .from("customer_questions")
        .select("id, prompt")
        .eq("case_id", currentCaseId!)
        .eq("status", "pending")
        .limit(1)
        .maybeSingle();
      if (queryError) throw queryError;
      return data;
    },
  });

  const errors = useMemo<ResolveCustomerCasePresentationErrors>(
    () => ({
      cases: casesError,
      batch: batchesError,
      pendingQuestion: pendingQuestionError,
    }),
    [casesError, batchesError, pendingQuestionError],
  );

  const sessions = useMemo(() => {
    if (!cases) return { current: null, past: [] };
    const current = cases.find((c) => !terminalStates.has(c.state as CaseState)) ?? null;
    const others = cases.filter((c) => c.id !== current?.id);
    return {
      current: current
        ? buildSession(
            current,
            true,
            batches ?? [],
            current.id === currentCaseId ? (pendingQuestion ?? undefined) : undefined,
            errors,
          )
        : null,
      past: others.map((c) => buildSession(c, false, batches ?? [], undefined, errors)),
    };
  }, [cases, batches, pendingQuestion, currentCaseId, errors]);

  const error = casesError ?? batchesError ?? pendingQuestionError ?? null;

  const refetch = async () => {
    await Promise.all([
      refetchCases(),
      refetchBatches(),
      currentCaseId ? refetchPendingQuestion() : Promise.resolve(),
    ]);
  };

  return {
    ...sessions,
    isLoading: isLoading || batchesLoading || pendingQuestionLoading,
    error,
    refetch,
  };
}
