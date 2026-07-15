import type { CaseState, QuoteRequestState, QuoteState, SwitchState } from "./enums";

export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

export const caseTransitions: TransitionMap<CaseState> = {
  draft: ["awaiting_documents", "cancelled"],
  awaiting_documents: ["extracting_information", "cancelled"],
  extracting_information: ["awaiting_customer_confirmation", "awaiting_documents", "cancelled"],
  awaiting_customer_confirmation: ["ready_for_market_search", "extracting_information", "cancelled"],
  ready_for_market_search: ["requesting_quotes", "cancelled"],
  requesting_quotes: ["awaiting_quotes", "cancelled"],
  awaiting_quotes: ["comparing_quotes", "requesting_quotes", "cancelled"],
  comparing_quotes: ["licensed_review", "awaiting_quotes", "retained_incumbent", "cancelled"],
  licensed_review: ["recommendation_ready", "comparing_quotes", "cancelled"],
  recommendation_ready: ["customer_decision", "cancelled"],
  customer_decision: ["switching", "retained_incumbent", "cancelled"],
  switching: ["completed", "cancelled"],
  completed: [],
  retained_incumbent: [],
  cancelled: [],
};

export const quoteRequestTransitions: TransitionMap<QuoteRequestState> = {
  draft: ["queued", "cancelled"],
  queued: ["sent", "cancelled"],
  sent: ["additional_information_required", "response_received", "declined", "no_response", "cancelled"],
  additional_information_required: ["sent", "response_received", "declined", "no_response", "cancelled"],
  response_received: [],
  declined: [],
  no_response: [],
  cancelled: [],
};

export const quoteTransitions: TransitionMap<QuoteState> = {
  estimate: ["conditional", "bindable", "expired", "rejected"],
  conditional: ["bindable", "expired", "rejected"],
  bindable: ["selected", "expired", "rejected"],
  expired: [],
  rejected: [],
  selected: [],
};

export const switchTransitions: TransitionMap<SwitchState> = {
  customer_approved: ["replacement_pending", "failed"],
  replacement_pending: ["replacement_confirmed", "failed"],
  replacement_confirmed: ["incumbent_cancellation_pending", "failed"],
  incumbent_cancellation_pending: ["incumbent_cancelled", "failed"],
  incumbent_cancelled: ["completed", "failed"],
  completed: [],
  failed: [],
};

export function canTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
): boolean {
  return map[from].includes(to);
}

export function assertTransition<S extends string>(map: TransitionMap<S>, from: S, to: S): void {
  if (!canTransition(map, from, to)) {
    throw new Error(`Invalid transition: ${from} -> ${to}`);
  }
}
