import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CaseState } from "@autopilot/schemas";
import { invokeEdgeFunction } from "./edge-functions";
import { useOptimizationCases, type OptimizationCase } from "./household";
import { formatEdmontonDate, formatEdmontonDateTimeLong } from "./format";

export type SessionStepState = "completed" | "current" | "upcoming" | "failed";

export interface SessionStep {
  key: CaseState;
  label: string;
  state: SessionStepState;
}

export interface AutopilotSession {
  id: string;
  name: string;
  startedAt: string;
  status: string;
  statusTone: "accent" | "warning" | "error" | "success" | "neutral";
  tooltip: string;
  isCurrent: boolean;
  steps: SessionStep[];
  currentStepIndex: number;
  action?: {
    label: string;
    route: string;
    params?: Record<string, string>;
  };
  isProcessing?: boolean;
}

const terminalStates = new Set<CaseState>(["completed", "retained_incumbent", "cancelled"]);

interface BatchSummary {
  id: string;
  session_id: string;
  status: string;
  is_terminal: boolean;
}

interface WorkflowStepDef {
  state: CaseState;
  label: string;
  actor: "you" | "our team" | "insurer" | "broker";
  waiting: string;
}

const caseWorkflow: WorkflowStepDef[] = [
  { state: "draft", label: "Start review", actor: "our team", waiting: "Review not started" },
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
  tone: AutopilotSession["statusTone"];
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
    recommendation_ready: "A recommendation is ready for you to review.",
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
    return { label: step?.waiting ?? "Recommendation ready", tone: "success", tooltip };
  if (state === "awaiting_quotes")
    return { label: step?.waiting ?? "Waiting for insurer responses", tone: "warning", tooltip };
  return { label: step?.waiting ?? "In progress", tone: "accent", tooltip };
}

function actionForState(
  state: CaseState,
  caseId?: string,
  sessionId?: string | null,
): AutopilotSession["action"] {
  if (state === "awaiting_documents") {
    return { label: "Upload document", route: "/(tabs)/documents" };
  }
  if (state === "extracting_information" && sessionId) {
    return {
      label: "Review",
      route: "/onboarding/review-entities",
      params: { sessionId },
    };
  }
  if (state === "awaiting_customer_confirmation" && caseId) {
    return { label: "Confirm", route: "/confirm-details", params: { caseId } };
  }
  if ((state === "recommendation_ready" || state === "customer_decision") && caseId) {
    return { label: "View details", route: "/recommendation", params: { caseId } };
  }
  return undefined;
}

function buildSteps(
  state: CaseState,
  mode: "current" | "past",
): { steps: SessionStep[]; currentStepIndex: number } {
  let currentIndex = caseWorkflow.findIndex((s) => s.state === state);
  let terminalStepState: SessionStepState | null = null;

  if (state === "retained_incumbent") {
    terminalStepState = "completed";
    currentIndex = caseWorkflow.findIndex((s) => s.state === "customer_decision");
  } else if (state === "cancelled") {
    terminalStepState = "failed";
    currentIndex = caseWorkflow.findIndex((s) => s.state === "customer_decision");
  }

  const effectiveIndex = currentIndex === -1 ? 0 : currentIndex;

  const steps: SessionStep[] = caseWorkflow.map((def, index) => {
    let stepState: SessionStepState;
    if (mode === "past") {
      if (index < effectiveIndex) stepState = "completed";
      else if (index === effectiveIndex) stepState = terminalStepState ?? "completed";
      else stepState = "upcoming";
    } else {
      if (index < effectiveIndex) stepState = "completed";
      else if (index === effectiveIndex) stepState = terminalStepState ?? "current";
      else stepState = "upcoming";
    }
    return { key: def.state, label: def.label, state: stepState };
  });

  return { steps, currentStepIndex: effectiveIndex };
}

function buildSession(
  c: OptimizationCase,
  isCurrent: boolean,
  batches?: BatchSummary[],
): AutopilotSession {
  const isTerminal = terminalStates.has(c.state as CaseState);
  const { steps, currentStepIndex } = buildSteps(
    c.state as CaseState,
    isTerminal ? "past" : "current",
  );
  const status = statusForState(c.state as CaseState);
  const batch = batches?.find((b) => b.session_id === c.session_id);
  const isProcessing =
    !isTerminal && c.state === "extracting_information" && !!batch && !batch.is_terminal;
  return {
    id: c.id,
    name: sessionName(c),
    startedAt: formatEdmontonDateTimeLong(c.created_at),
    status: status.label,
    statusTone: status.tone,
    tooltip: status.tooltip,
    isCurrent: isCurrent && !isTerminal,
    steps,
    currentStepIndex,
    action:
      isProcessing || isTerminal
        ? undefined
        : actionForState(c.state as CaseState, c.id, c.session_id),
    isProcessing,
  };
}

export function useAutopilotSessions(householdId: string | undefined) {
  const { data: cases, isLoading, error, refetch } = useOptimizationCases(householdId);
  const { data: batches, isLoading: batchesLoading } = useQuery<BatchSummary[]>({
    queryKey: ["document-processing-batches", householdId],
    enabled: !!householdId,
    queryFn: async () => {
      const { data, error: queryError } = await invokeEdgeFunction<BatchSummary[]>(
        "document-processing-batch",
        { action: "list", household_id: householdId },
      );
      if (queryError) throw new Error(queryError.message);
      return data ?? [];
    },
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      return rows.some((b) => !b.is_terminal) ? 2000 : false;
    },
  });

  const sessions = useMemo(() => {
    if (!cases) return { current: null, past: [] };
    const active = cases.filter((c) => !terminalStates.has(c.state as CaseState));
    const current = active[0] ?? null;
    const others = active
      .slice(1)
      .concat(cases.filter((c) => terminalStates.has(c.state as CaseState)));
    return {
      current: current ? buildSession(current, true, batches) : null,
      past: others.map((c) => buildSession(c, false, batches)),
    };
  }, [cases, batches]);

  return { ...sessions, isLoading: isLoading || batchesLoading, error, refetch };
}
